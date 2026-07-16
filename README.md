# VSK Gas Ops — Backend API

ASP.NET Core (.NET 8) Web API + Dapper + SQL Server/Azure SQL backend for the VSK gas cylinder
distribution business: orders → owner approval → multi-order dispatch trips with route optimization →
delivery reconciliation → payments & customer ledgers → reports → IOCL supply-chain tracking.

This is **Phase 1** of the production plan (see [`docs/vsk-ops-production-plan.md`](docs/vsk-ops-production-plan.md)):
backend + schema + auth, with the business rules ported from the working React prototype
([`docs/vsk-ops-prototype.jsx`](docs/vsk-ops-prototype.jsx)) and pinned by unit tests.

## Solution layout

| Project | What it holds |
|---|---|
| `src/VskOps.Core` | Domain entities + **pure business logic** ported 1:1 from the prototype: pricing (MRP history + windowed discounts), ledger math (dues crystallize at delivery, as-of-date balances, FIFO bulk settlement), empties-at-customer balances, order building, delivery reconciliation (defects, buy-at-door caps), route optimization (haversine + nearest-neighbour + stable pseudo-coords), IOCL inventory deltas. No dependencies — fully unit-testable. |
| `src/VskOps.Infrastructure` | Dapper repositories (hand-written SQL), DbUp migrations (`Migrations/Scripts/*.sql`, embedded), and the report queries — each reporting page the prototype computed in JS is a purpose-built `GROUP BY` query here. |
| `src/VskOps.Api` | Controllers, JWT auth, and the role→capability matrix (Owner / Dispatch / Accountant / Driver) enforced server-side via authorization policies — the prototype's `NAV_ACCESS` map, but as a real security boundary. |
| `tests/VskOps.Core.Tests` | xUnit tests pinning every ported business rule to the prototype's behavior. |

## Getting started

Prereqs: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) and a SQL Server —
Azure SQL, or locally e.g. `docker run -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='<YourStrong!Pass>' -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest`.

```bash
dotnet build
dotnet test

# configure secrets (don't put real values in appsettings.json)
cd src/VskOps.Api
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:VskOps" "Server=localhost,1433;Database=VskOps;User Id=sa;Password=<YourStrong!Pass>;TrustServerCertificate=True"
dotnet user-secrets set "Jwt:Key" "<random string, 32+ chars>"

dotnet run   # migrations run automatically on startup (Database:MigrateOnStartup)
```

Swagger UI is at `/swagger`. Bootstrap flow:

1. `POST /api/auth/register` — the **first** user self-registers and is forced to the Owner role.
2. `POST /api/auth/login` → JWT; click *Authorize* in Swagger and paste it.
3. Owners can then register Dispatch / Accountant / Driver accounts (Driver accounts link to a
   `Drivers` row so dispatch views scope to their own trips).

## Role → capability matrix

Mirrors the prototype's `NAV_ACCESS`, enforced with `[Authorize(Policy = …)]`:

| Capability | Owner | Dispatch | Accountant | Driver |
|---|---|---|---|---|
| Master data (drivers, trucks, cylinders, vendors, customers, IOCL) | ✅ | ✅ | — | — |
| Create orders | ✅ | ✅ | — | — |
| Approve / reject orders | ✅ | — | — | — |
| Record payments / bulk settle | ✅ | ✅ | ✅ | — |
| Create trips / depart | ✅ | ✅ | — | — |
| View trips / deliver stops | ✅ | ✅ | — | ✅ (own trips only) |
| Pricing (MRP, discounts, empty prices) | ✅ | — | ✅ | — |
| Reports | ✅ | ✅ | ✅ | — |

## Business rules worth knowing (ported from the prototype)

- **Pricing**: rate = latest MRP effective on the order date − the largest active discount for that
  customer + cylinder type, floored at 0. Empty-cylinder purchases use the type's own empty price.
- **Ledger**: an order owes nothing until delivered. Balance as of a date counts only payments made
  on/before that date. Bulk settlement fills the oldest delivered order first; excess is reported
  back, never applied.
- **Dispatch**: full stock leaves the depot the moment a trip departs. Customers without coordinates
  get a stable pseudo-location so routes stay deterministic. ETAs assume 28 km/h cumulative.
- **Delivery**: quantity handed over may differ from ordered (bill re-prices), defects aren't billed
  but return to the depot with collected empties, and buy-at-the-door is capped at that delivery's
  own shortfall (full − empties returned).
- **IOCL**: `sent` reduces depot empties/defectives, `received` adds full stock and a payable;
  editing/deleting a transaction first reverses its original stock effect.
- **Reports**: `filled` events already exclude defective units — they're logged at delivery from the
  actual full count handed over.

## Deviations from the plan (deliberate, small)

- **Auth** uses ASP.NET Core Identity's `PasswordHasher` + JWT bearer with a lightweight `Users`
  table instead of full ASP.NET Core Identity — full Identity's store abstractions add a lot of
  surface for the same result with Dapper. Swapping to full Identity later is contained to
  `AuthController` + `UserRepository`.
- **SignalR** (real-time notifications) is not wired yet; notifications persist to the
  `Notifications` table the same way the prototype recorded them. A hub can subscribe to the same
  writes in Phase 2.

## Next phases

2. **Port the frontend** — swap the prototype's `window.storage` calls for HTTP calls to this API; real login screen.
3. **PWA + deploy** — manifest, service worker, responsive pass; Azure App Service + Static Web Apps + Azure SQL; extend `.github/workflows/ci.yml` with a deploy job.
4. *(Optional)* MAUI wrapper once real native needs emerge.
