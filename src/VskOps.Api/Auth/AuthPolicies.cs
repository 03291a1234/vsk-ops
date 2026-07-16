using Microsoft.AspNetCore.Authorization;
using VskOps.Core.Domain;

namespace VskOps.Api.Auth;

/// <summary>
/// Role → capability matrix, mirroring the prototype's NAV_ACCESS map — but enforced server-side
/// as real authorization instead of a UI preference.
/// </summary>
public static class AuthPolicies
{
    public const string MasterData = nameof(MasterData);       // drivers, trucks, cylinders, vendors, customers
    public const string OrdersRead = nameof(OrdersRead);
    public const string OrderCreate = nameof(OrderCreate);
    public const string OrderApprove = nameof(OrderApprove);   // owners only
    public const string Payments = nameof(Payments);
    public const string DispatchRead = nameof(DispatchRead);   // includes drivers (their own trips)
    public const string DispatchManage = nameof(DispatchManage);
    public const string DeliverStop = nameof(DeliverStop);     // drivers confirm deliveries at the door
    public const string Pricing = nameof(Pricing);             // MRP, discounts, empty prices
    public const string Reports = nameof(Reports);

    public static void AddVskPolicies(this AuthorizationOptions options)
    {
        options.AddPolicy(MasterData, p => p.RequireRole(Roles.Owner, Roles.Dispatch));
        options.AddPolicy(OrdersRead, p => p.RequireRole(Roles.Owner, Roles.Dispatch, Roles.Accountant));
        options.AddPolicy(OrderCreate, p => p.RequireRole(Roles.Owner, Roles.Dispatch));
        options.AddPolicy(OrderApprove, p => p.RequireRole(Roles.Owner));
        options.AddPolicy(Payments, p => p.RequireRole(Roles.Owner, Roles.Dispatch, Roles.Accountant));
        options.AddPolicy(DispatchRead, p => p.RequireRole(Roles.Owner, Roles.Dispatch, Roles.Driver));
        options.AddPolicy(DispatchManage, p => p.RequireRole(Roles.Owner, Roles.Dispatch));
        options.AddPolicy(DeliverStop, p => p.RequireRole(Roles.Owner, Roles.Dispatch, Roles.Driver));
        options.AddPolicy(Pricing, p => p.RequireRole(Roles.Owner, Roles.Accountant));
        options.AddPolicy(Reports, p => p.RequireRole(Roles.Owner, Roles.Dispatch, Roles.Accountant));
    }
}
