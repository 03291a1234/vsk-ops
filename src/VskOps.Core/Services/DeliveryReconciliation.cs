using VskOps.Core.Domain;

namespace VskOps.Core.Services;

/// <summary>What the driver reports at the door for one cylinder type of one stop.</summary>
public record StopItemResult(int CylinderTypeId, int ActualQty, int EmptyQty, int DefectQty, int BuyQty);

public record ReconciledItem(
    int CylinderTypeId, int OrderedQty, int ActualQty, int FullQty, int EmptyQty, int DefectQty, int BuyQty);

public record DeliveryOutcome(
    List<OrderItem> UpdatedItems,
    List<EmptyPurchase> NewPurchaseLines,
    decimal NewOrderAmount,
    List<ReconciledItem> ReconciledItems,
    List<CylinderEvent> Events,
    Dictionary<int, (int Empty, int Defective)> DepotCredits);

/// <summary>
/// Delivery-time reconciliation ported from the prototype's tripMarkStopDelivered():
/// - the delivered quantity may differ (+/-) from what was ordered — the bill uses actual × rate;
/// - defective units are not billed (full = actual − defect) but are logged and return to the depot;
/// - the customer may buy out part of this delivery's own shortfall (full − empties returned) at the
///   type's empty price, added to the same order's bill;
/// - "filled" events use the actual full count handed over, which is what keeps reports in sync with
///   what the driver recorded at the door.
/// </summary>
public static class DeliveryReconciliation
{
    public static DeliveryOutcome Reconcile(
        Order order,
        IReadOnlyList<StopItemResult> results,
        IReadOnlyDictionary<int, CylinderType> cylinderTypes,
        DateOnly deliveryDate)
    {
        var updatedItems = order.Items.Select(it =>
        {
            var r = results.FirstOrDefault(x => x.CylinderTypeId == it.CylinderTypeId);
            var actualQty = r is null ? it.Qty : Math.Max(0, r.ActualQty);
            return new OrderItem
            {
                Id = it.Id,
                OrderId = it.OrderId,
                CylinderTypeId = it.CylinderTypeId,
                OrderedQty = it.OrderedQty,
                Qty = actualQty,
                Rate = it.Rate,
                Amount = actualQty * it.Rate,
            };
        }).ToList();
        var itemsAmount = updatedItems.Sum(i => i.Amount);

        var reconciled = updatedItems.Select(it =>
        {
            var r = results.FirstOrDefault(x => x.CylinderTypeId == it.CylinderTypeId)
                    ?? new StopItemResult(it.CylinderTypeId, it.Qty, 0, 0, 0);
            var defectQty = Math.Max(0, r.DefectQty);
            var emptyQty = Math.Max(0, r.EmptyQty);
            var fullQty = Math.Max(0, it.Qty - defectQty);
            var maxBuy = Math.Max(0, fullQty - emptyQty); // can't buy out more than this delivery's own shortfall
            var buyQty = Math.Min(Math.Max(0, r.BuyQty), maxBuy);
            return new ReconciledItem(it.CylinderTypeId, it.OrderedQty, it.Qty, fullQty, emptyQty, defectQty, buyQty);
        }).ToList();

        var newPurchaseLines = reconciled
            .Where(it => it.BuyQty > 0)
            .Select(it =>
            {
                var price = cylinderTypes.TryGetValue(it.CylinderTypeId, out var ct) ? ct.EmptyPrice ?? 0 : 0;
                return new EmptyPurchase
                {
                    OrderId = order.Id,
                    CylinderTypeId = it.CylinderTypeId,
                    Qty = it.BuyQty,
                    Price = price,
                    Amount = it.BuyQty * price,
                    Date = deliveryDate,
                };
            })
            .ToList();

        var newAmount = itemsAmount
                        + order.EmptyPurchases.Sum(p => p.Amount)
                        + newPurchaseLines.Sum(p => p.Amount);

        var events = new List<CylinderEvent>();
        foreach (var it in reconciled)
        {
            void Add(string action, int qty)
            {
                if (qty > 0) events.Add(new CylinderEvent
                {
                    Date = deliveryDate,
                    CustomerId = order.CustomerId,
                    CylinderTypeId = it.CylinderTypeId,
                    Action = action,
                    Qty = qty,
                });
            }
            Add(CylinderAction.Filled, it.FullQty);
            Add(CylinderAction.EmptyReturn, it.EmptyQty);
            Add(CylinderAction.Defect, it.DefectQty);
            Add(CylinderAction.EmptyPurchased, it.BuyQty);
        }

        // empties and defectives the driver collects come straight back into depot stock
        var depotCredits = reconciled
            .Where(it => it.EmptyQty > 0 || it.DefectQty > 0)
            .GroupBy(it => it.CylinderTypeId)
            .ToDictionary(g => g.Key, g => (g.Sum(x => x.EmptyQty), g.Sum(x => x.DefectQty)));

        return new DeliveryOutcome(updatedItems, newPurchaseLines, newAmount, reconciled, events, depotCredits);
    }
}
