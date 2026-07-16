import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Plus, Wallet, X, XCircle } from "lucide-react";
import { api } from "../api";
import { useToast, FlowNav } from "../App";
import { useAuth } from "../auth";
import { byId, useLoad } from "../hooks";
import {
  Badge, Btn, cylLabel, DateInput, dueOf, Empty, Field, formatDateIST, inputCls,
  ORDER_STAGES, OWNERS, Panel, PAYMENT_METHODS, paymentStatusOf, Pipeline, todayStr, totalPaid,
} from "../ui";

export default function OrdersTab({ setTab, focusOrderId, setFocusOrderId }) {
  const notify = useToast();
  const { profile } = useAuth();
  const { data, loading, reload } = useLoad(async () => {
    const [orders, customers, types] = await Promise.all([
      api.get("/api/orders"),
      api.get("/api/customers").catch(() => []), // Accountant can't read customers master — names degrade to ids
      api.get("/api/cylinder-types"),
    ]);
    return { orders, customers, types };
  });

  const [owner, setOwner] = useState(OWNERS[0]);
  const [filterDate, setFilterDate] = useState(todayStr());
  const [showAll, setShowAll] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("");
  const focusRef = useRef(null);

  useEffect(() => {
    if (focusOrderId) setShowAll(true);
  }, [focusOrderId]);
  useEffect(() => {
    if (focusOrderId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading orders…</div>;
  const { orders, customers, types } = data;
  const customerById = byId(customers);
  const typeById = byId(types);
  const nameOfCustomer = (id) => customerById[id]?.name ?? `Customer ${id}`;

  const visibleOrders = (showAll ? orders : orders.filter((o) => o.orderDate === filterDate)).filter(
    (o) => !customerFilter || o.customerId === Number(customerFilter)
  );
  const readyForDispatch = orders.filter((o) => o.stage === 1 && !o.tripId && !o.rejected).length;
  const customersWithOrders = customers.filter((c) => orders.some((o) => o.customerId === c.id));

  const act = (fn, message) => async () => {
    try {
      await fn();
      if (message) notify(message);
      await reload();
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <FlowNav current="orders" setTab={setTab} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {!showAll && (
            <>
              <DateInput value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
              {filterDate !== todayStr() && <Btn tone="ghost" onClick={() => setFilterDate(todayStr())}>Today</Btn>}
            </>
          )}
          <Btn tone={showAll ? "flame" : "ghost"} onClick={() => { setShowAll((s) => !s); setFocusOrderId(null); }}>
            {showAll ? "Showing All Orders" : "Show All Orders"}
          </Btn>
          <select className={inputCls} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">All Customers</option>
            {customersWithOrders.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {customerFilter && <Btn tone="ghost" onClick={() => setCustomerFilter("")}><X size={14} /> Clear</Btn>}
        </div>
        {profile.role !== "Accountant" && (
          <Btn tone="flame" onClick={() => setTab("neworder")}><Plus size={15} /> New Order</Btn>
        )}
      </div>

      {readyForDispatch > 0 && profile.role !== "Accountant" && (
        <div className="flex items-center justify-between gap-2 bg-[#22D3B0]/10 border border-[#22D3B0]/30 rounded-lg px-4 py-2.5">
          <span className="text-sm text-[#22D3B0]">{readyForDispatch} order(s) approved and waiting to be grouped into a trip.</span>
          <Btn tone="teal" onClick={() => setTab("dispatch")}>Go to Dispatch <ChevronRight size={14} /></Btn>
        </div>
      )}

      <SettleDuesPanel orders={orders} customers={customers} nameOfCustomer={nameOfCustomer} onSettled={reload} />

      {orders.length === 0 && <Empty text="No orders placed yet." action={() => setTab("neworder")} actionLabel="Place an order" />}
      {orders.length > 0 && visibleOrders.length === 0 && (
        <Empty
          text={customerFilter ? `No orders for ${nameOfCustomer(Number(customerFilter))}${showAll ? "" : ` on ${formatDateIST(filterDate)}`}.` : `No orders dated ${formatDateIST(filterDate)}.`}
          action={() => { setShowAll(true); setCustomerFilter(""); }}
          actionLabel="Show all orders"
        />
      )}

      {visibleOrders.map((o) => {
        const status = paymentStatusOf(o);
        const statusTone = status === "Paid" ? "good" : status === "Partially Paid" ? "warn" : status === "Awaiting Delivery" ? "muted" : "bad";
        const isFocused = o.id === focusOrderId;
        return (
          <Panel key={o.id} className={isFocused ? "!border-[#FF7A45] ring-1 ring-[#FF7A45]/40" : ""}>
            <div ref={isFocused ? focusRef : null} onClick={() => isFocused && setFocusOrderId(null)}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-sm text-[#8FA0AC]">#{o.id}</span>
                    {o.rejected ? <Badge tone="bad">Rejected</Badge> : <Badge tone={o.stage === 3 ? "good" : "flame"}>{ORDER_STAGES[o.stage]}</Badge>}
                    {!o.rejected && <Badge tone={statusTone}>{status}</Badge>}
                    {o.tripId && <Badge tone="teal">Trip #{o.tripId}</Badge>}
                  </div>
                  <div className="font-medium">{nameOfCustomer(o.customerId)}</div>
                  <div className="text-[12px] text-[#8FA0AC] font-mono">Order date: {formatDateIST(o.orderDate)} · ₹{o.amount} total</div>
                  <div className="mt-1 space-y-0.5">
                    {o.items.map((it) => (
                      <div key={it.id} className="text-[12px] text-[#8FA0AC] font-mono">
                        {it.qty} × {cylLabel(typeById[it.cylinderTypeId])} @ ₹{it.rate} = ₹{it.amount}
                        {it.orderedQty !== it.qty && <span className="text-[#FFC857]"> (ordered {it.orderedQty})</span>}
                      </div>
                    ))}
                    {(o.emptyPurchases || []).map((p) => (
                      <div key={p.id} className="text-[12px] text-[#22D3B0] font-mono">
                        Bought: {p.qty} × {cylLabel(typeById[p.cylinderTypeId])} empty @ ₹{p.price} = ₹{p.amount}
                      </div>
                    ))}
                  </div>
                </div>
                {!o.rejected && o.stage === 0 && (
                  profile.role === "Owner" ? (
                    <div className="flex items-center gap-2">
                      <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
                        {OWNERS.map((ow) => <option key={ow} value={ow}>{ow}</option>)}
                      </select>
                      <Btn tone="teal" onClick={act(() => api.post(`/api/orders/${o.id}/approve`, { owner }), `Order #${o.id} approved by ${owner}.`)}>
                        <CheckCircle2 size={15} /> Approve
                      </Btn>
                      <Btn tone="danger" onClick={act(() => api.post(`/api/orders/${o.id}/reject`, { owner }), `Order #${o.id} rejected.`)}>
                        <XCircle size={15} /> Reject
                      </Btn>
                    </div>
                  ) : (
                    <Badge tone="warn">Awaiting owner approval</Badge>
                  )
                )}
                {!o.rejected && o.stage === 1 && !o.tripId && profile.role !== "Accountant" && (
                  <Btn tone="ghost" onClick={() => setTab("dispatch")}>Ready for dispatch <ChevronRight size={14} /></Btn>
                )}
              </div>
              <div className="mt-4"><Pipeline stages={ORDER_STAGES} stageIndex={o.stage} rejected={o.rejected} /></div>
              {!o.rejected && o.stage === 3 && <PaymentPanel order={o} onPaid={reload} />}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

/** shown once an order is delivered — record Cash/Online payments; the remaining Due is computed, not chosen */
function PaymentPanel({ order: o, onPaid }) {
  const notify = useToast();
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState("");
  const paid = totalPaid(o);
  const due = dueOf(o);

  const record = async () => {
    try {
      const res = await api.post(`/api/orders/${o.id}/payments`, { method, amount: Number(amount) });
      notify(`₹${res.applied} recorded via ${method} for order #${o.id}.`);
      setAmount("");
      onPaid();
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-[#262E35]">
      <div className="flex flex-wrap gap-4 text-sm font-mono mb-3">
        <span className="text-[#5C6975]">Total ₹{o.amount}</span>
        <span className="text-[#22D3B0]">Paid ₹{paid}</span>
        <span className={due > 0 ? "text-[#FF5D5D]" : "text-[#3DD16F]"}>Due ₹{due}</span>
      </div>
      {due > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="number" min="1" max={due} placeholder={`Up to ₹${due}`} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} w-32`} />
          <Btn tone="teal" disabled={!amount || Number(amount) <= 0} onClick={record}>
            <Wallet size={15} /> Record Payment
          </Btn>
          <Btn tone="ghost" onClick={() => setAmount(String(due))}>Fill full due</Btn>
        </div>
      )}
      {(o.payments || []).length > 0 && (
        <div className="mt-3 space-y-1 text-[11px] font-mono text-[#5C6975]">
          {o.payments.map((p) => (
            <div key={p.id}>· ₹{p.amount} via {p.method}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** one payment covering a customer's dues across several delivered orders — FIFO by order date (server-side) */
function SettleDuesPanel({ orders, customers, nameOfCustomer, onSettled }) {
  const notify = useToast();
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState("");

  const dueByCustomer = customers
    .map((c) => ({
      c,
      due: orders.filter((o) => o.customerId === c.id && !o.rejected && o.stage === 3).reduce((a, o) => a + dueOf(o), 0),
      orderCount: orders.filter((o) => o.customerId === c.id && !o.rejected && o.stage === 3 && dueOf(o) > 0).length,
    }))
    .filter((x) => x.due > 0);

  if (dueByCustomer.length === 0) return null;
  const selected = dueByCustomer.find((x) => String(x.c.id) === customerId);

  const settle = async () => {
    try {
      const res = await api.post("/api/orders/settle", { customerId: Number(customerId), method, amount: Number(amount) });
      notify(
        `₹${res.applied} settled across ${res.orders.length} order(s), oldest first.` +
          (res.unapplied > 0 ? ` ₹${res.unapplied} exceeded total dues and was not applied.` : "")
      );
      setAmount("");
      setCustomerId("");
      onSettled();
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <Panel eyebrow="Bulk Settlement" title="Settle Customer Dues"
      right={<span className="text-[11px] text-[#5C6975] font-mono">One payment splits across all their outstanding orders, oldest first</span>}>
      <div className="grid sm:grid-cols-4 gap-3 items-end">
        <Field label="Customer">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer with dues</option>
            {dueByCustomer.map(({ c, due, orderCount }) => (
              <option key={c.id} value={c.id}>{nameOfCustomer(c.id)} — ₹{due} across {orderCount} order(s)</option>
            ))}
          </select>
        </Field>
        <Field label="Method">
          <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Amount (₹)">
          <input type="number" min="1" max={selected?.due} placeholder={selected ? `Up to ₹${selected.due}` : ""} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </Field>
        <Btn tone="teal" disabled={!customerId || !amount || Number(amount) <= 0} onClick={settle} className="justify-center">
          <Wallet size={15} /> Settle
        </Btn>
      </div>
      {selected && <div className="text-[11px] text-[#4B5661] font-mono mt-2">Total outstanding for {nameOfCustomer(selected.c.id)}: ₹{selected.due}</div>}
    </Panel>
  );
}
