using VskOps.Core.Domain;

namespace VskOps.Core.Services;

public record InventoryDelta(int CylinderTypeId, int Full, int Empty, int Defective)
{
    public InventoryDelta Negate() => this with { Full = -Full, Empty = -Empty, Defective = -Defective };
}

/// <summary>
/// IOCL supply-chain rules ported from the prototype: "sent" ships depot empties/defectives out for
/// refill; "received" brings full stock in with an amount billed by the vendor. Editing or deleting a
/// transaction must first undo its original depot-stock effect, then apply the new one.
/// </summary>
public static class IoclLogic
{
    /// <summary>The depot-stock effect a transaction had when it was created.</summary>
    public static InventoryDelta DeltaFor(IoclTransaction tx) => tx.Type switch
    {
        IoclTransactionType.Sent => new InventoryDelta(tx.CylinderTypeId, 0, -tx.EmptyQty, -tx.DefectiveQty),
        IoclTransactionType.Received => new InventoryDelta(tx.CylinderTypeId, tx.Qty, 0, 0),
        _ => new InventoryDelta(tx.CylinderTypeId, 0, 0, 0),
    };

    /// <summary>Normalizes an edited transaction: "sent" derives Qty from empty+defective; "received" coerces amounts.</summary>
    public static IoclTransaction NormalizeEdit(IoclTransaction merged)
    {
        if (merged.Type == IoclTransactionType.Sent)
        {
            merged.EmptyQty = Math.Max(0, merged.EmptyQty);
            merged.DefectiveQty = Math.Max(0, merged.DefectiveQty);
            merged.Qty = merged.EmptyQty + merged.DefectiveQty;
        }
        else
        {
            merged.Qty = Math.Max(0, merged.Qty);
            merged.AmountBilled = Math.Max(0, merged.AmountBilled);
        }
        return merged;
    }

    /// <summary>Outstanding payable to vendors: everything billed on received batches, minus what's marked paid.</summary>
    public static decimal OutstandingPayable(IEnumerable<IoclTransaction> transactions)
    {
        var received = transactions.Where(t => t.Type == IoclTransactionType.Received).ToList();
        var billed = received.Sum(t => t.AmountBilled);
        var paid = received.Where(t => t.Paid).Sum(t => t.AmountBilled);
        return billed - paid;
    }
}
