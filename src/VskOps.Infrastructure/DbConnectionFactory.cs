using System.Data;
using Npgsql;

namespace VskOps.Infrastructure;

public interface IDbConnectionFactory
{
    IDbConnection Create();
}

public class PostgresConnectionFactory(string connectionString) : IDbConnectionFactory
{
    static PostgresConnectionFactory() => DapperConfig.EnsureInitialized();

    public IDbConnection Create() => new NpgsqlConnection(connectionString);
}
