# VSK Gas Ops

ASP.NET Core (.NET 8) Web API + Dapper + SQL Server/Azure SQL backend, with a React (Vite) frontend,
for the VSK gas cylinder distribution business: orders → owner approval → multi-order dispatch trips
with route optimization → delivery reconciliation → payments & customer ledgers → reports → IOCL
supply-chain tracking.

This covers **Phases 1–2** of the production plan (see [`docs/vsk-ops-production-plan.md`](docs/vsk-ops-production-plan.md)):
backend + schema + auth, with the business rules ported from the working React prototype
([`docs/vsk-ops-prototype.jsx`](docs/vsk-ops-prototype.jsx)) and pinned by unit tests, plus that
prototype's UI ported to a real frontend that talks to the API.

## Solution layout

| Project | What it holds |
|---|---|
| `src/VskOps.Core` | Domain entities + **pure business logic** ported 1:1 from the prototype: pricing (MRP history + windowed discounts), ledger math (dues crystallize at delivery, as-of-date balances, FIFO bulk settlement), empties-at-customer balances, order building, delivery reconciliation (defects, buy-at-door caps), route optimization (haversine + nearest-neighbour + stable pseudo-coords), IOCL inventory deltas. No dependencies — fully unit-testable. |
| `src/VskOps.Infrastructure` | Dapper repositories (hand-written SQL), DbUp migrations (`Migrations/Scripts/*.sql`, embedded), and the report queries — each reporting page the prototype computed in JS is a purpose-built `GROUP BY` query here. |
| `src/VskOps.Api` | Controllers, JWT auth, and the role→capability matrix (Owner / Dispatch / Accountant / Driver) enforced server-side via authorization policies — the prototype's `NAV_ACCESS` map, but as a real security boundary. |
| `tests/VskOps.Core.Tests` | xUnit tests pinning every ported business rule to the prototype's behavior. |
| `frontend/` | React 18 + Vite + Tailwind port of the prototype UI: JWT login, role-scoped navigation, and every screen (dashboard, new order, approvals, dispatch & delivery, master data, IOCL, pricing, reports with printable invoices) wired to the API. |

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

### Frontend

```bash
# terminal 1 — API on a fixed port for the dev proxy
ASPNETCORE_URLS=http://localhost:5000 dotnet run --project src/VskOps.Api

# terminal 2 — Vite dev server (proxies /api → localhost:5000, no CORS needed)
cd frontend
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`). On a fresh database, use
*"First time here? Create the first Owner account"* on the login screen — the first registered
user is forced to the Owner role; Owners create the rest.

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

### Frontend notes

- The server is authoritative for all money math — the pricing preview on New Order only renders for
  roles allowed to read pricing (Owner/Accountant); Dispatch places orders without a preview and the
  server prices them identically.
- Drivers see their own trips only (`GET /api/trips` is scoped server-side) and read stop contents
  through `GET /api/trips/{id}/orders`, which is also driver-scoped.
- Notifications poll every 30s for now; SignalR replaces the poll in a later phase.
- Inline IOCL transaction *editing* is not in the UI yet (delete-and-recreate reverses stock
  correctly via the API's compensation logic); `PUT /api/iocl/{id}` already exists when it's wanted.

## PWA & mobile

The frontend is an installable PWA: on a phone, open the site and use *Add to Home Screen* —
no app store involved. Implementation notes:

- `vite-plugin-pwa` generates the manifest + service worker (`registerType: autoUpdate`).
- The service worker precaches the **app shell only**; `/api/*` is never cached — money data is
  always fetched live (`navigateFallbackDenylist` keeps API/Swagger routes out of the SPA fallback).
- Below the `md` breakpoint the sidebar becomes a hamburger-opened overlay drawer.
- iOS note: PWAs need HTTPS in production (App Service provides it) and use `apple-touch-icon.png`.

## Deploying to Azure

Single App Service serving both API and frontend (the API serves `wwwroot` and falls back to
`index.html` for SPA routes). [`.github/workflows/deploy-azure.yml`](.github/workflows/deploy-azure.yml)
has the full recipe: one-time `az` provisioning commands in the header comment, then set the
`AZURE_WEBAPP_NAME` and `AZURE_WEBAPP_PUBLISH_PROFILE` repo secrets and run the workflow from the
Actions tab. Switch its trigger to `push` for continuous deployment once verified.

If you later want the frontend on Azure Static Web Apps + the API on its own App Service instead,
add a CORS policy to `Program.cs` and point the frontend at the API origin — the split was kept
out of scope to minimize moving parts, per the plan.

## Next phases

4. *(Optional)* MAUI wrapper once real native needs emerge (push notifications, offline-first).
