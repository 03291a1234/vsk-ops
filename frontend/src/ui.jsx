import React, { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

/* ---------- constants (ported from the prototype) ---------- */
export const OWNERS = ["SK", "SC", "KBR"];
export const ORDER_STAGES = ["Placed", "Approved", "In Trip", "Delivered"];
export const TRIP_STAGES = ["Assigned", "On Delivery Run", "Completed"];
export const PAYMENT_METHODS = ["Cash", "Online"];

/* ---------- date/format helpers ---------- */
export const todayStr = (d = new Date()) => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" -> "DD-MM-YYYY" — Indian date format, no timezone shift since it's date-only */
export const formatDateIST = (dateStr) => {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
};
export const formatDateTimeIST = (iso) =>
  !iso
    ? "—"
    : new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
export const cylLabel = (ct) => (ct ? `${ct.name} (${ct.weight}kg)` : "—");

/* ---------- ledger display helpers (server is authoritative; these mirror it for the UI) ---------- */
export const totalPaid = (order) => (order.payments || []).reduce((a, p) => a + p.amount, 0);
export const dueOf = (order) => {
  if (order.rejected || order.stage < 3) return 0;
  return Math.max(0, order.amount - totalPaid(order));
};
export const paymentStatusOf = (order) => {
  if (order.rejected) return "Rejected";
  if (order.stage < 3) return "Awaiting Delivery";
  if (dueOf(order) <= 0) return "Paid";
  if (totalPaid(order) > 0) return "Partially Paid";
  return "Unpaid";
};
export const itemsSummary = (order, typeById) =>
  (order.items || []).map((it) => `${it.qty}× ${cylLabel(typeById[it.cylinderTypeId])}`).join(", ");

/* ---------- UI atoms ---------- */
export const Badge = ({ children, tone = "muted" }) => {
  const tones = {
    muted: "bg-white/5 text-[#8FA0AC] border-white/10",
    flame: "bg-[#FF7A45]/15 text-[#FF9A6E] border-[#FF7A45]/30",
    teal: "bg-[#22D3B0]/15 text-[#22D3B0] border-[#22D3B0]/30",
    good: "bg-[#3DD16F]/15 text-[#3DD16F] border-[#3DD16F]/30",
    bad: "bg-[#FF5D5D]/15 text-[#FF5D5D] border-[#FF5D5D]/30",
    warn: "bg-[#FFC857]/15 text-[#FFC857] border-[#FFC857]/30",
  };
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono border ${tones[tone]}`}>{children}</span>;
};

export const Panel = ({ title, eyebrow, right, children, className = "" }) => (
  <div className={`bg-[#171D22] border border-[#262E35] rounded-xl ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-[#262E35] flex-wrap gap-2">
        <div>
          {eyebrow && <div className="text-[10px] tracking-[0.18em] uppercase text-[#5C6975] font-mono mb-0.5">{eyebrow}</div>}
          {title && (
            <h3 className="text-[#E7ECEF] font-semibold text-[15px]" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
              {title}
            </h3>
          )}
        </div>
        {right}
      </div>
    )}
    <div className="p-5">{children}</div>
  </div>
);

export const Field = ({ label, children, hint }) => (
  <label className="flex flex-col gap-1.5 text-sm">
    <span className="text-[#8FA0AC] text-[12px] uppercase tracking-wide font-mono">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-[#4B5661]">{hint}</span>}
  </label>
);

export const inputCls =
  "bg-[#0F1316] border border-[#262E35] rounded-lg px-3 py-2 text-[#E7ECEF] text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7A45]/50 focus:border-[#FF7A45]/50 placeholder:text-[#4B5661]";

export const Btn = ({ children, onClick, tone = "default", disabled, type = "button", className = "" }) => {
  const tones = {
    default: "bg-white/5 hover:bg-white/10 text-[#E7ECEF] border-white/10",
    flame: "bg-[#FF7A45] hover:bg-[#FF8E60] text-[#0F1316] border-transparent font-semibold",
    teal: "bg-[#22D3B0] hover:bg-[#3CE0BE] text-[#0F1316] border-transparent font-semibold",
    danger: "bg-[#FF5D5D]/15 hover:bg-[#FF5D5D]/25 text-[#FF8A8A] border-[#FF5D5D]/30",
    ghost: "bg-transparent hover:bg-white/5 text-[#8FA0AC] border-transparent",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-sm border transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
};

export const Row = ({ children, onDelete }) => (
  <div className="flex items-center justify-between bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-2.5 gap-3">
    <div className="min-w-0">{children}</div>
    {onDelete && (
      <button onClick={onDelete} className="text-[#5C6975] hover:text-[#FF5D5D] p-1 shrink-0">
        <Trash2 size={15} />
      </button>
    )}
  </div>
);

export const Stat = ({ label, value, tone }) => {
  const tones = { flame: "text-[#FF9A6E]", warn: "text-[#FFC857]", bad: "text-[#FF5D5D]", teal: "text-[#22D3B0]" };
  return (
    <div className="bg-[#171D22] border border-[#262E35] rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-[#5C6975] font-mono">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tones[tone] || "text-[#E7ECEF]"}`} style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
        {value}
      </div>
    </div>
  );
};

export const Empty = ({ text, action, actionLabel }) => (
  <div className="text-center py-8">
    <AlertTriangle size={22} className="mx-auto text-[#4B5661] mb-2" />
    <p className="text-sm text-[#5C6975] mb-3">{text}</p>
    {action && (
      <Btn tone="flame" onClick={action}>
        {actionLabel}
      </Btn>
    )}
  </div>
);

/** generic segmented pipeline, used for both order-level and trip-level progress */
export const Pipeline = ({ stages, stageIndex, rejected }) => (
  <div className="w-full">
    <div className="relative h-2 rounded-full bg-[#0F1316] border border-[#262E35] overflow-hidden">
      {!rejected ? (
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${(stageIndex / (stages.length - 1)) * 100}%`, background: "linear-gradient(90deg,#FF7A45,#FFC857)" }}
        />
      ) : (
        <div className="h-full w-full bg-[#FF5D5D]/40" />
      )}
    </div>
    <div className="flex justify-between mt-2">
      {stages.map((s, i) => (
        <div key={s} className="flex flex-col items-center flex-1">
          <div
            className={`w-2.5 h-2.5 rounded-full border ${
              rejected ? "bg-[#FF5D5D] border-[#FF5D5D]" : i <= stageIndex ? "bg-[#FF7A45] border-[#FF7A45]" : "bg-[#0F1316] border-[#262E35]"
            }`}
          />
          <span className={`text-[9px] mt-1 text-center font-mono ${i <= stageIndex && !rejected ? "text-[#FF9A6E]" : "text-[#4B5661]"}`}>{s}</span>
        </div>
      ))}
    </div>
  </div>
);

