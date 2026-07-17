import React, { useState } from "react";
import { ChevronRight, Flame, Printer, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useToast, FlowNav } from "../App";
import { useLoad } from "../hooks";
import { Badge, Btn, DateInput, Empty, Field, formatDateIST, formatDateTimeIST, inputCls, Panel, Stat, todayStr, LoadError } from "../ui";

const daysAgoStr = (n) => todayStr(new Date(Date.now() - n * 86400000));

export default function ReportsTab({ setTab, section = "daily" }) {
  const [date, setDate] = useState(todayStr());
  const [rangeMode, setRangeMode] = useState("7");
  const [rangeCustomerFilter, setRangeCustomerFilter] = useState("");
  const [rangeStartInput, setRangeStartInput] = useState(daysAgoStr(6));
  const [rangeEndInput, setRangeEndInput] = useState(todayStr());
  const [invoiceRequest, setInvoiceRequest] = useState(null); // {customerId, startDate, endDate, periodLabel}

  const rangeStart = rangeMode === "custom" ? rangeStartInput : rangeMode === "30" ? daysAgoStr(29) : daysAgoStr(6);
  const rangeEnd = rangeMode === "custom" ? rangeEndInput : todayStr();

  return (
    <div className="space-y-6">
      <FlowNav current={`reports-${section}`} setTab={setTab} />
      {section !== "multiday" && (
        <div className="flex items-center justify-between bg-[#171D22] border border-[#262E35] rounded-xl px-5 py-3">
          <div>
            <div className="text-[10px] tracking-[0.18em] uppercase text-[#5C6975] font-mono mb-0.5">Report Date</div>
            <div className="text-[#E7ECEF] font-semibold text-[15px]" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{formatDateIST(date)}</div>
          </div>
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}

      {section === "daily" && <DailySection date={date} />}
      {section === "bytype" && <ByTypeSection date={date} />}
      {section === "ledger" && (
        <LedgerSection
          date={date}
          onInvoice={(customerId) => setInvoiceRequest({ customerId, startDate: date, endDate: date, periodLabel: formatDateIST(date) })}
        />
      )}
      {section === "cash" && <CashSection date={date} />}
      {section === "multiday" && (
        <MultiDaySection
          rangeMode={rangeMode} setRangeMode={setRangeMode}
          rangeStart={rangeStart} rangeEnd={rangeEnd}
          rangeStartInput={rangeStartInput} setRangeStartInput={setRangeStartInput}
          rangeEndInput={rangeEndInput} setRangeEndInput={setRangeEndInput}
          customerFilter={rangeCustomerFilter} setCustomerFilter={setRangeCustomerFilter}
          onInvoice={(customerId) =>
            setInvoiceRequest({ customerId, startDate: rangeStart, endDate: rangeEnd, periodLabel: `${formatDateIST(rangeStart)} to ${formatDateIST(rangeEnd)}` })
          }
        />
      )}

      {invoiceRequest && <InvoiceModal request={invoiceRequest} onClose={() => setInvoiceRequest(null)} />}
    </div>
  );
}

function DailySection({ date }) {
  const { data, loading, error, reload } = useLoad(() => api.get(`/api/reports/daily?date=${date}`), [date]);
  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (error) return <div className="text-sm text-[#FF8A8A]">{error}</div>;
  return (
    <Panel eyebrow="Daily Report" title="Summary">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Cylinders Filled (net of defects)" value={data.filled} tone="flame" />
        <Stat label="Empties Returned" value={data.emptyReturned} tone="teal" />
        <Stat label="Defects Logged" value={data.defects} tone="bad" />
        <Stat label="Outstanding Ledger (₹)" value={data.outstandingLedger} tone="warn" />
      </div>
      <div className="text-[11px] text-[#4B5661] font-mono mt-3">
        "Filled" already excludes defective units — defective cylinders found at delivery are logged separately and not counted as full.
      </div>
    </Panel>
  );
}

function ByTypeSection({ date }) {
  const { data: rows, loading, error, reload } = useLoad(() => api.get(`/api/reports/by-type?date=${date}`), [date]);
  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const hasData = rows.some((r) => r.filled || r.empty || r.defect);
  return (
    <Panel eyebrow="By Cylinder Type" title="Filled (net of defects) / Empty / Defect — company-wide">
      {!hasData ? (
        <Empty text="No cylinder movement logged for this date." />
      ) : (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#5C6975] font-mono border-b border-[#262E35]">
                  <th className="py-2 pr-4">Cylinder Type</th>
                  <th className="py-2 pr-4">Filled</th>
                  <th className="py-2 pr-4">Empty</th>
                  <th className="py-2 pr-4">Defect</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.cylinderTypeId} className="border-b border-[#262E35]/60">
                    <td className="py-2 pr-4 font-medium">{r.label}</td>
                    <td className="py-2 pr-4 font-mono text-[#FF9A6E]">{r.filled}</td>
                    <td className="py-2 pr-4 font-mono text-[#22D3B0]">{r.empty}</td>
                    <td className="py-2 pr-4 font-mono text-[#FF5D5D]">{r.defect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={rows.map((r) => ({ label: r.label, Filled: r.filled, Empty: r.empty, Defect: r.defect }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262E35" />
                <XAxis dataKey="label" stroke="#5C6975" tick={{ fontSize: 11 }} />
                <YAxis stroke="#5C6975" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#171D22", border: "1px solid #262E35", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Filled" fill="#FF7A45" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Empty" fill="#22D3B0" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Defect" fill="#FF5D5D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}

/** one customer's combined ledger row: summary bar that expands into the cylinder-type breakdown */
function CustomerLedgerGroup({ group, dueLabel, showRate, onInvoice }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-[#262E35] rounded-lg overflow-hidden mb-3 last:mb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 flex-wrap bg-[#0F1316] hover:bg-white/5 px-4 py-3 text-left transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight size={14} className={`text-[#5C6975] shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="font-medium text-[#E7ECEF] truncate">{group.customerName}</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-[12px] font-mono">
          <span className="text-[#5C6975]">Total <span className="text-[#FF9A6E] font-semibold">₹{group.totalAmount}</span></span>
          <span className="text-[#5C6975]">Cash <span className="text-[#DDE3E7]">₹{group.cash}</span></span>
          <span className="text-[#5C6975]">Online <span className="text-[#DDE3E7]">₹{group.online}</span></span>
          <span className="text-[#5C6975]">Paid <span className="text-[#22D3B0]">₹{group.paid}</span></span>
          <span className="text-[#5C6975]">{dueLabel} <span className={group.ledgerBalance > 0 ? "text-[#FF5D5D]" : "text-[#3DD16F]"}>₹{group.ledgerBalance}</span></span>
          {group.ledgerBalance > 0 ? <Badge tone="warn">Outstanding</Badge> : <Badge tone="good">Settled</Badge>}
          <Btn tone="ghost" onClick={(e) => { e.stopPropagation(); onInvoice(group.customerId); }}>
            <Printer size={13} /> Invoice
          </Btn>
        </div>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-[#262E35]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#5C6975] font-mono border-b border-[#262E35]">
                <th className="py-2 px-4">Cylinder Type</th>
                <th className="py-2 px-4">Ordered</th>
                <th className="py-2 px-4">Delivered</th>
                <th className="py-2 px-4">Shortage</th>
                <th className="py-2 px-4">Full</th>
                <th className="py-2 px-4">Empty</th>
                <th className="py-2 px-4">Bought</th>
                <th className="py-2 px-4">Bought Amount (₹)</th>
                <th className="py-2 px-4">Defect</th>
                {showRate && <th className="py-2 px-4">Rate (₹)</th>}
                <th className="py-2 px-4">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {group.typeRows.map((tr) => (
                <tr key={tr.cylinderTypeId} className="border-b border-[#262E35]/40 last:border-b-0">
                  <td className="py-2 px-4">{tr.cylinderLabel}</td>
                  <td className="py-2 px-4 font-mono">{tr.orderedQty || "—"}</td>
                  <td className="py-2 px-4 font-mono">{tr.deliveredQty || "—"}</td>
                  <td className="py-2 px-4 font-mono">
                    {tr.shortage > 0 && <Badge tone="bad">{tr.shortage} with customer</Badge>}
                    {tr.shortage < 0 && <Badge tone="warn">{-tr.shortage} extra returned</Badge>}
                    {tr.shortage === 0 && (tr.filled > 0 || tr.empty > 0) && <Badge tone="good">Balanced</Badge>}
                  </td>
                  <td className="py-2 px-4 font-mono text-[#FF9A6E]">{tr.filled}</td>
                  <td className="py-2 px-4 font-mono text-[#22D3B0]">{tr.empty}</td>
                  <td className="py-2 px-4 font-mono text-[#FFC857]">{tr.bought || "—"}</td>
                  <td className="py-2 px-4 font-mono text-[#FFC857]">{tr.boughtAmount || "—"}</td>
                  <td className="py-2 px-4 font-mono text-[#FF5D5D]">{tr.defect}</td>
                  {showRate && <td className="py-2 px-4 font-mono">{tr.rate ?? "—"}</td>}
                  <td className="py-2 px-4 font-mono text-[#FF9A6E]">{tr.amount || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LedgerSection({ date, onInvoice }) {
  const { data: groups, loading, error, reload } = useLoad(() => api.get(`/api/reports/ledger?date=${date}`), [date]);
  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  return (
    <Panel eyebrow="Per Customer" title="Cylinder Movement & Payments"
      right={<span className="text-[11px] text-[#5C6975] font-mono">Click a customer to expand their cylinder-type breakdown</span>}>
      {groups.length === 0 ? (
        <Empty text="No customer activity for this date." />
      ) : (
        groups.map((g) => <CustomerLedgerGroup key={g.customerId} group={g} dueLabel="Due" showRate onInvoice={onInvoice} />)
      )}
    </Panel>
  );
}

function CashSection({ date }) {
  const { data, loading, error, reload } = useLoad(() => api.get(`/api/reports/cash-collection?date=${date}`), [date]);
  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { rows, totalCashToHandOver } = data;
  return (
    <Panel eyebrow="Cash Collection" title="Driver & Truck Handover to Owner"
      right={<span className="text-[11px] text-[#5C6975] font-mono">Cash collected from customers that a driver must hand over — Online payments settle directly</span>}>
      {rows.length === 0 ? (
        <Empty text="No cash or online payments collected by drivers on this date." />
      ) : (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#5C6975] font-mono border-b border-[#262E35]">
                  <th className="py-2 pr-4">Driver</th>
                  <th className="py-2 pr-4">Truck(s)</th>
                  <th className="py-2 pr-4">Customers</th>
                  <th className="py-2 pr-4">Cash Collected (₹)</th>
                  <th className="py-2 pr-4">Online Collected (₹)</th>
                  <th className="py-2 pr-4">Total Collected (₹)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.driverId} className="border-b border-[#262E35]/60">
                    <td className="py-2 pr-4 font-medium">{d.driverName}</td>
                    <td className="py-2 pr-4 font-mono">{d.trucks}</td>
                    <td className="py-2 pr-4 font-mono">{d.customerCount}</td>
                    <td className="py-2 pr-4 font-mono text-[#FFC857]">{d.cash || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-[#5C6975]">{d.online || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-[#22D3B0]">{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg bg-[#FFC857]/10 border border-[#FFC857]/30 p-3 text-sm font-mono flex justify-between">
            <span className="text-[#FFC857]">Total Cash to Hand Over to Owner (SK/SC/KBR)</span>
            <span className="text-[#FFC857] font-semibold">₹{totalCashToHandOver}</span>
          </div>
        </>
      )}
    </Panel>
  );
}

function MultiDaySection({
  rangeMode, setRangeMode, rangeStart, rangeEnd,
  rangeStartInput, setRangeStartInput, rangeEndInput, setRangeEndInput,
  customerFilter, setCustomerFilter, onInvoice,
}) {
  const { data, loading, error, reload } = useLoad(async () => {
    const filter = customerFilter ? `&customerId=${customerFilter}` : "";
    const [groups, customers] = await Promise.all([
      api.get(`/api/reports/multi-day?start=${rangeStart}&end=${rangeEnd}${filter}`),
      api.get("/api/customers").catch(() => []),
    ]);
    return { groups, customers };
  }, [rangeStart, rangeEnd, customerFilter]);

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { groups, customers } = data;

  const totals = groups.reduce(
    (a, g) => ({
      amount: a.amount + g.totalAmount,
      paid: a.paid + g.paid,
      outstanding: a.outstanding + g.ledgerBalance,
      filled: a.filled + g.typeRows.reduce((x, r) => x + r.filled, 0),
      empty: a.empty + g.typeRows.reduce((x, r) => x + r.empty, 0),
      defect: a.defect + g.typeRows.reduce((x, r) => x + r.defect, 0),
      shortage: a.shortage + g.typeRows.reduce((x, r) => x + r.shortage, 0),
    }),
    { amount: 0, paid: 0, outstanding: 0, filled: 0, empty: 0, defect: 0, shortage: 0 }
  );

  return (
    <Panel
      eyebrow="Multi-Day View"
      title={`Customer Orders — ${formatDateIST(rangeStart)} to ${formatDateIST(rangeEnd)}`}
      right={
        <div className="flex items-center gap-1.5 flex-wrap">
          <Btn tone={rangeMode === "7" ? "flame" : "ghost"} onClick={() => setRangeMode("7")}>Last 7 Days</Btn>
          <Btn tone={rangeMode === "30" ? "flame" : "ghost"} onClick={() => setRangeMode("30")}>Last 30 Days</Btn>
          <Btn tone={rangeMode === "custom" ? "flame" : "ghost"} onClick={() => setRangeMode("custom")}>Custom Range</Btn>
        </div>
      }
    >
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        {rangeMode === "custom" && (
          <>
            <Field label="From"><DateInput value={rangeStartInput} onChange={(e) => setRangeStartInput(e.target.value)} /></Field>
            <Field label="To"><DateInput value={rangeEndInput} min={rangeStartInput} onChange={(e) => setRangeEndInput(e.target.value)} /></Field>
          </>
        )}
        <Field label="Customer">
          <select className={inputCls} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {customerFilter && <Btn tone="ghost" onClick={() => setCustomerFilter("")}><X size={14} /> Clear</Btn>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="Cylinders Filled" value={totals.filled} tone="flame" />
        <Stat label="Empties Returned" value={totals.empty} tone="teal" />
        <Stat label="Empties at Customer" value={totals.shortage} tone="warn" />
        <Stat label="Defects Logged" value={totals.defect} tone="bad" />
        <Stat label="Total Amount (₹)" value={totals.amount} tone="warn" />
        <Stat label="Total Paid (₹)" value={totals.paid} tone="teal" />
        <Stat label="Outstanding as of range end (₹)" value={totals.outstanding} tone="bad" />
      </div>
      <p className="text-[11px] text-[#4B5661] font-mono -mt-2 mb-4">
        "Empties at Customer" = Cylinders Filled − Empties Returned − Empties Purchased (+ opening balances) — cylinders delivered but not yet collected back or bought outright.
      </p>

      {groups.length === 0 ? (
        <Empty text="No order activity in this date range." />
      ) : (
        groups.map((g) => (
          <CustomerLedgerGroup key={g.customerId} group={g} dueLabel="Due as of range end" showRate={false} onInvoice={onInvoice} />
        ))
      )}
    </Panel>
  );
}

/** Printable invoice — data comes precomputed from the API so it stays correct if opened later. */
function InvoiceModal({ request, onClose }) {
  const notify = useToast();
  const { data: inv, loading, error } = useLoad(
    () => api.get(`/api/reports/invoice?customerId=${request.customerId}&start=${request.startDate}&end=${request.endDate}`),
    [request.customerId, request.startDate, request.endDate]
  );

  if (error) {
    notify(error);
    onClose();
    return null;
  }
  if (loading || !inv) return null;

  const invoiceNo = `INV-${String(inv.customerId).padStart(4, "0")}-${request.endDate.replace(/-/g, "")}`;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1900, backgroundColor: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "16px",
      }}
      onClick={onClose}
    >
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-2 mb-3 sticky top-0 z-10 py-1">
          <Btn tone="teal" onClick={() => window.print()}><Printer size={15} /> Print</Btn>
          <Btn tone="ghost" onClick={onClose}><X size={15} /> Close</Btn>
        </div>
        <div className="invoice-printable-area bg-white text-[#1A1A1A] rounded-lg shadow-2xl p-8" style={{ fontFamily: "'Inter',sans-serif" }}>
          <div className="flex items-start justify-between border-b border-[#E5E5E5] pb-5 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-gradient-to-br from-[#FF7A45] to-[#FFC857] flex items-center justify-center">
                  <Flame size={16} className="text-white" />
                </div>
                <div className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>VSK Gas Ops</div>
              </div>
              <div className="text-[11px] text-[#666] mt-0.5">Cylinder Distribution</div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold tracking-wide" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>INVOICE</div>
              <div className="text-[11px] text-[#666] font-mono mt-0.5">{invoiceNo}</div>
              <div className="text-[11px] text-[#666] font-mono">{request.periodLabel}</div>
            </div>
          </div>

          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-wide text-[#999] font-mono mb-1">Bill To</div>
            <div className="font-semibold">{inv.customerName}</div>
            {inv.address && <div className="text-[13px] text-[#555]">{inv.address}</div>}
            {inv.phone && <div className="text-[13px] text-[#555]">{inv.phone}</div>}
          </div>

          <table className="w-full text-[13px] mb-4">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[#999] border-b border-[#E5E5E5]">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Rate (₹)</th>
                <th className="py-2 font-medium text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-[#F0F0F0]">
                  <td className="py-2">{l.label}</td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">{l.rate}</td>
                  <td className="py-2 text-right">{l.amount}</td>
                </tr>
              ))}
              {inv.lines.length === 0 && (
                <tr><td colSpan="4" className="py-4 text-center text-[#999]">No delivered orders or purchases in this period.</td></tr>
              )}
            </tbody>
          </table>

          <div className="flex justify-end mb-5">
            <div className="w-56 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-[#666]">Total Amount</span><span className="font-semibold">₹{inv.totalAmount}</span></div>
              <div className="flex justify-between"><span className="text-[#666]">Paid This Period</span><span>₹{inv.paidThisPeriod}</span></div>
              <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                <span className="font-semibold">Balance Due (as of {formatDateIST(request.endDate)})</span>
                <span className="font-bold">₹{inv.balanceDue}</span>
              </div>
            </div>
          </div>

          {inv.payments.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide text-[#999] font-mono mb-1">Payments Received This Period</div>
              {inv.payments.map((p, i) => (
                <div key={i} className="text-[12px] text-[#555] flex justify-between border-b border-[#F5F5F5] py-1">
                  <span>{formatDateTimeIST(p.timestamp)} IST · {p.method}</span>
                  <span>₹{p.amount}</span>
                </div>
              ))}
            </div>
          )}

          <div className="text-[11px] text-[#999] border-t border-[#E5E5E5] pt-3 mt-4">
            Thank you for your business.
          </div>
        </div>
      </div>
    </div>
  );
}
