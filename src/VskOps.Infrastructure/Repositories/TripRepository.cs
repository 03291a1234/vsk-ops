using System.Data;
using Dapper;
using VskOps.Core.Domain;
using VskOps.Core.Services;

namespace VskOps.Infrastructure.Repositories;

public class TripRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<Trip>> GetAll(int? driverId = null)
    {
        using var conn = db.Create();
        var trips = (await conn.QueryAsync<Trip>(
            driverId is null
                ? "SELECT * FROM Trips ORDER BY CreatedAt DESC"
                : "SELECT * FROM Trips WHERE DriverId = @driverId ORDER BY CreatedAt DESC",
            new { driverId })).ToList();
        if (trips.Count == 0) return trips;

        var ids = trips.Select(t => t.Id).ToArray();
        var stops = (await conn.QueryAsync<TripStop>(
            "SELECT * FROM TripStops WHERE TripId IN @ids ORDER BY Seq", new { ids })).ToList();
        var stopIds = stops.Select(s => s.Id).ToArray();
        var stopItems = stopIds.Length == 0
            ? []
            : (await conn.QueryAsync<TripStopItem>(
                "SELECT * FROM TripStopItems WHERE TripStopId IN @stopIds", new { stopIds })).ToList();

        var stopsById = stops.ToDictionary(s => s.Id);
        foreach (var si in stopItems) stopsById[si.TripStopId].Items.Add(si);
        var tripsById = trips.ToDictionary(t => t.Id);
        foreach (var s in stops) tripsById[s.TripId].Stops.Add(s);
        return trips;
    }

    public async Task<Trip?> GetById(int id)
    {
        var trips = await GetAll();
        return trips.FirstOrDefault(t => t.Id == id);
    }

    /// <summary>Creates the trip and moves the selected orders to In Trip in one transaction.</summary>
    public async Task<int> CreateTrip(int driverId, int truckId, IReadOnlyList<int> orderIds)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();

        var tripId = await conn.ExecuteScalarAsync<int>(
            "INSERT INTO Trips (DriverId, TruckId, Stage) OUTPUT INSERTED.Id VALUES (@driverId, @truckId, 0)",
            new { driverId, truckId }, tx);
        await conn.ExecuteAsync(
            "UPDATE Orders SET Stage = 2, TripId = @tripId WHERE Id IN @orderIds", new { tripId, orderIds }, tx);
        foreach (var orderId in orderIds)
            await conn.ExecuteAsync(
                "INSERT INTO OrderHistory (OrderId, Stage) VALUES (@orderId, @label)",
                new { orderId, label = $"Assigned to trip {tripId}" }, tx);
        await conn.ExecuteAsync(
            "INSERT INTO TripHistory (TripId, Stage) VALUES (@tripId, 'Assigned')", new { tripId }, tx);

        tx.Commit();
        return tripId;
    }

    /// <summary>
    /// Departure: persists the optimized route, deducts the full-cylinder load from depot stock
    /// (stock leaves with the truck the moment it departs), and moves the trip to On Delivery Run.
    /// </summary>
    public async Task Depart(int tripId, IReadOnlyList<OptimizedStop> route, IReadOnlyDictionary<int, int> loadQtyByType)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();

        var seq = 0;
        foreach (var stop in route)
            await conn.ExecuteAsync(
                """
                INSERT INTO TripStops (TripId, OrderId, Seq, Lat, Lng, DistanceKm, EtaMin, Delivered)
                VALUES (@tripId, @OrderId, @seq, @Lat, @Lng, @DistanceKm, @EtaMin, 0)
                """, new { tripId, stop.OrderId, seq = ++seq, stop.Lat, stop.Lng, stop.DistanceKm, stop.EtaMin }, tx);

        foreach (var (cylinderTypeId, qty) in loadQtyByType)
            await AdjustInventoryInTx(conn, tx, cylinderTypeId, full: -qty, empty: 0, defective: 0);

        await conn.ExecuteAsync("UPDATE Trips SET Stage = 1 WHERE Id = @tripId", new { tripId }, tx);
        await conn.ExecuteAsync(
            "INSERT INTO TripHistory (TripId, Stage) VALUES (@tripId, 'On Delivery Run')", new { tripId }, tx);

        tx.Commit();
    }

    /// <summary>
    /// Persists a delivered stop: updated order items/amount, new door-purchase lines, reconciliation
    /// snapshot, cylinder events, depot credits, order → Delivered, and trip → Completed when it was
    /// the last stop. All-or-nothing.
    /// </summary>
    public async Task<bool> MarkStopDelivered(int tripId, int stopId, int orderId, DeliveryOutcome outcome)
    {
        using var conn = db.Create();
        conn.Open();
        using var tx = conn.BeginTransaction();

        foreach (var it in outcome.UpdatedItems)
            await conn.ExecuteAsync(
                "UPDATE OrderItems SET Qty = @Qty, Amount = @Amount WHERE Id = @Id", it, tx);
        foreach (var p in outcome.NewPurchaseLines)
            await conn.ExecuteAsync(
                """
                INSERT INTO EmptyPurchases (OrderId, CylinderTypeId, Qty, Price, Amount, Date)
                VALUES (@OrderId, @CylinderTypeId, @Qty, @Price, @Amount, @Date)
                """, p, tx);
        await conn.ExecuteAsync(
            "UPDATE Orders SET Stage = 3, Amount = @amount, DeliveredAt = SYSUTCDATETIME() WHERE Id = @orderId",
            new { orderId, amount = outcome.NewOrderAmount }, tx);
        await conn.ExecuteAsync(
            "INSERT INTO OrderHistory (OrderId, Stage) VALUES (@orderId, 'Delivered')", new { orderId }, tx);

        await conn.ExecuteAsync(
            "UPDATE TripStops SET Delivered = 1, DeliveredAt = SYSUTCDATETIME() WHERE Id = @stopId", new { stopId }, tx);
        foreach (var it in outcome.ReconciledItems)
            await conn.ExecuteAsync(
                """
                INSERT INTO TripStopItems (TripStopId, CylinderTypeId, OrderedQty, ActualQty, FullQty, EmptyQty, DefectQty, BuyQty)
                VALUES (@stopId, @CylinderTypeId, @OrderedQty, @ActualQty, @FullQty, @EmptyQty, @DefectQty, @BuyQty)
                """, new { stopId, it.CylinderTypeId, it.OrderedQty, it.ActualQty, it.FullQty, it.EmptyQty, it.DefectQty, it.BuyQty }, tx);

        foreach (var e in outcome.Events)
            await conn.ExecuteAsync(
                "INSERT INTO Events (Date, CustomerId, CylinderTypeId, Action, Qty) VALUES (@Date, @CustomerId, @CylinderTypeId, @Action, @Qty)", e, tx);

        foreach (var (cylinderTypeId, credit) in outcome.DepotCredits)
            await AdjustInventoryInTx(conn, tx, cylinderTypeId, full: 0, empty: credit.Empty, defective: credit.Defective);

        var undelivered = await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM TripStops WHERE TripId = @tripId AND Delivered = 0", new { tripId }, tx);
        var completed = undelivered == 0;
        if (completed)
        {
            await conn.ExecuteAsync("UPDATE Trips SET Stage = 2 WHERE Id = @tripId", new { tripId }, tx);
            await conn.ExecuteAsync(
                "INSERT INTO TripHistory (TripId, Stage) VALUES (@tripId, 'Completed')", new { tripId }, tx);
        }

        tx.Commit();
        return completed;
    }

    /// <summary>Upsert-style signed delta on the depot stock record for one cylinder type.</summary>
    internal static async Task AdjustInventoryInTx(IDbConnection conn, IDbTransaction tx, int cylinderTypeId, int full, int empty, int defective)
    {
        var updated = await conn.ExecuteAsync(
            """
            UPDATE Inventory
            SET [Full] = [Full] + @full, Empty = Empty + @empty, Defective = Defective + @defective, UpdatedAt = SYSUTCDATETIME()
            WHERE CylinderTypeId = @cylinderTypeId
            """, new { cylinderTypeId, full, empty, defective }, tx);
        if (updated == 0)
            await conn.ExecuteAsync(
                "INSERT INTO Inventory (CylinderTypeId, [Full], Empty, Defective) VALUES (@cylinderTypeId, @full, @empty, @defective)",
                new { cylinderTypeId, full, empty, defective }, tx);
    }
}
