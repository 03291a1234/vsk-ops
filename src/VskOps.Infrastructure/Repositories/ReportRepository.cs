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
/// computed by scanning the whole state in JS is one purpose-built GROUP BY query here.
/// Semantics preserved:
/// - "filled" events already exclude defective units (logged at delivery from the actual full count);
/// - delivered-order quantities/amounts key off the order's delivery date, not its order date;
/// - a customer's ledger balance is opening balance + remaining due on delivered orders dated on/before
///   the as-of date, counting only payments recorded on/before that date.
/// </summary>
public class ReportRepository(IDbConnectionFactory db)
{
    private const string LedgerBalanceSql =
        """
        SELECT ISNULL(SUM(x.Due), 0) + (SELECT ISNULL(SUM(OpeningBalance), 0) FROM Customers WHERE (@customerId IS NULL OR Id = @customerId))
        FROM (
            SELECT CASE WHEN o.Amount - ISNULL(p.Paid, 0) > 0 THEN o.Amount - ISNULL(p.Paid, 0) ELSE 0 END AS Due
            FROM Orders o
            OUTER APPLY (
                SELECT SUM(op.Amount) AS Paid FROM OrderPayments op
                WHERE op.OrderId = o.Id AND CAST(op.Timestamp AS DATE) <= @asOf
            ) p
            WHERE o.Rejected = 0 AND o.Stage = 3 AND o.OrderDate <= @asOf
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
                ISNULL(SUM(CASE WHEN Action = 'filled' THEN Qty END), 0),
                ISNULL(SUM(CASE WHEN Action = 'empty_return' THEN Qty END), 0),
                ISNULL(SUM(CASE WHEN Action = 'defect' THEN Qty END), 0)
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
                   CONCAT(ct.Name, ' (', FORMAT(ct.Weight, '0.##'), 'kg)') AS Label,
                   ISNULL(SUM(CASE WHEN e.Action = 'filled' THEN e.Qty END), 0) AS Filled,
                   ISNULL(SUM(CASE WHEN e.Action = 'empty_return' THEN e.Qty END), 0) AS Empty,
                   ISNULL(SUM(CASE WHEN e.Action = 'defect' THEN e.Qty END), 0) AS Defect
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
                   (SELECT STRING_AGG(x.RegNo, ', ')
                    FROM (SELECT DISTINCT tr.RegNo
                          FROM OrderPayments p2
                          JOIN Orders o2 ON o2.Id = p2.OrderId
                          JOIN Trips t2 ON t2.Id = o2.TripId
                          JOIN Trucks tr ON tr.Id = t2.TruckId
                          WHERE CAST(p2.Timestamp AS DATE) = @date AND t2.DriverId = t.DriverId) x) AS Trucks,
                   COUNT(DISTINCT o.CustomerId) AS CustomerCount,
                   ISNULL(SUM(CASE WHEN p.Method = 'Cash' THEN p.Amount END), 0) AS Cash,
                   ISNULL(SUM(CASE WHEN p.Method = 'Online' THEN p.Amount END), 0) AS Online,
                   ISNULL(SUM(p.Amount), 0) AS Total
            FROM OrderPayments p
            JOIN Orders o ON o.Id = p.OrderId
            JOIN Trips t ON t.Id = o.TripId
            JOIN Drivers d ON d.Id = t.DriverId
            WHERE CAST(p.Timestamp AS DATE) = @date
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
            SELECT CustomerId, CylinderTypeId, Action, SUM(Qty) AS Qty
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
                   SUM(oi.OrderedQty) AS OrderedQty, SUM(oi.Qty) AS DeliveredQty,
                   MAX(oi.Rate) AS Rate, SUM(oi.Amount) AS Amount
            FROM OrderItems oi
            JOIN Orders o ON o.Id = oi.OrderId
            WHERE o.Rejected = 0 AND o.DeliveredAt IS NOT NULL
              AND CAST(o.DeliveredAt AS DATE) >= @start AND CAST(o.DeliveredAt AS DATE) <= @end
              AND (@customerId IS NULL OR o.CustomerId = @customerId)
            GROUP BY o.CustomerId, oi.CylinderTypeId
            """, new { start, end, customerId })).ToList();

        var paymentRows = (await conn.QueryAsync<(int CustomerId, decimal Cash, decimal Online)>(
            """
            SELECT o.CustomerId,
                   ISNULL(SUM(CASE WHEN p.Method = 'Cash' THEN p.Amount END), 0) AS Cash,
                   ISNULL(SUM(CASE WHEN p.Method = 'Online' THEN p.Amount END), 0) AS Online
            FROM OrderPayments p
            JOIN Orders o ON o.Id = p.OrderId
            WHERE CAST(p.Timestamp AS DATE) >= @start AND CAST(p.Timestamp AS DATE) <= @end
              AND (@customerId IS NULL OR o.CustomerId = @customerId)
            GROUP BY o.CustomerId
            """, new { start, end, customerId })).ToList();

        var balances = (await conn.QueryAsync<(int CustomerId, decimal Balance)>(
            """
            SELECT c.Id AS CustomerId,
                   c.OpeningBalance + ISNULL((
                       SELECT SUM(CASE WHEN o.Amount - ISNULL(p.Paid, 0) > 0 THEN o.Amount - ISNULL(p.Paid, 0) ELSE 0 END)
                       FROM Orders o
                       OUTER APPLY (
                           SELECT SUM(op.Amount) AS Paid FROM OrderPayments op
                           WHERE op.OrderId = o.Id AND CAST(op.Timestamp AS DATE) <= @end
                       ) p
                       WHERE o.CustomerId = c.Id AND o.Rejected = 0 AND o.Stage = 3 AND o.OrderDate <= @end
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
                   CONCAT(ct.Name, ' (', FORMAT(ct.Weight, '0.##'), 'kg)') AS Label,
                   SUM(oi.Qty) AS Qty, MAX(oi.Rate) AS Rate, SUM(oi.Amount) AS Amount,
                   CAST(0 AS BIT) AS IsEmptyPurchase
            FROM OrderItems oi
            JOIN Orders o ON o.Id = oi.OrderId
            JOIN CylinderTypes ct ON ct.Id = oi.CylinderTypeId
            WHERE o.CustomerId = @customerId AND o.Rejected = 0 AND o.DeliveredAt IS NOT NULL
              AND CAST(o.DeliveredAt AS DATE) >= @start AND CAST(o.DeliveredAt AS DATE) <= @end
            GROUP BY oi.CylinderTypeId, ct.Name, ct.Weight
            """, new { customerId, start, end })).ToList();

        var purchaseLines = (await conn.QueryAsync<InvoiceLine>(
            """
            SELECT ep.CylinderTypeId,
                   CONCAT(ct.Name, ' (', FORMAT(ct.Weight, '0.##'), 'kg) — Empty Cylinder Purchase') AS Label,
                   SUM(ep.Qty) AS Qty, MAX(ep.Price) AS Rate, SUM(ep.Amount) AS Amount,
                   CAST(1 AS BIT) AS IsEmptyPurchase
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
              AND CAST(p.Timestamp AS DATE) >= @start AND CAST(p.Timestamp AS DATE) <= @end
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
