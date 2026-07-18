import React, { useEffect, useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import { useToast } from "../App";
import { byId, useLoad } from "../hooks";
import { Badge, Btn, cylLabel, DateInput, Empty, Field, formatDateIST, inputCls, Panel, Row, Stat, todayStr, LoadError } from "../ui";

/** Generic add-form + roster layout shared by the simple master-data pages. */
function CrudPage({ eyebrow, addTitle, listTitle, form, list }) {
  return (
    <div className="grid md:grid-cols-3 gap-6">
      <Panel eyebrow="New" title={addTitle} className="md:col-span-1 h-fit">{form}</Panel>
      <Panel eyebrow={eyebrow} title={listTitle} className="md:col-span-2">{list}</Panel>
    </div>
  );
}

export function DriversTab() {
  const notify = useToast();
  const { data: drivers, loading, error, reload } = useLoad(() => api.get("/api/drivers"));
  const [f, setF] = useState({ name: "", phone: "", license: "" });

  if (loading) return null;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const add = async () => {
    try {
      await api.post("/api/drivers", f);
      setF({ name: "", phone: "", license: "" });
      reload();
    } catch (e) { notify(e.message); }
  };
  const del = (id) => api.del(`/api/drivers/${id}`).then(reload).catch((e) => notify(e.message));

  return (
    <CrudPage
      eyebrow="Roster" addTitle="Add Driver" listTitle={`Drivers (${drivers.length})`}
      form={
        <div className="space-y-3">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ravi Kumar" /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 90000 00000" /></Field>
          <Field label="License No."><input className={inputCls} value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} placeholder="TS09 2024 00123" /></Field>
          <Btn tone="flame" disabled={!f.name.trim()} onClick={add} className="w-full justify-center"><Plus size={15} /> Add Driver</Btn>
        </div>
      }
      list={
        drivers.length === 0 ? <Empty text="No drivers added yet." /> : (
          <div className="space-y-2">
            {drivers.map((d) => (
              <Row key={d.id} onDelete={() => del(d.id)}>
                <div className="font-medium">{d.name}</div>
                <div className="text-[12px] text-[var(--c-text-muted)] font-mono">{d.phone || "—"} · {d.license || "—"}</div>
              </Row>
            ))}
          </div>
        )
      }
    />
  );
}

export function TrucksTab() {
  const notify = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [trucks, drivers] = await Promise.all([api.get("/api/trucks"), api.get("/api/drivers")]);
    return { trucks, drivers };
  });
  const [f, setF] = useState({ regNo: "", capacity: "", driverId: "" });

  if (loading) return null;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { trucks, drivers } = data;
  const driverById = byId(drivers);
  const add = async () => {
    try {
      await api.post("/api/trucks", { regNo: f.regNo, capacity: f.capacity ? Number(f.capacity) : null, driverId: f.driverId ? Number(f.driverId) : null });
      setF({ regNo: "", capacity: "", driverId: "" });
      reload();
    } catch (e) { notify(e.message); }
  };
  const del = (id) => api.del(`/api/trucks/${id}`).then(reload).catch((e) => notify(e.message));

  return (
    <CrudPage
      eyebrow="Fleet" addTitle="Add Truck" listTitle={`Trucks (${trucks.length})`}
      form={
        <div className="space-y-3">
          <Field label="Registration No."><input className={inputCls} value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} placeholder="TS 09 AB 1234" /></Field>
          <Field label="Capacity (cylinders)"><input type="number" className={inputCls} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="60" /></Field>
          <Field label="Default Driver">
            <select className={inputCls} value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
              <option value="">— None —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Btn tone="flame" disabled={!f.regNo.trim()} onClick={add} className="w-full justify-center"><Plus size={15} /> Add Truck</Btn>
        </div>
      }
      list={
        trucks.length === 0 ? <Empty text="No trucks added yet." /> : (
          <div className="space-y-2">
            {trucks.map((t) => (
              <Row key={t.id} onDelete={() => del(t.id)}>
                <div className="font-medium font-mono">{t.regNo}</div>
                <div className="text-[12px] text-[var(--c-text-muted)]">Cap: {t.capacity || "—"} · Driver: {driverById[t.driverId]?.name || "—"}</div>
              </Row>
            ))}
          </div>
        )
      }
    />
  );
}

