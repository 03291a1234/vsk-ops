using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VskOps.Api.Auth;
using VskOps.Core.Domain;
using VskOps.Infrastructure.Repositories;

namespace VskOps.Api.Controllers;

[ApiController]
[Route("api/drivers")]
[Authorize(Policy = AuthPolicies.MasterData)]
public class DriversController(DriverRepository repo) : ControllerBase
{
    [HttpGet] public async Task<IReadOnlyList<Driver>> GetAll() => await repo.GetAll();

    [HttpPost]
    public async Task<ActionResult> Create(Driver d)
    {
        if (string.IsNullOrWhiteSpace(d.Name)) return BadRequest("Name is required.");
        var id = await repo.Insert(d);
        return CreatedAtAction(nameof(GetAll), new { id }, new { id });
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id) { await repo.Delete(id); return NoContent(); }
}

[ApiController]
[Route("api/trucks")]
[Authorize(Policy = AuthPolicies.MasterData)]
public class TrucksController(TruckRepository repo) : ControllerBase
{
    [HttpGet] public async Task<IReadOnlyList<Truck>> GetAll() => await repo.GetAll();

    [HttpPost]
    public async Task<ActionResult> Create(Truck t)
    {
        if (string.IsNullOrWhiteSpace(t.RegNo)) return BadRequest("Registration number is required.");
        var id = await repo.Insert(t);
        return CreatedAtAction(nameof(GetAll), new { id }, new { id });
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id) { await repo.Delete(id); return NoContent(); }
}

[ApiController]
[Route("api/vendors")]
[Authorize(Policy = AuthPolicies.MasterData)]
public class VendorsController(VendorRepository repo) : ControllerBase
{
    [HttpGet] public async Task<IReadOnlyList<Vendor>> GetAll() => await repo.GetAll();

    [HttpPost]
    public async Task<ActionResult> Create(Vendor v)
    {
        if (string.IsNullOrWhiteSpace(v.Name)) return BadRequest("Name is required.");
        var id = await repo.Insert(v);
        return CreatedAtAction(nameof(GetAll), new { id }, new { id });
    }

    /// <summary>Vendors with billing history can't be deleted (mirrors the prototype's guard).</summary>
    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id)
    {
        if (await repo.HasBillingHistory(id)) return Conflict("Vendor has billing history and can't be deleted.");
        await repo.Delete(id);
        return NoContent();
    }
}

[ApiController]
[Route("api/customers")]
[Authorize(Policy = AuthPolicies.MasterData)]
public class CustomersController(
    CustomerRepository repo,
    CylinderTypeRepository cylinderTypes,
    EventRepository events) : ControllerBase
{
    [HttpGet] public async Task<IReadOnlyList<Customer>> GetAll() => await repo.GetAll();

    /// <summary>
    /// Cylinders this customer currently holds per type (filled − returned − purchased + opening) —
    /// what the New Order screen offers for outright purchase.
    /// </summary>
    [HttpGet("{id:int}/empties")]
    public async Task<ActionResult> GetEmptiesBalance(int id)
    {
        var customer = await repo.GetById(id);
        if (customer is null) return NotFound();
        var customerEvents = await events.GetByCustomer(id);
        var rows = (await cylinderTypes.GetAll())
            .Select(ct => new { cylinderTypeId = ct.Id, balance = Core.Services.Ledger.EmptiesAtCustomer(customerEvents, customer, ct.Id) })
            .Where(r => r.balance > 0)
            .ToList();
        return Ok(rows);
    }

    [HttpPost]
    public async Task<ActionResult> Create(Customer c)
    {
        if (string.IsNullOrWhiteSpace(c.Name)) return BadRequest("Name is required.");
        if (c.OpeningEmptiesQty <= 0) c.OpeningEmptiesCylinderTypeId = null;
        var id = await repo.Insert(c);
        return CreatedAtAction(nameof(GetAll), new { id }, new { id });
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id) { await repo.Delete(id); return NoContent(); }
}

public record SetInventoryRequest(int Full, int Empty, int Defective);
public record SetEmptyPriceRequest(decimal EmptyPrice);

