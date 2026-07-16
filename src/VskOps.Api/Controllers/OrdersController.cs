using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VskOps.Api.Auth;
using VskOps.Core.Domain;
using VskOps.Core.Services;
using VskOps.Infrastructure.Repositories;

namespace VskOps.Api.Controllers;

public record OrderLineRequest(int CylinderTypeId, int Qty);
public record CreateOrderRequest(
    int CustomerId, DateOnly? OrderDate,
    List<OrderLineRequest> Items,
    List<OrderLineRequest>? Purchases);
public record ApprovalRequest(string Owner);
public record PaymentRequest(string Method, decimal Amount);
public record SettlementRequest(int CustomerId, string Method, decimal Amount);

[ApiController]
[Route("api/orders")]
public class OrdersController(
    OrderRepository orders,
    CustomerRepository customers,
    CylinderTypeRepository cylinderTypes,
    PricingRepository pricing,
    EventRepository events,
    NotificationRepository notifications) : ControllerBase
{
    private static readonly string[] ValidMethods = ["Cash", "Online"];

    [HttpGet]
    [Authorize(Policy = AuthPolicies.OrdersRead)]
    public async Task<IReadOnlyList<Order>> GetAll([FromQuery] int? customerId) =>
        customerId is { } cid ? await orders.GetByCustomer(cid) : await orders.GetAll();

    [HttpGet("{id:int}")]
    [Authorize(Policy = AuthPolicies.OrdersRead)]
    public async Task<ActionResult<Order>> GetById(int id) =>
        await orders.GetById(id) is { } o ? o : NotFound();

    [HttpGet("{id:int}/history")]
    [Authorize(Policy = AuthPolicies.OrdersRead)]
    public async Task<ActionResult> GetHistory(int id)
    {
        var rows = await orders.GetHistory(id);
        return Ok(rows.Select(h => new { h.Stage, h.Timestamp }));
    }

    /// <summary>
    /// Places an order: delivery lines priced at the customer's effective rate for the order date;
    /// optional empty-cylinder purchase lines capped at what the customer actually holds. Purchases
    /// transfer ownership immediately (no delivery run needed) and are billed on this same order.
    /// </summary>
    [HttpPost]
    [Authorize(Policy = AuthPolicies.OrderCreate)]
    public async Task<ActionResult> Create(CreateOrderRequest req)
    {
        var customer = await customers.GetById(req.CustomerId);
        if (customer is null) return BadRequest("Unknown customer.");

        var orderDate = req.OrderDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var mrpHistory = await pricing.GetMrpHistory();
        var discounts = await pricing.GetDiscounts();
        var types = (await cylinderTypes.GetAll()).ToDictionary(t => t.Id);
        var customerEvents = await events.GetByCustomer(customer.Id);

        var built = OrderBuilder.Build(
            customer.Id, orderDate,
            req.Items.Select(i => new NewOrderLine(i.CylinderTypeId, i.Qty)),
            (req.Purchases ?? []).Select(p => new NewOrderLine(p.CylinderTypeId, p.Qty)),
            mrpHistory, discounts, types,
            typeId => Ledger.EmptiesAtCustomer(customerEvents, customer, typeId));

        if (built.Items.Count == 0 && built.Purchases.Count == 0)
            return BadRequest("Order needs at least one delivery line or empty-cylinder purchase.");

        var order = new Order
        {
            CustomerId = customer.Id,
            OrderDate = orderDate,
            Stage = OrderStage.Placed,
            Amount = built.Amount,
            Items = built.Items,
            EmptyPurchases = built.Purchases,
        };
        var id = await orders.InsertOrder(order, built.PurchaseEvents);

        var purchaseNote = built.Purchases.Count > 0
            ? $" Includes purchase of {built.Purchases.Sum(p => p.Qty)} empty cylinder(s)."
            : "";
        await notifications.Insert("Owners (SK/SC/KBR)",
            $"New order #{id} placed by {customer.Name} for {orderDate:dd-MM-yyyy} — awaiting approval.{purchaseNote}");
        return CreatedAtAction(nameof(GetById), new { id }, new { id, amount = built.Amount });
    }

    [HttpPost("{id:int}/approve")]
    [Authorize(Policy = AuthPolicies.OrderApprove)]
    public async Task<ActionResult> Approve(int id, ApprovalRequest req)
    {
        var order = await orders.GetById(id);
        if (order is null) return NotFound();
        if (order.Rejected || order.Stage != OrderStage.Placed) return Conflict("Order is not awaiting approval.");
        await orders.SetApproval(id, approved: true, req.Owner);
        await notifications.Insert("Dispatch", $"Order #{id} approved by {req.Owner}. Ready to be grouped into a delivery trip.");
        return NoContent();
    }

    [HttpPost("{id:int}/reject")]
    [Authorize(Policy = AuthPolicies.OrderApprove)]
    public async Task<ActionResult> Reject(int id, ApprovalRequest req)
    {
        var order = await orders.GetById(id);
        if (order is null) return NotFound();
        if (order.Rejected || order.Stage != OrderStage.Placed) return Conflict("Order is not awaiting approval.");
        await orders.SetApproval(id, approved: false, req.Owner);
        await notifications.Insert($"Customer {order.CustomerId}", $"Order #{id} was rejected by {req.Owner}.");
        return NoContent();
    }

    /// <summary>Records a payment on one delivered order, capped at the remaining due.</summary>
    [HttpPost("{id:int}/payments")]
    [Authorize(Policy = AuthPolicies.Payments)]
    public async Task<ActionResult> RecordPayment(int id, PaymentRequest req)
    {
        if (!ValidMethods.Contains(req.Method)) return BadRequest("Method must be Cash or Online.");
        var order = await orders.GetById(id);
        if (order is null) return NotFound();

        var amount = Math.Min(req.Amount, Ledger.DueOf(order));
        if (amount <= 0) return Conflict("Nothing is due on this order (payments are recorded only after delivery).");

        await orders.AddPayment(id, req.Method, amount, $"Payment ₹{amount} via {req.Method}");
        await notifications.Insert("Dispatch", $"₹{amount} recorded via {req.Method} for order #{id}.");
        return Ok(new { applied = amount });
    }

    /// <summary>
    /// One payment from a customer applied across all their outstanding delivered orders,
    /// oldest order date first. Any amount beyond the total due is reported back, not applied.
    /// </summary>
    [HttpPost("settle")]
    [Authorize(Policy = AuthPolicies.Payments)]
    public async Task<ActionResult> Settle(SettlementRequest req)
    {
        if (!ValidMethods.Contains(req.Method)) return BadRequest("Method must be Cash or Online.");
        if (req.Amount <= 0) return BadRequest("Amount must be positive.");

        var customerOrders = await orders.GetByCustomer(req.CustomerId);
        var allocations = Ledger.AllocateSettlement(customerOrders, req.Amount);
        if (allocations.Count == 0) return Conflict("Customer has no outstanding delivered orders.");

        await orders.AddPayments(allocations.Select(a =>
            (a.OrderId, req.Method, a.Amount, $"Payment ₹{a.Amount} via {req.Method} (bulk settlement)")));

        var applied = allocations.Sum(a => a.Amount);
        var unapplied = req.Amount - applied;
        await notifications.Insert("Dispatch",
            $"₹{applied} from customer {req.CustomerId} settled across {allocations.Count} order(s) (oldest dues first)."
            + (unapplied > 0 ? $" ₹{unapplied} exceeds total dues and was not applied." : ""));
        return Ok(new { applied, unapplied, orders = allocations });
    }
}
