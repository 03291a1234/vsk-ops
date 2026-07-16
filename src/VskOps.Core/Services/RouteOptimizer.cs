namespace VskOps.Core.Services;

public readonly record struct GeoPoint(double Lat, double Lng);

public record StopCandidate(int OrderId, int CustomerId, double Lat, double Lng);

public record OptimizedStop(int OrderId, int CustomerId, double Lat, double Lng, double DistanceKm, int EtaMin);

/// <summary>
/// Dispatch route planning ported from the prototype: nearest-neighbour heuristic over haversine
/// distances — not a true optimum, but fast and good enough for small daily runs. ETAs assume an
/// average speed of 28 km/h over the cumulative distance from the depot.
/// </summary>
public static class RouteOptimizer
{
    private const double AverageSpeedKmh = 28;

    /// <summary>Same 31-multiplier rolling hash as the prototype, so pseudo-locations stay stable per customer.</summary>
    public static uint SeededHash(string s)
    {
        uint h = 0;
        foreach (var c in s) h = unchecked(h * 31 + c);
        return h;
    }

    /// <summary>
    /// Deterministic stand-in location within ~±0.15° of the depot for customers without coordinates,
    /// so routing still produces a stable, repeatable ordering.
    /// </summary>
    public static GeoPoint PseudoCoord(string id, GeoPoint basePoint)
    {
        var h = SeededHash(id);
        var dLat = (h % 1000 / 1000.0 - 0.5) * 0.3;
        var dLng = ((h >> 10) % 1000 / 1000.0 - 0.5) * 0.3;
        return new GeoPoint(basePoint.Lat + dLat, basePoint.Lng + dLng);
    }

    public static double HaversineKm(GeoPoint a, GeoPoint b)
    {
        const double r = 6371;
        var dLat = (b.Lat - a.Lat) * Math.PI / 180;
        var dLng = (b.Lng - a.Lng) * Math.PI / 180;
        var s = Math.Pow(Math.Sin(dLat / 2), 2)
                + Math.Cos(a.Lat * Math.PI / 180) * Math.Cos(b.Lat * Math.PI / 180) * Math.Pow(Math.Sin(dLng / 2), 2);
        return r * 2 * Math.Atan2(Math.Sqrt(s), Math.Sqrt(1 - s));
    }

    public static List<OptimizedStop> Optimize(GeoPoint depot, IEnumerable<StopCandidate> stops)
    {
        var remaining = stops.ToList();
        var current = depot;
        double cumulativeKm = 0;
        var route = new List<OptimizedStop>();

        while (remaining.Count > 0)
        {
            var next = remaining.MinBy(s => HaversineKm(current, new GeoPoint(s.Lat, s.Lng)))!;
            remaining.Remove(next);
            var leg = HaversineKm(current, new GeoPoint(next.Lat, next.Lng));
            cumulativeKm += leg;
            route.Add(new OptimizedStop(
                next.OrderId, next.CustomerId, next.Lat, next.Lng,
                Math.Round(leg, 1),
                (int)Math.Round(cumulativeKm / AverageSpeedKmh * 60)));
            current = new GeoPoint(next.Lat, next.Lng);
        }
        return route;
    }
}
