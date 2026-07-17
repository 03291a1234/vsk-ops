import React, { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, tryGet } from "../api";
import { useToast, FlowNav } from "../App";
import { byId, useLoad } from "../hooks";
import { Badge, Btn, cylLabel, DateInput, Empty, Field, inputCls, Panel, todayStr } from "../ui";

/* Client-side pricing preview — mirrors of the server rules (Pricing.cs). The server recomputes
   authoritatively on create; this is display only, and only for roles allowed to read pricing. */
const currentMrp = (mrpHistory, cylinderTypeId, dateStr) => {
  const valid = mrpHistory
    .filter((h) => h.cylinderTypeId === cylinderTypeId && h.effectiveFrom <= dateStr)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return valid.length ? valid[0].value : 0;
};
const applicableDiscount = (discounts, customerId, cylinderTypeId, dateStr) => {
  const matches = discounts.filter(
    (d) => d.customerId === customerId && d.cylinderTypeId === cylinderTypeId && d.startDate <= dateStr && dateStr <= d.endDate
  );
  return matches.length ? Math.max(...matches.map((m) => m.amount)) : 0;
};

export default function NewOrderTab({ setTab }) {
  const notify = useToast();
  const { data, loading } = useLoad(async () => {
    const [customers, types, mrpHistory, discounts] = await Promise.all([
      api.get("/api/customers"),
      api.get("/api/cylinder-types"),
      tryGet("/api/pricing/mrp"), // Dispatch can't read pricing — preview hides, server still prices correctly
      tryGet("/api/pricing/discounts"),
    ]);
    return { customers, types, mrpHistory, discounts };
  });

  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [items, setItems] = useState([{ cylinderTypeId: "", qty: 1 }]);
  const [purchases, setPurchases] = useState([]);
  const [empties, setEmpties] = useState([]);
  const [placed, setPlaced] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPurchases([]);
    if (!customerId) return setEmpties([]);
    api.get(`/api/customers/${customerId}/empties`).then(setEmpties).catch(() => setEmpties([]));
  }, [customerId]);

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading…</div>;
  const { customers, types, mrpHistory, discounts } = data;
  const typeById = byId(types);
  const canPreview = mrpHistory !== null && discounts !== null;
  const oDate = orderDate || todayStr();
  const cid = Number(customerId);

  const updateRow = (idx, field, val) => setItems((r) => r.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));
  const updatePurchase = (idx, field, val) => setPurchases((r) => r.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));

  const lineBreakdown = items.map((it) => {
    if (!it.cylinderTypeId || !canPreview) return null;
    const typeId = Number(it.cylinderTypeId);
    const mrp = currentMrp(mrpHistory, typeId, oDate);
    const discount = cid ? applicableDiscount(discounts, cid, typeId, oDate) : 0;
    const rate = Math.max(0, mrp - discount);
    const qty = Number(it.qty) || 0;
    return { mrp, discount, rate, qty, amount: rate * qty };
  });
  const itemsTotal = lineBreakdown.reduce((a, l) => a + (l ? l.amount : 0), 0);
  const validItems = items.filter((it) => it.cylinderTypeId && Number(it.qty) > 0);

  const purchasableTypes = empties.map((e) => ({ ct: typeById[e.cylinderTypeId], balance: e.balance })).filter((x) => x.ct);
  const purchaseBreakdown = purchases.map((p) => {
    if (!p.cylinderTypeId) return null;
    const typeId = Number(p.cylinderTypeId);
    const balance = empties.find((e) => e.cylinderTypeId === typeId)?.balance ?? 0;
    const price = typeById[typeId]?.emptyPrice || 0;
    const qty = Math.min(Number(p.qty) || 0, balance);
    return { price, balance, qty, amount: price * qty };
  });
  const purchasesTotal = purchaseBreakdown.reduce((a, p) => a + (p ? p.amount : 0), 0);
  const validPurchases = purchases.filter((p) => p.cylinderTypeId && Number(p.qty) > 0);
  const orderTotal = itemsTotal + purchasesTotal;

  const place = async () => {
    setBusy(true);
    try {
      const res = await api.post("/api/orders", {
        customerId: cid,
        orderDate: oDate,
        items: validItems.map((it) => ({ cylinderTypeId: Number(it.cylinderTypeId), qty: Number(it.qty) })),
        purchases: validPurchases.map((p) => ({ cylinderTypeId: Number(p.cylinderTypeId), qty: Number(p.qty) })),
      });
      setPlaced(res);
      notify(`Order #${res.id} placed — ₹${res.amount} total, awaiting owner approval.`);
      setCustomerId("");
      setOrderDate(todayStr());
      setItems([{ cylinderTypeId: "", qty: 1 }]);
      setPurchases([]);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <FlowNav current="neworder" setTab={setTab} />
      <Panel eyebrow="Sales" title="New Order" right={<span className="text-[11px] text-[#5C6975] font-mono">Add as many cylinder types as this order needs</span>}>
        <div className="space-y-4">
          <Field label="Select Customer">
            <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Order Date" hint="Past dates allowed too — for backfilling orders that weren't entered on the day">
            <DateInput value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
          </Field>

          <div className="space-y-2">
            <span className="text-[#8FA0AC] text-[12px] uppercase tracking-wide font-mono">Cylinder Types</span>
            {items.map((it, idx) => {
              const bd = lineBreakdown[idx];
              return (
                <div key={idx} className="rounded-lg border border-[#262E35] bg-[#0F1316] p-3 space-y-2">
                  <div className="flex gap-2 items-end">
                    <select className={`${inputCls} flex-1`} value={it.cylinderTypeId} onChange={(e) => updateRow(idx, "cylinderTypeId", e.target.value)}>
                      <option value="">Choose a type…</option>
                      {types.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
                    </select>
                    <input type="number" min="1" className={`${inputCls} w-20`} value={it.qty} onChange={(e) => updateRow(idx, "qty", e.target.value)} />
                    {items.length > 1 && (
                      <button onClick={() => setItems((r) => r.filter((_, i) => i !== idx))} className="text-[#5C6975] hover:text-[#FF5D5D] p-2">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                  {bd && customerId && (
                    <div className="text-[11px] font-mono flex flex-wrap gap-x-4 gap-y-0.5 text-[#5C6975]">
                      <span>MRP ₹{bd.mrp}</span>
                      <span className={bd.discount > 0 ? "text-[#22D3B0]" : ""}>{bd.discount > 0 ? `Discount −₹${bd.discount}` : "No discount"}</span>
                      <span className="text-[#FF9A6E]">Rate ₹{bd.rate}</span>
                      <span className="text-[#FF9A6E] font-semibold">Line total ₹{bd.amount}</span>
                    </div>
                  )}
                </div>
              );
            })}
            <Btn tone="ghost" onClick={() => setItems((r) => [...r, { cylinderTypeId: "", qty: 1 }])} className="w-full justify-center">
              <Plus size={15} /> Add Another Cylinder Type
            </Btn>
          </div>

          {customerId && purchasableTypes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#262E35]">
              <span className="text-[#8FA0AC] text-[12px] uppercase tracking-wide font-mono">Purchase Empty Cylinders (optional)</span>
              <p className="text-[11px] text-[#4B5661]">
                This customer is currently holding {purchasableTypes.map((x) => `${x.balance} × ${cylLabel(x.ct)}`).join(", ")} unreturned. They can buy some or all outright instead of returning them.
              </p>
              {purchases.map((p, idx) => {
                const bd = purchaseBreakdown[idx];
                const availableTypes = purchasableTypes.filter(
                  (x) => String(x.ct.id) === String(p.cylinderTypeId) || !purchases.some((pp, j) => j !== idx && String(pp.cylinderTypeId) === String(x.ct.id))
                );
                return (
                  <div key={idx} className="rounded-lg border border-[#262E35] bg-[#0F1316] p-3 space-y-2">
                    <div className="flex gap-2 items-end">
                      <select className={`${inputCls} flex-1`} value={p.cylinderTypeId} onChange={(e) => updatePurchase(idx, "cylinderTypeId", e.target.value)}>
                        <option value="">Choose a type…</option>
                        {availableTypes.map((x) => <option key={x.ct.id} value={x.ct.id}>{cylLabel(x.ct)} — {x.balance} held</option>)}
                      </select>
                      <input type="number" min="1" max={bd?.balance || undefined} className={`${inputCls} w-20`} value={p.qty} onChange={(e) => updatePurchase(idx, "qty", e.target.value)} />
                      <button onClick={() => setPurchases((r) => r.filter((_, i) => i !== idx))} className="text-[#5C6975] hover:text-[#FF5D5D] p-2">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    {bd && p.cylinderTypeId && (
                      <div className="text-[11px] font-mono flex flex-wrap gap-x-4 gap-y-0.5 text-[#5C6975]">
                        <span>Held: {bd.balance}</span>
                        <span>Empty price ₹{bd.price}</span>
                        <span className="text-[#22D3B0] font-semibold">Line total ₹{bd.amount}</span>
                        {Number(p.qty) > bd.balance && <span className="text-[#FFC857]">Capped at {bd.balance}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {purchases.length < purchasableTypes.length && (
                <Btn tone="ghost" onClick={() => setPurchases((r) => [...r, { cylinderTypeId: "", qty: 1 }])} className="w-full justify-center">
                  <Plus size={15} /> Add Purchase Line
                </Btn>
              )}
            </div>
          )}

          {canPreview && orderTotal > 0 && customerId && (
            <div className="rounded-lg bg-[#0F1316] border border-[#FF7A45]/30 p-3 text-sm font-mono space-y-1">
              {itemsTotal > 0 && (
                <div className="flex justify-between text-[#5C6975]">
                  <span>Delivery ({validItems.reduce((a, i) => a + Number(i.qty), 0)} cyl)</span>
                  <span>₹{itemsTotal}</span>
                </div>
              )}
              {purchasesTotal > 0 && <div className="flex justify-between text-[#5C6975]"><span>Empty cylinder purchase</span><span>₹{purchasesTotal}</span></div>}
              <div className="flex justify-between pt-1 border-t border-[#262E35]">
                <span className="text-[#5C6975]">Order Total</span>
                <span className="text-[#FF9A6E] font-semibold">₹{orderTotal}</span>
              </div>
            </div>
          )}
          {!canPreview && (
            <p className="text-[11px] text-[#4B5661]">Rates are applied by the server at the customer's effective price for the order date.</p>
          )}
          <p className="text-[11px] text-[#4B5661]">Payment is recorded once the order is delivered — see the Orders tab after delivery.</p>
          <Btn tone="flame" onClick={place} disabled={busy || !customerId || (validItems.length === 0 && validPurchases.length === 0)} className="w-full justify-center">
            <Plus size={15} /> Place Order
          </Btn>
        </div>
      </Panel>

      {placed && (
        <Panel eyebrow="Confirmation" title="Order Placed">
          <div className="text-sm space-y-1 font-mono text-[#8FA0AC]">
            <div>Order ID: <span className="text-[#E7ECEF]">#{placed.id}</span></div>
            <div>Total: <span className="text-[#FF9A6E]">₹{placed.amount}</span></div>
            <div>Status: <Badge tone="warn">Pending owner approval</Badge></div>
          </div>
          <div className="flex gap-2 mt-3">
            <Btn onClick={() => setTab("orders")}>View in Orders</Btn>
            <Btn tone="ghost" onClick={() => setPlaced(null)}>Place another</Btn>
          </div>
        </Panel>
      )}
    </div>
  );
}
