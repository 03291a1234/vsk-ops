using VskOps.Core.Domain;

namespace VskOps.Core.Services;

public record NewOrderLine(int CylinderTypeId, int Qty);

public record BuiltOrder(
    List<OrderItem> Items,
    List<EmptyPurchase> Purchases,
    decimal Amount,
    List<CylinderEvent> PurchaseEvents);

/// <summary>
/// Order creation math ported from the prototype's createOrder(): each delivery line is priced at
/// the customer's effective rate for the order date; empty-cylinder purchase lines are priced at the
/// type's empty price and capped at what the customer actually holds. Purchases transfer ownership
/// immediately (an "empty_purchased" event on the order date) — they don't wait for a delivery run.
/// </summary>
public static class OrderBuilder
{
    public static BuiltOrder Build(
        int customerId,
        DateOnly orderDate,
        IEnumerable<NewOrderLine> lines,
        IEnumerable<NewOrderLine> purchases,
        IEnumerable<MrpEntry> mrpHistory,
        IEnumerable<Discount> discounts,
        IReadOnlyDictionary<int, CylinderType> cylinderTypes,
        Func<int, int> emptiesBalanceOf)
    {
        var items = lines
            .Where(l => l.Qty > 0)
            .Select(l =>
            {
                var rate = Pricing.EffectiveRate(mrpHistory, discounts, customerId, l.CylinderTypeId, orderDate);
                return new OrderItem
                {
                    CylinderTypeId = l.CylinderTypeId,
                    OrderedQty = l.Qty,
                    Qty = l.Qty,
                    Rate = rate,
                    Amount = l.Qty * rate,
                };
            })
            .ToList();

        var builtPurchases = purchases
            .Where(p => p.Qty > 0)
            .Select(p =>
            {
                var qty = Math.Min(p.Qty, emptiesBalanceOf(p.CylinderTypeId));
                var price = cylinderTypes.TryGetValue(p.CylinderTypeId, out var ct) ? ct.EmptyPrice ?? 0 : 0;
                return new EmptyPurchase
                {
                    CylinderTypeId = p.CylinderTypeId,
                    Qty = qty,
                    Price = price,
                    Amount = qty * price,
                    Date = orderDate,
                };
            })
            .Where(p => p.Qty > 0)
            .ToList();

        var purchaseEvents = builtPurchases
            .Select(p => new CylinderEvent
            {
                Date = orderDate,
                CustomerId = customerId,
                CylinderTypeId = p.CylinderTypeId,
                Action = CylinderAction.EmptyPurchased,
                Qty = p.Qty,
            })
            .ToList();

        var amount = items.Sum(i => i.Amount) + builtPurchases.Sum(p => p.Amount);
        return new BuiltOrder(items, builtPurchases, amount, purchaseEvents);
    }
}
