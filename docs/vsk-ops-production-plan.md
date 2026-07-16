# VSK Gas Ops — From Prototype to Production

## 1. What exists today (honest baseline)

The current app is a single React component running inside Claude's artifact viewer:

- **No backend, no database.** All data lives in Claude's `window.storage`, a browser-based key/value store scoped to this artifact. It isn't a real multi-user database — it's shared state for people looking at the same artifact link.
- **No real authentication.** The Owner/Dispatch/Accountant/Driver "roles" are a UI preference stored per-browser. Anyone can open dev tools and see or change anything, or just switch their own role.
- **No independent URL.** It only runs inside claude.ai; there's nothing to "visit" from a phone browser today.

None of that is a criticism of the prototype — it's done exactly what a prototype should: let us nail down the workflow (orders → approval → dispatch → delivery → payments → reports → IOCL supply chain → roles) before spending real engineering time on infrastructure. But "deploy to the cloud, accessible on mobile" means building that infrastructure now.

## 2. Target architecture

Given your background, this is the natural stack:

| Layer | Choice | Why |
|---|---|---|
| Backend API | ASP.NET Core Web API (.NET 8) | Matches your 18+ years of .NET experience directly |
| Data access | Dapper (micro-ORM) | Hand-written SQL mapped straight to objects — far better suited than EF Core to this app's reporting-heavy JOINs/aggregations (daily/multi-day breakdowns, ledger calculations, cash collection rollups) than translating them through LINQ |
| Database | Azure SQL Database | Managed, scales, pairs naturally with App Service |
| Auth | ASP.NET Core Identity + JWT bearer tokens | Roles map 1:1 onto Owner/Dispatch/Accountant/Driver already designed |
| Frontend | React (port the existing UI) as a PWA | Almost all of the component logic in this artifact carries over directly; PWA = installable on phones with zero app-store review |
| Real-time | SignalR hub | Replaces the current in-memory `notify()` calls with real push notifications (order approved, trip departed, delivery done) |
| Hosting | Azure App Service (API) + Azure Static Web Apps (frontend) + Azure SQL | Or a single App Service serving both, if you want to minimize moving parts initially |
| CI/CD | GitHub Actions → Azure | Every push to `main` auto-builds and deploys |

## 3. Database schema (maps directly from what's already modeled)

The `state` object in the artifact is already, functionally, a database schema in disguise. Translated to SQL tables — as plain `CREATE TABLE` scripts managed with a lightweight migration tool like **DbUp** or **Fluent Migrator** (since Dapper has no built-in migration story the way EF Core does):

```
Users            (Id, Name, Email, PasswordHash, Role, DriverId FK nullable)
Customers        (Id, Name, Phone, Address, Lat, Lng, OpeningBalance, OpeningEmptiesCylinderTypeId FK, OpeningEmptiesQty)
Drivers          (Id, Name, Phone, License)
Trucks           (Id, RegNo, Capacity, DriverId FK)
Vendors          (Id, Name, Phone, Address)
CylinderTypes    (Id, Name, Weight, EmptyPrice)
MrpHistory       (Id, CylinderTypeId FK, Value, EffectiveFrom)
Discounts        (Id, CustomerId FK, CylinderTypeId FK, Amount, StartDate, EndDate)
Orders           (Id, CustomerId FK, OrderDate, Stage, Rejected, ApprovedBy, TripId FK nullable, Amount)
OrderItems       (Id, OrderId FK, CylinderTypeId FK, OrderedQty, Qty, Rate, Amount)
OrderPayments    (Id, OrderId FK, Method, Amount, Timestamp)
EmptyPurchases   (Id, OrderId FK, CylinderTypeId FK, Qty, Price, Amount, Date)
Trips            (Id, DriverId FK, TruckId FK, Stage)
TripStops        (Id, TripId FK, OrderId FK, Lat, Lng, Delivered, DeliveredAt)
Events           (Id, Date, CustomerId FK, CylinderTypeId FK, Action, Qty)   -- filled/empty_return/defect/empty_purchased
Inventory        (Id, CylinderTypeId FK, Full, Empty, Defective, UpdatedAt)
IoclTransactions (Id, Type, Date, CylinderTypeId FK, Qty, EmptyQty, DefectiveQty, VendorId FK, AmountBilled, Paid, PaidOn, Note)
Notifications    (Id, Audience, Message, Timestamp)
```

Every table above is a straightforward SQL script + a Dapper repository class (e.g. `OrderRepository.GetById`, `ReportRepository.GetDailySummary`) away from what's already in the artifact's `emptyState` shape — this is a translation exercise, not a redesign. The report-heavy pages (Multi-Day View, Cylinder Movement & Payments, Cash Collection) map especially well to Dapper, since each can become one purpose-built SQL query with a `GROUP BY`/`JOIN` instead of pulling everything into memory and aggregating in C#.

## 4. Mobile strategy — two realistic tiers

**Tier 1 (fast, do this first): Progressive Web App.**
Add a `manifest.json` + service worker to the React frontend, do a responsive-layout pass (the sidebar in particular needs a mobile "drawer" behavior instead of always-visible), and it becomes installable via "Add to Home Screen" on both iOS and Android — no app store, no review process, works in days not months. This gets you 90% of "mobile app" feel for a fraction of the effort.

**Tier 2 (later, if truly needed): .NET MAUI wrapper.**
If you eventually need push notifications, offline-first behavior, or App Store/Play Store presence, MAUI reuses your C# skills directly and can share the same backend API. I'd treat this as a "phase 2" decision after the PWA is live and you know what's actually missing for drivers/dispatch in the field.

## 5. Migration phases

1. **Backend + schema + auth** — ASP.NET Core Web API project, SQL schema scripts versioned with DbUp/Fluent Migrator, Dapper repository classes for each entity, Identity + JWT, role-based `[Authorize]` attributes mirroring the Owner/Dispatch/Accountant/Driver access rules already defined in the artifact.
2. **Port the frontend** — swap `window.storage` calls for real HTTP calls to the API; wire up a real login screen; almost all component/business logic (pricing math, ledger calculations, dispatch routing, report aggregation) ports over close to as-is since it's already pure JS/React.
3. **PWA + deploy** — manifest, service worker, mobile-responsive pass, Azure App Service + Static Web Apps + Azure SQL, GitHub Actions pipeline.
4. **(Optional) MAUI wrapper** once you know what native capabilities are actually needed.

## 6. Recommended next step

This is genuinely multi-file, multi-day software engineering — scaffolding a real ASP.NET Core project, writing and running SQL migration scripts, building out Dapper repositories, testing API endpoints, iterating on a real dev server — none of which this chat/artifact environment can actually execute (no cloud provider access, no ability to run `dotnet build` against a real project on disk here in a way that persists). **Claude Code** is built exactly for this: a real file system, git, the `dotnet` and `npm` CLIs, and the ability to actually run and test what gets built before you deploy it.

I'm happy to keep helping from here on anything that's pure design/planning (schema adjustments, API contract details, further architecture decisions) or to keep extending this artifact as the reference implementation/prototype — but the actual build-and-deploy work belongs in a real dev environment.
