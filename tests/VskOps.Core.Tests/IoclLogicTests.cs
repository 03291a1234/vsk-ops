using VskOps.Core.Domain;
using VskOps.Core.Services;
using Xunit;

namespace VskOps.Core.Tests;

public class IoclLogicTests
{
    [Fact]
    public void Sent_transaction_reduces_depot_empty_and_defective()
    {
        var tx = new IoclTransaction { Type = IoclTransactionType.Sent, CylinderTypeId = 3, EmptyQty = 10, DefectiveQty = 2, Qty = 12 };
        Assert.Equal(new InventoryDelta(3, 0, -10, -2), IoclLogic.DeltaFor(tx));
    }

    [Fact]
    public void Received_transaction_increases_depot_full()
    {
        var tx = new IoclTransaction { Type = IoclTransactionType.Received, CylinderTypeId = 3, Qty = 25 };
        Assert.Equal(new InventoryDelta(3, 25, 0, 0), IoclLogic.DeltaFor(tx));
    }

    [Fact]
    public void Negate_reverses_a_delta_exactly()
    {
        var delta = new InventoryDelta(3, 25, -10, -2);
        Assert.Equal(new InventoryDelta(3, -25, 10, 2), delta.Negate());
    }

    [Fact]
    public void NormalizeEdit_derives_sent_qty_from_empty_plus_defective()
    {
        var merged = IoclLogic.NormalizeEdit(new IoclTransaction
        {
            Type = IoclTransactionType.Sent,
            EmptyQty = 7,
            DefectiveQty = 3,
            Qty = 999, // stale — must be recomputed
        });
        Assert.Equal(10, merged.Qty);
    }

    [Fact]
    public void OutstandingPayable_is_billed_minus_paid_on_received_batches()
    {
        var txs = new[]
        {
            new IoclTransaction { Type = IoclTransactionType.Received, AmountBilled = 50000, Paid = true },
            new IoclTransaction { Type = IoclTransactionType.Received, AmountBilled = 30000, Paid = false },
            new IoclTransaction { Type = IoclTransactionType.Sent, AmountBilled = 0 },
        };
        Assert.Equal(30000, IoclLogic.OutstandingPayable(txs));
    }
}
