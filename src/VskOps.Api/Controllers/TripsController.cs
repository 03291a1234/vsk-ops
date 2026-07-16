using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using VskOps.Api.Auth;
using VskOps.Core.Domain;
using VskOps.Core.Services;
using VskOps.Infrastructure;
using VskOps.Infrastructure.Repositories;

namespace VskOps.Api.Controllers;

public record CreateTripRequest(int DriverId, int TruckId, List<int> OrderIds);
public record DeliverStopRequest(List<StopItemResultRequest> Items);
public record StopItemResultRequest(int CylinderTypeId, int ActualQty, int EmptyQty, int DefectQty, int BuyQty);

[ApiController]
[Route("api/trips")]
public class TripsController(
    TripRepository trips,
    OrderRepository orders,
    CustomerRepository customers,
    CylinderTypeRepository cylinderTypes,
    InventoryRepository inventory,
    NotificationRepository notifications,
    IDbConnectionFactory db) : ControllerBase
{
    /// <summary>Drivers see only their own trips; everyone else sees all (mirrors the prototype's dispatch view).</summary>
    [HttpGet]
    [Authorize(Policy = AuthPolicies.DispatchRead)]
    public async Task<IReadOnlyList<Trip>> GetAll()
    {
        if (User.IsInRole(Roles.Driver))
        {
            var driverId = int.TryParse(User.FindFirstValue("driverId"), out var d) ? d : -1;
            return await trips.GetAll(driverId);
        }
        return await trips.GetAll();
    }

    /// <summary>One truck/driver carries several approved orders in a single trip.</summary>
    [HttpPost]
    [Authorize(Policy = AuthPolicies.DispatchManage)]
    public async Task<ActionResult> Create(CreateTripRequest req)
    {
        if (req.OrderIds.Count == 0) return BadRequest("Select at least one order.");
        var pool = await orders.GetDispatchPool();
        var invalid = req.OrderIds.Where(id => pool.All(o => o.Id != id)).ToList();
        if (invalid.Count > 0)
            return Conflict($"Order(s) {string.Join(", ", invalid)} are not approved-and-unassigned.");

        var tripId = await trips.CreateTrip(req.DriverId, req.TruckId, req.OrderIds);
        await notifications.Insert($"Driver {req.DriverId}",
            $"Trip #{tripId} assigned — {req.OrderIds.Count} order(s). Ready to fill and depart.");
        return CreatedAtAction(nameof(GetAll), new { id = tripId }, new { id = tripId });
    }

    /// <summary>
    /// Fill &amp; depart: computes the optimized route (nearest-neighbour; customers without coordinates
    /// get a stable pseudo-location near the depot) and deducts the full-cylinder load from depot stock —
    /// stock leaves with the truck the moment it departs. Warns (but proceeds) if stock goes negative.
    /// </summary>
    [HttpPost("{id:int}/depart")]
    [Authorize(Policy = AuthPolicies.DispatchManage)]
    public async Task<ActionResult> Depart(int id)
    {
        var trip = await trips.GetById(id);
        if (trip is null) return NotFound();
        if (trip.Stage != TripStage.Assigned) return Conflict("Trip has already departed.");

        var allOrders = await orders.GetAll();
        var tripOrders = allOrders.Where(o => o.TripId == id).ToList();
        if (tripOrders.Count == 0) return Conflict("Trip has no orders.");

        var depot = await GetDepot();
        var stops = new List<StopCandidate>();
        foreach (var o in tripOrders)
        {
            var c = await customers.GetById(o.CustomerId);
            var coord = c?.Lat is { } lat && c.Lng is { } lng
                ? new GeoPoint(lat, lng)
                : RouteOptimizer.PseudoCoord($"CUS-{o.CustomerId}", depot);
            stops.Add(new StopCandidate(o.Id, o.CustomerId, coord.Lat, coord.Lng));
        }

        var loadQty = tripOrders
            .SelectMany(o => o.Items)
            .GroupBy(i => i.CylinderTypeId)
            .ToDictionary(g => g.Key, g => g.Sum(i => i.Qty));

        var warnings = new List<string>();
        foreach (var (typeId, qty) in loadQty)
        {
            var current = (await inventory.GetByType(typeId))?.Full ?? 0;
            if (current < qty)
            {
                var warning = $"Depot only shows {current} full of cylinder type {typeId}, but trip #{id} is loading {qty}. Inventory will go negative.";
                warnings.Add(warning);
                await notifications.Insert("Dispatch", warning);
            }
        }

        var route = RouteOptimizer.Optimize(depot, stops);
        await trips.Depart(id, route, loadQty);

        foreach (var (stop, i) in route.Select((s, i) => (s, i)))
            await notifications.Insert($"Customer {stop.CustomerId}",
                $"Your order is on the way (stop {i + 1} of {route.Count}). Estimated arrival in ~{stop.EtaMin} min.");

        return Ok(new { route, warnings });
    }

    /// <summary>
    /// Driver confirms delivery for one stop: actual quantity handed over may differ from ordered
    /// (the bill re-prices at actual × rate), defects are logged and not billed, and the customer may
    /// buy out part of this delivery's shortfall at the door.
    /// </summary>
    [HttpPost("{id:int}/stops/{stopId:int}/deliver")]
    [Authorize(Policy = AuthPolicies.DeliverStop)]
    public async Task<ActionResult> DeliverStop(int id, int stopId, DeliverStopRequest req)
    {
        var trip = await trips.GetById(id);
        if (trip is null) return NotFound();
        var stop = trip.Stops.FirstOrDefault(s => s.Id == stopId);
        if (stop is null) return NotFound("No such stop on this trip.");
        if (stop.Delivered) return Conflict("Stop is already delivered.");

        // A driver can only deliver stops on their own trip
        if (User.IsInRole(Roles.Driver))
        {
            var driverId = int.TryParse(User.FindFirstValue("driverId"), out var d) ? d : -1;
            if (trip.DriverId != driverId) return Forbid();
        }

        var order = await orders.GetById(stop.OrderId);
        if (order is null) return NotFound("Order for this stop no longer exists.");

        var types = (await cylinderTypes.GetAll()).ToDictionary(t => t.Id);
        var outcome = DeliveryReconciliation.Reconcile(
            order,
            req.Items.Select(i => new StopItemResult(i.CylinderTypeId, i.ActualQty, i.EmptyQty, i.DefectQty, i.BuyQty)).ToList(),
            types,
            DateOnly.FromDateTime(DateTime.UtcNow));

        var completed = await trips.MarkStopDelivered(id, stopId, order.Id, outcome);

        var totalDefect = outcome.ReconciledItems.Sum(i => i.DefectQty);
        var totalBought = outcome.ReconciledItems.Sum(i => i.BuyQty);
        var adjusted = outcome.ReconciledItems.Count(i => i.ActualQty != i.OrderedQty);
        await notifications.Insert($"Customer {order.CustomerId}",
            $"Order #{order.Id} delivered"
            + (totalDefect > 0 ? $" ({totalDefect} defective unit(s))" : "") + "."
            + (totalBought > 0 ? $" Customer bought {totalBought} empty cylinder(s) at the door." : "")
            + (adjusted > 0 ? $" Quantity adjusted at delivery for {adjusted} item(s) — bill updated to ₹{outcome.NewOrderAmount}." : "")
            + " Thank you!");
        if (completed)
            await notifications.Insert("Dispatch", $"Trip #{id} completed — all stops delivered.");

        return Ok(new { newAmount = outcome.NewOrderAmount, tripCompleted = completed });
    }

    private async Task<GeoPoint> GetDepot()
    {
        using var conn = db.Create();
        var (lat, lng) = await Dapper.SqlMapper.QuerySingleAsync<(double, double)>(
            conn, "SELECT DepotLat, DepotLng FROM AppSettings WHERE Id = 1");
        return new GeoPoint(lat, lng);
    }
}
