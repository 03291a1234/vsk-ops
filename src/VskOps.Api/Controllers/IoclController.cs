using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VskOps.Api.Auth;
using VskOps.Core.Domain;
using VskOps.Core.Services;
using VskOps.Infrastructure.Repositories;

namespace VskOps.Api.Controllers;

public record SendToIoclRequest(int CylinderTypeId, int EmptyQty, int DefectiveQty, DateOnly? Date, string? Note);
public record ReceiveFromIoclRequest(int CylinderTypeId, int Qty, int? VendorId, decimal AmountBilled, DateOnly? Date, string? Note);
public record EditIoclRequest(DateOnly Date, int Qty, int EmptyQty, int DefectiveQty, int? VendorId, decimal AmountBilled, string? Note);

[ApiController]
[Route("api/iocl")]
[Authorize(Policy = AuthPolicies.MasterData)]
public class IoclController(
    IoclRepository repo,
    InventoryRepository inventory,
    NotificationRepository notifications) : ControllerBase
{
    [HttpGet]
    public async Task<IReadOnlyList<IoclTransaction>> GetAll() => await repo.GetAll();

    /// <summary>All-time sent/received counts and the running payable balance owed to vendors.</summary>
    [HttpGet("summary")]
    public async Task<ActionResult> GetSummary()
    {
        var txs = await repo.GetAll();
        var received = txs.Where(t => t.Type == IoclTransactionType.Received).ToList();
        return Ok(new
        {
            totalSent = txs.Where(t => t.Type == IoclTransactionType.Sent).Sum(t => t.Qty),
            totalReceived = received.Sum(t => t.Qty),
            totalBilled = received.Sum(t => t.AmountBilled),
            outstandingPayable = IoclLogic.OutstandingPayable(txs),
        });
    }

    /// <summary>Ships depot empties/defectives out for refill. Warns (but proceeds) if stock would go negative.</summary>
    [HttpPost("send")]
    public async Task<ActionResult> Send(SendToIoclRequest req)
    {
        if (req.EmptyQty <= 0 && req.DefectiveQty <= 0) return BadRequest("Send at least one empty or defective cylinder.");

        var rec = await inventory.GetByType(req.CylinderTypeId);
        string? warning = null;
        if (req.EmptyQty > (rec?.Empty ?? 0) || req.DefectiveQty > (rec?.Defective ?? 0))
        {
            warning = $"Sending more of cylinder type {req.CylinderTypeId} to IOCL than depot shows "
                      + $"(Empty: {rec?.Empty ?? 0}, Defective: {rec?.Defective ?? 0}) — stock will go negative.";
            await notifications.Insert("Dispatch", warning);
        }

        var id = await repo.Insert(new IoclTransaction
        {
            Type = IoclTransactionType.Sent,
            Date = req.Date ?? DateOnly.FromDateTime(DateTime.UtcNow),
            CylinderTypeId = req.CylinderTypeId,
            Qty = Math.Max(0, req.EmptyQty) + Math.Max(0, req.DefectiveQty),
            EmptyQty = Math.Max(0, req.EmptyQty),
            DefectiveQty = Math.Max(0, req.DefectiveQty),
            Note = req.Note,
        });
        await notifications.Insert("Dispatch",
            $"Sent {req.EmptyQty} empty + {req.DefectiveQty} defective of cylinder type {req.CylinderTypeId} to IOCL for refill.");
        return CreatedAtAction(nameof(GetAll), new { id }, new { id, warning });
    }

    /// <summary>New full stock arrives from IOCL — increases depot Full and logs what the vendor billed.</summary>
    [HttpPost("receive")]
    public async Task<ActionResult> Receive(ReceiveFromIoclRequest req)
    {
        if (req.Qty <= 0) return BadRequest("Quantity must be positive.");
        var id = await repo.Insert(new IoclTransaction
        {
            Type = IoclTransactionType.Received,
            Date = req.Date ?? DateOnly.FromDateTime(DateTime.UtcNow),
            CylinderTypeId = req.CylinderTypeId,
            Qty = req.Qty,
            VendorId = req.VendorId,
            AmountBilled = Math.Max(0, req.AmountBilled),
            Note = req.Note,
        });
        await notifications.Insert("Dispatch",
            $"Received {req.Qty} full of cylinder type {req.CylinderTypeId} from IOCL"
            + (req.AmountBilled > 0 ? $" — billed ₹{req.AmountBilled}" : "") + ".");
        return CreatedAtAction(nameof(GetAll), new { id }, new { id });
    }

    [HttpPost("{id:int}/toggle-paid")]
    public async Task<ActionResult> TogglePaid(int id)
    {
        if (await repo.GetById(id) is null) return NotFound();
        await repo.TogglePaid(id);
        return NoContent();
    }

    /// <summary>Edits a transaction — depot stock is adjusted by undoing the old effect and applying the new one.</summary>
    [HttpPut("{id:int}")]
    public async Task<ActionResult> Edit(int id, EditIoclRequest req)
    {
        var old = await repo.GetById(id);
        if (old is null) return NotFound();

        var merged = IoclLogic.NormalizeEdit(new IoclTransaction
        {
            Id = old.Id,
            Type = old.Type,
            Date = req.Date,
            CylinderTypeId = old.CylinderTypeId,
            Qty = req.Qty,
            EmptyQty = req.EmptyQty,
            DefectiveQty = req.DefectiveQty,
            VendorId = req.VendorId,
            AmountBilled = req.AmountBilled,
            Paid = old.Paid,
            PaidOn = old.PaidOn,
            Note = req.Note,
        });
        await repo.Update(old, merged);
        await notifications.Insert("Dispatch", $"Updated an IOCL {merged.Type} transaction for cylinder type {merged.CylinderTypeId}.");
        return NoContent();
    }

    /// <summary>Deletes a transaction, reversing whatever it did to depot stock.</summary>
    [HttpDelete("{id:int}")]
    public async Task<ActionResult> Delete(int id)
    {
        var tx = await repo.GetById(id);
        if (tx is null) return NotFound();
        await repo.Delete(tx);
        await notifications.Insert("Dispatch",
            $"Deleted an IOCL {tx.Type} transaction for cylinder type {tx.CylinderTypeId} — depot stock adjusted back.");
        return NoContent();
    }
}
