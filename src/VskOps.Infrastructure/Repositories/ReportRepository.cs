using Dapper;

namespace VskOps.Infrastructure.Repositories;

public record DailySummary(int Filled, int EmptyReturned, int Defects, decimal OutstandingLedger);

public record TypeMovementRow(int CylinderTypeId, string Label, int Filled, int Empty, int Defect);

public record CashCollectionRow(
    int DriverId, string DriverName, string Trucks, int CustomerCount, decimal Cash, decimal Online, decimal Total);

public record CustomerTypeRow(
    int CylinderTypeId, string CylinderLabel,
    int Filled, int Empty, int Defect, int Bought, decimal BoughtAmount,
    int OrderedQty, int DeliveredQty, decimal? Rate, decimal Amount, int Shortage);

public record CustomerLedgerGroup(
    int CustomerId, string CustomerName,
    decimal Cash, decimal Online, decimal Paid,
    decimal LedgerBalance, decimal TotalAmount,
    List<CustomerTypeRow> TypeRows);

public record InvoiceLine(int CylinderTypeId, string Label, int Qty, decimal Rate, decimal Amount, bool IsEmptyPurchase);

public record InvoicePayment(DateTime Timestamp, string Method, decimal Amount);

public record InvoiceData(
    int CustomerId, string CustomerName, string? Address, string? Phone,
    List<InvoiceLine> Lines, decimal TotalAmount,
    List<InvoicePayment> Payments, decimal PaidThisPeriod, decimal BalanceDue);

/// <summary>
/// Reporting queries ported from the prototype's Reports pages. Each aggregation that the artifact
/// computed by scanning the whole state in JS is one purpose-built GROUP BY query here (PostgreSQL).
/// Semantics preserved:
/// - "filled" events already exclude defective units (logged at delivery from the actual full count);
/// - delivered-order quantities/amounts key off the order's delivery date, not its order date;
/// - a customer's ledger balance is opening balance + remaining due on delivered orders dated on/before
///   the as-of date, counting only payments recorded on/before that date;
/// - timestamps are stored UTC, so date bucketing uses AT TIME ZONE 'UTC' to stay deterministic
///   regardless of the session's TimeZone setting.
/// </summary>
public class ReportRepository(IDbConnectionFactory db)
{
    private const string LedgerBalanceSql =
        """
        SELECT COALESCE(SUM(x.Due), 0) + (SELECT COALESCE(SUM(OpeningBalance), 0) FROM Customers WHERE (@customerId IS NULL OR Id = @customerId))
        FROM (
            SELECT GREATEST(o.Amount - COALESCE(p.Paid, 0), 0) AS Due
            FROM Orders o
            LEFT JOIN LATERAL (
                SELECT SUM(op.Amount) AS Paid FROM OrderPayments op
                WHERE op.OrderId = o.Id AND (op.Timestamp AT TIME ZONE 'UTC')::date <= @asOf
            ) p ON TRUE
            WHERE o.Rejected = FALSE AND o.Stage = 3 AND o.OrderDate <= @asOf
              AND (@customerId IS NULL OR o.CustomerId = @customerId)
        ) x
        """;

