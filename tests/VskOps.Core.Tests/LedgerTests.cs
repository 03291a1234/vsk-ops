using VskOps.Core.Domain;
using VskOps.Core.Services;
using Xunit;

namespace VskOps.Core.Tests;

public class LedgerTests
{
    private static DateOnly D(string s) => DateOnly.Parse(s);

    private static Order DeliveredOrder(int id, string orderDate, decimal amount, params (string date, decimal amt)[] payments) => new()
    {
        Id = id,
        CustomerId = 1,
        OrderDate = D(orderDate),
        Stage = OrderStage.Delivered,
        Amount = amount,
        CreatedAt = DateTime.Parse(orderDate + "T09:00:00Z").ToUniversalTime(),
        Payments = payments.Select(p => new OrderPayment
        {
            OrderId = id,
            Method = "Cash",
            Amount = p.amt,
            Timestamp = DateTime.Parse(p.date + "T12:00:00Z").ToUniversalTime(),
        }).ToList(),
    };

    [Fact]
    public void Due_is_zero_until_delivered_and_zero_when_rejected()
    {
        var placed = new Order { Stage = OrderStage.Placed, Amount = 500 };
        var inTrip = new Order { Stage = OrderStage.InTrip, Amount = 500 };
        var rejected = new Order { Stage = OrderStage.Delivered, Rejected = true, Amount = 500 };

        Assert.Equal(0, Ledger.DueOf(placed));
        Assert.Equal(0, Ledger.DueOf(inTrip));
        Assert.Equal(0, Ledger.DueOf(rejected));
        Assert.Equal(PaymentStatus.AwaitingDelivery, Ledger.StatusOf(inTrip));
        Assert.Equal(PaymentStatus.Rejected, Ledger.StatusOf(rejected));
    }

    [Fact]
    public void Due_respects_as_of_date_and_never_goes_negative()
    {
        var order = DeliveredOrder(1, "2026-07-01", 1000, ("2026-07-03", 400), ("2026-07-10", 700)); // overpaid by 100

        Assert.Equal(1000, Ledger.DueOf(order, D("2026-07-02"))); // no payments yet as of that day
        Assert.Equal(600, Ledger.DueOf(order, D("2026-07-03")));
        Assert.Equal(0, Ledger.DueOf(order, D("2026-07-10"))); // clamped, not -100
        Assert.Equal(PaymentStatus.Paid, Ledger.StatusOf(order));
    }

    [Fact]
    public void Balance_as_of_includes_opening_balance_and_only_orders_dated_on_or_before()
    {
        var orders = new[]
        {
            DeliveredOrder(1, "2026-07-01", 1000, ("2026-07-02", 300)),
            DeliveredOrder(2, "2026-07-05", 500),
            DeliveredOrder(3, "2026-07-20", 800), // after as-of date — excluded
        };

        // opening 250 + (1000-300) + 500
        Assert.Equal(1450, Ledger.BalanceAsOf(250, orders, D("2026-07-10")));
    }

    [Fact]
    public void Settlement_allocates_oldest_order_first_and_reports_unapplied_excess()
    {
        var orders = new[]
        {
            DeliveredOrder(2, "2026-07-05", 500),
            DeliveredOrder(1, "2026-07-01", 1000, ("2026-07-02", 800)), // 200 due, oldest
            DeliveredOrder(3, "2026-07-08", 300),
        };

        var allocations = Ledger.AllocateSettlement(orders, 650);

        Assert.Equal([new SettlementAllocation(1, 200), new SettlementAllocation(2, 450)], allocations);

        // Overpay: everything settles, excess is simply not allocated
        var all = Ledger.AllocateSettlement(orders, 2000);
        Assert.Equal(1000, all.Sum(a => a.Amount)); // 200 + 500 + 300
    }

    [Fact]
    public void EmptiesAtCustomer_is_filled_minus_returns_minus_purchases_plus_opening_clamped()
    {
        var customer = new Customer { Id = 1, OpeningEmptiesCylinderTypeId = 7, OpeningEmptiesQty = 3 };
        var events = new[]
        {
            new CylinderEvent { CustomerId = 1, CylinderTypeId = 7, Action = CylinderAction.Filled, Qty = 10 },
            new CylinderEvent { CustomerId = 1, CylinderTypeId = 7, Action = CylinderAction.EmptyReturn, Qty = 6 },
            new CylinderEvent { CustomerId = 1, CylinderTypeId = 7, Action = CylinderAction.EmptyPurchased, Qty = 2 },
            new CylinderEvent { CustomerId = 1, CylinderTypeId = 8, Action = CylinderAction.Filled, Qty = 99 }, // other type
        };

        Assert.Equal(5, Ledger.EmptiesAtCustomer(events, customer, 7)); // 10 - 6 - 2 + 3

        var overReturned = new[]
        {
            new CylinderEvent { CustomerId = 1, CylinderTypeId = 8, Action = CylinderAction.Filled, Qty = 2 },
            new CylinderEvent { CustomerId = 1, CylinderTypeId = 8, Action = CylinderAction.EmptyReturn, Qty = 5 },
        };
        Assert.Equal(0, Ledger.EmptiesAtCustomer(overReturned, customer, 8)); // clamped at 0
    }
}