export function VendorsTab() {
  const notify = useToast();
  const { data: vendors, loading, error, reload } = useLoad(() => api.get("/api/vendors"));
  const [f, setF] = useState({ name: "", phone: "", address: "" });

  if (loading) return null;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const add = async () => {
    try {
      await api.post("/api/vendors", f);
      setF({ name: "", phone: "", address: "" });
      reload();
    } catch (e) { notify(e.message); }
  };
  const del = (id) => api.del(`/api/vendors/${id}`).then(reload).catch((e) => notify(e.message));

  return (
    <CrudPage
      eyebrow="Who You Pay" addTitle="Add Vendor" listTitle={`Vendors (${vendors.length})`}
      form={
        <div className="space-y-3">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="IOCL, truck mechanic, etc." /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 90000 00000" /></Field>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Plant / office address" /></Field>
          <Btn tone="flame" disabled={!f.name.trim()} onClick={add} className="w-full justify-center"><Plus size={15} /> Add Vendor</Btn>
        </div>
      }
      list={
        vendors.length === 0 ? <Empty text="No vendors yet." /> : (
          <div className="space-y-2">
            {vendors.map((v) => (
              <Row key={v.id} onDelete={() => del(v.id)}>
                <div className="font-medium">{v.name}</div>
                <div className="text-[12px] text-[var(--c-text-muted)]">{v.phone || "—"} · {v.address || "—"}</div>
              </Row>
            ))}
          </div>
        )
      }
    />
  );
}

export function CustomersTab({ setTab }) {
  const notify = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [customers, types] = await Promise.all([api.get("/api/customers"), api.get("/api/cylinder-types")]);
    return { customers, types };
  });
  const empty = { name: "", phone: "", address: "", lat: "", lng: "", openingBalance: "", openingEmptiesCylinderTypeId: "", openingEmptiesQty: "" };
  const [f, setF] = useState(empty);

  if (loading) return null;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { customers, types } = data;
  const typeById = byId(types);
  const add = async () => {
    try {
      await api.post("/api/customers", {
        name: f.name, phone: f.phone, address: f.address,
        lat: f.lat ? Number(f.lat) : null,
        lng: f.lng ? Number(f.lng) : null,
        openingBalance: f.openingBalance ? Number(f.openingBalance) : 0,
        openingEmptiesCylinderTypeId: f.openingEmptiesQty && f.openingEmptiesCylinderTypeId ? Number(f.openingEmptiesCylinderTypeId) : null,
        openingEmptiesQty: f.openingEmptiesQty ? Number(f.openingEmptiesQty) : 0,
      });
      setF(empty);
      reload();
    } catch (e) { notify(e.message); }
  };
  const del = (id) => api.del(`/api/customers/${id}`).then(reload).catch((e) => notify(e.message));

  return (
    <div className="space-y-6">
      <CrudPage
        eyebrow="Book" addTitle="Add Customer" listTitle={`Customers (${customers.length})`}
        form={
          <div className="space-y-3">
            <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sri Sai Traders" /></Field>
            <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 90000 00000" /></Field>
            <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Hyderabad" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude" hint="Optional"><input className={inputCls} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="17.38" /></Field>
              <Field label="Longitude" hint="Optional"><input className={inputCls} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} placeholder="78.48" /></Field>
            </div>
            <p className="text-[11px] text-[var(--c-text-faint)]">Leave coordinates blank and route planning will approximate a location automatically.</p>
            <div className="pt-2 border-t border-[var(--c-border)] space-y-3">
              <span className="text-[var(--c-text-muted)] text-[12px] uppercase tracking-wide font-mono">Opening Balances (optional)</span>
              <Field label="Outstanding Balance (₹)" hint="Amount already owed before using this system">
                <input type="number" min="0" className={inputCls} value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Empties at Customer" hint="Cylinders already with them, not yet returned">
                <div className="flex gap-2">
                  <select className={`${inputCls} flex-1`} value={f.openingEmptiesCylinderTypeId} onChange={(e) => setF({ ...f, openingEmptiesCylinderTypeId: e.target.value })}>
                    <option value="">Cylinder type…</option>
                    {types.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
                  </select>
                  <input type="number" min="0" className={`${inputCls} w-20`} value={f.openingEmptiesQty} onChange={(e) => setF({ ...f, openingEmptiesQty: e.target.value })} placeholder="Qty" />
                </div>
              </Field>
            </div>
            <Btn tone="flame" disabled={!f.name.trim()} onClick={add} className="w-full justify-center"><Plus size={15} /> Add Customer</Btn>
          </div>
        }
        list={
          customers.length === 0 ? <Empty text="No customers yet." /> : (
            <div className="space-y-2">
              {customers.map((c) => (
                <Row key={c.id} onDelete={() => del(c.id)}>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-[12px] text-[var(--c-text-muted)]">{c.phone || "—"} · {c.address || "—"}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {c.openingBalance > 0 && <Badge tone="warn">Opening due: ₹{c.openingBalance}</Badge>}
                    {c.openingEmptiesQty > 0 && (
                      <Badge tone="muted">Opening empties: {c.openingEmptiesQty} × {cylLabel(typeById[c.openingEmptiesCylinderTypeId])}</Badge>
                    )}
                  </div>
                </Row>
              ))}
            </div>
          )
        }
      />
      <div className="text-[11px] text-[var(--c-text-faint)] font-mono">
        MRP and discounts are managed under <button className="text-[#FF9A6E] hover:underline" onClick={() => setTab("discounts")}>Pricing</button>.
      </div>
    </div>
  );
}

