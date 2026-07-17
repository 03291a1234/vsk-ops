using Dapper;
using VskOps.Core.Domain;

namespace VskOps.Infrastructure.Repositories;

public class DriverRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<Driver>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<Driver>("SELECT * FROM Drivers ORDER BY Name")).ToList();
    }

    public async Task<int> Insert(Driver d)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO Drivers (Name, Phone, License) OUTPUT INSERTED.Id VALUES (@Name, @Phone, @License)", d);
    }

    public async Task Delete(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM Drivers WHERE Id = @id", new { id });
    }
}

public class TruckRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<Truck>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<Truck>("SELECT * FROM Trucks ORDER BY RegNo")).ToList();
    }

    public async Task<int> Insert(Truck t)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO Trucks (RegNo, Capacity, DriverId) OUTPUT INSERTED.Id VALUES (@RegNo, @Capacity, @DriverId)", t);
    }

    public async Task Delete(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM Trucks WHERE Id = @id", new { id });
    }
}

public class VendorRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<Vendor>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<Vendor>("SELECT * FROM Vendors ORDER BY Name")).ToList();
    }

    public async Task<int> Insert(Vendor v)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO Vendors (Name, Phone, Address) OUTPUT INSERTED.Id VALUES (@Name, @Phone, @Address)", v);
    }

    /// <summary>Vendors with billing history can't be deleted (mirrors the prototype's guard).</summary>
    public async Task<bool> HasBillingHistory(int vendorId)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            "SELECT COUNT(1) FROM IoclTransactions WHERE VendorId = @vendorId", new { vendorId }) > 0;
    }

    public async Task Delete(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM Vendors WHERE Id = @id", new { id });
    }
}

public class CylinderTypeRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<CylinderType>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<CylinderType>("SELECT * FROM CylinderTypes ORDER BY Weight")).ToList();
    }

    public async Task<CylinderType?> GetById(int id)
    {
        using var conn = db.Create();
        return await conn.QuerySingleOrDefaultAsync<CylinderType>(
            "SELECT * FROM CylinderTypes WHERE Id = @id", new { id });
    }

    public async Task<int> Insert(CylinderType ct)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO CylinderTypes (Name, Weight, EmptyPrice) OUTPUT INSERTED.Id VALUES (@Name, @Weight, @EmptyPrice)", ct);
    }

    public async Task SetEmptyPrice(int id, decimal emptyPrice)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("UPDATE CylinderTypes SET EmptyPrice = @emptyPrice WHERE Id = @id", new { id, emptyPrice });
    }

    public async Task Delete(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM CylinderTypes WHERE Id = @id", new { id });
    }
}

public class CustomerRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<Customer>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<Customer>("SELECT * FROM Customers ORDER BY Name")).ToList();
    }

    public async Task<Customer?> GetById(int id)
    {
        using var conn = db.Create();
        return await conn.QuerySingleOrDefaultAsync<Customer>("SELECT * FROM Customers WHERE Id = @id", new { id });
    }

    public async Task<int> Insert(Customer c)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            """
            INSERT INTO Customers (Name, Phone, Address, Lat, Lng, OpeningBalance, OpeningEmptiesCylinderTypeId, OpeningEmptiesQty)
            OUTPUT INSERTED.Id
            VALUES (@Name, @Phone, @Address, @Lat, @Lng, @OpeningBalance, @OpeningEmptiesCylinderTypeId, @OpeningEmptiesQty)
            """, c);
    }

    public async Task Delete(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM Customers WHERE Id = @id", new { id });
    }
}

public class PricingRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<MrpEntry>> GetMrpHistory()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<MrpEntry>("SELECT * FROM MrpHistory ORDER BY EffectiveFrom DESC, ChangedAt DESC")).ToList();
    }

    public async Task<int> InsertMrp(MrpEntry m)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            "INSERT INTO MrpHistory (CylinderTypeId, Value, EffectiveFrom) OUTPUT INSERTED.Id VALUES (@CylinderTypeId, @Value, @EffectiveFrom)", m);
    }

    public async Task<IReadOnlyList<Discount>> GetDiscounts()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<Discount>("SELECT * FROM Discounts")).ToList();
    }

    public async Task<int> InsertDiscount(Discount d)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            """
            INSERT INTO Discounts (CustomerId, CylinderTypeId, Amount, StartDate, EndDate)
            OUTPUT INSERTED.Id VALUES (@CustomerId, @CylinderTypeId, @Amount, @StartDate, @EndDate)
            """, d);
    }

    public async Task DeleteDiscount(int id)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("DELETE FROM Discounts WHERE Id = @id", new { id });
    }
}

public class NotificationRepository(IDbConnectionFactory db)
{
    public async Task<IReadOnlyList<Notification>> GetRecent(int limit = 80)
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<Notification>(
            "SELECT TOP (@limit) * FROM Notifications ORDER BY Timestamp DESC", new { limit })).ToList();
    }

    public async Task Insert(string audience, string message)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync(
            "INSERT INTO Notifications (Audience, Message) VALUES (@audience, @message)", new { audience, message });
    }
}

public class UserRepository(IDbConnectionFactory db)
{
    public async Task<User?> GetByEmail(string email)
    {
        using var conn = db.Create();
        return await conn.QuerySingleOrDefaultAsync<User>("SELECT * FROM Users WHERE Email = @email", new { email });
    }

    public async Task<IReadOnlyList<User>> GetAll()
    {
        using var conn = db.Create();
        return (await conn.QueryAsync<User>("SELECT * FROM Users ORDER BY Name")).ToList();
    }

    public async Task<User?> GetById(int id)
    {
        using var conn = db.Create();
        return await conn.QuerySingleOrDefaultAsync<User>("SELECT * FROM Users WHERE Id = @id", new { id });
    }

    public async Task UpdatePasswordHash(int id, string passwordHash)
    {
        using var conn = db.Create();
        await conn.ExecuteAsync("UPDATE Users SET PasswordHash = @passwordHash WHERE Id = @id", new { id, passwordHash });
    }

    public async Task<int> Insert(User u)
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>(
            """
            INSERT INTO Users (Name, Email, PasswordHash, Role, DriverId)
            OUTPUT INSERTED.Id VALUES (@Name, @Email, @PasswordHash, @Role, @DriverId)
            """, u);
    }

    public async Task<int> Count()
    {
        using var conn = db.Create();
        return await conn.ExecuteScalarAsync<int>("SELECT COUNT(1) FROM Users");
    }
}
