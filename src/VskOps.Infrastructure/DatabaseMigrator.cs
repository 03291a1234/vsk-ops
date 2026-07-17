using System.Reflection;
using DbUp;

namespace VskOps.Infrastructure;

/// <summary>Runs embedded SQL migration scripts (Migrations/Scripts/*.sql) with DbUp, journaled in public.schemaversions.</summary>
public static class DatabaseMigrator
{
    public static void MigrateToLatest(string connectionString)
    {
        EnsureDatabase.For.PostgresqlDatabase(connectionString);

        var upgrader = DeployChanges.To
            .PostgresqlDatabase(connectionString)
            .WithScriptsEmbeddedInAssembly(Assembly.GetExecutingAssembly())
            .WithTransactionPerScript()
            .LogToConsole()
            .Build();

        if (!upgrader.IsUpgradeRequired()) return;

        var result = upgrader.PerformUpgrade();
        if (!result.Successful)
            throw new InvalidOperationException("Database migration failed.", result.Error);
    }
}
