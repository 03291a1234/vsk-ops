namespace VskOps.Core.Domain;

public class Driver
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? License { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Truck
{
    public int Id { get; set; }
    public string RegNo { get; set; } = "";
    public int? Capacity { get; set; }
    public int? DriverId { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Vendor
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class CylinderType
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public decimal Weight { get; set; }
    /// <summary>What a customer pays to keep/own an empty cylinder instead of returning it.</summary>
    public decimal? EmptyPrice { get; set; }
}

public class Customer
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public double? Lat { get; set; }
    public double? Lng { get; set; }
    /// <summary>Amount already owed before this system was used.</summary>
    public decimal OpeningBalance { get; set; }
    /// <summary>Cylinders already with the customer (one type) before this system was used.</summary>
    public int? OpeningEmptiesCylinderTypeId { get; set; }
    public int OpeningEmptiesQty { get; set; }
}

public class MrpEntry
{
    public int Id { get; set; }
    public int CylinderTypeId { get; set; }
    public decimal Value { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public DateTime ChangedAt { get; set; }
}

public class Discount
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public int CylinderTypeId { get; set; }
    public decimal Amount { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
}

public class Order
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public DateOnly OrderDate { get; set; }
    public OrderStage Stage { get; set; }
    public bool Rejected { get; set; }
    public string? ApprovedBy { get; set; }
    public int? TripId { get; set; }
    public decimal Amount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeliveredAt { get; set; }

    public List<OrderItem> Items { get; set; } = new();
    public List<OrderPayment> Payments { get; set; } = new();
    public List<EmptyPurchase> EmptyPurchases { get; set; } = new();
}

public class OrderItem
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int CylinderTypeId { get; set; }
    /// <summary>Quantity originally requested. Qty may be adjusted (+/-) at delivery.</summary>
    public int OrderedQty { get; set; }
    public int Qty { get; set; }
    public decimal Rate { get; set; }
    public decimal Amount { get; set; }
}

public class OrderPayment
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public string Method { get; set; } = "Cash";
    public decimal Amount { get; set; }
    public DateTime Timestamp { get; set; }
}

/// <summary>A customer buying an empty cylinder outright (keeping it) instead of returning it.</summary>
public class EmptyPurchase
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int CylinderTypeId { get; set; }
    public int Qty { get; set; }
    public decimal Price { get; set; }
    public decimal Amount { get; set; }
    public DateOnly Date { get; set; }
}

public class Trip
{
    public int Id { get; set; }
    public int DriverId { get; set; }
    public int TruckId { get; set; }
    public TripStage Stage { get; set; }
    public DateTime CreatedAt { get; set; }

    public List<TripStop> Stops { get; set; } = new();
}

public class TripStop
{
    public int Id { get; set; }
    public int TripId { get; set; }
    public int OrderId { get; set; }
    public int Seq { get; set; }
    public double Lat { get; set; }
    public double Lng { get; set; }
    public double DistanceKm { get; set; }
    public int EtaMin { get; set; }
    public bool Delivered { get; set; }
    public DateTime? DeliveredAt { get; set; }

    public List<TripStopItem> Items { get; set; } = new();
}

/// <summary>Per-cylinder-type reconciliation recorded when a stop is delivered.</summary>
public class TripStopItem
{
    public int Id { get; set; }
    public int TripStopId { get; set; }
    public int CylinderTypeId { get; set; }
    public int OrderedQty { get; set; }
    public int ActualQty { get; set; }
    public int FullQty { get; set; }
    public int EmptyQty { get; set; }
    public int DefectQty { get; set; }
    public int BuyQty { get; set; }
}

public class CylinderEvent
{
    public int Id { get; set; }
    public DateOnly Date { get; set; }
    public int CustomerId { get; set; }
    public int CylinderTypeId { get; set; }
    public string Action { get; set; } = CylinderAction.Filled;
    public int Qty { get; set; }
}

/// <summary>Company's own depot stock, one record per cylinder type.</summary>
public class InventoryRecord
{
    public int Id { get; set; }
    public int CylinderTypeId { get; set; }
    public int Full { get; set; }
    public int Empty { get; set; }
    public int Defective { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class IoclTransaction
{
    public int Id { get; set; }
    /// <summary>"sent" (empties/defectives out for refill) or "received" (full stock in).</summary>
    public string Type { get; set; } = IoclTransactionType.Sent;
    public DateOnly Date { get; set; }
    public int CylinderTypeId { get; set; }
    public int Qty { get; set; }
    public int EmptyQty { get; set; }
    public int DefectiveQty { get; set; }
    public int? VendorId { get; set; }
    public decimal AmountBilled { get; set; }
    public bool Paid { get; set; }
    public DateOnly? PaidOn { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Notification
{
    public int Id { get; set; }
    public string Audience { get; set; } = "";
    public string Message { get; set; } = "";
    public DateTime Timestamp { get; set; }
}

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = Roles.Owner;
    /// <summary>Set when Role == Driver, so dispatch views can be scoped to their own trips.</summary>
    public int? DriverId { get; set; }
    public DateTime CreatedAt { get; set; }
}