/* ---------- locale-independent calendar date picker (ported from the prototype) ---------- */
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-indexed

export const DateInput = ({ value, onChange, min, className = "" }) => {
  const val = value || todayStr();
  const [vy, vm] = val.split("-").map(Number);
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(vy);
  const [viewM, setViewM] = useState(vm);

  useEffect(() => {
    if (open) {
      setViewY(vy);
      setViewM(vm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changeMonth = (delta) => {
    let nm = viewM + delta,
      ny = viewY;
    if (nm < 1) { nm = 12; ny -= 1; }
    if (nm > 12) { nm = 1; ny += 1; }
    setViewM(nm);
    setViewY(ny);
  };

  const pick = (dd) => {
    let newVal = `${viewY}-${String(viewM).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (min && newVal < min) newVal = min;
    onChange({ target: { value: newVal } });
    setOpen(false);
  };
  const pickToday = () => {
    const t = todayStr();
    if (!min || t >= min) {
      onChange({ target: { value: t } });
      setOpen(false);
    }
  };

  const firstDow = new Date(viewY, viewM - 1, 1).getDay();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth(viewY, viewM) }, (_, i) => i + 1)];

  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputCls} w-full flex items-center justify-between gap-2 text-left`}>
        <span>{formatDateIST(val)}</span>
        <CalendarDays size={14} className="text-[#5C6975] shrink-0" />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              zIndex: 999,
              backgroundColor: "#FFFFFF",
              border: "1px solid #E2E5E9",
              borderRadius: "8px",
              padding: "12px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
              width: "256px",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => changeMonth(-1)} style={{ color: "#5C6975" }} className="p-1 rounded hover:bg-black/5">
                <ChevronLeft size={16} />
              </button>
              <span style={{ color: "#1A1A1A", fontFamily: "'Space Grotesk',sans-serif" }} className="text-sm font-medium">
                {MONTH_ABBR[viewM - 1]} {viewY}
              </span>
              <button type="button" onClick={() => changeMonth(1)} style={{ color: "#5C6975" }} className="p-1 rounded hover:bg-black/5">
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-mono mb-1" style={{ color: "#8A8F96" }}>
              {WEEKDAY_ABBR.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((dd, i) => {
                if (dd === null) return <div key={`blank-${i}`} />;
                const cellVal = `${viewY}-${String(viewM).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
                const disabled = min && cellVal < min;
                const selected = cellVal === val;
                const isToday = cellVal === todayStr();
                const cellStyle = selected
                  ? { backgroundColor: "#FF7A45", color: "#FFFFFF", fontWeight: 600 }
                  : disabled
                  ? { color: "#C7CBD1", cursor: "not-allowed" }
                  : isToday
                  ? { color: "#FF7A45", border: "1px solid #FF7A45" }
                  : { color: "#1A1A1A" };
                return (
                  <button
                    type="button"
                    key={dd}
                    disabled={disabled}
                    onClick={() => pick(dd)}
                    style={cellStyle}
                    className="text-[12px] rounded-md py-1.5 font-mono transition hover:bg-black/5"
                  >
                    {dd}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={pickToday} style={{ color: "#FF7A45" }} className="mt-2 w-full text-[11px] hover:underline font-mono text-center">
              Jump to Today
            </button>
          </div>
        </>
      )}
    </div>
  );
};