[ApiController]
[Route("api/cylinder-types")]
public class CylinderTypesController(CylinderTypeRepository repo, InventoryRepository inventory) : ControllerBase
{
    [HttpGet]
    [Authorize] // read needed by every role's screens
    public async Task<IReadOnlyList<CylinderType>> GetAll() => await repo.GetAll();

    [HttpPost]
    [Authorize(Policy = AuthPolicies.MasterData)]
    public async Task<ActionResult> Create(CylinderType ct)
    {
        if (string.IsNullOrWhiteSpace(ct.Name)) return BadRequest("Name is required.");
        var id = await repo.Insert(ct);
        return CreatedAtAction(nameof(GetAll), new { id }, new { id });
    }

    /// <summary>Empty-purchase price is a pricing decision — Owner/Accountant only.</summary>
    [HttpPut("{id:int}/empty-price")]
    [Authorize(Policy = AuthPolicies.Pricing)]
    public async Task<ActionResult> SetEmptyPrice(int id, SetEmptyPriceRequest req)
    {
        if (req.EmptyPrice < 0) return BadRequest("Price can't be negative.");
        await repo.SetEmptyPrice(id, req.EmptyPrice);
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = AuthPolicies.MasterData)]
    public async Task<ActionResult> Delete(int id) { await repo.Delete(id); return NoContent(); }

    [HttpGet("inventory")]
    [Authorize(Policy = AuthPolicies.DispatchRead)]
    public async Task<IReadOnlyList<InventoryRecord>> GetInventory() => await inventory.GetAll();

    /// <summary>Manual depot-stock correction — automatic movements happen on trip departure/delivery and IOCL transactions.</summary>
    [HttpPut("{id:int}/inventory")]
    [Authorize(Policy = AuthPolicies.MasterData)]
    public async Task<ActionResult> SetInventory(int id, SetInventoryRequest req)
    {
        await inventory.Set(id, req.Full, req.Empty, req.Defective);
        return NoContent();
    }

    [HttpDelete("{id:int}/inventory")]
    [Authorize(Policy = AuthPolicies.MasterData)]
    public async Task<ActionResult> DeleteInventory(int id) { await inventory.Delete(id); return NoContent(); }
}

public record CreateMrpRequest(int CylinderTypeId, decimal Value, DateOnly EffectiveFrom);
public record CreateDiscountRequest(int CustomerId, int CylinderTypeId, decimal Amount, DateOnly StartDate, DateOnly EndDate);

[ApiController]
[Route("api/pricing")]
[Authorize(Policy = AuthPolicies.Pricing)]
public class PricingController(PricingRepository repo) : ControllerBase
{
    [HttpGet("mrp")] public async Task<IReadOnlyList<MrpEntry>> GetMrpHistory() => await repo.GetMrpHistory();

    [HttpPost("mrp")]
    public async Task<ActionResult> AddMrp(CreateMrpRequest req)
    {
        if (req.Value <= 0) return BadRequest("MRP must be positive.");
        var id = await repo.InsertMrp(new MrpEntry
        {
            CylinderTypeId = req.CylinderTypeId,
            Value = req.Value,
            EffectiveFrom = req.EffectiveFrom,
        });
        return CreatedAtAction(nameof(GetMrpHistory), new { id }, new { id });
    }

    [HttpGet("discounts")] public async Task<IReadOnlyList<Discount>> GetDiscounts() => await repo.GetDiscounts();

    [HttpPost("discounts")]
    public async Task<ActionResult> AddDiscount(CreateDiscountRequest req)
    {
        if (req.Amount <= 0) return BadRequest("Discount must be positive.");
        if (req.EndDate < req.StartDate) return BadRequest("End date must be on/after start date.");
        var id = await repo.InsertDiscount(new Discount
        {
            CustomerId = req.CustomerId,
            CylinderTypeId = req.CylinderTypeId,
            Amount = req.Amount,
            StartDate = req.StartDate,
            EndDate = req.EndDate,
        });
        return CreatedAtAction(nameof(GetDiscounts), new { id }, new { id });
    }

    [HttpDelete("discounts/{id:int}")]
    public async Task<ActionResult> DeleteDiscount(int id) { await repo.DeleteDiscount(id); return NoContent(); }
}

[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController(NotificationRepository repo) : ControllerBase
{
    [HttpGet] public async Task<IReadOnlyList<Notification>> GetRecent() => await repo.GetRecent();
}
