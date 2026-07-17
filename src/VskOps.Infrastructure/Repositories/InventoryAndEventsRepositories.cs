using Dapper;
using VskOps.Core.Domain;
using VskOps.Core.Services;

namespace VskOps.Infrastructure.Repositories;

public class InventoryRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<InventoryRecord>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<InventoryRecord>(
            "SELECT Id, CylinderTypeId, [Full], Empty, Defective, UpdatedAt FROM Inventory")).ToList();
    }

    public async Task<InventoryRecord?> GetByType(int cylinderTypeId)
    {
        using var conn = db.Create();
        return await conn.QuerySingleOrDefaultAsync<InventoryRecord>(
            "SELECT Id, CylinderTypeId, [Full], Empty, Defective, UpdatedAt FROM Inventory WHERE CylinderTypeId = @cylinderTypeId",
            new { cylinderTypeId });
    }

    /// <summary>Manual correction — sets absolute values (mirrors the prototype's editable depot-stock rows).</summary>
    public async Task Set(int cylinderTypeId, int full, int empty, int defective)
    {
        using var conn = db.Create();
        var updated = await conn.ExecuteAsync(
            """
            UPDATE Inventory SET [Full] = @full, Empty = @empty, Defective = @defective, UpdatedAt = SYSUTCDATETIME()
            WHERE CylinderTypeId = @cylinderTypeId
            """, new { cylinderTypeId, full, empty, defective });
        if (updated == 0)
            await conn.ExecuteAsync(
                "INSERT INTO Inventory (CylinderTypeId, [Full], Empty, Defective) VALUES (@cylinderTypeId, @full, @empty, @defective)",
                new { cylinderTypeId, full, empty, defective });
    }

    public async Task Delete(int cylinderTypeId)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM Inventory WHERE CylinderTypeId = @cylinderTypeId", new { cylinderTypeId });
    }
}

public class EventRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<CylinderEvent>> GetByCustomer(int customerId)
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<CylinderEvent>(
            "SELECT * FROM Events WHERE CustomerId = @customerId", new { customerId })).ToList();
    }
}

public class IoclRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<IoclTransaction>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<IoclTransaction>(
            "SELECT * FROM IoclTransactions ORDER BY CreatedAt DESC")).ToList();
    }

    public async Task<IoclTransaction?> GetById(int id)
    {
        using var conn = db.Create();
        return await conn.QuerySingleOrDefaultAsync<IoclTransaction>(
            "SELECT * FROM IoclTransactions WHERE Id = @id", new { id });
    }

    /// <summary>Inserts the transaction and applies its depot-stock effect atomically.</summary>
    public async Task<int> Insert(IoclTransaction t)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();
        var id = await conn.ExecuteScalarAsync<int>(
            """
            INSERT INTO IoclTransactions (Type, Date, CylinderTypeId, Qty, EmptyQty, DefectiveQty, VendorId, AmountBilled, Paid, PaidOn, Note)
            OUTPUT INSERTED.Id
            VALUES (@Type, @Date, @CylinderTypeId, @Qty, @EmptyQty, @DefectiveQty, @VendorId, @AmountBilled, @Paid, @PaidOn, @Note)
            """, t, tx);
        var delta = IoclLogic.DeltaFor(t);
        await TripRepository.AdjustInventoryInTx(conn, tx, delta.CylinderTypeId, delta.Full, delta.Empty, delta.Defective);
        tx.Commit();
        return id;
    }

    public async Task TogglePaid(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync(
            """
            UPDATE IoclTransactions
            SET Paid = 1 - Paid,
                PaidOn = CASE WHEN Paid = 0 THEN CAST(SYSUTCDATETIME() AS DATE) ELSE NULL END
            WHERE Id = @id
            """, new { id });
    }

    /// <summary>Undoes the old depot-stock effect, applies the new one, and saves the edit atomically.</summary>
    public async Task Update(IoclTransaction old, IoclTransaction merged)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();
        var undo = IoclLogic.DeltaFor(old).Negate();
        await TripRepository.AdjustInventoryInTx(conn, tx, undo.CylinderTypeId, undo.Full, undo.Empty, undo.Defective);
        var apply = IoclLogic.DeltaFor(merged);
        await TripRepository.AdjustInventoryInTx(conn, tx, apply.CylinderTypeId, apply.Full, apply.Empty, apply.Defective);
        await conn.ExecuteAsync(
            """
            UPDATE IoclTransactions
            SET Date = @Date, Qty = @Qty, EmptyQty = @EmptyQty, DefectiveQty = @DefectiveQty,
                VendorId = @VendorId, AmountBilled = @AmountBilled, Note = @Note
            WHERE Id = @Id
            """, merged, tx);
        tx.Commit();
    }

    /// <summary>Deletes the transaction, adjusting depot stock back by its original effect.</summary>
    public async Task Delete(IoclTransaction t)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();
        var undo = IoclLogic.DeltaFor(t).Negate();
        await TripRepository.AdjustInventoryInTx(conn, tx, undo.CylinderTypeId, undo.Full, undo.Empty, undo.Defective);
        await conn.ExecuteAsync("DELETE FROM IoclTransactions WHERE Id = @Id", new { t.Id }, tx);
        tx.Commit();
    }
}
