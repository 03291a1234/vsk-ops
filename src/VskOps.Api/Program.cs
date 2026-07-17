using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using VskOps.Api.Auth;
using VskOps.Core.Domain;
using VskOps.Infrastructure;
using VskOps.Infrastructure.Repositories;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("VskOps")
    ?? throw new InvalidOperationException("Connection string 'VskOps' is not configured.");

var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();
if (string.IsNullOrWhiteSpace(jwtSettings.Key))
    throw new InvalidOperationException("Jwt:Key is not configured. Set it via user-secrets or environment (min. 32 chars).");

builder.Services.AddSingleton(jwtSettings);
builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<IDbConnectionFactory>(new SqlConnectionFactory(connectionString));

builder.Services.AddSingleton<DriverRepository>();
builder.Services.AddSingleton<TruckRepository>();
builder.Services.AddSingleton<VendorRepository>();
builder.Services.AddSingleton<CylinderTypeRepository>();
builder.Services.AddSingleton<CustomerRepository>();
builder.Services.AddSingleton<PricingRepository>();
builder.Services.AddSingleton<OrderRepository>();
builder.Services.AddSingleton<TripRepository>();
builder.Services.AddSingleton<InventoryRepository>();
builder.Services.AddSingleton<EventRepository>();
builder.Services.AddSingleton<IoclRepository>();
builder.Services.AddSingleton<NotificationRepository>();
builder.Services.AddSingleton<UserRepository>();
builder.Services.AddSingleton<ReportRepository>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = jwtSettings.Issuer,
        ValidateAudience = true,
        ValidAudience = jwtSettings.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Key)),
        ValidateLifetime = true,
    });
builder.Services.AddAuthorization(o => o.AddVskPolicies());

// Split-hosting mode: when the frontend runs on its own origin (separate App Service),
// list it in Cors:AllowedOrigins. Single-app hosting (SPA in wwwroot) needs no CORS.
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
if (corsOrigins.Length > 0)
    builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
        p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "VSK Gas Ops API",
        Version = "v1",
        Description = "Gas cylinder distribution: orders → owner approval → dispatch trips with route "
                      + "optimization → delivery reconciliation → payments & ledgers → reports → IOCL supply chain. "
                      + "Authenticate via POST /api/auth/login, then click Authorize and paste the token.",
    });
    o.IncludeXmlComments(Path.Combine(AppContext.BaseDirectory, "VskOps.Api.xml"), includeControllerXmlComments: true);
    o.MapType<DateOnly>(() => new OpenApiSchema { Type = "string", Format = "date", Example = new Microsoft.OpenApi.Any.OpenApiString("2026-07-17") });
    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT bearer token. Obtain one from POST /api/auth/login.",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
    });
    o.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = [],
    });
});

var app = builder.Build();

if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
    DatabaseMigrator.MigrateToLatest(connectionString);

app.UseSwagger();
app.UseSwaggerUI(o =>
{
    o.DocumentTitle = "VSK Gas Ops API";
    o.DisplayRequestDuration();
});

// Single-App-Service mode: when the built frontend is published into wwwroot
// (see .github/workflows/deploy-azure.yml), serve it and let the SPA own all
// non-API routes. Absent wwwroot (local dev with the Vite server), this is a no-op.
var wwwroot = Path.Combine(app.Environment.ContentRootPath, "wwwroot");
var serveSpa = File.Exists(Path.Combine(wwwroot, "index.html"));
if (serveSpa)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

if (corsOrigins.Length > 0)
    app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
if (serveSpa)
    app.MapFallbackToFile("index.html");
else
    app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription(); // API-only mode: land on the docs

app.Run();
