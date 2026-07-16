import React, { useState } from "react";
import { Plus } from "lucide-react";
import { api, tryGet } from "../api";
import { useToast } from "../App";
import { byId, useLoad } from "../hooks";
import { Badge, Btn, cylLabel, DateInput, Empty, Field, formatDateIST, inputCls, Panel, Row, todayStr } from "../ui";

const currentMrp = (mrpHistory, cylinderTypeId, dateStr) => {
  const valid = mrpHistory
    .filter((h) => h.cylinderTypeId === cylinderTypeId && h.effectiveFrom <= dateStr)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return valid.length ? valid[0].value : 0;
};

export default function PricingTab() {
  const notify = useToast();
  const { data, loading, reload } = useLoad(async () => {
    const [types, mrpHistory, discounts, customers] = await Promise.all([
      api.get("/api/cylinder-types"),
      api.get("/api/pricing/mrp"),
      api.get("/api/pricing/discounts"),
      tryGet("/api/customers", []), // Accountant can't read the customers master — falls back to ids
    ]);
    return { types, mrpHistory, discounts, customers };
  });

  const [mrpForm, setMrpForm] = useState({ cylinderTypeId: "", value: "", effectiveFrom: todayStr() });
  const [df, setDf] = useState({ customerId: "", cylinderTypeId: "", amount: "", startDate: todayStr(), endDate: todayStr() });

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading pricing…</div>;
  const { types, mrpHistory, discounts, customers } = data;
  const typeById = byId(types);
  const customerById = byId(customers);
  const nameOfCustomer = (id) => customerById[id]?.name ?? `Customer ${id}`;

  const addMrp = async () => {
    try {
      await api.post("/api/pricing/mrp", {
        cylinderTypeId: Number(mrpForm.cylinderTypeId),
        value: Number(mrpForm.value),
        effectiveFrom: mrpForm.effectiveFrom,
      });
      setMrpForm({ cylinderTypeId: "", value: "", effectiveFrom: todayStr() });
      reload();
    } catch (e) { notify(e.message); }
  };
  const addDiscount = async () => {
    try {
      await api.post("/api/pricing/discounts", {
        customerId: Number(df.customerId),
        cylinderTypeId: Number(df.cylinderTypeId),
        amount: Number(df.amount),
        startDate: df.startDate,
        endDate: df.endDate,
      });
      setDf({ customerId: "", cylinderTypeId: "", amount: "", startDate: todayStr(), endDate: todayStr() });
      reload();
    } catch (e) { notify(e.message); }
  };
  const delDiscount = (id) => api.del(`/api/pricing/discounts/${id}`).then(reload).catch((e) => notify(e.message));

  const sortedHistory = [...mrpHistory].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

  return (
    <div className="space-y-6">
      <Panel eyebrow="Fixed per cylinder type · same for every customer" title="MRP Rate by Cylinder Type">
        <div className="flex flex-wrap gap-2 mb-4">
          {types.map((ct) => {
            const v = currentMrp(mrpHistory, ct.id, todayStr());
            return <Badge key={ct.id} tone={v ? "flame" : "bad"}>{cylLabel(ct)}: {v ? `₹${v}` : "not set"}</Badge>;
          })}
          {types.length === 0 && <span className="text-sm text-[#5C6975]">Add a cylinder type first.</span>}
        </div>
        <div className="grid sm:grid-cols-4 gap-3 items-end mb-4">
          <Field label="Cylinder Type">
            <select className={inputCls} value={mrpForm.cylinderTypeId} onChange={(e) => setMrpForm({ ...mrpForm, cylinderTypeId: e.target.value })}>
              <option value="">Select type</option>
              {types.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
            </select>
          </Field>
          <Field label="New MRP (₹)">
            <input type="number" className={inputCls} value={mrpForm.value} onChange={(e) => setMrpForm({ ...mrpForm, value: e.target.value })} placeholder="1450" />
          </Field>
          <Field label="Effective From">
            <DateInput value={mrpForm.effectiveFrom} onChange={(e) => setMrpForm({ ...mrpForm, effectiveFrom: e.target.value })} />
          </Field>
          <Btn tone="flame" disabled={!mrpForm.cylinderTypeId || !mrpForm.value} onClick={addMrp} className="justify-center">
            <Plus size={15} /> Update MRP
          </Btn>
        </div>
        {sortedHistory.length === 0 ? <Empty text="No MRP set yet — add one above." /> : (
          <div className="space-y-2">
            {sortedHistory.map((h) => (
              <Row key={h.id}>
                <div className="font-mono text-sm">
                  {cylLabel(typeById[h.cylinderTypeId])} · ₹{h.value} <span className="text-[#5C6975]">from {formatDateIST(h.effectiveFrom)}</span>
                </div>
              </Row>
            ))}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Fixed per cylinder type · same for every customer" title="Empty Cylinder Purchase Price"
        right={<span className="text-[11px] text-[#5C6975] font-mono">What a customer pays to keep/own an empty cylinder instead of returning it</span>}>
        {types.length === 0 ? (
          <p className="text-sm text-[#5C6975]">Add a cylinder type first.</p>
        ) : (
          <div className="space-y-2">
            {types.map((ct) => <EmptyPriceRow key={ct.id} ct={ct} onSaved={reload} />)}
          </div>
        )}
      </Panel>

      <div className="grid md:grid-cols-3 gap-6">
        <Panel eyebrow="Per Customer" title="Add Discount" className="md:col-span-1 h-fit">
          <div className="space-y-3">
            <Field label="Customer">
              <select className={inputCls} value={df.customerId} onChange={(e) => setDf({ ...df, customerId: e.target.value })}>
                <option value="">Select customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Cylinder Type">
              <select className={inputCls} value={df.cylinderTypeId} onChange={(e) => setDf({ ...df, cylinderTypeId: e.target.value })}>
                <option value="">Select type</option>
                {types.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
              </select>
            </Field>
            <Field label="Discount (₹ off MRP)">
              <input type="number" className={inputCls} value={df.amount} onChange={(e) => setDf({ ...df, amount: e.target.value })} placeholder="50" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start Date"><DateInput value={df.startDate} onChange={(e) => setDf({ ...df, startDate: e.target.value })} /></Field>
              <Field label="End Date"><DateInput value={df.endDate} min={df.startDate} onChange={(e) => setDf({ ...df, endDate: e.target.value })} /></Field>
            </div>
            <Btn tone="flame" disabled={!df.customerId || !df.cylinderTypeId || !df.amount} onClick={addDiscount} className="w-full justify-center">
              <Plus size={15} /> Save Discount
            </Btn>
          </div>
        </Panel>
        <Panel eyebrow="Active & Scheduled" title={`Discount Rates (${discounts.length})`} className="md:col-span-2">
          {discounts.length === 0 ? <Empty text="No discounts set yet." /> : (
            <div className="space-y-2">
              {discounts.map((d) => {
                const isActive = d.startDate <= todayStr() && todayStr() <= d.endDate;
                return (
                  <Row key={d.id} onDelete={() => delDiscount(d.id)}>
                    <div className="font-medium">
                      {nameOfCustomer(d.customerId)} <span className="text-[#5C6975]">→</span> {cylLabel(typeById[d.cylinderTypeId])}
                    </div>
                    <div className="text-[12px] text-[#FF9A6E] font-mono">−₹{d.amount} · {formatDateIST(d.startDate)} → {formatDateIST(d.endDate)}</div>
                    {isActive && <Badge tone="good">Active today</Badge>}
                  </Row>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function EmptyPriceRow({ ct, onSaved }) {
  const notify = useToast();
  const [val, setVal] = useState(ct.emptyPrice ?? "");
  const save = () => {
    if (val === "" || Number(val) < 0) return;
    api.put(`/api/cylinder-types/${ct.id}/empty-price`, { emptyPrice: Number(val) })
      .then(onSaved).catch((e) => notify(e.message));
  };
  return (
    <Row>
      <div className="font-medium">{cylLabel(ct)}</div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[#5C6975] text-[12px] font-mono">₹</span>
        <input type="number" min="0" className={`${inputCls} w-24`} value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. 800" />
        <Btn tone="ghost" onClick={save}>Save</Btn>
        {ct.emptyPrice != null && <Badge tone="teal">Current: ₹{ct.emptyPrice}</Badge>}
      </div>
    </Row>
  );
}
