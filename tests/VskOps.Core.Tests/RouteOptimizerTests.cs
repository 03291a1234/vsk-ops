using VskOps.Core.Services;
using Xunit;

namespace VskOps.Core.Tests;

public class RouteOptimizerTests
{
    private static readonly GeoPoint Depot = new(17.4239, 78.4738); // prototype's placeholder depot

    [Fact]
    public void Haversine_matches_known_distance()
    {
        // Hyderabad → Bengaluru is ~500 km great-circle
        var hyd = new GeoPoint(17.3850, 78.4867);
        var blr = new GeoPoint(12.9716, 77.5946);
        var km = RouteOptimizer.HaversineKm(hyd, blr);
        Assert.InRange(km, 490, 510);
    }

    [Fact]
    public void Haversine_of_identical_points_is_zero()
    {
        Assert.Equal(0, RouteOptimizer.HaversineKm(Depot, Depot), precision: 9);
    }

    [Fact]
    public void PseudoCoord_is_deterministic_and_within_expected_offset()
    {
        var a = RouteOptimizer.PseudoCoord("CUS-42", Depot);
        var b = RouteOptimizer.PseudoCoord("CUS-42", Depot);
        Assert.Equal(a, b); // same customer always maps to the same stand-in location

        Assert.InRange(Math.Abs(a.Lat - Depot.Lat), 0, 0.15);
        Assert.InRange(Math.Abs(a.Lng - Depot.Lng), 0, 0.15);

        var other = RouteOptimizer.PseudoCoord("CUS-43", Depot);
        Assert.NotEqual(a, other);
    }

    [Fact]
    public void Optimize_visits_nearest_stop_first_and_accumulates_eta()
    {
        // Two stops due east: one ~11 km away, one ~22 km away (at this latitude 0.1° lng ≈ 10.6 km)
        var near = new StopCandidate(1, 101, Depot.Lat, Depot.Lng + 0.1);
        var far = new StopCandidate(2, 102, Depot.Lat, Depot.Lng + 0.2);

        var route = RouteOptimizer.Optimize(Depot, [far, near]);

        Assert.Equal([1, 2], route.Select(s => s.OrderId));

        // ETA is cumulative from the depot at 28 km/h — the second stop's ETA must exceed the first's
        Assert.True(route[1].EtaMin > route[0].EtaMin);
        var expectedFirstEta = (int)Math.Round(route[0].DistanceKm / 28 * 60);
        Assert.InRange(route[0].EtaMin, expectedFirstEta - 1, expectedFirstEta + 1);
    }

    [Fact]
    public void Optimize_handles_empty_input()
    {
        Assert.Empty(RouteOptimizer.Optimize(Depot, []));
    }
}
