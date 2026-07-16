using VskOps.Core.Domain;
using VskOps.Core.Services;
using Xunit;

namespace VskOps.Core.Tests;

public class PricingTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    [Fact]
    public void CurrentMrp_picks_latest_entry_effective_on_or_before_date()
    {
        var history = new[]
        {
            new MrpEntry { CylinderTypeId = 1, Value = 1450, EffectiveFrom = D("2026-01-01") },
            new MrpEntry { CylinderTypeId = 1, Value = 1500, EffectiveFrom = D("2026-06-01") },
            new MrpEntry { CylinderTypeId = 1, Value = 1550, EffectiveFrom = D("2026-08-01") }, // future change
            new MrpEntry { CylinderTypeId = 2, Value = 2000, EffectiveFrom = D("2026-01-01") },
        };

        Assert.Equal(1500, Pricing.CurrentMrp(history, 1, D("2026-07-15")));
        Assert.Equal(1450, Pricing.CurrentMrp(history, 1, D("2026-05-31")));
        Assert.Equal(1550, Pricing.CurrentMrp(history, 1, D("2026-08-01")));
        Assert.Equal(0, Pricing.CurrentMrp(history, 1, D("2025-12-31"))); // before any entry
        Assert.Equal(0, Pricing.CurrentMrp(history, 99, D("2026-07-15"))); // unknown type
    }

    [Fact]
    public void ApplicableDiscount_takes_largest_overlapping_window_and_respects_bounds()
    {
        var discounts = new[]
        {
            new Discount { CustomerId = 1, CylinderTypeId = 1, Amount = 50, StartDate = D("2026-07-01"), EndDate = D("2026-07-31") },
            new Discount { CustomerId = 1, CylinderTypeId = 1, Amount = 80, StartDate = D("2026-07-10"), EndDate = D("2026-07-20") },
            new Discount { CustomerId = 2, CylinderTypeId = 1, Amount = 999, StartDate = D("2026-01-01"), EndDate = D("2026-12-31") },
        };

        Assert.Equal(80, Pricing.ApplicableDiscount(discounts, 1, 1, D("2026-07-15"))); // both active → max wins
        Assert.Equal(50, Pricing.ApplicableDiscount(discounts, 1, 1, D("2026-07-05"))); // only the first window
        Assert.Equal(50, Pricing.ApplicableDiscount(discounts, 1, 1, D("2026-07-31"))); // end date inclusive
        Assert.Equal(0, Pricing.ApplicableDiscount(discounts, 1, 1, D("2026-08-01"))); // expired
        Assert.Equal(0, Pricing.ApplicableDiscount(discounts, 1, 2, D("2026-07-15"))); // other type
    }

    [Fact]
    public void EffectiveRate_is_mrp_minus_discount_clamped_at_zero()
    {
        var history = new[] { new MrpEntry { CylinderTypeId = 1, Value = 100, EffectiveFrom = D("2026-01-01") } };
        var discounts = new[]
        {
            new Discount { CustomerId = 1, CylinderTypeId = 1, Amount = 150, StartDate = D("2026-01-01"), EndDate = D("2099-12-31") },
        };

        Assert.Equal(0, Pricing.EffectiveRate(history, discounts, 1, 1, D("2026-07-15"))); // discount > MRP → 0, never negative
        Assert.Equal(100, Pricing.EffectiveRate(history, discounts, 2, 1, D("2026-07-15"))); // no discount for customer 2
    }
}
