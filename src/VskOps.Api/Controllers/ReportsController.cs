using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VskOps.Api.Auth;
using VskOps.Infrastructure.Repositories;

namespace VskOps.Api.Controllers;

[ApiController]
[Route("api/reports")]
[Authorize(Policy = AuthPolicies.Reports)]
public class ReportsController(ReportRepository reports) : ControllerBase
{
    /// <summary>Daily Summary: cylinders filled (net of defects), empties returned, defects, outstanding ledger.</summary>
    [HttpGet("daily")]
    public async Task<DailySummary> GetDaily([FromQuery] DateOnly date) =>
        await reports.GetDailySummary(date);

    /// <summary>By Cylinder Type: company-wide filled/empty/defect for one date.</summary>
    [HttpGet("by-type")]
    public async Task<IReadOnlyList<TypeMovementRow>> GetByType([FromQuery] DateOnly date) =>
        await reports.GetMovementByType(date);

    /// <summary>
    /// Cylinder Movement &amp; Payments for one date: per customer × cylinder type, with that
    /// customer's cash/online payments and ledger balance as of the date.
    /// </summary>
    [HttpGet("ledger")]
    public async Task<IReadOnlyList<CustomerLedgerGroup>> GetLedger([FromQuery] DateOnly date, [FromQuery] int? customerId) =>
        await reports.GetCustomerLedger(date, date, customerId);

    /// <summary>Multi-Day View: the same breakdown over a date range (last 7/30 days or custom).</summary>
    [HttpGet("multi-day")]
    public async Task<ActionResult<IReadOnlyList<CustomerLedgerGroup>>> GetMultiDay(
        [FromQuery] DateOnly start, [FromQuery] DateOnly end, [FromQuery] int? customerId)
    {
        if (end < start) return BadRequest("End date must be on/after start date.");
        return Ok(await reports.GetCustomerLedger(start, end, customerId));
    }

    /// <summary>Cash Collection: cash physically in each driver's hand for the date, owed back to the owner.</summary>
    [HttpGet("cash-collection")]
    public async Task<ActionResult> GetCashCollection([FromQuery] DateOnly date)
    {
        var rows = await reports.GetCashCollection(date);
        return Ok(new { rows, totalCashToHandOver = rows.Sum(r => r.Cash) });
    }

    /// <summary>Printable-invoice data for one customer over a period, with balance due as of the period end.</summary>
    [HttpGet("invoice")]
    public async Task<ActionResult<InvoiceData>> GetInvoice(
        [FromQuery] int customerId, [FromQuery] DateOnly start, [FromQuery] DateOnly end)
    {
        if (end < start) return BadRequest("End date must be on/after start date.");
        var invoice = await reports.GetInvoice(customerId, start, end);
        return invoice is null ? NotFound() : invoice;
    }
}
