using System.Data;
using Dapper;

namespace VskOps.Infrastructure;

/// <summary>
/// Dapper doesn't know DateOnly as a parameter type out of the box; Npgsql maps it natively to
/// the Postgres `date` type once the parameter gets through. Registered once via the connection
/// factory's static initializer.
/// </summary>
public class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value;
    }

    public override DateOnly Parse(object value) => value switch
    {
        DateOnly d => d,
        DateTime dt => DateOnly.FromDateTime(dt),
        _ => DateOnly.Parse((string)value),
    };
}

public static class DapperConfig
{
    private static bool _initialized;

    public static void EnsureInitialized()
    {
        if (_initialized) return;
        SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());
        _initialized = true;
    }
}
