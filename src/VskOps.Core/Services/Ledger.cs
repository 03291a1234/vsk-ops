using VskOps.Core.Domain;

namespace VskOps.Core.Services;

/// <summary>
/// Payment / ledger rules ported from the prototype. The central rule: an order's balance only
/// crystallizes as "due" once it is delivered — rejected or in-flight orders owe nothing yet.
/// </summary>
public static class Ledger
{
    /// <summary>Sum of payments recorded on/before <paramref name="asOf"/> (all-time when null).</summary>
    public static decimal TotalPaid(Order order, DateOnly? asOf = null)
    {
        var payments = asOf is { } d
            ? order.Payments.Where(p => DateOnly.FromDateTime(p.Timestamp) <= d)
            : order.Payments;
        return payments.Sum(p => p.Amount);
    }

    /// <summary>Remaining balance owed — 0 until the order is delivered, never negative.</summary>
    public static decimal DueOf(Order order, DateOnly? asOf = null)
    {
        if (order.Rejected || order.Stage < OrderStage.Delivered) return 0;
        return Math.Max(0, order.Amount - TotalPaid(order, asOf));
    }

    public static PaymentStatus StatusOf(Order order)
    {
        if (order.Rejected) return PaymentStatus.Rejected;
        if (order.Stage < OrderStage.Delivered) return PaymentStatus.AwaitingDelivery;
        if (DueOf(order) <= 0) return PaymentStatus.Paid;
        return TotalPaid(order) > 0 ? PaymentStatus.PartiallyPaid : PaymentStatus.Unpaid;
    }

    /// <summary>
    /// Opening balance plus remaining due on delivered orders dated on/before <paramref name="asOf"/>,
    /// counting only payments recorded on/before that date.
    /// </summary>
    public static decimal BalanceAsOf(decimal openingBalance, IEnumerable<Order> customerOrders, DateOnly asOf) =>
        openingBalance + customerOrders
            .Where(o => !o.Rejected && o.OrderDate <= asOf)
            .Sum(o => DueOf(o, asOf));

    /// <summary>
    /// Cylinders currently sitting with a customer for one type, all-time:
    /// Filled − Empty returns − already-purchased, plus any opening balance. Never negative.
    /// </summary>
    public static int EmptiesAtCustomer(IEnumerable<CylinderEvent> customerEvents, Customer customer, int cylinderTypeId)
    {
        var evs = customerEvents.Where(e => e.CustomerId == customer.Id && e.CylinderTypeId == cylinderTypeId).ToList();
        var filled = evs.Where(e => e.Action == CylinderAction.Filled).Sum(e => e.Qty);
        var empty = evs.Where(e => e.Action == CylinderAction.EmptyReturn).Sum(e => e.Qty);
        var purchased = evs.Where(e => e.Action == CylinderAction.EmptyPurchased).Sum(e => e.Qty);
        var opening = customer.OpeningEmptiesCylinderTypeId == cylinderTypeId ? customer.OpeningEmptiesQty : 0;
        return Math.Max(0, filled - empty - purchased + opening);
    }

    /// <summary>
    /// One payment from a customer applied across their outstanding delivered orders —
    /// oldest order date first (created-at breaks ties). Returns per-order allocations;
    /// any amount beyond the total due is left unallocated.
    /// </summary>
    public static IReadOnlyList<SettlementAllocation> AllocateSettlement(IEnumerable<Order> orders, decimal amount)
    {
        var remaining = amount;
        var allocations = new List<SettlementAllocation>();
        if (remaining <= 0) return allocations;

        var dueOrders = orders
            .Where(o => !o.Rejected && o.Stage == OrderStage.Delivered && DueOf(o) > 0)
            .OrderBy(o => o.OrderDate)
            .ThenBy(o => o.CreatedAt);

        foreach (var o in dueOrders)
        {
            if (remaining <= 0) break;
            var alloc = Math.Min(remaining, DueOf(o));
            if (alloc > 0)
            {
                allocations.Add(new SettlementAllocation(o.Id, alloc));
                remaining -= alloc;
            }
        }
        return allocations;
    }
}

public record SettlementAllocation(int OrderId, decimal Amount);