    public async Task<decimal> LedgerBalanceAsOf(DateOnly asOf, int? customerId = null)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<decimal>(LedgerBalanceSql, new { asOf, customerId });
    }

    public async Task<DailySummary> GetDailySummary(DateOnly date)
    {
        using var conn = db.Create();
        var (filled, empty, defect) = await conn.QuerySingleAsync<(int, int, int)>(
            """
            SELECT
                COALESCE(SUM(Qty) FILTER (WHERE Action = 'filled'), 0)::int,
                COALESCE(SUM(Qty) FILTER (WHERE Action = 'empty_return'), 0)::int,
                COALESCE(SUM(Qty) FILTER (WHERE Action = 'defect'), 0)::int
            FROM Events WHERE Date = @date
            """, new { date });
        var ledger = await conn.ExecuteScalarAsync<decimal>(LedgerBalanceSql, new { asOf = date, customerId = (int?)null });
        return new DailySummary(filled, empty, defect, ledger);
    }

    public async Task<IReadOnlyList<TypeMovementRow>> GetMovementByType(DateOnly date)
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<TypeMovementRow>(
            """
            SELECT ct.Id AS CylinderTypeId,
                   ct.Name || ' (' || trim_scale(ct.Weight)::text || 'kg)' AS Label,
                   COALESCE(SUM(e.Qty) FILTER (WHERE e.Action = 'filled'), 0)::int AS Filled,
                   COALESCE(SUM(e.Qty) FILTER (WHERE e.Action = 'empty_return'), 0)::int AS Empty,
                   COALESCE(SUM(e.Qty) FILTER (WHERE e.Action = 'defect'), 0)::int AS Defect
            FROM CylinderTypes ct
            LEFT JOIN Events e ON e.CylinderTypeId = ct.Id AND e.Date = @date
            GROUP BY ct.Id, ct.Name, ct.Weight
            ORDER BY ct.Weight
            """, new { date })).ToList();
    }

    /// <summary>
    /// Cash physically in each driver's hand for the date, owed back to the owner — payments on orders
    /// grouped by the trip's driver (Online settles directly; it's shown but not handed over).
    /// </summary>
    public async Task<IReadOnlyList<CashCollectionRow>> GetCashCollection(DateOnly date)
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<CashCollectionRow>(
            """
            SELECT t.DriverId,
                   d.Name AS DriverName,
                   STRING_AGG(DISTINCT tr.RegNo, ', ') AS Trucks,
                   COUNT(DISTINCT o.CustomerId)::int AS CustomerCount,
                   COALESCE(SUM(p.Amount) FILTER (WHERE p.Method = 'Cash'), 0) AS Cash,
                   COALESCE(SUM(p.Amount) FILTER (WHERE p.Method = 'Online'), 0) AS Online,
                   COALESCE(SUM(p.Amount), 0) AS Total
            FROM OrderPayments p
            JOIN Orders o ON o.Id = p.OrderId
            JOIN Trips t ON t.Id = o.TripId
            JOIN Drivers d ON d.Id = t.DriverId
            JOIN Trucks tr ON tr.Id = t.TruckId
            WHERE (p.Timestamp AT TIME ZONE 'UTC')::date = @date
            GROUP BY t.DriverId, d.Name
            HAVING SUM(p.Amount) > 0
            """, new { date })).ToList();
    }

    /// <summary>
    /// The "Cylinder Movement &amp; Payments" / "Multi-Day View" breakdown: per customer × cylinder type,
    /// combining cylinder events, door purchases, delivered-order quantities and payments over the range.
    /// Shortage = Filled − Empty − Bought + opening empties (positive ⇒ the customer still holds cylinders);
    /// Amount = Bought Amount + Full × Rate — bills only good (non-defective) cylinders plus empties bought outright.
    /// </summary>
    public async Task<IReadOnlyList<CustomerLedgerGroup>> GetCustomerLedger(DateOnly start, DateOnly end, int? customerId = null)
    {
        using var conn = db.Create();

        var eventRows = (await conn.QueryAsync<(int CustomerId, int CylinderTypeId, string Action, int Qty)>(
            """
            SELECT CustomerId, CylinderTypeId, Action, SUM(Qty)::int AS Qty
            FROM Events
            WHERE Date >= @start AND Date <= @end AND (@customerId IS NULL OR CustomerId = @customerId)
            GROUP BY CustomerId, CylinderTypeId, Action
            """, new { start, end, customerId })).ToList();

        var boughtRows = (await conn.QueryAsync<(int CustomerId, int CylinderTypeId, decimal Amount)>(
            """
            SELECT o.CustomerId, ep.CylinderTypeId, SUM(ep.Amount) AS Amount
            FROM EmptyPurchases ep
            JOIN Orders o ON o.Id = ep.OrderId
            WHERE ep.Date >= @start AND ep.Date <= @end AND (@customerId IS NULL OR o.CustomerId = @customerId)
            GROUP BY o.CustomerId, ep.CylinderTypeId
            """, new { start, end, customerId })).ToList();

        var orderAgg = (await conn.QueryAsync<(int CustomerId, int CylinderTypeId, int OrderedQty, int DeliveredQty, decimal Rate, decimal Amount)>(
            """
            SELECT o.CustomerId, oi.CylinderTypeId,
                   SUM(oi.OrderedQty)::int AS OrderedQty, SUM(oi.Qty)::int AS DeliveredQty,
                   MAX(oi.Rate) AS Rate, SUM(oi.Amount) AS Amount
            FROM OrderItems oi
            JOIN Orders o ON o.Id = oi.OrderId
            WHERE o.Rejected = FALSE AND o.DeliveredAt IS NOT NULL
              AND (o.DeliveredAt AT TIME ZONE 'UTC')::date >= @start AND (o.DeliveredAt AT TIME ZONE 'UTC')::date <= @end
              AND (@customerId IS NULL OR o.CustomerId = @customerId)
            GROUP BY o.CustomerId, oi.CylinderTypeId
            """, new { start, end, customerId })).ToList();

        var paymentRows = (await conn.QueryAsync<(int CustomerId, decimal Cash, decimal Online)>(
            """
            SELECT o.CustomerId,
                   COALESCE(SUM(p.Amount) FILTER (WHERE p.Method = 'Cash'), 0) AS Cash,
                   COALESCE(SUM(p.Amount) FILTER (WHERE p.Method = 'Online'), 0) AS Online
            FROM OrderPayments p
            JOIN Orders o ON o.Id = p.OrderId
            WHERE (p.Timestamp AT TIME ZONE 'UTC')::date >= @start AND (p.Timestamp AT TIME ZONE 'UTC')::date <= @end
              AND (@customerId IS NULL OR o.CustomerId = @customerId)
            GROUP BY o.CustomerId
            """, new { start, end, customerId })).ToList();

        var balances = (await conn.QueryAsync<(int CustomerId, decimal Balance)>(
            """
            SELECT c.Id AS CustomerId,
                   c.OpeningBalance + COALESCE((
                       SELECT SUM(GREATEST(o.Amount - COALESCE(p.Paid, 0), 0))
                       FROM Orders o
                       LEFT JOIN LATERAL (
                           SELECT SUM(op.Amount) AS Paid FROM OrderPayments op
                           WHERE op.OrderId = o.Id AND (op.Timestamp AT TIME ZONE 'UTC')::date <= @end
                       ) p ON TRUE
                       WHERE o.CustomerId = c.Id AND o.Rejected = FALSE AND o.Stage = 3 AND o.OrderDate <= @end
                   ), 0) AS Balance
            FROM Customers c
            WHERE (@customerId IS NULL OR c.Id = @customerId)
            """, new { end, customerId })).ToList();

        var customers = (await conn.QueryAsync<(int Id, string Name, int? OpeningType, int OpeningQty)>(
            "SELECT Id, Name, OpeningEmptiesCylinderTypeId, OpeningEmptiesQty FROM Customers WHERE (@customerId IS NULL OR Id = @customerId) ORDER BY Name",
            new { customerId })).ToList();

        var types = (await conn.QueryAsync<(int Id, string Name, decimal Weight)>(
            "SELECT Id, Name, Weight FROM CylinderTypes ORDER BY Weight")).ToList();

        string LabelOf((int Id, string Name, decimal Weight) t) => $"{t.Name} ({t.Weight:0.##}kg)";
        var groups = new List<CustomerLedgerGroup>();

        foreach (var c in customers)
        {
            var pay = paymentRows.FirstOrDefault(p => p.CustomerId == c.Id);
            var balance = balances.FirstOrDefault(b => b.CustomerId == c.Id).Balance;
            var typeRows = new List<CustomerTypeRow>();

            foreach (var t in types)
            {
                int EventQty(string action) => eventRows
                    .FirstOrDefault(e => e.CustomerId == c.Id && e.CylinderTypeId == t.Id && e.Action == action).Qty;
                var filled = EventQty("filled");
                var empty = EventQty("empty_return");
                var defect = EventQty("defect");
                var bought = EventQty("empty_purchased");
                var boughtAmount = boughtRows.FirstOrDefault(b => b.CustomerId == c.Id && b.CylinderTypeId == t.Id).Amount;
                var agg = orderAgg.FirstOrDefault(a => a.CustomerId == c.Id && a.CylinderTypeId == t.Id);
                var hasAgg = orderAgg.Any(a => a.CustomerId == c.Id && a.CylinderTypeId == t.Id);
                var openingEmpties = c.OpeningType == t.Id ? c.OpeningQty : 0;

                if (filled == 0 && empty == 0 && defect == 0 && bought == 0 && !hasAgg && openingEmpties == 0) continue;

                var rate = hasAgg ? agg.Rate : (decimal?)null;
                typeRows.Add(new CustomerTypeRow(
                    t.Id, LabelOf(t), filled, empty, defect, bought, boughtAmount,
                    hasAgg ? agg.OrderedQty : 0, hasAgg ? agg.DeliveredQty : 0, rate,
                    boughtAmount + filled * (rate ?? 0),
                    filled - empty - bought + openingEmpties));
            }

            var hasActivity = typeRows.Count > 0 || pay.Cash + pay.Online > 0 || balance > 0;
            if (!hasActivity) continue;

            groups.Add(new CustomerLedgerGroup(
                c.Id, c.Name, pay.Cash, pay.Online, pay.Cash + pay.Online,
                balance, typeRows.Sum(r => r.Amount), typeRows));
        }
        return groups;
    }

    /// <summary>
    /// Printable-invoice data for one customer over a period: delivery lines and empty-purchase lines
    /// aggregated by cylinder type, payments received in the period, and the running balance due as of
    /// the period end (computed independently so the invoice stays correct if opened later).
    /// </summary>
    public async Task<InvoiceData?> GetInvoice(int customerId, DateOnly start, DateOnly end)
    {
        using var conn = db.Create();
        var customer = await conn.QuerySingleOrDefaultAsync<(int Id, string Name, string? Address, string? Phone)>(
            "SELECT Id, Name, Address, Phone FROM Customers WHERE Id = @customerId", new { customerId });
        if (customer.Id == 0) return null;

        var deliveryLines = (await conn.QueryAsync<InvoiceLine>(
            """
            SELECT oi.CylinderTypeId,
                   ct.Name || ' (' || trim_scale(ct.Weight)::text || 'kg)' AS Label,
                   SUM(oi.Qty)::int AS Qty, MAX(oi.Rate) AS Rate, SUM(oi.Amount) AS Amount,
                   FALSE AS IsEmptyPurchase
            FROM OrderItems oi
            JOIN Orders o ON o.Id = oi.OrderId
            JOIN CylinderTypes ct ON ct.Id = oi.CylinderTypeId
            WHERE o.CustomerId = @customerId AND o.Rejected = FALSE AND o.DeliveredAt IS NOT NULL
              AND (o.DeliveredAt AT TIME ZONE 'UTC')::date >= @start AND (o.DeliveredAt AT TIME ZONE 'UTC')::date <= @end
            GROUP BY oi.CylinderTypeId, ct.Name, ct.Weight
            """, new { customerId, start, end })).ToList();

        var purchaseLines = (await conn.QueryAsync<InvoiceLine>(
            """
            SELECT ep.CylinderTypeId,
                   ct.Name || ' (' || trim_scale(ct.Weight)::text || 'kg) — Empty Cylinder Purchase' AS Label,
                   SUM(ep.Qty)::int AS Qty, MAX(ep.Price) AS Rate, SUM(ep.Amount) AS Amount,
                   TRUE AS IsEmptyPurchase
            FROM EmptyPurchases ep
            JOIN Orders o ON o.Id = ep.OrderId
            JOIN CylinderTypes ct ON ct.Id = ep.CylinderTypeId
            WHERE o.CustomerId = @customerId AND ep.Date >= @start AND ep.Date <= @end
            GROUP BY ep.CylinderTypeId, ct.Name, ct.Weight
            """, new { customerId, start, end })).ToList();

        var payments = (await conn.QueryAsync<InvoicePayment>(
            """
            SELECT p.Timestamp, p.Method, p.Amount
            FROM OrderPayments p
            JOIN Orders o ON o.Id = p.OrderId
            WHERE o.CustomerId = @customerId
              AND (p.Timestamp AT TIME ZONE 'UTC')::date >= @start AND (p.Timestamp AT TIME ZONE 'UTC')::date <= @end
            ORDER BY p.Timestamp
            """, new { customerId, start, end })).ToList();

        var balanceDue = await conn.ExecuteScalarAsync<decimal>(LedgerBalanceSql, new { asOf = end, customerId });

        var lines = deliveryLines.Concat(purchaseLines).ToList();
        return new InvoiceData(
            customer.Id, customer.Name, customer.Address, customer.Phone,
            lines, lines.Sum(l => l.Amount),
            payments, payments.Sum(p => p.Amount), balanceDue);
    }
}
