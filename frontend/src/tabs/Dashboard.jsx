import React from "react";
import { ChevronRight } from "lucide-react";
import { tryGet } from "../api";
import { byId, useLoad } from "../hooks";
import { Badge, Btn, cylLabel, dueOf, Empty, Panel, Pipeline, Stat, TRIP_STAGES } from "../ui";

export default function Dashboard({ setTab }) {
  const { data, loading, error } = useLoad(async () => {
    const [orders, trips, types, inventory, drivers, trucks] = await Promise.all([
      tryGet("/api/orders", []),
      tryGet("/api/trips", []), // Accountant can't read trips — panel degrades gracefully
      tryGet("/api/cylinder-types", []),
      tryGet("/api/cylinder-types/inventory", []),
      tryGet("/api/drivers", []),
      tryGet("/api/trucks", []),
    ]);
    return { orders, trips, types, inventory, drivers, trucks };
  });

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading dashboard…</div>;
  if (error) return <div className="text-sm text-[#FF8A8A]">{error}</div>;

  const { orders, trips, types, inventory, drivers, trucks } = data;
  const driverById = byId(drivers);
  const truckById = byId(trucks);
  const activeOrders = orders.filter((o) => !o.rejected && o.stage < 3);
  const unpaid = orders.filter((o) => !o.rejected && dueOf(o) > 0);
  const activeTrips = trips.filter((t) => t.stage < 2);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active Orders" value={activeOrders.length} tone="flame" />
        <Stat label="Pending Approval" value={orders.filter((o) => o.stage === 0 && !o.rejected).length} tone="warn" />
        <Stat label="Trips In Motion" value={activeTrips.length} tone="teal" />
        <Stat label="Unpaid Invoices" value={unpaid.length} tone="bad" />
      </div>

      <Panel
        eyebrow="Company Inventory"
        title="Depot Stock (Full / Empty / Defective)"
        right={
          <Btn tone="ghost" onClick={() => setTab("cylinders")}>
            Manage Inventory <ChevronRight size={14} />
          </Btn>
        }
      >
        {types.length === 0 ? (
          <Empty text="No cylinder types yet." action={() => setTab("cylinders")} actionLabel="Add cylinder type" />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {types.map((ct) => {
              const rec = inventory.find((r) => r.cylinderTypeId === ct.id);
              return (
                <div key={ct.id} className="bg-[#0F1316] border border-[#262E35] rounded-lg p-3">
                  <div className="text-sm font-medium mb-2">{cylLabel(ct)}</div>
                  <div className="flex gap-2 flex-wrap">
                    <Badge tone="flame">Full: {rec?.full ?? 0}</Badge>
                    <Badge tone="teal">Empty: {rec?.empty ?? 0}</Badge>
                    <Badge tone="bad">Defective: {rec?.defective ?? 0}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Live Routing" title="Trips In Motion">
        {activeTrips.length === 0 ? (
          <Empty text="No trips dispatched right now." action={() => setTab("dispatch")} actionLabel="Go to Dispatch" />
        ) : (
          <div className="space-y-5">
            {activeTrips.slice(0, 5).map((t) => (
              <div key={t.id}>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-mono text-[#8FA0AC]">
                    Trip #{t.id} · {driverById[t.driverId]?.name ?? "—"} · {truckById[t.truckId]?.regNo ?? "—"}
                  </span>
                  <span className="text-[#5C6975]">{t.stops.length || "…"} stop(s)</span>
                </div>
                <Pipeline stages={TRIP_STAGES} stageIndex={t.stage} />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
