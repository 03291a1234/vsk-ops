using VskOps.Core.Domain;

namespace VskOps.Core.Services;

/// <summary>
/// Pricing rules ported from the prototype: MRP is fixed per cylinder type (with an effective-from
/// history), the same for every customer; per-customer discounts are subtracted from the MRP for
/// the relevant type within their date window.
/// </summary>
public static class Pricing
{
    /// <summary>Latest MRP whose EffectiveFrom is on or before <paramref name="onDate"/>; 0 when none set.</summary>
    public static decimal CurrentMrp(IEnumerable<MrpEntry> mrpHistory, int cylinderTypeId, DateOnly onDate) =>
        mrpHistory
            .Where(h => h.CylinderTypeId == cylinderTypeId && h.EffectiveFrom <= onDate)
            .OrderByDescending(h => h.EffectiveFrom)
            .Select(h => h.Value)
            .FirstOrDefault();

    /// <summary>Largest discount active for this customer + cylinder type on the given date; 0 when none.</summary>
    public static decimal ApplicableDiscount(IEnumerable<Discount> discounts, int customerId, int cylinderTypeId, DateOnly onDate)
    {
        var matches = discounts
            .Where(d => d.CustomerId == customerId
                        && d.CylinderTypeId == cylinderTypeId
                        && d.StartDate <= onDate && onDate <= d.EndDate)
            .ToList();
        return matches.Count == 0 ? 0 : matches.Max(d => d.Amount);
    }

    /// <summary>MRP minus applicable discount, never below zero.</summary>
    public static decimal EffectiveRate(
        IEnumerable<MrpEntry> mrpHistory, IEnumerable<Discount> discounts,
        int customerId, int cylinderTypeId, DateOnly onDate)
    {
        var mrp = CurrentMrp(mrpHistory, cylinderTypeId, onDate);
        var disc = ApplicableDiscount(discounts, customerId, cylinderTypeId, onDate);
        return Math.Max(0, mrp - disc);
    }
}
