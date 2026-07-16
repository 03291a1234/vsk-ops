using System.Data;
using Dapper;
using VskOps.Core.Domain;

namespace VskOps.Infrastructure.Repositories;

public class OrderRepository(IDbConnectionFactory db)
{
    private const string SelectOrders = "SELECT * FROM Orders";

    public async Task<IReadOnlyList<Order>> GetAll()
    {
        using var conn = db.Create();
        return await LoadWithChildren(conn, $"{SelectOrders} ORDER BY CreatedAt DESC", new { });
    }

    public async Task<IReadOnlyList<Order>> GetByCustomer(int customerId)
    {
        using var conn = db.Create();
        return await LoadWithChildren(conn, $"{SelectOrders} WHERE CustomerId = @customerId", new { customerId });
    }

    public async Task<Order?> GetById(int id)
    {
        using var conn = db.Create();
        var orders = await LoadWithChildren(conn, $"{SelectOrders} WHERE Id = @id", new { id });
        return orders.FirstOrDefault();
    }

    /// <summary>Approved orders not yet assigned to a trip — the dispatch pool.</summary>
    public async Task<IReadOnlyList<Order>> GetDispatchPool()
    {
        using var conn = db.Create();
        return await LoadWithChildren(conn,
            $"{SelectOrders} WHERE Stage = 1 AND TripId IS NULL AND Rejected = 0", new { });
    }

    private static async Task<IReadOnlyList<Order>> LoadWithChildren(IDbConnection conn, string sql, object param)
    {
        var orders = (await conn.QueryAsync<Order>(sql, param)).ToList();
        if (orders.Count == 0) return orders;

        var ids = orders.Select(o => o.Id).ToArray();
        var items = await conn.QueryAsync<OrderItem>("SELECT * FROM OrderItems WHERE OrderId IN @ids", new { ids });
        var payments = await conn.QueryAsync<OrderPayment>("SELECT * FROM OrderPayments WHERE OrderId IN @ids ORDER BY Timestamp", new { ids });
        var purchases = await conn.QueryAsync<EmptyPurchase>("SELECT * FROM EmptyPurchases WHERE OrderId IN @ids", new { ids });

        var byId = orders.ToDictionary(o => o.Id);
        foreach (var it in items) byId[it.OrderId].Items.Add(it);
        foreach (var p in payments) byId[p.OrderId].Payments.Add(p);
        foreach (var ep in purchases) byId[ep.OrderId].EmptyPurchases.Add(ep);
        return orders;
    }

    /// <summary>Inserts the order with its items, purchase lines, purchase events, and history in one transaction.</summary>
    public async Task<int> InsertOrder(Order order, IEnumerable<CylinderEvent> purchaseEvents)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();

        var orderId = await conn.ExecuteScalarAsync<int>(
            """
            INSERT INTO Orders (CustomerId, OrderDate, Stage, Rejected, Amount)
            OUTPUT INSERTED.Id VALUES (@CustomerId, @OrderDate, @Stage, @Rejected, @Amount)
            """, order, tx);

        foreach (var it in order.Items)
        {
            it.OrderId = orderId;
            await conn.ExecuteAsync(
                """
                INSERT INTO OrderItems (OrderId, CylinderTypeId, OrderedQty, Qty, Rate, Amount)
                VALUES (@OrderId, @CylinderTypeId, @OrderedQty, @Qty, @Rate, @Amount)
                """, it, tx);
        }
        foreach (var p in order.EmptyPurchases)
        {
            p.OrderId = orderId;
            await conn.ExecuteAsync(
                """
                INSERT INTO EmptyPurchases (OrderId, CylinderTypeId, Qty, Price, Amount, Date)
                VALUES (@OrderId, @CylinderTypeId, @Qty, @Price, @Amount, @Date)
                """, p, tx);
        }
        foreach (var e in purchaseEvents)
            await conn.ExecuteAsync(
                "INSERT INTO Events (Date, CustomerId, CylinderTypeId, Action, Qty) VALUES (@Date, @CustomerId, @CylinderTypeId, @Action, @Qty)", e, tx);

        await conn.ExecuteAsync(
            "INSERT INTO OrderHistory (OrderId, Stage) VALUES (@orderId, 'Placed')", new { orderId }, tx);

        tx.Commit();
        return orderId;
    }

    public async Task SetApproval(int orderId, bool approved, string owner)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();
        if (approved)
            await conn.ExecuteAsync(
                "UPDATE Orders SET Stage = 1, ApprovedBy = @owner WHERE Id = @orderId", new { orderId, owner }, tx);
        else
            await conn.ExecuteAsync(
                "UPDATE Orders SET Rejected = 1, ApprovedBy = @owner WHERE Id = @orderId", new { orderId, owner }, tx);
        await conn.ExecuteAsync(
            "INSERT INTO OrderHistory (OrderId, Stage) VALUES (@orderId, @label)",
            new { orderId, label = (approved ? "Approved by " : "Rejected by ") + owner }, tx);
        tx.Commit();
    }

    public async Task AddPayment(int orderId, string method, decimal amount, string historyLabel)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();
        await AddPaymentInTx(conn, tx, orderId, method, amount, historyLabel);
        tx.Commit();
    }

    /// <summary>Applies FIFO settlement allocations produced by Ledger.AllocateSettlement in one transaction.</summary>
    public async Task AddPayments(IEnumerable<(int OrderId, string Method, decimal Amount, string HistoryLabel)> payments)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();
        foreach (var (orderId, method, amount, label) in payments)
            await AddPaymentInTx(conn, tx, orderId, method, amount, label);
        tx.Commit();
    }

    private static async Task AddPaymentInTx(IDbConnection conn, IDbTransaction tx, int orderId, string method, decimal amount, string historyLabel)
    {
        await conn.ExecuteAsync(
            "INSERT INTO OrderPayments (OrderId, Method, Amount) VALUES (@orderId, @method, @amount)",
            new { orderId, method, amount }, tx);
        await conn.ExecuteAsync(
            "INSERT INTO OrderHistory (OrderId, Stage) VALUES (@orderId, @historyLabel)",
            new { orderId, historyLabel }, tx);
    }

    public async Task<IReadOnlyList<(int OrderId, string Stage, DateTime Timestamp)>> GetHistory(int orderId)
    {
        using var conn = db.Create();
        var rows = await conn.QueryAsync<(int, string, DateTime)>(
            "SELECT OrderId, Stage, Timestamp FROM OrderHistory WHERE OrderId = @orderId ORDER BY Timestamp", new { orderId });
        return rows.ToList();
    }
}
