using VskOps.Core.Domain;
using VskOps.Core.Services;
using Xunit;

namespace VskOps.Core.Tests;

public class OrderBuilderTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    private static readonly MrpEntry[] Mrp =
    [
        new() { CylinderTypeId = 1, Value = 1450, EffectiveFrom = D("2026-01-01") },
        new() { CylinderTypeId = 2, Value = 3500, EffectiveFrom = D("2026-01-01") },
    ];

    private static readonly Discount[] Discounts =
    [
        new() { CustomerId = 1, CylinderTypeId = 1, Amount = 50, StartDate = D("2026-01-01"), EndDate = D("2099-12-31") },
    ];

    private static readonly Dictionary<int, CylinderType> Types = new()
    {
        [1] = new CylinderType { Id = 1, Name = "Xtra Tej", Weight = 5, EmptyPrice = 800 },
        [2] = new CylinderType { Id = 2, Name = "Xtra Tej", Weight = 47.5m, EmptyPrice = null },
    };

    [Fact]
    public void Delivery_lines_use_effective_rate_for_the_order_date()
    {
        var built = OrderBuilder.Build(
            customerId: 1, orderDate: D("2026-07-16"),
            lines: [new NewOrderLine(1, 3), new NewOrderLine(2, 2)],
            purchases: [],
            Mrp, Discounts, Types, _ => 0);

        var line1 = built.Items.Single(i => i.CylinderTypeId == 1);
        Assert.Equal(1400, line1.Rate); // 1450 MRP − 50 discount
        Assert.Equal(4200, line1.Amount);
        Assert.Equal(3, line1.OrderedQty);

        var line2 = built.Items.Single(i => i.CylinderTypeId == 2);
        Assert.Equal(3500, line2.Rate); // no discount for this type
        Assert.Equal(4200 + 7000, built.Amount);
    }

    [Fact]
    public void Purchases_are_capped_at_the_customers_empties_balance_and_priced_at_empty_price()
    {
        var built = OrderBuilder.Build(
            customerId: 1, orderDate: D("2026-07-16"),
            lines: [],
            purchases: [new NewOrderLine(1, 10)], // customer only holds 4
            Mrp, Discounts, Types, _ => 4);

        var p = Assert.Single(built.Purchases);
        Assert.Equal(4, p.Qty);
        Assert.Equal(800, p.Price);
        Assert.Equal(3200, p.Amount);
        Assert.Equal(3200, built.Amount);

        // ownership transfers immediately — one empty_purchased event dated on the order date
        var ev = Assert.Single(built.PurchaseEvents);
        Assert.Equal(CylinderAction.EmptyPurchased, ev.Action);
        Assert.Equal(4, ev.Qty);
        Assert.Equal(D("2026-07-16"), ev.Date);
    }

    [Fact]
    public void Purchase_lines_with_no_held_empties_are_dropped()
    {
        var built = OrderBuilder.Build(
            customerId: 1, orderDate: D("2026-07-16"),
            lines: [new NewOrderLine(1, 1)],
            purchases: [new NewOrderLine(1, 5)],
            Mrp, Discounts, Types, _ => 0); // holds nothing

        Assert.Empty(built.Purchases);
        Assert.Empty(built.PurchaseEvents);
        Assert.Equal(1400, built.Amount); // just the delivery line
    }

    [Fact]
    public void Zero_and_negative_quantities_are_filtered_out()
    {
        var built = OrderBuilder.Build(
            customerId: 1, orderDate: D("2026-07-16"),
            lines: [new NewOrderLine(1, 0), new NewOrderLine(2, -3)],
            purchases: [],
            Mrp, Discounts, Types, _ => 0);

        Assert.Empty(built.Items);
        Assert.Equal(0, built.Amount);
    }
}