export function CylindersTab() {
  const notify = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [types, inventory, vendors, iocl] = await Promise.all([
      api.get("/api/cylinder-types"),
      api.get("/api/cylinder-types/inventory"),
      api.get("/api/vendors"),
      api.get("/api/iocl"),
    ]);
    return { types, inventory, vendors, iocl };
  });
  const [f, setF] = useState({ name: "", weight: "" });

  if (loading) return null;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { types, inventory, vendors, iocl } = data;
  const add = async () => {
    try {
      await api.post("/api/cylinder-types", { name: f.name, weight: Number(f.weight) || 0 });
      setF({ name: "", weight: "" });
      reload();
    } catch (e) { notify(e.message); }
  };
  const del = (id) => api.del(`/api/cylinder-types/${id}`).then(reload).catch((e) => notify(e.message));

  return (
    <div className="space-y-6">
      <CrudPage
        eyebrow="Catalog" addTitle="Add Cylinder Type" listTitle={`Cylinder Types (${types.length})`}
        form={
          <div className="space-y-3">
            <Field label="Type Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Commercial" /></Field>
            <Field label="Weight (kg)"><input type="number" className={inputCls} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} placeholder="19" /></Field>
            <Btn tone="flame" disabled={!f.name.trim()} onClick={add} className="w-full justify-center"><Plus size={15} /> Add Type</Btn>
          </div>
        }
        list={
          types.length === 0 ? <Empty text="No cylinder types yet." /> : (
            <div className="space-y-2">
              {types.map((c) => (
                <Row key={c.id} onDelete={() => del(c.id)}>
                  <div className="font-medium">{cylLabel(c)}</div>
                  {c.emptyPrice != null && <div className="text-[12px] text-[var(--c-text-muted)] font-mono">Empty purchase price: ₹{c.emptyPrice}</div>}
                </Row>
              ))}
            </div>
          )
        }
      />

      <Panel eyebrow="Company Inventory" title="Depot Stock (Full / Empty / Defective)"
        right={<span className="text-[11px] text-[var(--c-text-dim)] font-mono">Full auto-deducts on trip departure; Empty/Defective auto-credit on delivery. Edit directly only for manual corrections.</span>}>
        {types.length === 0 ? (
          <Empty text="No cylinder types yet — add one above first." />
        ) : (
          <div className="space-y-2">
            {types.map((ct) => (
              <InventoryStockRow key={ct.id} ct={ct} record={inventory.find((r) => r.cylinderTypeId === ct.id)} onChanged={reload} />
            ))}
          </div>
        )}
      </Panel>

      <IoclPanel types={types} vendors={vendors} iocl={iocl} inventory={inventory} onChanged={reload} />
    </div>
  );
}

function InventoryStockRow({ ct, record, onChanged }) {
  const notify = useToast();
  const [full, setFull] = useState(record?.full ?? 0);
  const [empty, setEmpty] = useState(record?.empty ?? 0);
  const [defective, setDefective] = useState(record?.defective ?? 0);

  // keep inputs in sync when IOCL / trip activity changes depot stock elsewhere
  useEffect(() => {
    setFull(record?.full ?? 0);
    setEmpty(record?.empty ?? 0);
    setDefective(record?.defective ?? 0);
  }, [record?.full, record?.empty, record?.defective]);

  const dirty = !record || record.full !== Number(full) || record.empty !== Number(empty) || record.defective !== Number(defective);

  const save = () =>
    api.put(`/api/cylinder-types/${ct.id}/inventory`, { full: Number(full) || 0, empty: Number(empty) || 0, defective: Number(defective) || 0 })
      .then(onChanged).catch((e) => notify(e.message));
  const clear = () => api.del(`/api/cylinder-types/${ct.id}/inventory`).then(onChanged).catch((e) => notify(e.message));

  const NumInput = ({ label, value, set }) => (
    <div className="flex flex-col items-start">
      <span className="text-[9px] text-[var(--c-text-faint)] font-mono">{label}</span>
      <input type="number" min="0" value={value} onChange={(e) => set(e.target.value)} className={`${inputCls} w-20`} />
    </div>
  );

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 bg-[var(--c-page)] border border-[var(--c-border)] rounded-lg px-4 py-3">
      <div className="font-medium">{cylLabel(ct)}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <NumInput label="Full" value={full} set={setFull} />
        <NumInput label="Empty" value={empty} set={setEmpty} />
        <NumInput label="Defective" value={defective} set={setDefective} />
        <Btn tone={dirty ? "flame" : "ghost"} disabled={!dirty} onClick={save}>Save</Btn>
        {record && <Btn tone="ghost" onClick={clear}><Trash2 size={13} /></Btn>}
      </div>
    </div>
  );
}

