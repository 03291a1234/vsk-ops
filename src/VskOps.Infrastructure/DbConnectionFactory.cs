using System.Data;
using Microsoft.Data.SqlClient;

namespace VskOps.Infrastructure;

public interface IDbConnectionFactory
{
    IDbConnection Create();
}

public class SqlConnectionFactory(string connectionString) : IDbConnectionFactory
{
    public IDbConnection Create() => new SqlConnection(connectionString);
}
