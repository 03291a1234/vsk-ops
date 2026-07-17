import React, { useState } from "react";
import { ChevronRight, Navigation, PackageCheck, Route, Wallet } from "lucide-react";
import { api, tryGet } from "../api";
import { useToast, FlowNav } from "../App";
import { useAuth } from "../auth";
import { byId, useLoad } from "../hooks";
import {
  Badge, Btn, cylLabel, dueOf, Empty, Field, inputCls, itemsSummary,
  Panel, paymentStatusOf, Pipeline, TRIP_STAGES, LoadError,
} from "../ui";

export default function DispatchTab({ setTab, goToOrderPayment }) {
  const notify = useToast();
  const { profile } = useAuth();
  const isDriver = profile.role === "Driver";

  const { data, loading, error, reload } = useLoad(async () => {
    const [trips, drivers, trucks, types, customers, orders] = await Promise.all([
      api.get("/api/trips"), // server scopes drivers to their own trips
      tryGet("/api/drivers", []),
      tryGet("/api/trucks", []),
      api.get("/api/cylinder-types"),
      tryGet("/api/customers", []),
      tryGet("/api/orders", []), // drivers can't read this — trip orders come from /api/trips/{id}/orders instead
    ]);
    return { trips, drivers, trucks, types, customers, orders };
  });

  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [selected, setSelected] = useState([]);

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading dispatch…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { trips, drivers, trucks, types, customers, orders } = data;
  const typeById = byId(types);
  const customerById = byId(customers);
  const driverById = byId(drivers);
  const truckById = byId(trucks);
  const nameOfCustomer = (id) => customerById[id]?.name ?? `Customer ${id}`;

  const pool = orders.filter((o) => o.stage === 1 && !o.tripId && !o.rejected);
  const toggleSel = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const build = async () => {
    try {
      const res = await api.post("/api/trips", { driverId: Number(driverId), truckId: Number(truckId), orderIds: selected });
      notify(`Trip #${res.id} created with ${selected.length} order(s).`);
      setSelected([]);
      setDriverId("");
      setTruckId("");
      await reload();
    } catch (e) {
      notify(e.message);
    }
  };

  const depart = async (trip) => {
    try {
      const res = await api.post(`/api/trips/${trip.id}/depart`);
      (res.warnings || []).forEach(notify);
      notify(`Trip #${trip.id} departed — route optimized across ${res.route.length} stop(s).`);
      await reload();
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <FlowNav current="dispatch" setTab={setTab} />
      {isDriver && (
        <div className="bg-[#171D22] border border-[#262E35] rounded-xl px-5 py-3 text-sm text-[#8FA0AC]">
          Showing your assigned trips only.
        </div>
      )}
      {!isDriver && (
        <Panel eyebrow="Multi-Order Dispatch" title={`Approved Orders Ready for Trip (${pool.length})`}
          right={<span className="text-[11px] text-[#5C6975] font-mono">One truck/driver can carry several orders in a single trip</span>}>
          {pool.length === 0 ? (
            <Empty text="No approved orders waiting for dispatch." action={() => setTab("orders")} actionLabel="Go approve some orders" />
          ) : (
            <div className="space-y-2 mb-4">
              {pool.map((o) => (
                <label key={o.id} className="flex items-center gap-3 bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSel(o.id)} className="accent-[#FF7A45]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{nameOfCustomer(o.customerId)}</div>
                    <div className="text-[12px] text-[#8FA0AC] font-mono">#{o.id} · {itemsSummary(o, typeById)}</div>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <Field label="Driver">
              <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Select driver</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Truck">
              <select className={inputCls} value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                <option value="">Select truck</option>
                {trucks.map((t) => <option key={t.id} value={t.id}>{t.regNo}</option>)}
              </select>
            </Field>
            <Btn tone="flame" disabled={!driverId || !truckId || !selected.length} onClick={build} className="justify-center">
              <Route size={15} /> Create Trip ({selected.length})
            </Btn>
          </div>
        </Panel>
      )}

      {!isDriver && trips.some((t) => t.stage === 2) && (
        <div className="flex items-center justify-between gap-2 bg-[#22D3B0]/10 border border-[#22D3B0]/30 rounded-lg px-4 py-2.5">
          <span className="text-sm text-[#22D3B0]">
            {trips.filter((t) => t.stage === 2).length} trip(s) completed. Fill/empty/defect and payments are ready in Reports.
          </span>
          <Btn tone="teal" onClick={() => setTab("reports-daily")}>View Reports <ChevronRight size={14} /></Btn>
        </div>
      )}

      <div className="space-y-4">
        {trips.length === 0 && <Empty text={isDriver ? "No trips assigned to you yet." : "No trips created yet."} />}
        {trips.map((t) => (
          <TripCard
            key={t.id}
            trip={t}
            typeById={typeById}
            nameOfCustomer={nameOfCustomer}
            driverName={driverById[t.driverId]?.name ?? `Driver ${t.driverId}`}
            truckLabel={truckById[t.truckId]?.regNo ?? `Truck ${t.truckId}`}
            onDepart={() => depart(t)}
            onChanged={reload}
            goToOrderPayment={goToOrderPayment}
            isDriver={isDriver}
          />
        ))}
      </div>
    </div>
  );
}

function TripCard({ trip: t, typeById, nameOfCustomer, driverName, truckLabel, onDepart, onChanged, goToOrderPayment, isDriver }) {
  // Per-trip order details come from the trip-scoped endpoint so drivers can see their stops too
  const { data: tripOrders } = useLoad(() => api.get(`/api/trips/${t.id}/orders`), [t.id, t.stage]);
  const orderById = byId(tripOrders || []);

  return (
    <Panel>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm text-[#8FA0AC]">Trip #{t.id}</span>
            <Badge tone={t.stage === 2 ? "good" : "flame"}>{TRIP_STAGES[t.stage]}</Badge>
            <Badge tone="muted">{(tripOrders || []).length} order(s)</Badge>
          </div>
          <div className="font-medium">{driverName} · {truckLabel}</div>
        </div>
        {t.stage === 0 && !isDriver && (
          <Btn tone="flame" onClick={onDepart}><Navigation size={15} /> Fill &amp; Depart (Optimized Route)</Btn>
        )}
      </div>

      <div className="mt-4"><Pipeline stages={TRIP_STAGES} stageIndex={t.stage} /></div>

      {t.stage === 0 && (tripOrders || []).length > 0 && (
        <div className="mt-4 space-y-1">
          {tripOrders.map((o) => (
            <div key={o.id} className="text-[12px] text-[#8FA0AC] font-mono">
              #{o.id} · {nameOfCustomer(o.customerId)} · {itemsSummary(o, typeById)}
            </div>
          ))}
        </div>
      )}

      {t.stage >= 1 && (
        <div className="mt-4 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-[#5C6975] font-mono mb-1">Optimized Route (nearest-neighbour)</div>
          {t.stops.map((stop, i) => (
            <RouteStop
              key={stop.id}
              trip={t}
              stop={stop}
              seq={i + 1}
              order={orderById[stop.orderId]}
              typeById={typeById}
              nameOfCustomer={nameOfCustomer}
              onChanged={onChanged}
              goToOrderPayment={goToOrderPayment}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function RouteStop({ trip, stop, seq, order, typeById, nameOfCustomer, onChanged, goToOrderPayment }) {
  const notify = useToast();
  const [rows, setRows] = useState(null);
  if (!order) return null;

  const editRows = rows ?? order.items.map((it) => ({ cylinderTypeId: it.cylinderTypeId, actualQty: it.qty, empty: 0, defect: 0, buy: 0 }));
  const updateRow = (idx, field, val) => setRows(editRows.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));
  const totalQty = order.items.reduce((a, it) => a + it.qty, 0);
  const priceFor = (cylinderTypeId) => typeById[cylinderTypeId]?.emptyPrice || 0;

  const submit = async () => {
    try {
      const res = await api.post(`/api/trips/${trip.id}/stops/${stop.id}/deliver`, {
        items: editRows.map((r) => ({
          cylinderTypeId: r.cylinderTypeId,
          actualQty: Number(r.actualQty) || 0,
          emptyQty: Number(r.empty) || 0,
          defectQty: Number(r.defect) || 0,
          buyQty: Number(r.buy) || 0,
        })),
      });
      notify(`Stop delivered — bill ₹${res.newAmount}.${res.tripCompleted ? " Trip completed!" : ""}`);
      onChanged();
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <div className="bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-[#FF7A45]/15 text-[#FF9A6E] text-[12px] font-mono flex items-center justify-center border border-[#FF7A45]/30">{seq}</div>
          <div>
            <div className="text-sm font-medium">{nameOfCustomer(stop.customerId ?? order.customerId)}</div>
            <div className="text-[11px] text-[#5C6975] font-mono">
              {order.items.length} item(s), {totalQty} cyl ordered · {stop.distanceKm}km leg · ETA {stop.etaMin} min
            </div>
          </div>
        </div>
        {stop.delivered && <Badge tone="good">Delivered</Badge>}
      </div>

      <div className="space-y-2">
        {stop.delivered
          ? stop.items.map((it) => {
              const changed = it.actualQty !== it.orderedQty;
              return (
                <div key={it.cylinderTypeId} className="flex items-center justify-between gap-2 flex-wrap bg-[#171D22] rounded-md px-3 py-2">
                  <span className="text-sm">
                    {cylLabel(typeById[it.cylinderTypeId])} · ordered {it.orderedQty}
                    {changed && <span className="text-[#FFC857]"> → delivered {it.actualQty}</span>}
                  </span>
                  <div className="flex gap-2 flex-wrap">
                    <Badge tone="flame">Full: {it.fullQty}</Badge>
                    <Badge tone="teal">Empty: {it.emptyQty}</Badge>
                    <Badge tone="bad">Defect: {it.defectQty}</Badge>
                    {it.buyQty > 0 && <Badge tone="warn">Bought: {it.buyQty}</Badge>}
                  </div>
                </div>
              );
            })
          : order.items.map((it, idx) => {
              const row = editRows[idx];
              const actualQty = Number(row.actualQty) || 0;
              const liveFull = Math.max(0, actualQty - (Number(row.defect) || 0));
              const shortfall = Math.max(0, liveFull - (Number(row.empty) || 0));
              const price = priceFor(it.cylinderTypeId);
              const diff = actualQty - it.qty;
              return (
                <div key={it.cylinderTypeId} className="bg-[#171D22] rounded-md px-3 py-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm">{cylLabel(typeById[it.cylinderTypeId])} · ordered {it.qty}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex flex-col items-start">
                        <span className="text-[9px] text-[#4B5661] font-mono">Qty to deliver</span>
                        <input type="number" min="0" value={row.actualQty} onChange={(e) => updateRow(idx, "actualQty", e.target.value)} className={`${inputCls} w-16`} />
                      </div>
                      <Badge tone="flame">Full: {liveFull}</Badge>
                      <div className="flex flex-col items-start">
                        <span className="text-[9px] text-[#4B5661] font-mono">Empty</span>
                        <input type="number" min="0" value={row.empty} onChange={(e) => updateRow(idx, "empty", e.target.value)} className={`${inputCls} w-16`} />
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-[9px] text-[#4B5661] font-mono">Defect</span>
                        <input type="number" min="0" max={actualQty} value={row.defect} onChange={(e) => updateRow(idx, "defect", e.target.value)} className={`${inputCls} w-16`} />
                      </div>
                    </div>
                  </div>
                  {diff !== 0 && (
                    <div className="text-[10px] text-[#FFC857] font-mono mt-1">
                      {diff > 0 ? `+${diff} more than ordered` : `${diff} less than ordered`} — bill will use ₹{it.rate} × {actualQty} = ₹{it.rate * actualQty} for this line.
                    </div>
                  )}
                  {Number(row.defect) > 0 && (
                    <div className="text-[10px] text-[#FF9A6E] font-mono mt-1">{actualQty} − {row.defect} defective = {liveFull} full.</div>
                  )}
                  {shortfall > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#262E35] flex items-center justify-between flex-wrap gap-2">
                      <div className="text-[11px] text-[#FFC857] font-mono">
                        Shortfall of {shortfall} not being returned — customer can buy it now{price ? ` at ₹${price}/cyl` : " (set an empty price in Pricing first)"}.
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-[#4B5661] font-mono">Buy</span>
                        <input
                          type="number" min="0" max={shortfall} disabled={!price} value={row.buy}
                          onChange={(e) => updateRow(idx, "buy", Math.min(Number(e.target.value) || 0, shortfall))}
                          className={`${inputCls} w-16`}
                        />
                        {Number(row.buy) > 0 && <Badge tone="teal">₹{Number(row.buy) * price}</Badge>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
      </div>

      {!stop.delivered && (
        <div className="mt-3 flex justify-end">
          <Btn tone="teal" onClick={submit}><PackageCheck size={15} /> Confirm Delivery for This Stop</Btn>
        </div>
      )}
      {stop.delivered && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#262E35] pt-3">
          <span className="text-[12px] font-mono text-[#5C6975]">
            ₹{order.amount} total · <span className={dueOf(order) > 0 ? "text-[#FF5D5D]" : "text-[#3DD16F]"}>{paymentStatusOf(order)}</span>
          </span>
          <Btn tone="ghost" onClick={() => goToOrderPayment(order.id)}>
            <Wallet size={15} /> {dueOf(order) > 0 ? "Record Payment" : "View Payment"} <ChevronRight size={14} />
          </Btn>
        </div>
      )}
    </div>
  );
}