/** IOCL supplier panel: ship empties/defectives out, receive full stock in, track the running payable. */
function IoclPanel({ types, vendors, iocl, onChanged }) {
  const notify = useToast();
  const [sendForm, setSendForm] = useState({ cylinderTypeId: "", emptyQty: "", defectiveQty: "", date: todayStr(), note: "" });
  const [receiveForm, setReceiveForm] = useState({ cylinderTypeId: "", qty: "", vendorId: "", amountBilled: "", date: todayStr(), note: "" });
  const typeById = byId(types);
  const vendorById = byId(vendors);

  const sentTx = iocl.filter((t) => t.type === "sent");
  const receivedTx = iocl.filter((t) => t.type === "received");
  const totalBilled = receivedTx.reduce((a, t) => a + (t.amountBilled || 0), 0);
  const totalPaidToIocl = receivedTx.filter((t) => t.paid).reduce((a, t) => a + (t.amountBilled || 0), 0);

  const doSend = async () => {
    try {
      await api.post("/api/iocl/send", {
        cylinderTypeId: Number(sendForm.cylinderTypeId),
        emptyQty: Number(sendForm.emptyQty) || 0,
        defectiveQty: Number(sendForm.defectiveQty) || 0,
        date: sendForm.date,
        note: sendForm.note,
      });
      setSendForm({ cylinderTypeId: "", emptyQty: "", defectiveQty: "", date: todayStr(), note: "" });
      onChanged();
    } catch (e) { notify(e.message); }
  };
  const doReceive = async () => {
    try {
      await api.post("/api/iocl/receive", {
        cylinderTypeId: Number(receiveForm.cylinderTypeId),
        qty: Number(receiveForm.qty) || 0,
        vendorId: receiveForm.vendorId ? Number(receiveForm.vendorId) : null,
        amountBilled: Number(receiveForm.amountBilled) || 0,
        date: receiveForm.date,
        note: receiveForm.note,
      });
      setReceiveForm({ cylinderTypeId: "", qty: "", vendorId: "", amountBilled: "", date: todayStr(), note: "" });
      onChanged();
    } catch (e) { notify(e.message); }
  };
  const togglePaid = (id) => api.post(`/api/iocl/${id}/toggle-paid`).then(onChanged).catch((e) => notify(e.message));
  const del = (id) => api.del(`/api/iocl/${id}`).then(onChanged).catch((e) => notify(e.message));

  return (
    <Panel eyebrow="Supplier" title="IOCL Supply"
      right={<span className="text-[11px] text-[var(--c-text-dim)] font-mono">Ship empties/defectives out for refill, receive full stock back, track what's billed</span>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Stat label="Sent to IOCL (all-time)" value={sentTx.reduce((a, t) => a + t.qty, 0)} tone="teal" />
        <Stat label="Received from IOCL (all-time)" value={receivedTx.reduce((a, t) => a + t.qty, 0)} tone="flame" />
        <Stat label="Total Billed by IOCL (₹)" value={totalBilled} tone="warn" />
        <Stat label="Outstanding Payable (₹)" value={totalBilled - totalPaidToIocl} tone="bad" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-page)] p-4 space-y-3">
          <div className="text-sm font-medium text-[var(--c-text-bright)]">Send Empties/Defectives to IOCL</div>
          <Field label="Cylinder Type">
            <select className={inputCls} value={sendForm.cylinderTypeId} onChange={(e) => setSendForm({ ...sendForm, cylinderTypeId: e.target.value })}>
              <option value="">Select type…</option>
              {types.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Empty Qty"><input type="number" min="0" className={inputCls} value={sendForm.emptyQty} onChange={(e) => setSendForm({ ...sendForm, emptyQty: e.target.value })} placeholder="0" /></Field>
            <Field label="Defective Qty"><input type="number" min="0" className={inputCls} value={sendForm.defectiveQty} onChange={(e) => setSendForm({ ...sendForm, defectiveQty: e.target.value })} placeholder="0" /></Field>
          </div>
          <Field label="Date"><DateInput value={sendForm.date} onChange={(e) => setSendForm({ ...sendForm, date: e.target.value })} /></Field>
          <Field label="Note" hint="optional"><input className={inputCls} value={sendForm.note} onChange={(e) => setSendForm({ ...sendForm, note: e.target.value })} placeholder="e.g. truck reg, driver" /></Field>
          <Btn tone="teal" disabled={!sendForm.cylinderTypeId || (!sendForm.emptyQty && !sendForm.defectiveQty)} onClick={doSend} className="w-full justify-center">
            <ArrowRight size={15} /> Send to IOCL
          </Btn>
        </div>

        <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-page)] p-4 space-y-3">
          <div className="text-sm font-medium text-[var(--c-text-bright)]">Receive New Stock from IOCL</div>
          <Field label="Cylinder Type">
            <select className={inputCls} value={receiveForm.cylinderTypeId} onChange={(e) => setReceiveForm({ ...receiveForm, cylinderTypeId: e.target.value })}>
              <option value="">Select type…</option>
              {types.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Qty Received"><input type="number" min="0" className={inputCls} value={receiveForm.qty} onChange={(e) => setReceiveForm({ ...receiveForm, qty: e.target.value })} placeholder="0" /></Field>
            <Field label="Amount Billed (₹)"><input type="number" min="0" className={inputCls} value={receiveForm.amountBilled} onChange={(e) => setReceiveForm({ ...receiveForm, amountBilled: e.target.value })} placeholder="0" /></Field>
          </div>
          <Field label="Billed On" hint="the date on IOCL's bill for this batch"><DateInput value={receiveForm.date} onChange={(e) => setReceiveForm({ ...receiveForm, date: e.target.value })} /></Field>
          <Field label="Billed To" hint="which vendor issued this bill">
            <select className={inputCls} value={receiveForm.vendorId} onChange={(e) => setReceiveForm({ ...receiveForm, vendorId: e.target.value })}>
              <option value="">Select vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Note" hint="optional"><input className={inputCls} value={receiveForm.note} onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })} placeholder="e.g. invoice number" /></Field>
          <Btn tone="flame" disabled={!receiveForm.cylinderTypeId || !receiveForm.qty} onClick={doReceive} className="w-full justify-center">
            <ArrowRight size={15} className="rotate-180" /> Receive from IOCL
          </Btn>
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-wide text-[var(--c-text-dim)] font-mono mb-2">Transaction History</div>
      {iocl.length === 0 ? (
        <Empty text="No IOCL transactions logged yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--c-text-dim)] font-mono border-b border-[var(--c-border)]">
                <th className="py-2 pr-4">Date / Billed On</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Cylinder Type</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4">Vendor</th>
                <th className="py-2 pr-4">Details</th>
                <th className="py-2 pr-4">Amount (₹)</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {iocl.map((t) => (
                <tr key={t.id} className="border-b border-[var(--c-divider)]">
                  <td className="py-2 pr-4 font-mono">{formatDateIST(t.date)}</td>
                  <td className="py-2 pr-4">{t.type === "sent" ? <Badge tone="teal">Sent</Badge> : <Badge tone="flame">Received</Badge>}</td>
                  <td className="py-2 pr-4">{cylLabel(typeById[t.cylinderTypeId])}</td>
                  <td className="py-2 pr-4 font-mono">{t.qty}</td>
                  <td className="py-2 pr-4">{t.type === "received" ? vendorById[t.vendorId]?.name ?? "—" : "—"}</td>
                  <td className="py-2 pr-4 text-[12px] text-[var(--c-text-muted)]">
                    {t.type === "sent" ? `${t.emptyQty} empty, ${t.defectiveQty} defective` : (t.note || "—")}
                  </td>
                  <td className="py-2 pr-4 font-mono">{t.type === "received" ? `₹${t.amountBilled}` : "—"}</td>
                  <td className="py-2 pr-4">
                    {t.type === "received" ? (
                      <Btn tone={t.paid ? "ghost" : "flame"} onClick={() => togglePaid(t.id)}>
                        {t.paid ? `Paid ${formatDateIST(t.paidOn)}` : "Mark Paid"}
                      </Btn>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <button onClick={() => del(t.id)} className="text-[var(--c-text-dim)] hover:text-[#FF5D5D] p-1" title="Delete (reverses the stock effect)">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
