using VskOps.Core.Domain;
using VskOps.Core.Services;
using Xunit;

namespace VskOps.Core.Tests;

public class DeliveryReconciliationTests
{
    private static readonly DateOnly Today = DateOnly.Parse("2026-07-16");

    private static readonly Dictionary<int, CylinderType> Types = new()
    {
        [1] = new CylinderType { Id = 1, Name = "Xtra Tej", Weight = 47.5m, EmptyPrice = 800 },
    };

    private static Order OrderWith(int qty, decimal rate) => new()
    {
        Id = 10,
        CustomerId = 5,
        Amount = qty * rate,
        Items = [new OrderItem { Id = 1, OrderId = 10, CylinderTypeId = 1, OrderedQty = qty, Qty = qty, Rate = rate, Amount = qty * rate }],
    };

    [Fact]
    public void Quantity_adjusted_at_the_door_reprices_the_bill()
    {
        var order = OrderWith(qty: 10, rate: 2980);
        var outcome = DeliveryReconciliation.Reconcile(order,
            [new StopItemResult(1, ActualQty: 12, EmptyQty: 0, DefectQty: 0, BuyQty: 0)], Types, Today);

        var item = Assert.Single(outcome.UpdatedItems);
        Assert.Equal(12, item.Qty);
        Assert.Equal(10, item.OrderedQty); // original request preserved
        Assert.Equal(12 * 2980, outcome.NewOrderAmount);
    }

    [Fact]
    public void Defective_units_are_not_billed_and_return_to_the_depot()
    {
        var order = OrderWith(qty: 10, rate: 100);
        var outcome = DeliveryReconciliation.Reconcile(order,
            [new StopItemResult(1, ActualQty: 10, EmptyQty: 6, DefectQty: 2, BuyQty: 0)], Types, Today);

        var rec = Assert.Single(outcome.ReconciledItems);
        Assert.Equal(8, rec.FullQty); // 10 − 2 defective

        // "filled" event carries the actual full count handed over — the rule that keeps reports honest
        Assert.Equal(8, outcome.Events.Single(e => e.Action == CylinderAction.Filled).Qty);
        Assert.Equal(6, outcome.Events.Single(e => e.Action == CylinderAction.EmptyReturn).Qty);
        Assert.Equal(2, outcome.Events.Single(e => e.Action == CylinderAction.Defect).Qty);

        // collected empties + defectives come back into depot stock
        Assert.Equal((6, 2), outcome.DepotCredits[1]);
    }

    [Fact]
    public void Buy_at_the_door_is_capped_at_this_deliverys_own_shortfall()
    {
        // 10 full handed over, 6 empties returned → shortfall 4; customer asks to buy 9
        var order = OrderWith(qty: 10, rate: 100);
        var outcome = DeliveryReconciliation.Reconcile(order,
            [new StopItemResult(1, ActualQty: 10, EmptyQty: 6, DefectQty: 0, BuyQty: 9)], Types, Today);

        var rec = Assert.Single(outcome.ReconciledItems);
        Assert.Equal(4, rec.BuyQty);

        var purchase = Assert.Single(outcome.NewPurchaseLines);
        Assert.Equal(4, purchase.Qty);
        Assert.Equal(800, purchase.Price);
        Assert.Equal(3200, purchase.Amount);

        Assert.Equal(10 * 100 + 3200, outcome.NewOrderAmount);
        Assert.Equal(4, outcome.Events.Single(e => e.Action == CylinderAction.EmptyPurchased).Qty);
    }

    [Fact]
    public void Existing_purchase_lines_from_order_creation_stay_in_the_total()
    {
        var order = OrderWith(qty: 5, rate: 100);
        order.EmptyPurchases.Add(new EmptyPurchase { OrderId = 10, CylinderTypeId = 1, Qty = 2, Price = 800, Amount = 1600, Date = Today });
        order.Amount += 1600;

        var outcome = DeliveryReconciliation.Reconcile(order,
            [new StopItemResult(1, ActualQty: 5, EmptyQty: 5, DefectQty: 0, BuyQty: 0)], Types, Today);

        Assert.Equal(5 * 100 + 1600, outcome.NewOrderAmount);
    }

    [Fact]
    public void Missing_result_for_an_item_defaults_to_delivered_as_ordered()
    {
        var order = OrderWith(qty: 7, rate: 100);
        var outcome = DeliveryReconciliation.Reconcile(order, [], Types, Today);

        Assert.Equal(7, Assert.Single(outcome.UpdatedItems).Qty);
        Assert.Equal(700, outcome.NewOrderAmount);
        Assert.Equal(7, outcome.Events.Single(e => e.Action == CylinderAction.Filled).Qty);
    }
}
