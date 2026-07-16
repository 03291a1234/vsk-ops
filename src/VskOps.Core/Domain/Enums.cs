namespace VskOps.Core.Domain;

/// <summary>Order pipeline: Placed → Approved → In Trip → Delivered (mirrors ORDER_STAGES in the prototype).</summary>
public enum OrderStage
{
    Placed = 0,
    Approved = 1,
    InTrip = 2,
    Delivered = 3,
}

/// <summary>Trip pipeline: Assigned → On Delivery Run → Completed (mirrors TRIP_STAGES).</summary>
public enum TripStage
{
    Assigned = 0,
    OnDeliveryRun = 1,
    Completed = 2,
}

public enum PaymentMethod
{
    Cash,
    Online,
}

/// <summary>Cylinder movement event actions (Events.Action).</summary>
public static class CylinderAction
{
    public const string Filled = "filled";
    public const string EmptyReturn = "empty_return";
    public const string Defect = "defect";
    public const string EmptyPurchased = "empty_purchased";
}

public static class IoclTransactionType
{
    public const string Sent = "sent";
    public const string Received = "received";
}

public static class Roles
{
    public const string Owner = "Owner";
    public const string Dispatch = "Dispatch";
    public const string Accountant = "Accountant";
    public const string Driver = "Driver";
}

public enum PaymentStatus
{
    Rejected,
    AwaitingDelivery,
    Paid,
    PartiallyPaid,
    Unpaid,
}
