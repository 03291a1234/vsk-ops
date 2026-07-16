import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Truck, User, Flame, Users, Receipt, ClipboardList, BarChart3,
  Plus, Trash2, CheckCircle2, XCircle, Bell, MapPin, ArrowRight,
  Fuel, PackageCheck, Wallet, AlertTriangle, ChevronRight, ChevronLeft, X,
  Route, ShoppingCart, Tag, Navigation, CalendarDays, Printer, Building2, Pencil, ChevronDown, Database
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

/* ---------- constants ---------- */
const OWNERS = ["SK", "SC", "KBR"];
const ORDER_STAGES = ["Placed", "Approved", "In Trip", "Delivered"];
const TRIP_STAGES = ["Assigned", "On Delivery Run", "Completed"];
const PAYMENT_METHODS = ["Cash", "Online"];
const DEFAULT_DEPOT = { lat: 17.4239, lng: 78.4738 }; // placeholder — set to your actual IOCL bottling plant coords
const STORAGE_KEY = "vsk-ops-data-v7";
const todayStr = (d = new Date()) => d.toISOString().slice(0, 10);
/** "YYYY-MM-DD" (as stored from date inputs) -> "DD-MM-YYYY" — Indian date format, no timezone shift since it's date-only */
const formatDateIST = (dateStr) => {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
};
/** ISO timestamp -> Indian Standard Time, DD-MM-YYYY hh:mm AM/PM */
const formatDateTimeIST = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
/** ISO timestamp -> Indian Standard Time, hh:mm AM/PM only */
const formatTimeIST = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true });
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
const cylLabel = (ct) => (ct ? `${ct.name} (${ct.weight}kg)` : "—");
const itemsSummary = (order, nameOf) => (order.items || []).map((it) => `${it.qty}× ${nameOf.cylType(it.cylinderTypeId)}`).join(", ");

const emptyState = {
  drivers: [],
  trucks: [],
  cylinderTypes: [],
  customers: [],
  discounts: [],          // {id, customerId, cylinderTypeId, amount, startDate, endDate}
  mrpHistory: [],         // {id, cylinderTypeId, value, effectiveFrom, changedAt} — MRP is fixed per cylinder type
  orders: [],
  trips: [],
  events: [],             // {id, date, customerId, type(cylinderTypeId), action:'filled'|'empty_return'|'defect', qty}
  inventory: [],          // {id, cylinderTypeId, full, empty, defective, updatedAt} — company's own depot stock, one record per cylinder type
  ioclTransactions: [],   // {id, type:'sent'|'received', date, cylinderTypeId, qty, emptyQty?, defectiveQty?, vendorId?, amountBilled?, paid?, paidOn?, note, createdAt}
  vendors: [],            // {id, name, phone, address, createdAt} — who you buy/refill from (IOCL, maintenance, etc.)
  notifications: [],
  depot: DEFAULT_DEPOT,
};

/* ---------- default seed data ---------- */
const SEED_CYLINDER_TYPES = [
  { name: "Xtra Tej", weight: 5, mrp: 1450 },
  { name: "Xtra Tej", weight: 19, mrp: 2000 },
  { name: "Xtra Tej", weight: 47.5, mrp: 3500 },
];
const SEED_CUSTOMERS = [
  { name: "Sri Sai Traders", phone: "+91 90000 11111", address: "Begumpet, Hyderabad", lat: null, lng: null },
  { name: "Amaravathi Hotel & Caterers", phone: "+91 90000 22222", address: "Kukatpally, Hyderabad", lat: null, lng: null },
];
const SEED_DRIVERS = [
  { name: "Ravi Kumar", phone: "+91 90000 33333", license: "TS09 2019 004521" },
  { name: "Manoj Reddy", phone: "+91 90000 44444", license: "TS09 2021 009874" },
];
const SEED_VENDORS = [{ name: "IOCL", phone: "", address: "" }];
// {regNo, capacity, driverName} — driverName resolved against seeded/existing drivers; last truck is left unassigned as a spare
const SEED_TRUCKS = [
  { regNo: "TS 09 FA 1201", capacity: 60, driverName: "Ravi Kumar" },
  { regNo: "TS 09 FA 1202", capacity: 60, driverName: "Manoj Reddy" },
  { regNo: "TS 09 FA 1203", capacity: 80, driverName: null },
];
// {customerName, weight, discount} — resolved against seeded/existing customers & cylinder types by name/weight
const SEED_DISCOUNTS = [
  { customerName: "Sri Sai Traders", weight: 5, amount: 50 },
  { customerName: "Amaravathi Hotel & Caterers", weight: 47.5, amount: 100 },
];
/** fills cylinder types / customers / drivers / trucks / MRP / discounts only where missing — never overwrites existing data */
function withSeedData(state) {
  const cylinderTypes = state.cylinderTypes.length ? state.cylinderTypes : SEED_CYLINDER_TYPES.map((c) => ({ id: uid("CYL"), name: c.name, weight: c.weight }));
  const customers = state.customers.length ? state.customers : SEED_CUSTOMERS.map((c) => ({ id: uid("CUS"), ...c }));
  const drivers = state.drivers.length ? state.drivers : SEED_DRIVERS.map((d) => ({ id: uid("DRV"), ...d, createdAt: now() }));
  const vendors = state.vendors.length ? state.vendors : SEED_VENDORS.map((v) => ({ id: uid("VEN"), ...v, createdAt: now() }));
  const trucks = state.trucks.length
    ? state.trucks
    : SEED_TRUCKS.map((t) => ({
        id: uid("TRK"),
        regNo: t.regNo,
        capacity: t.capacity,
        driverId: t.driverName ? drivers.find((d) => d.name === t.driverName)?.id || "" : "",
        createdAt: now(),
      }));

  const mrpHistory = [...state.mrpHistory];
  SEED_CYLINDER_TYPES.forEach((seed) => {
    const ct = cylinderTypes.find((c) => c.name === seed.name && c.weight === seed.weight);
    if (ct && !mrpHistory.some((h) => h.cylinderTypeId === ct.id)) {
      mrpHistory.push({ id: uid("MRP"), cylinderTypeId: ct.id, value: seed.mrp, effectiveFrom: todayStr(), changedAt: now() });
    }
  });

  const discounts = [...state.discounts];
  SEED_DISCOUNTS.forEach((seed) => {
    const cust = customers.find((c) => c.name === seed.customerName);
    const ct = cylinderTypes.find((c) => c.weight === seed.weight);
    if (cust && ct && !discounts.some((d) => d.customerId === cust.id && d.cylinderTypeId === ct.id)) {
      discounts.push({ id: uid("DSC"), customerId: cust.id, cylinderTypeId: ct.id, amount: seed.amount, startDate: todayStr(), endDate: "2099-12-31" });
    }
  });

  return { ...state, cylinderTypes, customers, drivers, vendors, trucks, mrpHistory, discounts };
}

/* ---------- Delite Kitchen historical import (from uploaded PDF) ---------- */
const DELITE_KITCHEN_CUSTOMER = {
  name: "Delite Kitchen",
  phone: "+91 91000 10791",
  address: "Devender Colony, Kompally, Hyderabad, Telangana 500100",
  lat: null,
  lng: null,
};
// Cylinder type wasn't stated on the invoice sheet — the per-cylinder rate (~₹2980–3367) is closest to the
// 47.5kg tier already in this system, so that's the assumption used here. Flag it if that's wrong.
const DELITE_KITCHEN_CYLINDER = { name: "Xtra Tej", weight: 47.5 };
// {date, full, empty, amount, paidOn} — one row per invoice line from the PDF. "Empty's at Restaurant" (Full−Empty)
// and the periodic subtotal rows are derived, not re-entered. paidOn is null where "Payment Received On" was blank.
const DELITE_KITCHEN_SALES = [
  { date: "2026-06-09", full: 12, empty: 0, amount: 40404, paidOn: "2026-06-10" },
  { date: "2026-06-10", full: 10, empty: 0, amount: 33670, paidOn: "2026-06-12" },
  { date: "2026-06-11", full: 6, empty: 0, amount: 20202, paidOn: "2026-06-15" },
  { date: "2026-06-12", full: 12, empty: 12, amount: 40404, paidOn: "2026-06-15" },
  { date: "2026-06-13", full: 12, empty: 10, amount: 40404, paidOn: "2026-06-14" },
  { date: "2026-06-14", full: 12, empty: 10, amount: 40404, paidOn: "2026-06-18" },
  { date: "2026-06-15", full: 10, empty: 12, amount: 32000, paidOn: "2026-06-19" },
  { date: "2026-06-16", full: 10, empty: 10, amount: 32000, paidOn: "2026-06-20" },
  { date: "2026-06-17", full: 8, empty: 8, amount: 25600, paidOn: "2026-06-25" },
  { date: "2026-06-18", full: 12, empty: 0, amount: 38400, paidOn: "2026-06-21" },
  { date: "2026-06-19", full: 8, empty: 8, amount: 25600, paidOn: "2026-06-25" },
  { date: "2026-06-20", full: 10, empty: 8, amount: 32000, paidOn: "2026-06-25" },
  { date: "2026-06-21", full: 12, empty: 10, amount: 38400, paidOn: "2026-07-02" },
  { date: "2026-06-22", full: 10, empty: 11, amount: 32000, paidOn: "2026-06-28" },
  { date: "2026-06-23", full: 10, empty: 10, amount: 32000, paidOn: "2026-06-26" },
  { date: "2026-06-24", full: 7, empty: 7, amount: 22400, paidOn: "2026-06-28" },
  { date: "2026-06-25", full: 10, empty: 10, amount: 32000, paidOn: "2026-07-01" },
  { date: "2026-06-26", full: 12, empty: 12, amount: 38400, paidOn: null },
  { date: "2026-06-27", full: 10, empty: 8, amount: 32000, paidOn: "2026-07-01" },
  { date: "2026-06-28", full: 12, empty: 12, amount: 38400, paidOn: "2026-07-02" },
  { date: "2026-06-29", full: 10, empty: 10, amount: 32000, paidOn: "2026-07-01" },
  { date: "2026-06-30", full: 10, empty: 10, amount: 32000, paidOn: null },
  { date: "2026-07-01", full: 10, empty: 10, amount: 29800, paidOn: null },
  { date: "2026-07-02", full: 12, empty: 11, amount: 35760, paidOn: "2026-07-04" },
  { date: "2026-07-03", full: 10, empty: 9, amount: 29800, paidOn: null },
  { date: "2026-07-04", full: 10, empty: 10, amount: 29800, paidOn: "2026-07-08" },
  { date: "2026-07-05", full: 12, empty: 11, amount: 35760, paidOn: null },
  { date: "2026-07-06", full: 10, empty: 10, amount: 29800, paidOn: null },
  { date: "2026-07-07", full: 10, empty: 10, amount: 29800, paidOn: "2026-07-08" },
  { date: "2026-07-08", full: 12, empty: 12, amount: 35760, paidOn: null },
  { date: "2026-07-09", full: 12, empty: 12, amount: 35760, paidOn: null },
  { date: "2026-07-10", full: 12, empty: 12, amount: 35760, paidOn: null },
  { date: "2026-07-11", full: 12, empty: 12, amount: 35760, paidOn: null },
  { date: "2026-07-12", full: 12, empty: 12, amount: 35760, paidOn: null },
  { date: "2026-07-12", full: 5, empty: 2, amount: 14900, paidOn: null, note: "Evening delivery" },
];
const DELITE_IMPORT_TAG = "Imported: Delite Kitchen dataset";
/** builds one completed, delivered order + matching cylinder events per invoice row — payment recorded only where
 * "Payment Received On" had a date; assumed Cash since the PDF doesn't state a method. Safe to call more than
 * once — it's a no-op if this dataset was already imported for this customer. */
function importDeliteKitchen(state) {
  let customer = state.customers.find((c) => c.name === DELITE_KITCHEN_CUSTOMER.name);
  const customers = customer ? state.customers : [...state.customers, (customer = { id: uid("CUS"), ...DELITE_KITCHEN_CUSTOMER })];

  let cylType = state.cylinderTypes.find((c) => c.name === DELITE_KITCHEN_CYLINDER.name && c.weight === DELITE_KITCHEN_CYLINDER.weight);
  const cylinderTypes = cylType ? state.cylinderTypes : [...state.cylinderTypes, (cylType = { id: uid("CYL"), ...DELITE_KITCHEN_CYLINDER })];

  const alreadyImported = state.orders.some((o) => o.customerId === customer.id && o.history.some((h) => h.stage === DELITE_IMPORT_TAG));
  if (alreadyImported) return { ...state, changed: false };

  const newOrders = [];
  const newEvents = [];
  DELITE_KITCHEN_SALES.forEach((row) => {
    const rate = row.full > 0 ? Math.round(row.amount / row.full) : 0;
    const createdAt = `${row.date}T09:00:00.000Z`;
    const deliveredAt = `${row.date}T18:00:00.000Z`;
    const payments = row.paidOn ? [{ id: uid("PMT"), method: "Cash", amount: row.amount, ts: `${row.paidOn}T12:00:00.000Z` }] : [];
    newOrders.push({
      id: uid("ORD"),
      customerId: customer.id,
      orderDate: row.date,
      items: [{ id: uid("ITM"), cylinderTypeId: cylType.id, orderedQty: row.full, qty: row.full, rate, amount: row.amount }],
      amount: row.amount,
      payments,
      stage: 3,
      rejected: false,
      approvedBy: "Imported",
      tripId: null,
      createdAt,
      history: [
        { stage: "Placed", ts: createdAt },
        { stage: "Approved by Imported", ts: createdAt },
        { stage: DELITE_IMPORT_TAG, ts: createdAt },
        { stage: "Delivered", ts: deliveredAt },
      ],
    });
    newEvents.push({ id: uid("ev"), date: row.date, customerId: customer.id, type: cylType.id, action: "filled", qty: row.full });
    if (row.empty > 0) newEvents.push({ id: uid("ev"), date: row.date, customerId: customer.id, type: cylType.id, action: "empty_return", qty: row.empty });
  });

  return { ...state, customers, cylinderTypes, orders: [...newOrders, ...state.orders], events: [...state.events, ...newEvents], changed: true };
}

/* ---------- geo helpers (route optimization) ---------- */
function seededHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function pseudoCoord(id, base) {
  const h = seededHash(id);
  const dLat = ((h % 1000) / 1000 - 0.5) * 0.3;
  const dLng = (((h >>> 10) % 1000) / 1000 - 0.5) * 0.3;
  return { lat: base.lat + dLat, lng: base.lng + dLng };
}
function haversine(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
/** nearest-neighbour heuristic — not a true optimum, but fast and good enough for small daily runs */
function optimizeRoute(depot, stops) {
  let remaining = [...stops];
  let current = depot;
  let cum = 0;
  const route = [];
  while (remaining.length) {
    remaining.sort((a, b) => haversine(current, a) - haversine(current, b));
    const next = remaining.shift();
    const d = haversine(current, next);
    cum += d;
    route.push({ ...next, distanceKm: +d.toFixed(1), etaMin: Math.round((cum / 28) * 60), delivered: false });
    current = next;
  }
  return route;
}

/* ---------- pricing helpers ---------- */
function currentMrp(mrpHistory, cylinderTypeId, dateStr) {
  const valid = mrpHistory
    .filter((h) => h.cylinderTypeId === cylinderTypeId && h.effectiveFrom <= dateStr)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return valid.length ? valid[0].value : 0;
}
function applicableDiscount(discounts, customerId, cylinderTypeId, dateStr) {
  const matches = discounts.filter(
    (d) => d.customerId === customerId && d.cylinderTypeId === cylinderTypeId && d.startDate <= dateStr && dateStr <= d.endDate
  );
  if (!matches.length) return 0;
  return Math.max(...matches.map((m) => m.amount));
}
function effectiveRate(state, customerId, cylinderTypeId, dateStr = todayStr()) {
  const mrp = currentMrp(state.mrpHistory, cylinderTypeId, dateStr);
  const disc = applicableDiscount(state.discounts, customerId, cylinderTypeId, dateStr);
  return Math.max(0, mrp - disc);
}
/** current cylinders sitting with a customer for one type, all-time: Filled − Empty − already-purchased, plus any opening balance */
function emptiesAtCustomerBalance(state, customerId, cylinderTypeId) {
  const evs = state.events.filter((e) => e.customerId === customerId && e.type === cylinderTypeId);
  const filled = evs.filter((e) => e.action === "filled").reduce((a, e) => a + e.qty, 0);
  const empty = evs.filter((e) => e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
  const purchased = evs.filter((e) => e.action === "empty_purchased").reduce((a, e) => a + e.qty, 0);
  const cust = state.customers.find((c) => c.id === customerId);
  const opening = cust?.openingEmptiesCylinderTypeId === cylinderTypeId ? cust.openingEmptiesQty || 0 : 0;
  return Math.max(0, filled - empty - purchased + opening);
}

/* ---------- payment / ledger helpers ---------- */
/** sum of payments recorded on/before dateStr (defaults to "all time") */
function totalPaid(order, dateStr = null) {
  const payments = order.payments || [];
  const filtered = dateStr ? payments.filter((p) => p.ts.slice(0, 10) <= dateStr) : payments;
  return filtered.reduce((a, p) => a + p.amount, 0);
}
/** remaining balance owed — only crystallizes once the order is delivered */
function dueOf(order, dateStr = null) {
  if (order.rejected || order.stage < 3) return 0;
  return Math.max(0, order.amount - totalPaid(order, dateStr));
}
function paymentStatusOf(order) {
  if (order.rejected) return "Rejected";
  if (order.stage < 3) return "Awaiting Delivery";
  const due = dueOf(order);
  if (due <= 0) return "Paid";
  if (totalPaid(order) > 0) return "Partially Paid";
  return "Unpaid";
}
/** opening balance plus remaining due on delivered orders, counting only payments recorded on/before asOfDate */
function ledgerBalanceAsOf(state, customerId, asOfDate) {
  const opening = state.customers.find((c) => c.id === customerId)?.openingBalance || 0;
  return (
    opening +
    state.orders
      .filter((o) => o.customerId === customerId && !o.rejected && o.orderDate <= asOfDate)
      .reduce((a, o) => a + dueOf(o, asOfDate), 0)
  );
}

/** older purchase lines (made before purchases carried a date) get dated to their order's orderDate — otherwise
 * they're invisible to the daily/range "Bought Amount" columns, which key off that date */
function backfillPurchaseDates(state) {
  let changed = false;
  const orders = state.orders.map((o) => {
    if (!o.emptyPurchases || !o.emptyPurchases.some((p) => !p.date)) return o;
    changed = true;
    return { ...o, emptyPurchases: o.emptyPurchases.map((p) => (p.date ? p : { ...p, date: o.orderDate })) };
  });
  return changed ? { ...state, orders } : state;
}

/* ---------- storage helpers ---------- */
async function loadState() {
  try {
    const res = await window.storage.get(STORAGE_KEY, true);
    if (res?.value) return withSeedData(backfillPurchaseDates({ ...emptyState, ...JSON.parse(res.value) }));
  } catch (e) {}
  return withSeedData(emptyState); // first-ever run — start with Xtra Tej cylinder types + two sample customers
}
async function saveState(state) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(state), true);
  } catch (e) {
    console.error("save failed", e);
  }
}

/* ---------- roles & profile ----------
 * IMPORTANT: this is a UI-level convenience only, not real security. This app has no backend and no
 * authentication — the shared company data is readable/writable by anyone with access to the artifact,
 * regardless of what role they've picked here. What this DOES do: scope each person's nav/actions to
 * their job so day-to-day use stays on-track, and reduce accidental clicks (e.g. a driver never seeing
 * an "Approve Order" button). Treat it as a preference, not a permission boundary. */
const ROLES = ["Owner", "Dispatch", "Accountant", "Driver"];
const NAV_ACCESS = {
  dashboard: ["Owner", "Dispatch", "Accountant"],
  neworder: ["Owner", "Dispatch"],
  orders: ["Owner", "Dispatch", "Accountant"],
  dispatch: ["Owner", "Dispatch", "Driver"],
  masterdata: ["Owner", "Dispatch"],
  discounts: ["Owner", "Accountant"],
  reports: ["Owner", "Dispatch", "Accountant"],
};
const PROFILE_KEY = "vsk-ops-profile-v1";
const emptyProfile = { name: "", role: "Owner", driverId: null };
async function loadProfile() {
  try {
    const res = await window.storage.get(PROFILE_KEY, false); // personal, not shared — this is "who's using this browser"
    if (res?.value) return { ...emptyProfile, ...JSON.parse(res.value) };
  } catch (e) {}
  return emptyProfile; // no profile set yet — defaults to Owner (full access) so nothing is locked out by default
}
async function saveProfile(profile) {
  try {
    await window.storage.set(PROFILE_KEY, JSON.stringify(profile), false);
  } catch (e) {
    console.error("profile save failed", e);
  }
}

/* ---------- UI atoms ---------- */
const Badge = ({ children, tone = "muted" }) => {
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

const Panel = ({ title, eyebrow, right, children, className = "" }) => (
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

const Field = ({ label, children, hint }) => (
  <label className="flex flex-col gap-1.5 text-sm">
    <span className="text-[#8FA0AC] text-[12px] uppercase tracking-wide font-mono">{label}</span>
    {children}
    {hint && <span className="text-[11px] text-[#4B5661]">{hint}</span>}
  </label>
);

const inputCls =
  "bg-[#0F1316] border border-[#262E35] rounded-lg px-3 py-2 text-[#E7ECEF] text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7A45]/50 focus:border-[#FF7A45]/50 placeholder:text-[#4B5661]";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-indexed

const WEEKDAY_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Locale-independent calendar date picker. A native <input type="date"> can't be forced into a fixed
 * format — its popup follows the visitor's own browser/OS locale (often MM/DD/YYYY for US settings), and
 * that isn't something a webpage can override. This builds the calendar grid ourselves instead, so the
 * trigger always reads DD-MM-YYYY and the popup's month/weekday labels are fixed by this component, not
 * by whoever happens to be viewing it. */
const DateInput = ({ value, onChange, min, className = "" }) => {
  const val = value || todayStr();
  const [vy, vm] = val.split("-").map(Number);
  const [open, setOpen] = useState(false);
  const [viewY, setViewY] = useState(vy);
  const [viewM, setViewM] = useState(vm);

  useEffect(() => {
    if (open) { setViewY(vy); setViewM(vm); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changeMonth = (delta) => {
    let nm = viewM + delta, ny = viewY;
    if (nm < 1) { nm = 12; ny -= 1; }
    if (nm > 12) { nm = 1; ny += 1; }
    setViewM(nm); setViewY(ny);
  };

  const pick = (dd) => {
    let newVal = `${viewY}-${String(viewM).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (min && newVal < min) newVal = min;
    onChange({ target: { value: newVal } });
    setOpen(false);
  };
  const pickToday = () => {
    const t = todayStr();
    if (!min || t >= min) { onChange({ target: { value: t } }); setOpen(false); }
  };

  const firstDow = new Date(viewY, viewM - 1, 1).getDay(); // 0 = Sunday
  const numDays = daysInMonth(viewY, viewM);
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)];

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} w-full flex items-center justify-between gap-2 text-left`}
      >
        <span>{formatDateIST(val)}</span>
        <CalendarDays size={14} className="text-[#5C6975] shrink-0" />
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 998, backgroundColor: "transparent" }}
            onClick={() => setOpen(false)}
          />
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
              opacity: 1,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => changeMonth(-1)} style={{ color: "#5C6975" }} className="p-1 rounded hover:bg-black/5"><ChevronLeft size={16} /></button>
              <span style={{ color: "#1A1A1A", fontFamily: "'Space Grotesk',sans-serif" }} className="text-sm font-medium">{MONTH_ABBR[viewM - 1]} {viewY}</span>
              <button type="button" onClick={() => changeMonth(1)} style={{ color: "#5C6975" }} className="p-1 rounded hover:bg-black/5"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-mono mb-1" style={{ color: "#8A8F96" }}>
              {WEEKDAY_ABBR.map((w) => <div key={w}>{w}</div>)}
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

const Btn = ({ children, onClick, tone = "default", disabled, type = "button", className = "" }) => {
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

const Row = ({ children, onDelete }) => (
  <div className="flex items-center justify-between bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-2.5 gap-3">
    <div className="min-w-0">{children}</div>
    {onDelete && (
      <button onClick={onDelete} className="text-[#5C6975] hover:text-[#FF5D5D] p-1 shrink-0">
        <Trash2 size={15} />
      </button>
    )}
  </div>
);

const FLOW_STEPS = [
  { id: "neworder", label: "1. New Order" },
  { id: "orders", label: "2. Approve" },
  { id: "dispatch", label: "3. Dispatch & Deliver" },
  { id: "reports-daily", label: "4. Reports", matchPrefix: "reports-" },
];
/** shows where the current page sits in the order → approve → dispatch → report pipeline, and lets you jump steps */
const FlowNav = ({ current, setTab }) => (
  <div className="flex items-center gap-1.5 flex-wrap mb-1">
    {FLOW_STEPS.map((s, i) => {
      const active = s.matchPrefix ? current.startsWith(s.matchPrefix) : s.id === current;
      return (
        <React.Fragment key={s.id}>
          <button
            onClick={() => setTab(s.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition ${
              active ? "bg-[#FF7A45]/15 text-[#FF9A6E] border-[#FF7A45]/30" : "bg-transparent text-[#5C6975] border-transparent hover:bg-white/5"
            }`}
          >
            {s.label}
          </button>
          {i < FLOW_STEPS.length - 1 && <ChevronRight size={12} className="text-[#3A4550]" />}
        </React.Fragment>
      );
    })}
  </div>
);

const Empty = ({ text, action, actionLabel }) => (
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

const Stat = ({ label, value, tone }) => {
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

const Dial = ({ label, filled, empty }) => {
  const total = filled + empty || 1;
  const pct = Math.round((filled / total) * 100);
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-[#0F1316] border border-[#262E35]">
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="#262E35" strokeWidth="8" />
        <circle
          cx="42" cy="42" r={r} fill="none" stroke="#FF7A45" strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          strokeLinecap="round" transform="rotate(-90 42 42)"
        />
        <text x="42" y="47" textAnchor="middle" fill="#E7ECEF" fontSize="16" fontFamily="'JetBrains Mono',monospace">{pct}%</text>
      </svg>
      <div>
        <div className="text-[#E7ECEF] text-sm font-medium">{label}</div>
        <div className="text-[12px] text-[#FF9A6E] font-mono">{filled} full</div>
        <div className="text-[12px] text-[#22D3B0] font-mono">{empty} empty</div>
      </div>
    </div>
  );
};

/** generic segmented pipeline, used for both order-level and trip-level progress */
const Pipeline = ({ stages, stageIndex, rejected }) => (
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

/** master-data records that all live under one "Master Data" hover menu instead of cluttering the main bar */
const MASTER_DATA_ITEMS = [
  { id: "drivers", label: "Drivers", icon: User },
  { id: "trucks", label: "Trucks", icon: Truck },
  { id: "cylinders", label: "Cylinders", icon: Fuel },
  { id: "vendors", label: "Vendors", icon: Building2 },
  { id: "customers", label: "Customers", icon: Users },
];
/** each report section is its own page, reachable from one "Reports" hover menu */
const REPORT_ITEMS = [
  { id: "reports-daily", label: "Daily Summary", icon: BarChart3 },
  { id: "reports-bytype", label: "By Cylinder Type", icon: Fuel },
  { id: "reports-ledger", label: "Cylinder Movement & Payments", icon: Wallet },
  { id: "reports-cash", label: "Cash Collection", icon: Receipt },
  { id: "reports-multiday", label: "Multi-Day View", icon: CalendarDays },
];

/** a nav item that reveals a list of pages on hover (and on click/tap, for touch devices without hover) */
/** the app's left navigation: single pages plus two accordion groups (Master Data, Reports) whose
 * sub-items expand in place. Collapses to an icon-only rail; expanding a group while collapsed
 * re-opens the sidebar first, since there's nowhere to show sub-items otherwise. */
function Sidebar({ tab, setTab, open, setOpen, openGroups, setOpenGroups, state, loadSampleData, clearOrders, confirmClear, setConfirmClear, profile, hasAccess }) {
  const singleItems = [
    { id: "dashboard", label: "Dashboard", icon: Flame },
    { id: "neworder", label: "New Order", icon: ShoppingCart },
    { id: "orders", label: "Orders", icon: ClipboardList },
    { id: "dispatch", label: "Dispatch", icon: Route },
  ].filter((i) => hasAccess(i.id));
  const trailingItems = [{ id: "discounts", label: "Pricing", icon: Tag }].filter((i) => hasAccess(i.id));
  const groups = [
    { id: "masterdata", label: "Master Data", icon: Database, items: MASTER_DATA_ITEMS },
    { id: "reports", label: "Reports", icon: BarChart3, items: REPORT_ITEMS },
  ].filter((g) => hasAccess(g.items[0].id));

  useEffect(() => {
    if (MASTER_DATA_ITEMS.some((i) => i.id === tab)) setOpenGroups((g) => ({ ...g, masterdata: true }));
    if (REPORT_ITEMS.some((i) => i.id === tab)) setOpenGroups((g) => ({ ...g, reports: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const toggleGroup = (id) => setOpenGroups((g) => ({ ...g, [id]: !g[id] }));

  const NavBtn = ({ item, indent }) => (
    <button
      type="button"
      onClick={() => setTab(item.id)}
      title={item.label}
      className={`w-full flex items-center gap-2.5 rounded-lg text-sm transition py-2 ${indent ? "pl-8 pr-3" : "px-3"} ${
        tab === item.id ? "bg-[#FF7A45]/15 text-[#FF9A6E]" : "text-[#8FA0AC] hover:bg-white/5 hover:text-[#DDE3E7]"
      }`}
    >
      <item.icon size={16} className="shrink-0" />
      {open && <span className="truncate">{item.label}</span>}
    </button>
  );

  return (
    <div className={`${open ? "w-60" : "w-[68px]"} shrink-0 border-r border-[#262E35] bg-[#0F1316] flex flex-col transition-all duration-200 sticky top-0 h-screen overflow-hidden`}>
      <div className="flex items-center gap-2.5 px-4 h-[72px] border-b border-[#262E35] shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={open ? "Collapse menu" : "Expand menu"}
          className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#FF7A45] to-[#FFC857] flex items-center justify-center shrink-0 hover:opacity-90 transition"
        >
          <Flame size={18} className="text-[#0F1316]" />
        </button>
        {open && (
          <>
            <div className="min-w-0 flex-1">
              <div className="font-semibold tracking-tight truncate" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>VSK Gas Ops</div>
              <div className="text-[9px] text-[#5C6975] font-mono uppercase tracking-wide truncate">Cylinder Distribution</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Collapse menu"
              className="shrink-0 p-1.5 rounded-lg text-[#8FA0AC] hover:bg-white/5 hover:text-[#DDE3E7] transition"
            >
              <ChevronLeft size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
        {singleItems.map((item) => <NavBtn key={item.id} item={item} />)}

        {groups.map((g) => {
          const isActiveGroup = g.items.some((i) => i.id === tab);
          return (
            <div key={g.id}>
              <button
                type="button"
                onClick={() => { if (!open) setOpen(true); toggleGroup(g.id); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
                  isActiveGroup ? "text-[#FF9A6E]" : "text-[#8FA0AC] hover:bg-white/5 hover:text-[#DDE3E7]"
                }`}
              >
                <g.icon size={16} className="shrink-0" />
                {open && <span className="flex-1 text-left truncate">{g.label}</span>}
                {open && <ChevronDown size={13} className={`transition-transform shrink-0 ${openGroups[g.id] ? "rotate-180" : ""}`} />}
              </button>
              {open && openGroups[g.id] && (
                <div className="space-y-0.5 mt-0.5">
                  {g.items.map((item) => <NavBtn key={item.id} item={item} indent />)}
                </div>
              )}
            </div>
          );
        })}

        {trailingItems.map((item) => <NavBtn key={item.id} item={item} />)}
      </div>

      <div className="px-3 py-3 border-t border-[#262E35] shrink-0 space-y-2">
        <button
          type="button"
          onClick={() => setTab("profile")}
          title="My Profile"
          className={`w-full flex items-center gap-2.5 rounded-lg text-sm transition py-2 px-3 ${
            tab === "profile" ? "bg-[#FF7A45]/15 text-[#FF9A6E]" : "text-[#8FA0AC] hover:bg-white/5 hover:text-[#DDE3E7]"
          }`}
        >
          <User size={16} className="shrink-0" />
          {open && (
            <span className="truncate text-left">
              <span className="block leading-tight">{profile.name || "Set your name"}</span>
              <span className="block text-[10px] text-[#5C6975] font-mono leading-tight">{profile.role}</span>
            </span>
          )}
        </button>
        {open && (state.cylinderTypes.length === 0 || state.customers.length === 0 || state.drivers.length === 0 || state.trucks.length === 0 || state.mrpHistory.length === 0 || state.discounts.length === 0) && (
          <Btn tone="ghost" onClick={loadSampleData} className="w-full justify-center text-[12px]">Load Sample Data</Btn>
        )}
        {open && (state.orders.length > 0 || state.trips.length > 0) && (
          <Btn
            tone={confirmClear ? "danger" : "ghost"}
            className="w-full justify-center text-[12px]"
            onClick={() => {
              if (confirmClear) { clearOrders(); setConfirmClear(false); }
              else { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 4000); }
            }}
          >
            {confirmClear ? "Confirm Clear?" : "Clear Orders"}
          </Btn>
        )}
      </div>
    </div>
  );
}

/** everyone's own "who am I" page — switchable anytime. Note this is a preference, not a login: see the
 * caveat on ROLES above. Picking "Driver" also asks which driver record you are, so Dispatch can be
 * filtered down to just your own trips. */
function ProfileTab({ state, profile, setProfile }) {
  const [name, setName] = useState(profile.name);
  const [role, setRole] = useState(profile.role);
  const [driverId, setDriverId] = useState(profile.driverId || "");

  const dirty = name !== profile.name || role !== profile.role || (role === "Driver" && driverId !== (profile.driverId || ""));

  const save = () => {
    setProfile({ name, role, driverId: role === "Driver" ? driverId || null : null });
  };

  const ROLE_BLURB = {
    Owner: "Full access — approve orders, set pricing, manage vendors, everything.",
    Dispatch: "Day-to-day operations — orders, dispatch, deliveries, reports. No pricing changes.",
    Accountant: "Reports, payments, and pricing — no order placement or dispatch.",
    Driver: "Just your own assigned trip(s) — mark deliveries, record payment collected.",
  };

  return (
    <div className="max-w-lg space-y-4">
      <Panel eyebrow="My Profile" title="Who's using this session?"
        right={<span className="text-[11px] text-[#5C6975] font-mono">A preference, not a login — see note below</span>}>
        <div className="space-y-4">
          <Field label="Your Name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi Kumar" />
          </Field>
          <Field label="Role">
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition ${
                    role === r
                      ? "bg-[#FF7A45] text-[#0F1316] border-[#FF7A45]"
                      : "bg-[#0F1316] text-[#8FA0AC] border-[#262E35] hover:border-[#3A4550] hover:text-[#DDE3E7]"
                  }`}
                >
                  {role === r && <CheckCircle2 size={15} />}
                  {r}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#4B5661] mt-1.5">{ROLE_BLURB[role]}</p>
          </Field>
          {role === "Driver" && (
            <Field label="Which driver are you?" hint="Dispatch will show only trips assigned to you">
              <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Select your driver record…</option>
                {state.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
          <Btn tone="flame" disabled={!dirty} onClick={save} className="w-full justify-center">Save Profile</Btn>
        </div>
      </Panel>

      <div className="rounded-lg bg-[#FFC857]/10 border border-[#FFC857]/30 p-3 text-[12px] text-[#FFC857] flex gap-2">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <span>
          This app has no backend or real login — anyone with access to it can open the browser tools and see or change anything,
          no matter what role is picked here. This page only scopes your own view to your job and hides actions you don't need,
          to keep day-to-day use on-track. It is not a security boundary.
        </span>
      </div>
    </div>
  );
}

/* =========================================================
   MAIN APP
   ========================================================= */
export default function VSKOps() {
  const [state, setState] = useState(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [focusOrderId, setFocusOrderId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState({ masterdata: false, reports: false });
  const [profile, setProfile] = useState(emptyProfile);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const goToOrderPayment = (orderId) => {
    setFocusOrderId(orderId);
    setTab("orders");
  };

  useEffect(() => {
    loadState().then((s) => {
      setState(s);
      setLoaded(true);
    });
    loadProfile().then((p) => {
      setProfile(p);
      setProfileLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (loaded) saveState(state);
  }, [state, loaded]);
  useEffect(() => {
    if (profileLoaded) saveProfile(profile);
  }, [profile, profileLoaded]);

  /** which nav group a given tab id belongs to, for permission checks */
  const navGroupOf = (id) => {
    if (id === "profile") return "profile";
    if (MASTER_DATA_ITEMS.some((i) => i.id === id)) return "masterdata";
    if (id.startsWith("reports-")) return "reports";
    return id;
  };
  const hasAccess = (id) => {
    const group = navGroupOf(id);
    if (group === "profile") return true; // everyone can always reach their own profile
    return (NAV_ACCESS[group] || []).includes(profile.role);
  };
  // if a role switch makes the current page inaccessible, bounce to somewhere that role can actually see
  useEffect(() => {
    if (!profileLoaded || hasAccess(tab)) return;
    setTab(profile.role === "Driver" ? "dispatch" : "dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.role, profileLoaded]);

  const notify = useCallback((audience, message) => {
    setState((s) => ({ ...s, notifications: [{ id: uid("n"), ts: now(), audience, message }, ...s.notifications].slice(0, 80) }));
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const update = (key, fn) => setState((s) => ({ ...s, [key]: fn(s[key]) }));
  const loadSampleData = () => {
    setState((s) => withSeedData(s));
    setToast("Sample cylinder types and customers loaded.");
    setTimeout(() => setToast(null), 3200);
  };
  const clearOrders = () => {
    setState((s) => ({ ...s, orders: [], trips: [], events: [], notifications: [] }));
    setToast("Active orders, trips, and cylinder events cleared. Cylinder types, customers, drivers, trucks, and pricing were kept.");
    setTimeout(() => setToast(null), 3200);
  };
  const deliteKitchenImported = state.orders.some((o) => o.history.some((h) => h.stage === DELITE_IMPORT_TAG));
  const runDeliteKitchenImport = () => {
    const result = importDeliteKitchen(state);
    if (!result.changed) {
      setToast("Delite Kitchen data was already imported — nothing to do.");
    } else {
      setState(result);
      setToast(`Imported Delite Kitchen: ${DELITE_KITCHEN_SALES.length} historical orders (09 Jun – 12 Jul 2026).`);
    }
    setTimeout(() => setToast(null), 3600);
  };

  const nameOf = {
    driver: (id) => state.drivers.find((d) => d.id === id)?.name ?? "—",
    truck: (id) => state.trucks.find((t) => t.id === id)?.regNo ?? "—",
    customer: (id) => state.customers.find((c) => c.id === id)?.name ?? "—",
    cylType: (id) => cylLabel(state.cylinderTypes.find((c) => c.id === id)),
    vendor: (id) => state.vendors.find((v) => v.id === id)?.name ?? "—",
  };
  const custOf = (id) => state.customers.find((c) => c.id === id);

  const inventoryByType = useMemo(
    () =>
      state.cylinderTypes.map((ct) => {
        const filled = state.events.filter((e) => e.type === ct.id && e.action === "filled").reduce((a, e) => a + e.qty, 0);
        const empty = state.events.filter((e) => e.type === ct.id && e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
        return { ...ct, filled, empty };
      }),
    [state.cylinderTypes, state.events]
  );

  /* ---------- order actions ---------- */
  const createOrder = ({ customerId, orderDate, items, purchases }) => {
    const oDate = orderDate || todayStr();
    const builtItems = (items || [])
      .filter((it) => it.cylinderTypeId && Number(it.qty) > 0)
      .map((it) => {
        const qty = Number(it.qty);
        const rate = effectiveRate(state, customerId, it.cylinderTypeId, oDate);
        return { id: uid("ITM"), cylinderTypeId: it.cylinderTypeId, orderedQty: qty, qty, rate, amount: qty * rate };
      });
    // customer buying out empties they already hold, instead of returning them — priced at each type's empty-purchase price, not the full MRP
    const builtPurchases = (purchases || [])
      .filter((p) => p.cylinderTypeId && Number(p.qty) > 0)
      .map((p) => {
        const qty = Math.min(Number(p.qty), emptiesAtCustomerBalance(state, customerId, p.cylinderTypeId));
        const ct = state.cylinderTypes.find((c) => c.id === p.cylinderTypeId);
        const price = ct?.emptyPrice || 0;
        return { id: uid("EPU"), cylinderTypeId: p.cylinderTypeId, qty, price, amount: qty * price, date: oDate };
      })
      .filter((p) => p.qty > 0);
    const amount = builtItems.reduce((a, it) => a + it.amount, 0) + builtPurchases.reduce((a, p) => a + p.amount, 0);
    const order = {
      id: uid("ORD"),
      customerId,
      orderDate: oDate, // requested order date — today or a future date; used for reporting
      items: builtItems, // one or more {cylinderTypeId, qty, rate, amount} lines per order
      emptyPurchases: builtPurchases, // {cylinderTypeId, qty, price, amount} — empties bought outright, billed on this same order
      amount,
      payments: [], // {id, method:'Cash'|'Online', amount, ts} — recorded only after delivery
      stage: 0,
      rejected: false,
      approvedBy: null,
      tripId: null,
      createdAt: now(),
      history: [{ stage: "Placed", ts: now() }],
    };
    update("orders", (o) => [order, ...o]);
    // ownership transfers immediately — it doesn't require a delivery run, unlike full-cylinder fills
    if (builtPurchases.length) {
      update("events", (e) => [
        ...e,
        ...builtPurchases.map((p) => ({ id: uid("ev"), date: oDate, customerId, type: p.cylinderTypeId, action: "empty_purchased", qty: p.qty })),
      ]);
    }
    const purchaseNote = builtPurchases.length ? ` Includes purchase of ${builtPurchases.reduce((a, p) => a + p.qty, 0)} empty cylinder(s).` : "";
    notify("Owners (SK/SC/KBR)", `New order ${order.id} placed by ${nameOf.customer(customerId)} for ${oDate} — awaiting approval.${purchaseNote}`);
    return order;
  };
  const stampHistory = (id, label, patch = {}) =>
    update("orders", (orders) => orders.map((o) => (o.id === id ? { ...o, ...patch, history: [...o.history, { stage: label, ts: now() }] } : o)));

  const approveOrder = (o, owner) => {
    stampHistory(o.id, `Approved by ${owner}`, { stage: 1, approvedBy: owner });
    notify("Dispatch", `Order ${o.id} approved by ${owner}. Ready to be grouped into a delivery trip.`);
  };
  const rejectOrder = (o, owner) => {
    stampHistory(o.id, `Rejected by ${owner}`, { rejected: true, approvedBy: owner });
    notify(nameOf.customer(o.customerId), `Order ${o.id} was rejected by ${owner}.`);
  };
  const recordPayment = (o, method, amount) => {
    const amt = Math.min(Number(amount) || 0, dueOf(o));
    if (amt <= 0) return;
    update("orders", (orders) =>
      orders.map((x) =>
        x.id === o.id
          ? { ...x, payments: [...(x.payments || []), { id: uid("PMT"), method, amount: amt, ts: now() }], history: [...x.history, { stage: `Payment ₹${amt} via ${method}`, ts: now() }] }
          : x
      )
    );
    notify("Dispatch", `₹${amt} recorded via ${method} for order ${o.id}.`);
  };
  /** one payment from a customer, applied across all their outstanding delivered orders — oldest order date first */
  const settleCustomerPayment = (customerId, method, amount) => {
    let remaining = Number(amount) || 0;
    if (remaining <= 0) return;
    const dueOrders = state.orders
      .filter((o) => o.customerId === customerId && !o.rejected && o.stage === 3 && dueOf(o) > 0)
      .sort((a, b) => (a.orderDate < b.orderDate ? -1 : a.orderDate > b.orderDate ? 1 : a.createdAt < b.createdAt ? -1 : 1));
    const allocations = {};
    for (const o of dueOrders) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, dueOf(o));
      if (alloc > 0) {
        allocations[o.id] = alloc;
        remaining -= alloc;
      }
    }
    const settledCount = Object.keys(allocations).length;
    if (settledCount === 0) return;
    update("orders", (orders) =>
      orders.map((o) =>
        allocations[o.id]
          ? {
              ...o,
              payments: [...(o.payments || []), { id: uid("PMT"), method, amount: allocations[o.id], ts: now() }],
              history: [...o.history, { stage: `Payment ₹${allocations[o.id]} via ${method} (bulk settlement)`, ts: now() }],
            }
          : o
      )
    );
    const applied = Number(amount) - remaining;
    const overpaid = remaining > 0 ? ` ₹${remaining} exceeds total dues and was not applied.` : "";
    notify("Dispatch", `₹${applied} from ${nameOf.customer(customerId)} settled across ${settledCount} order(s) (oldest dues first).${overpaid}`);
  };

  /* ---------- trip (multi-order dispatch + routing) actions ---------- */
  const createTrip = (driverId, truckId, orderIds) => {
    const trip = {
      id: uid("TRIP"),
      driverId,
      truckId,
      orderIds,
      stage: 0,
      route: [],
      createdAt: now(),
      history: [{ stage: "Assigned", ts: now() }],
    };
    update("trips", (t) => [trip, ...t]);
    update("orders", (orders) => orders.map((o) => (orderIds.includes(o.id) ? { ...o, stage: 2, tripId: trip.id } : o)));
    notify(nameOf.driver(driverId), `Trip ${trip.id} assigned — ${orderIds.length} order(s). Ready to fill and depart.`);
  };
  const tripStamp = (id, label, patch = {}) =>
    update("trips", (trips) => trips.map((t) => (t.id === id ? { ...t, ...patch, history: [...t.history, { stage: label, ts: now() }] } : t)));

  /** fills cylinders for every line item in the trip, computes the optimized route, and departs — all in one step */
  /** applies signed deltas to depot inventory records, creating one if a cylinder type has never been tracked */
  const adjustInventory = (deltas) => {
    // deltas: { [cylinderTypeId]: { full?, empty?, defective? } }
    update("inventory", (arr) => {
      let next = [...arr];
      Object.entries(deltas).forEach(([cylinderTypeId, d]) => {
        const idx = next.findIndex((r) => r.cylinderTypeId === cylinderTypeId);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            full: next[idx].full + (d.full || 0),
            empty: next[idx].empty + (d.empty || 0),
            defective: next[idx].defective + (d.defective || 0),
            updatedAt: now(),
          };
        } else {
          next.push({ id: uid("INV"), cylinderTypeId, full: d.full || 0, empty: d.empty || 0, defective: d.defective || 0, updatedAt: now() });
        }
      });
      return next;
    });
  };

  /** ships empties/defectives out to IOCL for refill — reduces depot Empty/Defective and logs the shipment */
  const sendToIOCL = ({ cylinderTypeId, emptyQty, defectiveQty, date, note }) => {
    const eq = Number(emptyQty) || 0;
    const dq = Number(defectiveQty) || 0;
    if (!cylinderTypeId || (eq <= 0 && dq <= 0)) return;
    const rec = state.inventory.find((r) => r.cylinderTypeId === cylinderTypeId);
    const availEmpty = rec?.empty ?? 0;
    const availDefective = rec?.defective ?? 0;
    if (eq > availEmpty || dq > availDefective) {
      notify("Dispatch", `Sending more ${nameOf.cylType(cylinderTypeId)} to IOCL than depot shows (Empty: ${availEmpty}, Defective: ${availDefective}) — stock will go negative.`);
    }
    adjustInventory({ [cylinderTypeId]: { empty: -eq, defective: -dq } });
    const tx = { id: uid("IOCL"), type: "sent", date: date || todayStr(), cylinderTypeId, qty: eq + dq, emptyQty: eq, defectiveQty: dq, note: note || "", createdAt: now() };
    update("ioclTransactions", (arr) => [tx, ...arr]);
    notify("Dispatch", `Sent ${eq} empty + ${dq} defective ${nameOf.cylType(cylinderTypeId)} to IOCL for refill.`);
  };
  /** new full stock arrives from IOCL — increases depot Full and logs what IOCL billed for the batch */
  const receiveFromIOCL = ({ cylinderTypeId, qty, vendorId, amountBilled, date, note }) => {
    const q = Number(qty) || 0;
    if (!cylinderTypeId || q <= 0) return;
    adjustInventory({ [cylinderTypeId]: { full: q } });
    const tx = { id: uid("IOCL"), type: "received", date: date || todayStr(), cylinderTypeId, qty: q, vendorId: vendorId || null, amountBilled: Number(amountBilled) || 0, paid: false, paidOn: null, note: note || "", createdAt: now() };
    update("ioclTransactions", (arr) => [tx, ...arr]);
    const billNote = tx.amountBilled > 0 ? ` — billed ₹${tx.amountBilled} to ${nameOf.vendor(vendorId)}` : "";
    notify("Dispatch", `Received ${q} full ${nameOf.cylType(cylinderTypeId)} from IOCL${billNote}.`);
  };
  const toggleIOCLPaid = (txId) => {
    update("ioclTransactions", (arr) => arr.map((t) => (t.id === txId ? { ...t, paid: !t.paid, paidOn: !t.paid ? todayStr() : null } : t)));
  };
  /** the depot-stock effect a transaction had when it was created — used to undo it on edit/delete */
  const inventoryDeltaForTx = (tx) => {
    if (tx.type === "sent") return { [tx.cylinderTypeId]: { empty: -(tx.emptyQty || 0), defective: -(tx.defectiveQty || 0) } };
    if (tx.type === "received") return { [tx.cylinderTypeId]: { full: tx.qty || 0 } };
    return {};
  };
  const negateDelta = (delta) => {
    const out = {};
    Object.entries(delta).forEach(([id, d]) => { out[id] = { full: -(d.full || 0), empty: -(d.empty || 0), defective: -(d.defective || 0) }; });
    return out;
  };
  const deleteIOCLTransaction = (txId) => {
    const tx = state.ioclTransactions.find((t) => t.id === txId);
    if (!tx) return;
    adjustInventory(negateDelta(inventoryDeltaForTx(tx))); // undo whatever this transaction did to depot stock
    update("ioclTransactions", (arr) => arr.filter((t) => t.id !== txId));
    notify("Dispatch", `Deleted an IOCL ${tx.type} transaction for ${nameOf.cylType(tx.cylinderTypeId)} — depot stock adjusted back.`);
  };
  const editIOCLTransaction = (txId, updates) => {
    const tx = state.ioclTransactions.find((t) => t.id === txId);
    if (!tx) return;
    adjustInventory(negateDelta(inventoryDeltaForTx(tx))); // undo the old effect first
    const merged = { ...tx, ...updates };
    if (merged.type === "sent") {
      merged.emptyQty = Number(merged.emptyQty) || 0;
      merged.defectiveQty = Number(merged.defectiveQty) || 0;
      merged.qty = merged.emptyQty + merged.defectiveQty;
    } else {
      merged.qty = Number(merged.qty) || 0;
      merged.amountBilled = Number(merged.amountBilled) || 0;
    }
    adjustInventory(inventoryDeltaForTx(merged)); // then apply the new one
    update("ioclTransactions", (arr) => arr.map((t) => (t.id === txId ? merged : t)));
    notify("Dispatch", `Updated an IOCL ${merged.type} transaction for ${nameOf.cylType(merged.cylinderTypeId)}.`);
  };

  const tripDepart = (trip) => {
    const orders = state.orders.filter((o) => trip.orderIds.includes(o.id));
    const stops = orders.map((o) => {
      const c = custOf(o.customerId);
      const coord = c?.lat && c?.lng ? { lat: c.lat, lng: c.lng } : pseudoCoord(c?.id || o.customerId, state.depot);
      return { orderId: o.id, customerId: o.customerId, lat: coord.lat, lng: coord.lng, items: o.items.map((it) => ({ cylinderTypeId: it.cylinderTypeId, qty: it.qty })) };
    });

    // depot Full stock leaves with the truck the moment it departs — one deduction per cylinder type for the whole load
    const loadQty = {};
    orders.forEach((o) => o.items.forEach((it) => { loadQty[it.cylinderTypeId] = (loadQty[it.cylinderTypeId] || 0) + it.qty; }));
    Object.entries(loadQty).forEach(([cylinderTypeId, qty]) => {
      const current = state.inventory.find((r) => r.cylinderTypeId === cylinderTypeId)?.full ?? 0;
      if (current < qty) {
        notify("Dispatch", `Depot only shows ${current} full ${nameOf.cylType(cylinderTypeId)}, but trip ${trip.id} is loading ${qty}. Inventory will go negative — check the Cylinders tab.`);
      }
    });
    adjustInventory(Object.fromEntries(Object.entries(loadQty).map(([id, qty]) => [id, { full: -qty }])));

    const route = optimizeRoute(state.depot, stops);
    tripStamp(trip.id, "On Delivery Run", { stage: 1, route });
    route.forEach((stop, i) => {
      notify(
        nameOf.customer(stop.customerId),
        `Your order is on the way (stop ${i + 1} of ${route.length}). Estimated arrival in ~${stop.etaMin} min.`
      );
    });
  };
  /** itemResults: [{cylinderTypeId, actualQty, emptyQty, defectQty, buyQty}] — actualQty may differ (+/-) from what was
   * originally ordered; buyQty is how many of this delivery's shortfall (Full − Empty) the customer chose to buy
   * outright right at the door, instead of it becoming an owed balance */
  const tripMarkStopDelivered = (trip, stopOrderId, itemResults) => {
    const order = state.orders.find((o) => o.id === stopOrderId);
    const newItems = order.items.map((it) => {
      const r = itemResults.find((x) => x.cylinderTypeId === it.cylinderTypeId);
      const orderedQty = it.orderedQty ?? it.qty;
      const actualQty = r ? Math.max(0, Number(r.actualQty)) : it.qty;
      return { ...it, orderedQty, qty: actualQty, amount: actualQty * it.rate };
    });
    const itemsAmount = newItems.reduce((a, it) => a + it.amount, 0);

    const resultItems = newItems.map((it) => {
      const r = itemResults.find((x) => x.cylinderTypeId === it.cylinderTypeId) || { emptyQty: 0, defectQty: 0, buyQty: 0 };
      const defectQty = Number(r.defectQty) || 0;
      const emptyQty = Number(r.emptyQty) || 0;
      const fullQty = Math.max(0, it.qty - defectQty);
      const maxBuy = Math.max(0, fullQty - emptyQty); // can't buy out more than this delivery's own shortfall
      const buyQty = Math.min(Number(r.buyQty) || 0, maxBuy);
      return { cylinderTypeId: it.cylinderTypeId, orderedQty: it.orderedQty, actualQty: it.qty, fullQty, emptyQty, defectQty, buyQty };
    });

    // new empty-cylinder-purchase lines for whatever the customer bought out at the door, on top of any from order creation
    const newPurchaseLines = resultItems
      .filter((it) => it.buyQty > 0)
      .map((it) => {
        const ct = state.cylinderTypes.find((c) => c.id === it.cylinderTypeId);
        const price = ct?.emptyPrice || 0;
        return { id: uid("EPU"), cylinderTypeId: it.cylinderTypeId, qty: it.buyQty, price, amount: it.buyQty * price, date: todayStr() };
      });
    const emptyPurchases = [...(order.emptyPurchases || []), ...newPurchaseLines];
    const newAmount = itemsAmount + emptyPurchases.reduce((a, p) => a + p.amount, 0);

    const newRoute = trip.route.map((r) => (r.orderId === stopOrderId ? { ...r, delivered: true, deliveredAt: now(), items: resultItems } : r));
    const allDelivered = newRoute.every((r) => r.delivered);
    tripStamp(trip.id, `Delivered stop: ${nameOf.customer(order.customerId)}`, { route: newRoute, stage: allDelivered ? 2 : trip.stage });
    stampHistory(stopOrderId, "Delivered", { stage: 3, items: newItems, emptyPurchases, amount: newAmount });
    // "filled" is logged here, at delivery, using the actual full count handed over — this is what keeps
    // Reports in sync with the Full/Empty/Defect badges shown on the route stop, instead of the originally planned load
    const events = resultItems.flatMap((it) => [
      ...(it.fullQty > 0 ? [{ id: uid("ev"), date: todayStr(), customerId: order.customerId, type: it.cylinderTypeId, action: "filled", qty: it.fullQty }] : []),
      ...(it.emptyQty > 0 ? [{ id: uid("ev"), date: todayStr(), customerId: order.customerId, type: it.cylinderTypeId, action: "empty_return", qty: it.emptyQty }] : []),
      ...(it.defectQty > 0 ? [{ id: uid("ev"), date: todayStr(), customerId: order.customerId, type: it.cylinderTypeId, action: "defect", qty: it.defectQty }] : []),
      ...(it.buyQty > 0 ? [{ id: uid("ev"), date: todayStr(), customerId: order.customerId, type: it.cylinderTypeId, action: "empty_purchased", qty: it.buyQty }] : []),
    ]);
    if (events.length) update("events", (e) => [...e, ...events]);
    // the empties and defectives the driver collects come back into the depot's stock — credited the moment they're logged here
    const invDeltas = {};
    resultItems.forEach((it) => {
      if (it.emptyQty > 0 || it.defectQty > 0) {
        invDeltas[it.cylinderTypeId] = invDeltas[it.cylinderTypeId] || {};
        invDeltas[it.cylinderTypeId].empty = (invDeltas[it.cylinderTypeId].empty || 0) + it.emptyQty;
        invDeltas[it.cylinderTypeId].defective = (invDeltas[it.cylinderTypeId].defective || 0) + it.defectQty;
      }
    });
    if (Object.keys(invDeltas).length) adjustInventory(invDeltas);
    const totalDefect = resultItems.reduce((a, it) => a + it.defectQty, 0);
    const totalBought = resultItems.reduce((a, it) => a + it.buyQty, 0);
    const adjusted = resultItems.filter((it) => it.actualQty !== it.orderedQty);
    const defectNote = totalDefect > 0 ? ` (${totalDefect} defective unit(s))` : "";
    const buyNote = totalBought > 0 ? ` Customer bought ${totalBought} empty cylinder(s) at the door.` : "";
    const adjustNote = adjusted.length > 0 ? ` Quantity adjusted at delivery for ${adjusted.length} item(s) — bill updated to ₹${newAmount}.` : "";
    notify(nameOf.customer(order.customerId), `Order ${order.id} delivered${defectNote}.${buyNote}${adjustNote} Thank you!`);
    if (allDelivered) notify("Dispatch", `Trip ${trip.id} completed — all stops delivered.`);
  };

  if (!loaded) {
    return <div className="min-h-screen bg-[#0F1316] flex items-center justify-center text-[#8FA0AC] font-mono text-sm">Loading VSK Ops…</div>;
  }

  const ctx = { state, update, notify, nameOf, custOf, inventoryByType, setTab, focusOrderId, setFocusOrderId, goToOrderPayment, deliteKitchenImported, runDeliteKitchenImport, sendToIOCL, receiveFromIOCL, toggleIOCLPaid, deleteIOCLTransaction, editIOCLTransaction, profile, setProfile };

  return (
    <div className="min-h-screen bg-[#0F1316] text-[#E7ECEF] flex" style={{ fontFamily: "'Inter',sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @media print {
          body * { visibility: hidden; }
          .invoice-printable-area, .invoice-printable-area * { visibility: visible; }
          .invoice-printable-area { position: fixed; inset: 0; width: 100%; margin: 0; box-shadow: none; border-radius: 0; }
        }
      `}</style>

      <Sidebar
        tab={tab} setTab={setTab} open={sidebarOpen} setOpen={setSidebarOpen}
        openGroups={openGroups} setOpenGroups={setOpenGroups} state={state}
        loadSampleData={loadSampleData} clearOrders={clearOrders}
        confirmClear={confirmClear} setConfirmClear={setConfirmClear}
        profile={profile} hasAccess={hasAccess}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="border-b border-[#262E35] px-6 h-[72px] flex items-center justify-end sticky top-0 bg-[#0F1316]/95 backdrop-blur z-20">
          <NotifBell notifications={state.notifications} />
        </div>

        <div className="p-6 max-w-6xl mx-auto w-full space-y-6">
          {tab === "profile" && <ProfileTab {...ctx} />}
          {tab === "dashboard" && hasAccess("dashboard") && <Dashboard {...ctx} />}
          {tab === "neworder" && hasAccess("neworder") && <NewOrderTab {...ctx} createOrder={createOrder} setTab={setTab} />}
          {tab === "orders" && hasAccess("orders") && <OrdersTab {...ctx} approveOrder={approveOrder} rejectOrder={rejectOrder} recordPayment={recordPayment} settleCustomerPayment={settleCustomerPayment} />}
          {tab === "dispatch" && hasAccess("dispatch") && (
            <DispatchTab {...ctx} createTrip={createTrip} tripDepart={tripDepart} tripMarkStopDelivered={tripMarkStopDelivered} />
          )}
          {tab === "drivers" && hasAccess("drivers") && <DriversTab {...ctx} />}
          {tab === "trucks" && hasAccess("trucks") && <TrucksTab {...ctx} />}
          {tab === "cylinders" && hasAccess("cylinders") && <CylindersTab {...ctx} />}
          {tab === "vendors" && hasAccess("vendors") && <VendorsTab {...ctx} />}
          {tab === "customers" && hasAccess("customers") && <CustomersTab {...ctx} />}
          {tab === "discounts" && hasAccess("discounts") && <DiscountsTab {...ctx} />}
          {tab.startsWith("reports-") && hasAccess("reports") && <ReportsTab {...ctx} section={tab.replace("reports-", "")} />}
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            top: "88px",
            right: "20px",
            zIndex: 2000,
            backgroundColor: "#FFFFFF",
            border: "1px solid #FFD9A0",
            borderRadius: "10px",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
            maxWidth: "384px",
          }}
        >
          <Bell size={15} style={{ color: "#FF7A45", flexShrink: 0 }} />
          <span style={{ fontSize: "14px", color: "#1A1A1A" }}>{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Notifications bell ---------- */
function NotifBell({ notifications }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-lg hover:bg-white/5 border border-[#262E35]">
        <Bell size={17} className="text-[#8FA0AC]" />
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF7A45] text-[10px] flex items-center justify-center text-[#0F1316] font-bold">
            {Math.min(notifications.length, 9)}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-[#171D22] border border-[#262E35] rounded-xl shadow-2xl z-30">
          <div className="px-4 py-3 border-b border-[#262E35] flex items-center justify-between">
            <span className="text-sm font-medium">Notifications</span>
            <button onClick={() => setOpen(false)}><X size={14} className="text-[#5C6975]" /></button>
          </div>
          {notifications.length === 0 && <div className="p-4 text-sm text-[#5C6975]">No notifications yet.</div>}
          {notifications.map((n) => (
            <div key={n.id} className="px-4 py-2.5 border-b border-[#262E35]/60 text-sm">
              <div className="text-[10px] font-mono text-[#5C6975] uppercase">{n.audience} · {formatTimeIST(n.ts)} IST</div>
              <div className="text-[#DDE3E7] mt-0.5">{n.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Dashboard ---------- */
function Dashboard({ state, inventoryByType, nameOf, setTab }) {
  const activeOrders = state.orders.filter((o) => !o.rejected && o.stage < 3);
  const unpaid = state.orders.filter((o) => !o.rejected && dueOf(o) > 0);
  const activeTrips = state.trips.filter((t) => t.stage < 4);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active Orders" value={activeOrders.length} tone="flame" />
        <Stat label="Pending Approval" value={state.orders.filter((o) => o.stage === 0 && !o.rejected).length} tone="warn" />
        <Stat label="Trips In Motion" value={activeTrips.length} tone="teal" />
        <Stat label="Unpaid Invoices" value={unpaid.length} tone="bad" />
      </div>

      <Panel eyebrow="Inventory" title="Cylinder Stock by Type">
        {inventoryByType.length === 0 ? (
          <Empty text="No cylinder types yet." action={() => setTab("cylinders")} actionLabel="Add cylinder type" />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {inventoryByType.map((ct) => (
              <Dial key={ct.id} label={cylLabel(ct)} filled={ct.filled} empty={ct.empty} />
            ))}
          </div>
        )}
        <p className="text-[11px] text-[#4B5661] font-mono mt-3">
          Lifetime totals delivered to / collected from customers, derived from order activity — not the same as depot stock below.
        </p>
      </Panel>

      <Panel eyebrow="Company Inventory" title="Depot Stock (Full / Empty / Defective)"
        right={<Btn tone="ghost" onClick={() => setTab("cylinders")}>Manage Inventory <ChevronRight size={14} /></Btn>}>
        {state.cylinderTypes.length === 0 ? (
          <Empty text="No cylinder types yet." action={() => setTab("cylinders")} actionLabel="Add cylinder type" />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {state.cylinderTypes.map((ct) => {
              const rec = state.inventory.find((r) => r.cylinderTypeId === ct.id);
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
                  <span className="font-mono text-[#8FA0AC]">{t.id} · {nameOf.driver(t.driverId)} · {nameOf.truck(t.truckId)}</span>
                  <span className="text-[#5C6975]">{t.orderIds.length} stop(s)</span>
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

/** one editable depot-stock row — full CRUD: create/update via Save, read via the displayed values, delete via Clear */
function InventoryStockRow({ ct, record, onSave, onDelete }) {
  const [full, setFull] = useState(record?.full ?? 0);
  const [empty, setEmpty] = useState(record?.empty ?? 0);
  const [defective, setDefective] = useState(record?.defective ?? 0);

  // record is only set once via useState's initializer — without this, the inputs go stale whenever
  // something else changes depot stock (IOCL send/receive, a trip departing/delivering) and never
  // visibly update, even though the underlying numbers are actually correct.
  useEffect(() => {
    setFull(record?.full ?? 0);
    setEmpty(record?.empty ?? 0);
    setDefective(record?.defective ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.full, record?.empty, record?.defective]);

  const dirty = !record || record.full !== Number(full) || record.empty !== Number(empty) || record.defective !== Number(defective);

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">{cylLabel(ct)}</div>
        {record?.updatedAt && <div className="text-[10px] text-[#4B5661] font-mono">Updated {formatDateTimeIST(record.updatedAt)} IST</div>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-col items-start">
          <span className="text-[9px] text-[#4B5661] font-mono">Full</span>
          <input type="number" min="0" value={full} onChange={(e) => setFull(e.target.value)} className={`${inputCls} w-20`} />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-[9px] text-[#4B5661] font-mono">Empty</span>
          <input type="number" min="0" value={empty} onChange={(e) => setEmpty(e.target.value)} className={`${inputCls} w-20`} />
        </div>
        <div className="flex flex-col items-start">
          <span className="text-[9px] text-[#4B5661] font-mono">Defective</span>
          <input type="number" min="0" value={defective} onChange={(e) => setDefective(e.target.value)} className={`${inputCls} w-20`} />
        </div>
        <Btn tone={dirty ? "flame" : "ghost"} disabled={!dirty} onClick={() => onSave(ct.id, Number(full) || 0, Number(empty) || 0, Number(defective) || 0)}>
          Save
        </Btn>
        {record && (
          <Btn tone="ghost" onClick={() => { onDelete(ct.id); setFull(0); setEmpty(0); setDefective(0); }}>
            <Trash2 size={13} />
          </Btn>
        )}
      </div>
    </div>
  );
}

/* ---------- New Order page ---------- */
function NewOrderTab({ state, createOrder, setTab }) {
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [items, setItems] = useState([{ cylinderTypeId: "", qty: 1 }]);
  const [purchases, setPurchases] = useState([]);
  const [placed, setPlaced] = useState(null);

  const oDate = orderDate || todayStr();
  const addRow = () => setItems((r) => [...r, { cylinderTypeId: "", qty: 1 }]);
  const removeRow = (idx) => setItems((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx, field, val) => setItems((r) => r.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));

  const lineBreakdown = items.map((it) => {
    if (!it.cylinderTypeId) return null;
    const mrp = currentMrp(state.mrpHistory, it.cylinderTypeId, oDate);
    const discount = customerId ? applicableDiscount(state.discounts, customerId, it.cylinderTypeId, oDate) : 0;
    const rate = customerId ? effectiveRate(state, customerId, it.cylinderTypeId, oDate) : mrp;
    const qty = Number(it.qty) || 0;
    return { mrp, discount, rate, qty, amount: rate * qty };
  });
  const itemsTotal = lineBreakdown.reduce((a, l) => a + (l ? l.amount : 0), 0);
  const validItems = items.filter((it) => it.cylinderTypeId && Number(it.qty) > 0);

  // cylinder types this customer currently holds empties for (owed back), each with its own purchase price
  const purchasableTypes = customerId
    ? state.cylinderTypes.map((ct) => ({ ct, balance: emptiesAtCustomerBalance(state, customerId, ct.id) })).filter((x) => x.balance > 0)
    : [];
  const updatePurchase = (idx, field, val) => setPurchases((r) => r.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));
  const addPurchaseRow = () => setPurchases((r) => [...r, { cylinderTypeId: "", qty: 1 }]);
  const removePurchaseRow = (idx) => setPurchases((r) => r.filter((_, i) => i !== idx));
  const purchaseBreakdown = purchases.map((p) => {
    if (!p.cylinderTypeId) return null;
    const ct = state.cylinderTypes.find((c) => c.id === p.cylinderTypeId);
    const balance = customerId ? emptiesAtCustomerBalance(state, customerId, p.cylinderTypeId) : 0;
    const price = ct?.emptyPrice || 0;
    const qty = Math.min(Number(p.qty) || 0, balance);
    return { price, balance, qty, amount: price * qty };
  });
  const purchasesTotal = purchaseBreakdown.reduce((a, p) => a + (p ? p.amount : 0), 0);
  const validPurchases = purchases.filter((p) => p.cylinderTypeId && Number(p.qty) > 0);

  const orderTotal = itemsTotal + purchasesTotal;

  const place = () => {
    if (!customerId || (validItems.length === 0 && validPurchases.length === 0)) return;
    const o = createOrder({ customerId, orderDate, items: validItems, purchases: validPurchases });
    setPlaced(o);
    setCustomerId("");
    setOrderDate(todayStr());
    setItems([{ cylinderTypeId: "", qty: 1 }]);
    setPurchases([]);
  };

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <FlowNav current="neworder" setTab={setTab} />
      <Panel eyebrow="Sales" title="New Order" right={<span className="text-[11px] text-[#5C6975] font-mono">Add as many cylinder types as this order needs</span>}>
        <div className="space-y-4">
          <Field label="Select Customer">
            <select className={inputCls} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setPurchases([]); }}>
              <option value="">Choose a customer…</option>
              {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Order Date" hint="Today or a future date">
            <DateInput min={todayStr()} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
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
                      {state.cylinderTypes.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
                    </select>
                    <input type="number" min="1" className={`${inputCls} w-20`} value={it.qty} onChange={(e) => updateRow(idx, "qty", e.target.value)} />
                    {items.length > 1 && (
                      <button onClick={() => removeRow(idx)} className="text-[#5C6975] hover:text-[#FF5D5D] p-2"><Trash2 size={15} /></button>
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
            <Btn tone="ghost" onClick={addRow} className="w-full justify-center"><Plus size={15} /> Add Another Cylinder Type</Btn>
          </div>

          {customerId && purchasableTypes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#262E35]">
              <span className="text-[#8FA0AC] text-[12px] uppercase tracking-wide font-mono">Purchase Empty Cylinders (optional)</span>
              <p className="text-[11px] text-[#4B5661]">
                This customer is currently holding {purchasableTypes.map((x) => `${x.balance} × ${cylLabel(x.ct)}`).join(", ")} unreturned. They can buy some or all outright instead of returning them.
              </p>
              {purchases.map((p, idx) => {
                const bd = purchaseBreakdown[idx];
                const availableTypes = purchasableTypes.filter((x) => x.ct.id === p.cylinderTypeId || !purchases.some((pp, j) => j !== idx && pp.cylinderTypeId === x.ct.id));
                return (
                  <div key={idx} className="rounded-lg border border-[#262E35] bg-[#0F1316] p-3 space-y-2">
                    <div className="flex gap-2 items-end">
                      <select className={`${inputCls} flex-1`} value={p.cylinderTypeId} onChange={(e) => updatePurchase(idx, "cylinderTypeId", e.target.value)}>
                        <option value="">Choose a type…</option>
                        {availableTypes.map((x) => <option key={x.ct.id} value={x.ct.id}>{cylLabel(x.ct)} — {x.balance} held</option>)}
                      </select>
                      <input type="number" min="1" max={bd?.balance || undefined} className={`${inputCls} w-20`} value={p.qty} onChange={(e) => updatePurchase(idx, "qty", e.target.value)} />
                      <button onClick={() => removePurchaseRow(idx)} className="text-[#5C6975] hover:text-[#FF5D5D] p-2"><Trash2 size={15} /></button>
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
                <Btn tone="ghost" onClick={addPurchaseRow} className="w-full justify-center"><Plus size={15} /> Add Purchase Line</Btn>
              )}
            </div>
          )}

          {orderTotal > 0 && customerId && (
            <div className="rounded-lg bg-[#0F1316] border border-[#FF7A45]/30 p-3 text-sm font-mono space-y-1">
              {itemsTotal > 0 && <div className="flex justify-between text-[#5C6975]"><span>Delivery ({validItems.reduce((a, i) => a + Number(i.qty), 0)} cyl)</span><span>₹{itemsTotal}</span></div>}
              {purchasesTotal > 0 && <div className="flex justify-between text-[#5C6975]"><span>Empty cylinder purchase</span><span>₹{purchasesTotal}</span></div>}
              <div className="flex justify-between pt-1 border-t border-[#262E35]">
                <span className="text-[#5C6975]">Order Total</span>
                <span className="text-[#FF9A6E] font-semibold">₹{orderTotal}</span>
              </div>
            </div>
          )}
          <p className="text-[11px] text-[#4B5661]">Payment is recorded once the order is delivered — see the Orders tab after delivery.</p>
          <Btn tone="flame" onClick={place} disabled={!customerId || (validItems.length === 0 && validPurchases.length === 0)} className="w-full justify-center">
            <Plus size={15} /> Place Order
          </Btn>
        </div>
      </Panel>

      {placed && (
        <Panel eyebrow="Confirmation" title="Order Placed">
          <div className="text-sm space-y-1 font-mono text-[#8FA0AC]">
            <div>Order ID: <span className="text-[#E7ECEF]">{placed.id}</span></div>
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

/* ---------- Orders (approval + status list) ---------- */
function OrdersTab({ state, nameOf, approveOrder, rejectOrder, recordPayment, settleCustomerPayment, setTab, focusOrderId, setFocusOrderId, profile }) {
  const [owner, setOwner] = useState(OWNERS[0]);
  const [filterDate, setFilterDate] = useState(todayStr());
  const [showAll, setShowAll] = useState(false);
  const [customerFilter, setCustomerFilter] = useState("");
  const focusRef = useRef(null);

  useEffect(() => {
    if (focusOrderId) setShowAll(true);
  }, [focusOrderId]);
  useEffect(() => {
    if (focusOrderId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusOrderId, showAll]);

  const visibleOrders = (showAll ? state.orders : state.orders.filter((o) => o.orderDate === filterDate))
    .filter((o) => !customerFilter || o.customerId === customerFilter);
  const isToday = filterDate === todayStr();

  const readyForDispatch = state.orders.filter((o) => o.stage === 1 && !o.tripId && !o.rejected).length;
  const customersWithOrders = state.customers.filter((c) => state.orders.some((o) => o.customerId === c.id));

  return (
    <div className="space-y-4">
      <FlowNav current="orders" setTab={setTab} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {!showAll && (
            <>
              <DateInput value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
              {!isToday && <Btn tone="ghost" onClick={() => setFilterDate(todayStr())}>Today</Btn>}
            </>
          )}
          <Btn tone={showAll ? "flame" : "ghost"} onClick={() => { setShowAll((s) => !s); setFocusOrderId(null); }}>{showAll ? "Showing All Orders" : "Show All Orders"}</Btn>
          <select className={inputCls} value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="">All Customers</option>
            {customersWithOrders.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {customerFilter && <Btn tone="ghost" onClick={() => setCustomerFilter("")}><X size={14} /> Clear</Btn>}
        </div>
        <Btn tone="flame" onClick={() => setTab("neworder")}><Plus size={15} /> New Order</Btn>
      </div>
      {readyForDispatch > 0 && (
        <div className="flex items-center justify-between gap-2 bg-[#22D3B0]/10 border border-[#22D3B0]/30 rounded-lg px-4 py-2.5">
          <span className="text-sm text-[#22D3B0]">{readyForDispatch} order(s) approved and waiting to be grouped into a trip.</span>
          <Btn tone="teal" onClick={() => setTab("dispatch")}>Go to Dispatch <ChevronRight size={14} /></Btn>
        </div>
      )}
      <SettleDuesPanel state={state} nameOf={nameOf} settleCustomerPayment={settleCustomerPayment} />
      {state.orders.length === 0 && <Empty text="No orders placed yet." action={() => setTab("neworder")} actionLabel="Place an order" />}
      {state.orders.length > 0 && visibleOrders.length === 0 && (
        <Empty
          text={customerFilter ? `No orders for ${nameOf.customer(customerFilter)}${showAll ? "" : ` on ${filterDate}`}.` : `No orders dated ${filterDate}.`}
          action={() => { setShowAll(true); setCustomerFilter(""); }}
          actionLabel="Show all orders"
        />
      )}
      {visibleOrders.map((o) => {
        const status = paymentStatusOf(o);
        const statusTone = status === "Paid" ? "good" : status === "Partially Paid" ? "warn" : status === "Awaiting Delivery" ? "muted" : "bad";
        const isFocused = o.id === focusOrderId;
        return (
          <Panel key={o.id} className={`!p-0 ${isFocused ? "!border-[#FF7A45] ring-1 ring-[#FF7A45]/40" : ""}`}>
            <div className="p-5" ref={isFocused ? focusRef : null} onClick={() => isFocused && setFocusOrderId(null)}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-sm text-[#8FA0AC]">{o.id}</span>
                    {o.rejected ? <Badge tone="bad">Rejected</Badge> : <Badge tone={o.stage === 3 ? "good" : "flame"}>{ORDER_STAGES[o.stage]}</Badge>}
                    {!o.rejected && <Badge tone={statusTone}>{status}</Badge>}
                    {o.tripId && <Badge tone="teal">{o.tripId}</Badge>}
                  </div>
                  <div className="font-medium">{nameOf.customer(o.customerId)}</div>
                  <div className="text-[12px] text-[#8FA0AC] font-mono">Order date: {formatDateIST(o.orderDate)} · ₹{o.amount} total</div>
                  <div className="mt-1 space-y-0.5">
                    {o.items.map((it) => (
                      <div key={it.id} className="text-[12px] text-[#8FA0AC] font-mono">
                        {it.qty} × {nameOf.cylType(it.cylinderTypeId)} @ ₹{it.rate} = ₹{it.amount}
                        {it.orderedQty !== undefined && it.orderedQty !== it.qty && <span className="text-[#FFC857]"> (ordered {it.orderedQty})</span>}
                      </div>
                    ))}
                    {(o.emptyPurchases || []).map((p) => (
                      <div key={p.id} className="text-[12px] text-[#22D3B0] font-mono">
                        Bought: {p.qty} × {nameOf.cylType(p.cylinderTypeId)} empty @ ₹{p.price} = ₹{p.amount}
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
                      <Btn tone="teal" onClick={() => approveOrder(o, owner)}><CheckCircle2 size={15} /> Approve</Btn>
                      <Btn tone="danger" onClick={() => rejectOrder(o, owner)}><XCircle size={15} /> Reject</Btn>
                    </div>
                  ) : (
                    <Badge tone="warn">Awaiting owner approval</Badge>
                  )
                )}
                {!o.rejected && o.stage === 1 && !o.tripId && (
                  <Btn tone="ghost" onClick={() => setTab("dispatch")}>Ready for dispatch <ChevronRight size={14} /></Btn>
                )}
              </div>
              <div className="mt-4"><Pipeline stages={ORDER_STAGES} stageIndex={o.stage} rejected={o.rejected} /></div>
              {!o.rejected && o.stage === 3 && <PaymentPanel order={o} recordPayment={recordPayment} />}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

/** shown once an order is delivered — record Cash/Online payments; the remaining Due is computed, not chosen */
function PaymentPanel({ order: o, recordPayment }) {
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState("");
  const paid = totalPaid(o);
  const due = dueOf(o);

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
          <Btn tone="teal" disabled={!amount || Number(amount) <= 0} onClick={() => { recordPayment(o, method, amount); setAmount(""); }}>
            <Wallet size={15} /> Record Payment
          </Btn>
          <Btn tone="ghost" onClick={() => setAmount(String(due))}>Fill full due</Btn>
        </div>
      )}
      {(o.payments || []).length > 0 && (
        <div className="mt-3 space-y-1 text-[11px] font-mono text-[#5C6975]">
          {o.payments.map((p) => (
            <div key={p.id}>· ₹{p.amount} via {p.method} — {formatDateTimeIST(p.ts)} IST</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** one payment covering a customer's dues across several delivered orders — FIFO by order date */
function SettleDuesPanel({ state, nameOf, settleCustomerPayment }) {
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState("Cash");
  const [amount, setAmount] = useState("");

  const dueByCustomer = state.customers
    .map((c) => ({
      c,
      due: state.orders.filter((o) => o.customerId === c.id && !o.rejected && o.stage === 3).reduce((a, o) => a + dueOf(o), 0),
      orderCount: state.orders.filter((o) => o.customerId === c.id && !o.rejected && o.stage === 3 && dueOf(o) > 0).length,
    }))
    .filter((x) => x.due > 0);

  if (dueByCustomer.length === 0) return null;
  const selected = dueByCustomer.find((x) => x.c.id === customerId);

  return (
    <Panel eyebrow="Bulk Settlement" title="Settle Customer Dues"
      right={<span className="text-[11px] text-[#5C6975] font-mono">One payment splits across all their outstanding orders, oldest first</span>}>
      <div className="grid sm:grid-cols-4 gap-3 items-end">
        <Field label="Customer">
          <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select customer with dues</option>
            {dueByCustomer.map(({ c, due, orderCount }) => <option key={c.id} value={c.id}>{c.name} — ₹{due} across {orderCount} order(s)</option>)}
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
        <Btn tone="teal" disabled={!customerId || !amount || Number(amount) <= 0} onClick={() => { settleCustomerPayment(customerId, method, amount); setAmount(""); setCustomerId(""); }} className="justify-center">
          <Wallet size={15} /> Settle
        </Btn>
      </div>
      {selected && <div className="text-[11px] text-[#4B5661] font-mono mt-2">Total outstanding for {selected.c.name}: ₹{selected.due}</div>}
    </Panel>
  );
}

/* ---------- Dispatch (multi-order trips + route optimization) ---------- */
function DispatchTab({ state, update, nameOf, createTrip, tripDepart, tripMarkStopDelivered, setTab, goToOrderPayment, profile }) {
  const isDriver = profile.role === "Driver";
  const pool = state.orders.filter((o) => o.stage === 1 && !o.tripId && !o.rejected);
  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [selected, setSelected] = useState([]);
  const visibleTrips = isDriver ? state.trips.filter((t) => t.driverId === profile.driverId) : state.trips;

  const toggleSel = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const build = () => {
    if (!driverId || !truckId || selected.length === 0) return;
    createTrip(driverId, truckId, selected);
    setSelected([]); setDriverId(""); setTruckId("");
  };

  return (
    <div className="space-y-6">
      <FlowNav current="dispatch" setTab={setTab} />
      {isDriver && (
        <div className="bg-[#171D22] border border-[#262E35] rounded-xl px-5 py-3 text-sm text-[#8FA0AC]">
          Showing your assigned trips only. {!profile.driverId && "Set which driver you are on your Profile page to see them."}
        </div>
      )}
      {!isDriver && (
      <Panel eyebrow="Multi-Order Dispatch" title={`Approved Orders Ready for Trip (${pool.length})`}
        right={<span className="text-[11px] text-[#5C6975] font-mono">One truck/driver can carry several orders in a single trip</span>}>
        {pool.length === 0 ? <Empty text="No approved orders waiting for dispatch." action={() => setTab("orders")} actionLabel="Go approve some orders" /> : (
          <div className="space-y-2 mb-4">
            {pool.map((o) => (
              <label key={o.id} className="flex items-center gap-3 bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-2.5 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleSel(o.id)} className="accent-[#FF7A45]" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{nameOf.customer(o.customerId)}</div>
                  <div className="text-[12px] text-[#8FA0AC] font-mono">{o.id} · {itemsSummary(o, nameOf)}</div>
                </div>
              </label>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="Driver">
            <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Select driver</option>
              {state.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Truck">
            <select className={inputCls} value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">Select truck</option>
              {state.trucks.map((t) => <option key={t.id} value={t.id}>{t.regNo}</option>)}
            </select>
          </Field>
          <Btn tone="flame" disabled={!driverId || !truckId || !selected.length} onClick={build} className="justify-center">
            <Route size={15} /> Create Trip ({selected.length})
          </Btn>
        </div>
      </Panel>
      )}

      {!isDriver && state.trips.some((t) => t.stage === 2) && (
        <div className="flex items-center justify-between gap-2 bg-[#22D3B0]/10 border border-[#22D3B0]/30 rounded-lg px-4 py-2.5">
          <span className="text-sm text-[#22D3B0]">{state.trips.filter((t) => t.stage === 2).length} trip(s) completed. Fill/empty/defect and payments are ready in Reports.</span>
          <Btn tone="teal" onClick={() => setTab("reports-daily")}>View Reports <ChevronRight size={14} /></Btn>
        </div>
      )}

      <div className="space-y-4">
        {visibleTrips.length === 0 && <Empty text={isDriver ? "No trips assigned to you yet." : "No trips created yet."} />}
        {visibleTrips.map((t) => (
          <TripCard key={t.id} trip={t} state={state} nameOf={nameOf} tripDepart={tripDepart} tripMarkStopDelivered={tripMarkStopDelivered} goToOrderPayment={goToOrderPayment} />
        ))}
      </div>
    </div>
  );
}

function TripCard({ trip: t, state, nameOf, tripDepart, tripMarkStopDelivered, goToOrderPayment }) {
  const orders = state.orders.filter((o) => t.orderIds.includes(o.id));
  return (
    <Panel className="!p-0">
      <div className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-sm text-[#8FA0AC]">{t.id}</span>
              <Badge tone={t.stage === 2 ? "good" : "flame"}>{TRIP_STAGES[t.stage]}</Badge>
              <Badge tone="muted">{orders.length} order(s)</Badge>
            </div>
            <div className="font-medium">{nameOf.driver(t.driverId)} · {nameOf.truck(t.truckId)}</div>
          </div>
          <div className="flex gap-2">
            {t.stage === 0 && <Btn tone="flame" onClick={() => tripDepart(t)}><Navigation size={15} /> Fill &amp; Depart (Optimized Route)</Btn>}
          </div>
        </div>

        <div className="mt-4"><Pipeline stages={TRIP_STAGES} stageIndex={t.stage} /></div>

        {t.stage >= 1 && (
          <div className="mt-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-[#5C6975] font-mono mb-1">Optimized Route (nearest-neighbour)</div>
            {t.route.map((stop, i) => (
              <RouteStop key={stop.orderId} stop={stop} seq={i + 1} order={orders.find((o) => o.id === stop.orderId)} nameOf={nameOf} cylinderTypes={state.cylinderTypes}
                onDeliver={(itemResults) => tripMarkStopDelivered(t, stop.orderId, itemResults)}
                onGoToPayment={() => goToOrderPayment(stop.orderId)} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function RouteStop({ stop, seq, order, nameOf, cylinderTypes, onDeliver, onGoToPayment }) {
  const [rows, setRows] = useState(() => (order?.items || []).map((it) => ({ cylinderTypeId: it.cylinderTypeId, orderedQty: it.qty, actualQty: it.qty, empty: 0, defect: 0, buy: 0 })));
  if (!order) return null;
  const updateRow = (idx, field, val) => setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: val } : row)));
  const totalQty = order.items.reduce((a, it) => a + it.qty, 0);
  const priceFor = (cylinderTypeId) => cylinderTypes?.find((c) => c.id === cylinderTypeId)?.emptyPrice || 0;

  const submit = () => onDeliver(rows.map((r) => ({ cylinderTypeId: r.cylinderTypeId, actualQty: Number(r.actualQty) || 0, emptyQty: Number(r.empty) || 0, defectQty: Number(r.defect) || 0, buyQty: Number(r.buy) || 0 })));

  return (
    <div className="bg-[#0F1316] border border-[#262E35] rounded-lg px-4 py-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-[#FF7A45]/15 text-[#FF9A6E] text-[12px] font-mono flex items-center justify-center border border-[#FF7A45]/30">{seq}</div>
          <div>
            <div className="text-sm font-medium">{nameOf.customer(stop.customerId)}</div>
            <div className="text-[11px] text-[#5C6975] font-mono">{order.items.length} item(s), {totalQty} cyl ordered · {stop.distanceKm}km leg · ETA {stop.etaMin} min</div>
          </div>
        </div>
        {stop.delivered && <Badge tone="good">Delivered</Badge>}
      </div>

      <div className="space-y-2">
        {(stop.delivered ? stop.items : order.items).map((it, idx) => {
          const label = nameOf.cylType(it.cylinderTypeId);
          if (stop.delivered) {
            const changed = it.actualQty !== it.orderedQty;
            return (
              <div key={it.cylinderTypeId} className="flex items-center justify-between gap-2 flex-wrap bg-[#171D22] rounded-md px-3 py-2">
                <span className="text-sm">{label} · ordered {it.orderedQty}{changed && <span className="text-[#FFC857]"> → delivered {it.actualQty}</span>}</span>
                <div className="flex gap-2 flex-wrap">
                  <Badge tone="flame">Full: {it.fullQty}</Badge>
                  <Badge tone="teal">Empty: {it.emptyQty}</Badge>
                  <Badge tone="bad">Defect: {it.defectQty}</Badge>
                  {it.buyQty > 0 && <Badge tone="warn">Bought: {it.buyQty}</Badge>}
                </div>
              </div>
            );
          }
          const row = rows[idx] || { actualQty: it.qty, empty: 0, defect: 0, buy: 0 };
          const actualQty = Number(row.actualQty) || 0;
          const liveFull = Math.max(0, actualQty - (Number(row.defect) || 0));
          const shortfall = Math.max(0, liveFull - (Number(row.empty) || 0));
          const price = priceFor(it.cylinderTypeId);
          const diff = actualQty - it.qty;
          return (
            <div key={it.cylinderTypeId} className="bg-[#171D22] rounded-md px-3 py-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm">{label} · ordered {it.qty}</span>
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
                    <input type="number" min="0" max={shortfall} disabled={!price} value={row.buy} onChange={(e) => updateRow(idx, "buy", Math.min(Number(e.target.value) || 0, shortfall))} className={`${inputCls} w-16`} />
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
          <Btn tone="ghost" onClick={onGoToPayment}><Wallet size={15} /> {dueOf(order) > 0 ? "Record Payment" : "View Payment"} <ChevronRight size={14} /></Btn>
        </div>
      )}
    </div>
  );
}

/* ---------- Drivers ---------- */
function DriversTab({ state, update }) {
  const [f, setF] = useState({ name: "", phone: "", license: "" });
  const add = () => {
    if (!f.name.trim()) return;
    update("drivers", (d) => [...d, { id: uid("DRV"), ...f, createdAt: now() }]);
    setF({ name: "", phone: "", license: "" });
  };
  return (
    <div className="grid md:grid-cols-3 gap-6">
      <Panel eyebrow="New" title="Add Driver" className="md:col-span-1 h-fit">
        <div className="space-y-3">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ravi Kumar" /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 90000 00000" /></Field>
          <Field label="License No."><input className={inputCls} value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} placeholder="TS09 2024 00123" /></Field>
          <Btn tone="flame" onClick={add} className="w-full justify-center"><Plus size={15} /> Add Driver</Btn>
        </div>
      </Panel>
      <Panel eyebrow="Roster" title={`Drivers (${state.drivers.length})`} className="md:col-span-2">
        {state.drivers.length === 0 ? <Empty text="No drivers added yet." /> : (
          <div className="space-y-2">
            {state.drivers.map((d) => (
              <Row key={d.id} onDelete={() => update("drivers", (arr) => arr.filter((x) => x.id !== d.id))}>
                <div className="font-medium">{d.name}</div>
                <div className="text-[12px] text-[#8FA0AC] font-mono">{d.phone} · {d.license}</div>
              </Row>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Trucks ---------- */
function TrucksTab({ state, update }) {
  const [f, setF] = useState({ regNo: "", capacity: "", driverId: "" });
  const add = () => {
    if (!f.regNo.trim()) return;
    update("trucks", (t) => [...t, { id: uid("TRK"), ...f, createdAt: now() }]);
    setF({ regNo: "", capacity: "", driverId: "" });
  };
  return (
    <div className="grid md:grid-cols-3 gap-6">
      <Panel eyebrow="New" title="Add Truck" className="md:col-span-1 h-fit">
        <div className="space-y-3">
          <Field label="Registration No."><input className={inputCls} value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} placeholder="TS 09 AB 1234" /></Field>
          <Field label="Capacity (cylinders)"><input type="number" className={inputCls} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} placeholder="60" /></Field>
          <Field label="Default Driver">
            <select className={inputCls} value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
              <option value="">— None —</option>
              {state.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Btn tone="flame" onClick={add} className="w-full justify-center"><Plus size={15} /> Add Truck</Btn>
        </div>
      </Panel>
      <Panel eyebrow="Fleet" title={`Trucks (${state.trucks.length})`} className="md:col-span-2">
        {state.trucks.length === 0 ? <Empty text="No trucks added yet." /> : (
          <div className="space-y-2">
            {state.trucks.map((t) => (
              <Row key={t.id} onDelete={() => update("trucks", (arr) => arr.filter((x) => x.id !== t.id))}>
                <div className="font-medium font-mono">{t.regNo}</div>
                <div className="text-[12px] text-[#8FA0AC]">Cap: {t.capacity || "—"} · Driver: {state.drivers.find((d) => d.id === t.driverId)?.name || "—"}</div>
              </Row>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Cylinders ---------- */
function CylindersTab({ state, update, inventoryByType, nameOf, sendToIOCL, receiveFromIOCL, toggleIOCLPaid, deleteIOCLTransaction, editIOCLTransaction }) {
  const [f, setF] = useState({ name: "", weight: "" });
  const add = () => {
    if (!f.name.trim()) return;
    update("cylinderTypes", (c) => [...c, { id: uid("CYL"), ...f }]);
    setF({ name: "", weight: "" });
  };
  const saveInventory = (cylinderTypeId, full, empty, defective) => {
    update("inventory", (arr) => {
      const existing = arr.find((r) => r.cylinderTypeId === cylinderTypeId);
      const rec = { id: existing?.id || uid("INV"), cylinderTypeId, full, empty, defective, updatedAt: now() };
      return existing ? arr.map((r) => (r.cylinderTypeId === cylinderTypeId ? rec : r)) : [...arr, rec];
    });
  };
  const deleteInventory = (cylinderTypeId) => {
    update("inventory", (arr) => arr.filter((r) => r.cylinderTypeId !== cylinderTypeId));
  };
  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-6">
        <Panel eyebrow="New" title="Add Cylinder Type" className="md:col-span-1 h-fit">
          <div className="space-y-3">
            <Field label="Type Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Commercial" /></Field>
            <Field label="Weight (kg)"><input type="number" className={inputCls} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} placeholder="19" /></Field>
            <Btn tone="flame" onClick={add} className="w-full justify-center"><Plus size={15} /> Add Type</Btn>
          </div>
        </Panel>
        <Panel eyebrow="Catalog" title={`Cylinder Types (${state.cylinderTypes.length})`} className="md:col-span-2">
          {state.cylinderTypes.length === 0 ? <Empty text="No cylinder types yet." /> : (
            <div className="space-y-2">
              {inventoryByType.map((c) => (
                <Row key={c.id} onDelete={() => update("cylinderTypes", (arr) => arr.filter((x) => x.id !== c.id))}>
                  <div className="font-medium">{cylLabel(c)}</div>
                  <div className="flex gap-2 mt-1">
                    <Badge tone="flame">{c.filled} full</Badge>
                    <Badge tone="teal">{c.empty} empty</Badge>
                  </div>
                </Row>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Company Inventory" title="Depot Stock (Full / Empty / Defective)"
        right={<span className="text-[11px] text-[#5C6975] font-mono">Full auto-deducts on trip departure; Empty/Defective auto-credit on delivery. Edit directly only for manual corrections.</span>}>
        {state.cylinderTypes.length === 0 ? (
          <Empty text="No cylinder types yet — add one above first." />
        ) : (
          <div className="space-y-2">
            {state.cylinderTypes.map((ct) => (
              <InventoryStockRow
                key={ct.id}
                ct={ct}
                record={state.inventory.find((r) => r.cylinderTypeId === ct.id)}
                onSave={saveInventory}
                onDelete={deleteInventory}
              />
            ))}
          </div>
        )}
      </Panel>

      <IOCLSupplyPanel state={state} nameOf={nameOf} sendToIOCL={sendToIOCL} receiveFromIOCL={receiveFromIOCL} toggleIOCLPaid={toggleIOCLPaid} deleteIOCLTransaction={deleteIOCLTransaction} editIOCLTransaction={editIOCLTransaction} />
    </div>
  );
}

/** the company's supplier relationship with IOCL: ship empties/defectives out for refill, receive full stock back in,
 * and track what IOCL billed for each batch so there's a running payable balance instead of just a stock number */
function IOCLSupplyPanel({ state, nameOf, sendToIOCL, receiveFromIOCL, toggleIOCLPaid, deleteIOCLTransaction, editIOCLTransaction }) {
  const [sendForm, setSendForm] = useState({ cylinderTypeId: "", emptyQty: "", defectiveQty: "", date: todayStr(), note: "" });
  const [receiveForm, setReceiveForm] = useState({ cylinderTypeId: "", qty: "", vendorId: "", amountBilled: "", date: todayStr(), note: "" });

  const txs = state.ioclTransactions || [];
  const sentTx = txs.filter((t) => t.type === "sent");
  const receivedTx = txs.filter((t) => t.type === "received");
  const totalSent = sentTx.reduce((a, t) => a + t.qty, 0);
  const totalReceived = receivedTx.reduce((a, t) => a + t.qty, 0);
  const totalBilled = receivedTx.reduce((a, t) => a + (t.amountBilled || 0), 0);
  const totalPaidToIOCL = receivedTx.filter((t) => t.paid).reduce((a, t) => a + (t.amountBilled || 0), 0);
  const outstanding = totalBilled - totalPaidToIOCL;

  const doSend = () => {
    if (!sendForm.cylinderTypeId || (!sendForm.emptyQty && !sendForm.defectiveQty)) return;
    sendToIOCL(sendForm);
    setSendForm({ cylinderTypeId: "", emptyQty: "", defectiveQty: "", date: todayStr(), note: "" });
  };
  const doReceive = () => {
    if (!receiveForm.cylinderTypeId || !receiveForm.qty) return;
    receiveFromIOCL(receiveForm);
    setReceiveForm({ cylinderTypeId: "", qty: "", vendorId: "", amountBilled: "", date: todayStr(), note: "" });
  };

  return (
    <Panel eyebrow="Supplier" title="IOCL Supply"
      right={<span className="text-[11px] text-[#5C6975] font-mono">Ship empties/defectives out for refill, receive full stock back, track what's billed</span>}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Stat label="Sent to IOCL (all-time)" value={totalSent} tone="teal" />
        <Stat label="Received from IOCL (all-time)" value={totalReceived} tone="flame" />
        <Stat label="Total Billed by IOCL (₹)" value={totalBilled} tone="warn" />
        <Stat label="Outstanding Payable (₹)" value={outstanding} tone="bad" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border border-[#262E35] bg-[#0F1316] p-4 space-y-3">
          <div className="text-sm font-medium text-[#DDE3E7]">Send Empties/Defectives to IOCL</div>
          <Field label="Cylinder Type">
            <select className={inputCls} value={sendForm.cylinderTypeId} onChange={(e) => setSendForm({ ...sendForm, cylinderTypeId: e.target.value })}>
              <option value="">Select type…</option>
              {state.cylinderTypes.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Empty Qty"><input type="number" min="0" className={inputCls} value={sendForm.emptyQty} onChange={(e) => setSendForm({ ...sendForm, emptyQty: e.target.value })} placeholder="0" /></Field>
            <Field label="Defective Qty"><input type="number" min="0" className={inputCls} value={sendForm.defectiveQty} onChange={(e) => setSendForm({ ...sendForm, defectiveQty: e.target.value })} placeholder="0" /></Field>
          </div>
          <Field label="Date"><DateInput value={sendForm.date} onChange={(e) => setSendForm({ ...sendForm, date: e.target.value })} /></Field>
          <Field label="Note" hint="optional"><input className={inputCls} value={sendForm.note} onChange={(e) => setSendForm({ ...sendForm, note: e.target.value })} placeholder="e.g. truck reg, driver" /></Field>
          <Btn tone="teal" onClick={doSend} className="w-full justify-center"><ArrowRight size={15} /> Send to IOCL</Btn>
        </div>

        <div className="rounded-lg border border-[#262E35] bg-[#0F1316] p-4 space-y-3">
          <div className="text-sm font-medium text-[#DDE3E7]">Receive New Stock from IOCL</div>
          <Field label="Cylinder Type">
            <select className={inputCls} value={receiveForm.cylinderTypeId} onChange={(e) => setReceiveForm({ ...receiveForm, cylinderTypeId: e.target.value })}>
              <option value="">Select type…</option>
              {state.cylinderTypes.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
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
              {state.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Note" hint="optional"><input className={inputCls} value={receiveForm.note} onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })} placeholder="e.g. invoice number" /></Field>
          <Btn tone="flame" onClick={doReceive} className="w-full justify-center"><ArrowRight size={15} className="rotate-180" /> Receive from IOCL</Btn>
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-wide text-[#5C6975] font-mono mb-2">Transaction History</div>
      {txs.length === 0 ? (
        <Empty text="No IOCL transactions logged yet." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#5C6975] font-mono border-b border-[#262E35]">
                <th className="py-2 pr-4">Date / Billed On</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Cylinder Type</th>
                <th className="py-2 pr-4">Qty</th>
                <th className="py-2 pr-4">Vendor</th>
                <th className="py-2 pr-4">Details</th>
                <th className="py-2 pr-4">Amount (₹)</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <IOCLTransactionRow
                  key={t.id}
                  t={t}
                  state={state}
                  nameOf={nameOf}
                  onTogglePaid={() => toggleIOCLPaid(t.id)}
                  onEdit={(updates) => editIOCLTransaction(t.id, updates)}
                  onDelete={() => deleteIOCLTransaction(t.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** one transaction row, switchable into an inline edit form; Delete reverses whatever this transaction did to depot stock */
function IOCLTransactionRow({ t, state, nameOf, onTogglePaid, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    date: t.date,
    emptyQty: t.emptyQty ?? 0,
    defectiveQty: t.defectiveQty ?? 0,
    qty: t.qty,
    vendorId: t.vendorId || "",
    amountBilled: t.amountBilled ?? 0,
    note: t.note || "",
  });

  const save = () => { onEdit(form); setEditing(false); };

  if (!editing) {
    return (
      <tr className="border-b border-[#262E35]/60">
        <td className="py-2 pr-4 font-mono">{formatDateIST(t.date)}</td>
        <td className="py-2 pr-4">{t.type === "sent" ? <Badge tone="teal">Sent</Badge> : <Badge tone="flame">Received</Badge>}</td>
        <td className="py-2 pr-4">{nameOf.cylType(t.cylinderTypeId)}</td>
        <td className="py-2 pr-4 font-mono">{t.qty}</td>
        <td className="py-2 pr-4">{t.type === "received" ? nameOf.vendor(t.vendorId) : "—"}</td>
        <td className="py-2 pr-4 text-[12px] text-[#8FA0AC]">
          {t.type === "sent" ? `${t.emptyQty} empty, ${t.defectiveQty} defective` : (t.note || "—")}
        </td>
        <td className="py-2 pr-4 font-mono">{t.type === "received" ? `₹${t.amountBilled}` : "—"}</td>
        <td className="py-2 pr-4">
          {t.type === "received" ? (
            <Btn tone={t.paid ? "ghost" : "flame"} onClick={onTogglePaid}>
              {t.paid ? `Paid ${formatDateIST(t.paidOn)}` : "Mark Paid"}
            </Btn>
          ) : "—"}
        </td>
        <td className="py-2 pr-4">
          <div className="flex gap-1">
            <button onClick={() => setEditing(true)} className="text-[#5C6975] hover:text-[#FF9A6E] p-1"><Pencil size={14} /></button>
            <button onClick={onDelete} className="text-[#5C6975] hover:text-[#FF5D5D] p-1"><Trash2 size={14} /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-[#262E35]/60 bg-[#0F1316]">
      <td className="py-2 pr-4"><DateInput value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></td>
      <td className="py-2 pr-4">{t.type === "sent" ? <Badge tone="teal">Sent</Badge> : <Badge tone="flame">Received</Badge>}</td>
      <td className="py-2 pr-4">{nameOf.cylType(t.cylinderTypeId)}</td>
      <td className="py-2 pr-4">
        {t.type === "received" ? (
          <input type="number" min="0" className={`${inputCls} w-20`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
        ) : "—"}
      </td>
      <td className="py-2 pr-4">
        {t.type === "received" ? (
          <select className={inputCls} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
            <option value="">—</option>
            {state.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        ) : "—"}
      </td>
      <td className="py-2 pr-4">
        {t.type === "sent" ? (
          <div className="flex gap-1">
            <input type="number" min="0" className={`${inputCls} w-16`} value={form.emptyQty} onChange={(e) => setForm({ ...form, emptyQty: e.target.value })} placeholder="Empty" />
            <input type="number" min="0" className={`${inputCls} w-16`} value={form.defectiveQty} onChange={(e) => setForm({ ...form, defectiveQty: e.target.value })} placeholder="Defective" />
          </div>
        ) : (
          <input className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note" />
        )}
      </td>
      <td className="py-2 pr-4">
        {t.type === "received" ? (
          <input type="number" min="0" className={`${inputCls} w-20`} value={form.amountBilled} onChange={(e) => setForm({ ...form, amountBilled: e.target.value })} />
        ) : "—"}
      </td>
      <td className="py-2 pr-4">—</td>
      <td className="py-2 pr-4">
        <div className="flex gap-1">
          <Btn tone="teal" onClick={save}>Save</Btn>
          <Btn tone="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
        </div>
      </td>
    </tr>
  );
}

/* ---------- Vendors ---------- */
function VendorsTab({ state, update }) {
  const [f, setF] = useState({ name: "", phone: "", address: "" });
  const add = () => {
    if (!f.name.trim()) return;
    update("vendors", (v) => [...v, { id: uid("VEN"), ...f, createdAt: now() }]);
    setF({ name: "", phone: "", address: "" });
  };
  const inUse = (vendorId) => (state.ioclTransactions || []).some((t) => t.vendorId === vendorId);
  return (
    <div className="grid md:grid-cols-3 gap-6">
      <Panel eyebrow="New" title="Add Vendor" className="md:col-span-1 h-fit">
        <div className="space-y-3">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="IOCL, truck mechanic, etc." /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 90000 00000" /></Field>
          <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Plant / office address" /></Field>
          <Btn tone="flame" onClick={add} className="w-full justify-center"><Plus size={15} /> Add Vendor</Btn>
        </div>
      </Panel>
      <Panel eyebrow="Who You Pay" title={`Vendors (${state.vendors.length})`} className="md:col-span-2">
        {state.vendors.length === 0 ? <Empty text="No vendors yet." /> : (
          <div className="space-y-2">
            {state.vendors.map((v) => (
              <Row key={v.id} onDelete={inUse(v.id) ? undefined : () => update("vendors", (arr) => arr.filter((x) => x.id !== v.id))}>
                <div className="font-medium">{v.name}</div>
                <div className="text-[12px] text-[#8FA0AC]">{v.phone || "—"} · {v.address || "—"}</div>
                {inUse(v.id) && <Badge tone="muted">Has billing history — can't delete</Badge>}
              </Row>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Customers ---------- */
function CustomersTab({ state, update, setTab, deliteKitchenImported, runDeliteKitchenImport, nameOf }) {
  const [f, setF] = useState({ name: "", phone: "", address: "", lat: "", lng: "", openingBalance: "", openingEmptiesCylinderTypeId: "", openingEmptiesQty: "" });
  const mrpRows = state.cylinderTypes.map((ct) => ({ ct, value: currentMrp(state.mrpHistory, ct.id, todayStr()) }));

  const add = () => {
    if (!f.name.trim()) return;
    const id = uid("CUS");
    update("customers", (c) => [
      ...c,
      {
        id,
        name: f.name,
        phone: f.phone,
        address: f.address,
        lat: f.lat ? Number(f.lat) : null,
        lng: f.lng ? Number(f.lng) : null,
        openingBalance: f.openingBalance ? Number(f.openingBalance) : 0,
        openingEmptiesCylinderTypeId: f.openingEmptiesQty ? f.openingEmptiesCylinderTypeId || null : null,
        openingEmptiesQty: f.openingEmptiesQty ? Number(f.openingEmptiesQty) : 0,
      },
    ]);
    setF({ name: "", phone: "", address: "", lat: "", lng: "", openingBalance: "", openingEmptiesCylinderTypeId: "", openingEmptiesQty: "" });
  };
  const activeDiscountCount = (customerId) =>
    state.discounts.filter((d) => d.customerId === customerId && d.startDate <= todayStr() && todayStr() <= d.endDate).length;

  return (
    <div className="space-y-6">
      {!deliteKitchenImported && (
        <Panel eyebrow="Data Import" title="Delite Kitchen — Historical Sales (from uploaded PDF)"
          right={<Btn tone="flame" onClick={runDeliteKitchenImport}>Import Data</Btn>}>
          <p className="text-sm text-[#8FA0AC]">
            35 delivery records from 09 Jun to 12 Jul 2026 — cylinders delivered/returned, invoice amounts, and payment dates.
            Creates the customer, imports each day as a completed delivered order, and logs the matching fill/empty events.
          </p>
          <p className="text-[11px] text-[#FFC857] font-mono mt-2">
            Assumption: cylinder type wasn't stated on the sheet — mapped to Xtra Tej (47.5kg) based on the per-unit rate. Payment method assumed Cash (not stated). Tell me if either is wrong.
          </p>
        </Panel>
      )}
      {deliteKitchenImported && (
        <div className="flex items-center gap-2 bg-[#3DD16F]/10 border border-[#3DD16F]/30 rounded-lg px-4 py-2.5">
          <CheckCircle2 size={15} className="text-[#3DD16F]" />
          <span className="text-sm text-[#3DD16F]">Delite Kitchen historical data imported.</span>
        </div>
      )}

      <Panel eyebrow="Company-wide Pricing" title="Current MRP by Cylinder Type"
        right={<Btn tone="ghost" onClick={() => setTab("discounts")}>Manage MRP &amp; Discounts <ChevronRight size={14} /></Btn>}>
        <p className="text-sm text-[#8FA0AC] mb-3">
          MRP is fixed monthly per cylinder type and applies the same to every customer. Individual customer discounts (below) are subtracted from the relevant type's MRP.
        </p>
        {mrpRows.length === 0 ? (
          <p className="text-sm text-[#5C6975]">No cylinder types yet — add one in the Cylinders tab, then set its MRP under Pricing.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mrpRows.map(({ ct, value }) => (
              <Badge key={ct.id} tone={value ? "flame" : "bad"}>{cylLabel(ct)}: {value ? `₹${value}` : "not set"}</Badge>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid md:grid-cols-3 gap-6">
        <Panel eyebrow="New" title="Add Customer" className="md:col-span-1 h-fit">
          <div className="space-y-3">
            <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sri Sai Traders" /></Field>
            <Field label="Phone"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 90000 00000" /></Field>
            <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Hyderabad" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude" hint="Optional"><input className={inputCls} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="17.38" /></Field>
              <Field label="Longitude" hint="Optional"><input className={inputCls} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} placeholder="78.48" /></Field>
            </div>
            <p className="text-[11px] text-[#4B5661]">Leave coordinates blank and route planning will approximate a location automatically.</p>
            <div className="pt-2 border-t border-[#262E35] space-y-3">
              <span className="text-[#8FA0AC] text-[12px] uppercase tracking-wide font-mono">Opening Balances (optional)</span>
              <Field label="Outstanding Balance (₹)" hint="Amount already owed before using this system">
                <input type="number" min="0" className={inputCls} value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} placeholder="0" />
              </Field>
              <Field label="Empties at Customer" hint="Cylinders already with them, not yet returned">
                <div className="flex gap-2">
                  <select className={`${inputCls} flex-1`} value={f.openingEmptiesCylinderTypeId} onChange={(e) => setF({ ...f, openingEmptiesCylinderTypeId: e.target.value })}>
                    <option value="">Cylinder type…</option>
                    {state.cylinderTypes.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
                  </select>
                  <input type="number" min="0" className={`${inputCls} w-20`} value={f.openingEmptiesQty} onChange={(e) => setF({ ...f, openingEmptiesQty: e.target.value })} placeholder="Qty" />
                </div>
              </Field>
            </div>
            <Btn tone="flame" onClick={add} className="w-full justify-center"><Plus size={15} /> Add Customer</Btn>
          </div>
        </Panel>
        <Panel eyebrow="Book" title={`Customers (${state.customers.length})`} className="md:col-span-2">
          {state.customers.length === 0 ? <Empty text="No customers yet." /> : (
            <div className="space-y-2">
              {state.customers.map((c) => (
                <Row key={c.id} onDelete={() => update("customers", (arr) => arr.filter((x) => x.id !== c.id))}>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-[12px] text-[#8FA0AC]">{c.phone} · {c.address}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {activeDiscountCount(c.id) > 0 && <Badge tone="teal">{activeDiscountCount(c.id)} active discount(s)</Badge>}
                    {c.openingBalance > 0 && <Badge tone="warn">Opening due: ₹{c.openingBalance}</Badge>}
                    {c.openingEmptiesQty > 0 && <Badge tone="muted">Opening empties: {c.openingEmptiesQty} × {nameOf.cylType(c.openingEmptiesCylinderTypeId)}</Badge>}
                  </div>
                </Row>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---------- Pricing / Discounts (+ MRP settings) ---------- */
function DiscountsTab({ state, update, nameOf }) {
  const [mrpForm, setMrpForm] = useState({ cylinderTypeId: "", value: "", effectiveFrom: todayStr() });
  const [df, setDf] = useState({ customerId: "", cylinderTypeId: "", amount: "", startDate: todayStr(), endDate: todayStr() });

  const addMrp = () => {
    if (!mrpForm.cylinderTypeId || !mrpForm.value) return;
    update("mrpHistory", (m) => [
      { id: uid("MRP"), cylinderTypeId: mrpForm.cylinderTypeId, value: Number(mrpForm.value), effectiveFrom: mrpForm.effectiveFrom, changedAt: now() },
      ...m,
    ]);
    setMrpForm({ cylinderTypeId: "", value: "", effectiveFrom: todayStr() });
  };
  const addDiscount = () => {
    if (!df.customerId || !df.cylinderTypeId || !df.amount) return;
    update("discounts", (d) => [...d, { id: uid("DSC"), customerId: df.customerId, cylinderTypeId: df.cylinderTypeId, amount: Number(df.amount), startDate: df.startDate, endDate: df.endDate }]);
    setDf({ customerId: "", cylinderTypeId: "", amount: "", startDate: todayStr(), endDate: todayStr() });
  };

  const sortedHistory = [...state.mrpHistory].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

  return (
    <div className="space-y-6">
      <Panel eyebrow="Fixed per cylinder type · same for every customer" title="MRP Rate by Cylinder Type">
        <div className="flex flex-wrap gap-2 mb-4">
          {state.cylinderTypes.map((ct) => {
            const v = currentMrp(state.mrpHistory, ct.id, todayStr());
            return <Badge key={ct.id} tone={v ? "flame" : "bad"}>{cylLabel(ct)}: {v ? `₹${v}` : "not set"}</Badge>;
          })}
          {state.cylinderTypes.length === 0 && <span className="text-sm text-[#5C6975]">Add a cylinder type first.</span>}
        </div>
        <div className="grid sm:grid-cols-4 gap-3 items-end mb-4">
          <Field label="Cylinder Type">
            <select className={inputCls} value={mrpForm.cylinderTypeId} onChange={(e) => setMrpForm({ ...mrpForm, cylinderTypeId: e.target.value })}>
              <option value="">Select type</option>
              {state.cylinderTypes.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
            </select>
          </Field>
          <Field label="New MRP (₹)"><input type="number" className={inputCls} value={mrpForm.value} onChange={(e) => setMrpForm({ ...mrpForm, value: e.target.value })} placeholder="1450" /></Field>
          <Field label="Effective From"><DateInput value={mrpForm.effectiveFrom} onChange={(e) => setMrpForm({ ...mrpForm, effectiveFrom: e.target.value })} /></Field>
          <Btn tone="flame" disabled={!mrpForm.cylinderTypeId || !mrpForm.value} onClick={addMrp} className="justify-center"><Plus size={15} /> Update MRP</Btn>
        </div>
        {sortedHistory.length === 0 ? <Empty text="No MRP set yet — add one above." /> : (
          <div className="space-y-2">
            {sortedHistory.map((h) => (
              <Row key={h.id}>
                <div className="font-mono text-sm">{nameOf.cylType(h.cylinderTypeId)} · ₹{h.value} <span className="text-[#5C6975]">from {formatDateIST(h.effectiveFrom)}</span></div>
                <div className="text-[11px] text-[#4B5661]">changed {formatDateTimeIST(h.changedAt)} IST</div>
              </Row>
            ))}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Fixed per cylinder type · same for every customer" title="Empty Cylinder Purchase Price"
        right={<span className="text-[11px] text-[#5C6975] font-mono">What a customer pays to keep/own an empty cylinder instead of returning it</span>}>
        {state.cylinderTypes.length === 0 ? (
          <p className="text-sm text-[#5C6975]">Add a cylinder type first.</p>
        ) : (
          <div className="space-y-2">
            {state.cylinderTypes.map((ct) => (
              <EmptyPriceRow key={ct.id} ct={ct} update={update} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid md:grid-cols-3 gap-6">
        <Panel eyebrow="Per Customer" title="Add Discount" className="md:col-span-1 h-fit">
          <div className="space-y-3">
            <Field label="Customer">
              <select className={inputCls} value={df.customerId} onChange={(e) => setDf({ ...df, customerId: e.target.value })}>
                <option value="">Select customer</option>
                {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Cylinder Type">
              <select className={inputCls} value={df.cylinderTypeId} onChange={(e) => setDf({ ...df, cylinderTypeId: e.target.value })}>
                <option value="">Select type</option>
                {state.cylinderTypes.map((c) => <option key={c.id} value={c.id}>{cylLabel(c)}</option>)}
              </select>
            </Field>
            <Field label="Discount (₹ off MRP)"><input type="number" className={inputCls} value={df.amount} onChange={(e) => setDf({ ...df, amount: e.target.value })} placeholder="50" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start Date"><DateInput value={df.startDate} onChange={(e) => setDf({ ...df, startDate: e.target.value })} /></Field>
              <Field label="End Date"><DateInput value={df.endDate} onChange={(e) => setDf({ ...df, endDate: e.target.value })} /></Field>
            </div>
            <Btn tone="flame" onClick={addDiscount} className="w-full justify-center"><Plus size={15} /> Save Discount</Btn>
          </div>
        </Panel>
        <Panel eyebrow="Active & Scheduled" title={`Discount Rates (${state.discounts.length})`} className="md:col-span-2">
          {state.discounts.length === 0 ? <Empty text="No discounts set yet." /> : (
            <div className="space-y-2">
              {state.discounts.map((d) => {
                const isActive = d.startDate <= todayStr() && todayStr() <= d.endDate;
                return (
                  <Row key={d.id} onDelete={() => update("discounts", (arr) => arr.filter((x) => x.id !== d.id))}>
                    <div className="font-medium">{nameOf.customer(d.customerId)} <span className="text-[#5C6975]">→</span> {nameOf.cylType(d.cylinderTypeId)}</div>
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

/** one editable row for setting a cylinder type's empty-purchase price */
function EmptyPriceRow({ ct, update }) {
  const [val, setVal] = useState(ct.emptyPrice ?? "");
  useEffect(() => { setVal(ct.emptyPrice ?? ""); }, [ct.emptyPrice]);
  const save = () => {
    if (val === "" || Number(val) < 0) return;
    update("cylinderTypes", (arr) => arr.map((c) => (c.id === ct.id ? { ...c, emptyPrice: Number(val) } : c)));
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

/* ---------- Reports ---------- */
/** Printable invoice for one customer over a date (or date range). Line items are recomputed independently
 * from state rather than reused from the report tables, so the invoice stays correct even if opened later. */
function InvoiceModal({ state, nameOf, customerId, startDate, endDate, periodLabel, onClose }) {
  const customer = state.customers.find((c) => c.id === customerId);
  if (!customer) return null;

  const orders = state.orders.filter((o) => !o.rejected && o.customerId === customerId);
  const deliveredInPeriod = orders.filter((o) => o.history.some((h) => h.stage === "Delivered" && h.ts.slice(0, 10) >= startDate && h.ts.slice(0, 10) <= endDate));

  const lineMap = {};
  deliveredInPeriod.forEach((o) => {
    o.items.forEach((it) => {
      const l = lineMap[it.cylinderTypeId] || { cylinderTypeId: it.cylinderTypeId, qty: 0, amount: 0, rate: it.rate };
      l.qty += it.qty;
      l.amount += it.amount;
      l.rate = it.rate;
      lineMap[it.cylinderTypeId] = l;
    });
  });
  const deliveryLines = Object.values(lineMap);

  const purchaseMap = {};
  orders
    .flatMap((o) => o.emptyPurchases || [])
    .filter((p) => p.date >= startDate && p.date <= endDate)
    .forEach((p) => {
      const l = purchaseMap[p.cylinderTypeId] || { cylinderTypeId: p.cylinderTypeId, qty: 0, amount: 0, price: p.price };
      l.qty += p.qty;
      l.amount += p.amount;
      l.price = p.price;
      purchaseMap[p.cylinderTypeId] = l;
    });
  const purchaseLines = Object.values(purchaseMap);

  const totalAmount = deliveryLines.reduce((a, l) => a + l.amount, 0) + purchaseLines.reduce((a, l) => a + l.amount, 0);
  const payments = orders
    .flatMap((o) => o.payments || [])
    .filter((p) => p.ts.slice(0, 10) >= startDate && p.ts.slice(0, 10) <= endDate)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const totalPaidThisPeriod = payments.reduce((a, p) => a + p.amount, 0);
  const balanceDue = ledgerBalanceAsOf(state, customerId, endDate);
  const invoiceNo = `INV-${customerId.slice(-6).toUpperCase()}-${endDate.replace(/-/g, "")}`;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1900,
        backgroundColor: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflowY: "auto",
        padding: "16px",
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
              <div className="text-xl font-bold tracking-wide text-[#1A1A1A]" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>INVOICE</div>
              <div className="text-[11px] text-[#666] font-mono mt-0.5">{invoiceNo}</div>
              <div className="text-[11px] text-[#666] font-mono">{periodLabel}</div>
            </div>
          </div>

          <div className="mb-5">
            <div className="text-[10px] uppercase tracking-wide text-[#999] font-mono mb-1">Bill To</div>
            <div className="font-semibold text-[#1A1A1A]">{customer.name}</div>
            {customer.address && <div className="text-[13px] text-[#555]">{customer.address}</div>}
            {customer.phone && <div className="text-[13px] text-[#555]">{customer.phone}</div>}
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
              {deliveryLines.map((l) => (
                <tr key={l.cylinderTypeId} className="border-b border-[#F0F0F0]">
                  <td className="py-2">{nameOf.cylType(l.cylinderTypeId)}</td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">{l.rate}</td>
                  <td className="py-2 text-right">{l.amount}</td>
                </tr>
              ))}
              {purchaseLines.map((l) => (
                <tr key={`p-${l.cylinderTypeId}`} className="border-b border-[#F0F0F0]">
                  <td className="py-2">{nameOf.cylType(l.cylinderTypeId)} — Empty Cylinder Purchase</td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">{l.price}</td>
                  <td className="py-2 text-right">{l.amount}</td>
                </tr>
              ))}
              {deliveryLines.length === 0 && purchaseLines.length === 0 && (
                <tr><td colSpan="4" className="py-4 text-center text-[#999]">No delivered orders or purchases in this period.</td></tr>
              )}
            </tbody>
          </table>

          <div className="flex justify-end mb-5">
            <div className="w-56 space-y-1.5 text-[13px]">
              <div className="flex justify-between"><span className="text-[#666]">Total Amount</span><span className="font-semibold">₹{totalAmount}</span></div>
              <div className="flex justify-between"><span className="text-[#666]">Paid This Period</span><span>₹{totalPaidThisPeriod}</span></div>
              <div className="flex justify-between pt-1.5 border-t border-[#E5E5E5]">
                <span className="font-semibold">Balance Due (as of {formatDateIST(endDate)})</span>
                <span className="font-bold">₹{balanceDue}</span>
              </div>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide text-[#999] font-mono mb-1">Payments Received This Period</div>
              {payments.map((p) => (
                <div key={p.id} className="text-[12px] text-[#555] flex justify-between border-b border-[#F5F5F5] py-1">
                  <span>{formatDateTimeIST(p.ts)} IST · {p.method}</span>
                  <span>₹{p.amount}</span>
                </div>
              ))}
            </div>
          )}

          <div className="text-[11px] text-[#999] border-t border-[#E5E5E5] pt-3 mt-4">
            Generated {formatDateTimeIST(now())} IST · Thank you for your business.
          </div>
        </div>
      </div>
    </div>
  );
}


/** one customer's combined ledger: a summary bar (payments/total/due/invoice) that expands to reveal
 * that customer's cylinder-type breakdown underneath — replaces having two separate tables to cross-reference */
function CustomerLedgerGroup({ group, dueLabel, showRate, onInvoice }) {
  const [open, setOpen] = useState(true);
  const { customerName, customerTotalAmount, paid, ledgerBalance, typeRows } = group;
  return (
    <div className="border border-[#262E35] rounded-lg overflow-hidden mb-3 last:mb-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 flex-wrap bg-[#0F1316] hover:bg-white/5 px-4 py-3 text-left transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight size={14} className={`text-[#5C6975] shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="font-medium text-[#E7ECEF] truncate">{customerName}</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-[12px] font-mono">
          <span className="text-[#5C6975]">Total <span className="text-[#FF9A6E] font-semibold">₹{customerTotalAmount || 0}</span></span>
          <span className="text-[#5C6975]">Cash <span className="text-[#DDE3E7]">₹{paid.cash || 0}</span></span>
          <span className="text-[#5C6975]">Online <span className="text-[#DDE3E7]">₹{paid.online || 0}</span></span>
          <span className="text-[#5C6975]">Paid <span className="text-[#22D3B0]">₹{paid.total || 0}</span></span>
          <span className="text-[#5C6975]">{dueLabel} <span className={ledgerBalance > 0 ? "text-[#FF5D5D]" : "text-[#3DD16F]"}>₹{ledgerBalance || 0}</span></span>
          {ledgerBalance > 0 ? <Badge tone="warn">Outstanding</Badge> : <Badge tone="good">Settled</Badge>}
          <Btn tone="ghost" onClick={(e) => { e.stopPropagation(); onInvoice(); }}><Printer size={13} /> Invoice</Btn>
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
              {typeRows.map((tr) => (
                <tr key={tr.cylinderTypeId ?? "none"} className="border-b border-[#262E35]/40 last:border-b-0">
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

function ReportsTab({ state, nameOf, setTab, section = "daily" }) {
  const [date, setDate] = useState(todayStr());
  const [rangeMode, setRangeMode] = useState("7"); // "7" | "30" | "custom"
  const [rangeCustomerFilter, setRangeCustomerFilter] = useState("");
  const [rangeStartInput, setRangeStartInput] = useState(todayStr(new Date(Date.now() - 6 * 86400000)));
  const [rangeEndInput, setRangeEndInput] = useState(todayStr());
  const [invoiceRequest, setInvoiceRequest] = useState(null); // {customerId, startDate, endDate, periodLabel}
  const dayEvents = state.events.filter((e) => e.date === date);
  // "filled" events are logged at delivery using the actual full count handed over (qty already excludes
  // defective units), so no further defect subtraction is needed here — this is what keeps this page in
  // sync with the Full/Empty/Defect badges shown on the Dispatch route stops.

  const byType = {};
  dayEvents.forEach((e) => {
    byType[e.type] = byType[e.type] || { Filled: 0, Empty: 0, Defect: 0 };
    if (e.action === "filled") byType[e.type].Filled += e.qty;
    if (e.action === "empty_return") byType[e.type].Empty += e.qty;
    if (e.action === "defect") byType[e.type].Defect += e.qty;
  });
  const cylinderRows = state.cylinderTypes.map((c) => ({ id: c.id, label: cylLabel(c), ...(byType[c.id] || { Filled: 0, Empty: 0, Defect: 0 }) }));
  const totalFilled = dayEvents.filter((e) => e.action === "filled").reduce((a, e) => a + e.qty, 0);
  const totalEmpty = dayEvents.filter((e) => e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
  const totalDefect = dayEvents.filter((e) => e.action === "defect").reduce((a, e) => a + e.qty, 0);

  // ledger balance as of a given date (defaults to the daily selector): opening balance (carried over from
  // before this system was used) plus remaining due on delivered orders, counting only payments recorded
  // on/before that date — reused by both the daily view and the range section below
  const ledgerAsOf = (customerId, asOfDate = date) => {
    const opening = state.customers.find((c) => c.id === customerId)?.openingBalance || 0;
    return (
      opening +
      state.orders
        .filter((o) => o.customerId === customerId && !o.rejected && o.orderDate <= asOfDate)
        .reduce((a, o) => a + dueOf(o, asOfDate), 0)
    );
  };

  // payments actually recorded ON this date, split by method, across all of a customer's orders
  const paymentsToday = (customerId) => {
    const pays = state.orders
      .filter((o) => o.customerId === customerId)
      .flatMap((o) => o.payments || [])
      .filter((p) => p.ts.slice(0, 10) === date);
    const cash = pays.filter((p) => p.method === "Cash").reduce((a, p) => a + p.amount, 0);
    const online = pays.filter((p) => p.method === "Online").reduce((a, p) => a + p.amount, 0);
    return { cash, online, total: cash + online };
  };

  // orders actually delivered on this date — source of Ordered/Delivered qty and per-type ₹ pricing
  const deliveredToday = state.orders.filter((o) => !o.rejected && o.history.some((h) => h.stage === "Delivered" && h.ts.slice(0, 10) === date));
  const orderAgg = {}; // `${customerId}|${cylinderTypeId}` -> { orderedQty, deliveredQty, rate, amount }
  deliveredToday.forEach((o) => {
    o.items.forEach((it) => {
      const key = `${o.customerId}|${it.cylinderTypeId}`;
      const a = orderAgg[key] || { orderedQty: 0, deliveredQty: 0, rate: it.rate, amount: 0 };
      a.orderedQty += it.orderedQty ?? it.qty;
      a.deliveredQty += it.qty;
      a.rate = it.rate;
      a.amount += it.amount;
      orderAgg[key] = a;
    });
  });

  // breakdown by customer × cylinder type, carrying that customer's payment/ledger figures alongside —
  // so Filled/Empty/Defect/Shortage/Price are all differentiated by cylinder type right in the payments view
  const perCustomerGroups = [];
  state.customers.forEach((c) => {
    const pay = paymentsToday(c.id);
    const ledgerBalance = ledgerAsOf(c.id);
    const typeRows = [];
    state.cylinderTypes.forEach((ct) => {
      const evs = dayEvents.filter((e) => e.customerId === c.id && e.type === ct.id);
      const filled = evs.filter((e) => e.action === "filled").reduce((a, e) => a + e.qty, 0);
      const empty = evs.filter((e) => e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
      const defect = evs.filter((e) => e.action === "defect").reduce((a, e) => a + e.qty, 0);
      const bought = evs.filter((e) => e.action === "empty_purchased").reduce((a, e) => a + e.qty, 0);
      const boughtAmount = state.orders
        .filter((o) => o.customerId === c.id)
        .flatMap((o) => o.emptyPurchases || [])
        .filter((p) => p.cylinderTypeId === ct.id && p.date === date)
        .reduce((a, p) => a + p.amount, 0);
      const agg = orderAgg[`${c.id}|${ct.id}`];
      const openingEmpties = c.openingEmptiesCylinderTypeId === ct.id ? c.openingEmptiesQty || 0 : 0;
      if (filled || empty || defect || bought || agg || openingEmpties) {
        const orderedQty = agg?.orderedQty ?? 0;
        const deliveredQty = agg?.deliveredQty ?? 0;
        const rate = agg?.rate ?? null;
        typeRows.push({
          cylinderTypeId: ct.id,
          cylinderLabel: cylLabel(ct),
          filled,
          empty,
          defect,
          bought,
          boughtAmount,
          orderedQty,
          deliveredQty,
          shortage: filled - empty - bought + openingEmpties, // Full − Empty − Bought, plus any opening balance — positive = customer still holds more full cylinders than empties returned/bought
          rate,
          amount: boughtAmount + filled * (rate || 0), // Bought Amount + Full × Rate — bills only good (non-defective) cylinders, plus any empties purchased outright
        });
      }
    });
    const hasActivity = typeRows.length > 0 || pay.total > 0 || ledgerBalance > 0;
    if (!hasActivity) return;
    if (typeRows.length === 0) typeRows.push({ cylinderTypeId: null, cylinderLabel: "—", filled: 0, empty: 0, defect: 0, bought: 0, boughtAmount: 0, orderedQty: 0, deliveredQty: 0, shortage: 0, rate: null, amount: 0 });
    const customerTotalAmount = typeRows.reduce((a, tr) => a + (tr.amount || 0), 0); // tr.amount already folds in Bought Amount
    perCustomerGroups.push({ customerId: c.id, customerName: c.name, paid: pay, ledgerBalance, customerTotalAmount, typeRows });
  });

  const perCustomer = state.customers.map((c) => {
    const evs = dayEvents.filter((e) => e.customerId === c.id);
    const filled = evs.filter((e) => e.action === "filled").reduce((a, e) => a + e.qty, 0);
    const empty = evs.filter((e) => e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
    const defect = evs.filter((e) => e.action === "defect").reduce((a, e) => a + e.qty, 0);
    return { ...c, filled, empty, defect };
  }).filter((c) => c.filled || c.empty || c.defect);

  const reconFilled = perCustomer.reduce((a, c) => a + c.filled, 0);
  const reconEmpty = perCustomer.reduce((a, c) => a + c.empty, 0);
  const reconDefect = perCustomer.reduce((a, c) => a + c.defect, 0);
  const totalLedger = state.customers.reduce((a, c) => a + ledgerAsOf(c.id), 0);

  // cash physically in a driver's hand today, owed back to the owner — grouped by driver (and whichever truck(s) they ran)
  const collectionByDriver = {};
  state.orders.forEach((o) => {
    if (!o.tripId) return;
    const trip = state.trips.find((t) => t.id === o.tripId);
    if (!trip) return;
    (o.payments || [])
      .filter((p) => p.ts.slice(0, 10) === date)
      .forEach((p) => {
        const key = trip.driverId;
        const c = collectionByDriver[key] || { driverId: trip.driverId, trucks: new Set(), customers: new Set(), cash: 0, online: 0 };
        c.trucks.add(trip.truckId);
        c.customers.add(o.customerId);
        if (p.method === "Cash") c.cash += p.amount;
        if (p.method === "Online") c.online += p.amount;
        collectionByDriver[key] = c;
      });
  });
  const driverCashRows = Object.values(collectionByDriver)
    .map((d) => ({ ...d, truckLabel: [...d.trucks].map((id) => nameOf.truck(id)).join(", "), customerCount: d.customers.size, total: d.cash + d.online }))
    .filter((d) => d.total > 0);
  const totalCashToHandOver = driverCashRows.reduce((a, d) => a + d.cash, 0);

  // --- Customer Orders over a date range (default: last 7 days) ---
  const daysAgoStr = (n) => todayStr(new Date(Date.now() - n * 86400000));
  const rangeStart = rangeMode === "custom" ? rangeStartInput : rangeMode === "30" ? daysAgoStr(29) : daysAgoStr(6);
  const rangeEnd = rangeMode === "custom" ? rangeEndInput : todayStr();
  const matchesRangeCustomer = (customerId) => !rangeCustomerFilter || customerId === rangeCustomerFilter;
  const rangeEvents = state.events.filter((e) => e.date >= rangeStart && e.date <= rangeEnd && matchesRangeCustomer(e.customerId));

  const paymentsInRange = (customerId) => {
    const pays = state.orders
      .filter((o) => o.customerId === customerId)
      .flatMap((o) => o.payments || [])
      .filter((p) => { const d = p.ts.slice(0, 10); return d >= rangeStart && d <= rangeEnd; });
    const cash = pays.filter((p) => p.method === "Cash").reduce((a, p) => a + p.amount, 0);
    const online = pays.filter((p) => p.method === "Online").reduce((a, p) => a + p.amount, 0);
    return { cash, online, total: cash + online };
  };

  const deliveredInRange = state.orders.filter(
    (o) => !o.rejected && matchesRangeCustomer(o.customerId) && o.history.some((h) => h.stage === "Delivered" && h.ts.slice(0, 10) >= rangeStart && h.ts.slice(0, 10) <= rangeEnd)
  );
  const rangeOrderAgg = {}; // `${customerId}|${cylinderTypeId}` -> { orderedQty, deliveredQty, rate, amount }
  deliveredInRange.forEach((o) => {
    o.items.forEach((it) => {
      const key = `${o.customerId}|${it.cylinderTypeId}`;
      const a = rangeOrderAgg[key] || { orderedQty: 0, deliveredQty: 0, rate: it.rate, amount: 0 };
      a.orderedQty += it.orderedQty ?? it.qty;
      a.deliveredQty += it.qty;
      a.rate = it.rate;
      a.amount += it.amount;
      rangeOrderAgg[key] = a;
    });
  });

  const rangeCustomerGroups = [];
  state.customers.filter((c) => matchesRangeCustomer(c.id)).forEach((c) => {
    const pay = paymentsInRange(c.id);
    const ledgerBalance = ledgerAsOf(c.id, rangeEnd);
    const typeRows = [];
    state.cylinderTypes.forEach((ct) => {
      const evs = rangeEvents.filter((e) => e.customerId === c.id && e.type === ct.id);
      const filled = evs.filter((e) => e.action === "filled").reduce((a, e) => a + e.qty, 0);
      const empty = evs.filter((e) => e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
      const defect = evs.filter((e) => e.action === "defect").reduce((a, e) => a + e.qty, 0);
      const bought = evs.filter((e) => e.action === "empty_purchased").reduce((a, e) => a + e.qty, 0);
      const boughtAmount = state.orders
        .filter((o) => o.customerId === c.id)
        .flatMap((o) => o.emptyPurchases || [])
        .filter((p) => p.cylinderTypeId === ct.id && p.date >= rangeStart && p.date <= rangeEnd)
        .reduce((a, p) => a + p.amount, 0);
      const agg = rangeOrderAgg[`${c.id}|${ct.id}`];
      const openingEmpties = c.openingEmptiesCylinderTypeId === ct.id ? c.openingEmptiesQty || 0 : 0;
      if (filled || empty || defect || bought || agg || openingEmpties) {
        const orderedQty = agg?.orderedQty ?? 0;
        const deliveredQty = agg?.deliveredQty ?? 0;
        typeRows.push({
          cylinderTypeId: ct.id,
          cylinderLabel: cylLabel(ct),
          filled, empty, defect, bought, boughtAmount, orderedQty, deliveredQty,
          shortage: filled - empty - bought + openingEmpties,
          amount: boughtAmount + filled * (agg?.rate ?? 0), // Bought Amount + Full × Rate — bills only good (non-defective) cylinders, plus any empties purchased outright
        });
      }
    });
    const hasActivity = typeRows.length > 0 || pay.total > 0 || ledgerBalance > 0;
    if (!hasActivity) return;
    if (typeRows.length === 0) typeRows.push({ cylinderTypeId: null, cylinderLabel: "—", filled: 0, empty: 0, defect: 0, bought: 0, boughtAmount: 0, orderedQty: 0, deliveredQty: 0, shortage: 0, amount: 0 });
    const customerTotalAmount = typeRows.reduce((a, tr) => a + (tr.amount || 0), 0); // tr.amount already folds in Bought Amount
    rangeCustomerGroups.push({ customerId: c.id, customerName: c.name, paid: pay, ledgerBalance, customerTotalAmount, typeRows });
  });

  const rangeOrdersPlaced = state.orders.filter((o) => !o.rejected && matchesRangeCustomer(o.customerId) && o.orderDate >= rangeStart && o.orderDate <= rangeEnd).length;
  const rangeFilled = rangeEvents.filter((e) => e.action === "filled").reduce((a, e) => a + e.qty, 0);
  const rangeEmpty = rangeEvents.filter((e) => e.action === "empty_return").reduce((a, e) => a + e.qty, 0);
  const rangeDefect = rangeEvents.filter((e) => e.action === "defect").reduce((a, e) => a + e.qty, 0);
  const rangeBought = rangeEvents.filter((e) => e.action === "empty_purchased").reduce((a, e) => a + e.qty, 0);
  const rangeOpeningEmpties = state.customers.filter((c) => matchesRangeCustomer(c.id)).reduce((a, c) => a + (c.openingEmptiesQty || 0), 0);
  const rangeEmptiesAtCustomer = rangeFilled - rangeEmpty - rangeBought + rangeOpeningEmpties; // Filled − Empty − Bought, plus any opening balance — cylinders still sitting with the customer (or company-wide if none selected)
  const rangeBoughtAmount = state.orders
    .filter((o) => matchesRangeCustomer(o.customerId))
    .flatMap((o) => o.emptyPurchases || [])
    .filter((p) => p.date >= rangeStart && p.date <= rangeEnd)
    .reduce((a, p) => a + p.amount, 0);
  const rangeAmount = rangeCustomerGroups.reduce((a, g) => a + g.customerTotalAmount, 0); // sum of each row's Bought Amount + Full × Rate — matches the table exactly
  const rangeDeliveryAmount = rangeAmount - rangeBoughtAmount;
  const rangePaid = state.customers.filter((c) => matchesRangeCustomer(c.id)).reduce((a, c) => a + paymentsInRange(c.id).total, 0);
  const rangeOutstanding = state.customers.filter((c) => matchesRangeCustomer(c.id)).reduce((a, c) => a + ledgerAsOf(c.id, rangeEnd), 0);

  const chartData = cylinderRows;

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
      {section === "daily" && (
      <Panel eyebrow="Daily Report" title="Summary">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Cylinders Filled (net of defects)" value={totalFilled} tone="flame" />
          <Stat label="Empties Returned" value={totalEmpty} tone="teal" />
          <Stat label="Defects Logged" value={totalDefect} tone="bad" />
          <Stat label="Outstanding Ledger (₹)" value={totalLedger} tone="warn" />
        </div>
        <div className="text-[11px] text-[#4B5661] font-mono mt-3">
          Reconciliation — sum across customers: {reconFilled} filled · {reconEmpty} empty · {reconDefect} defect (matches company totals above by construction, since every fill/return/defect is logged against a customer). "Filled" already excludes defective units — {totalDefect} defective cylinder(s) found at delivery were logged separately and are not counted as full.
        </div>
      </Panel>
      )}

      {section === "bytype" && (
      <Panel eyebrow="By Cylinder Type" title="Filled (net of defects) / Empty / Defect — company-wide">
        {cylinderRows.every((d) => !d.Filled && !d.Empty && !d.Defect) ? (
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
                  {cylinderRows.map((r) => (
                    <tr key={r.id} className="border-b border-[#262E35]/60">
                      <td className="py-2 pr-4 font-medium">{r.label}</td>
                      <td className="py-2 pr-4 font-mono text-[#FF9A6E]">{r.Filled}</td>
                      <td className="py-2 pr-4 font-mono text-[#22D3B0]">{r.Empty}</td>
                      <td className="py-2 pr-4 font-mono text-[#FF5D5D]">{r.Defect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
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
      )}

      {section === "ledger" && (
      <Panel eyebrow="Per Customer" title="Cylinder Movement &amp; Payments"
        right={<span className="text-[11px] text-[#5C6975] font-mono">Click a customer to expand their cylinder-type breakdown</span>}>
        {perCustomerGroups.length === 0 ? <Empty text="No customer activity for this date." /> : (
          perCustomerGroups.map((g) => (
            <CustomerLedgerGroup
              key={g.customerId}
              group={g}
              dueLabel="Due"
              showRate
              onInvoice={() => setInvoiceRequest({ customerId: g.customerId, startDate: date, endDate: date, periodLabel: formatDateIST(date) })}
            />
          ))
        )}
      </Panel>
      )}

      {section === "cash" && (
      <Panel eyebrow="Cash Collection" title="Driver &amp; Truck Handover to Owner"
        right={<span className="text-[11px] text-[#5C6975] font-mono">Cash collected from customers that a driver must hand over — Online payments settle directly, not via drivers</span>}>
        {driverCashRows.length === 0 ? (
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
                  {driverCashRows.map((d) => (
                    <tr key={d.driverId} className="border-b border-[#262E35]/60">
                      <td className="py-2 pr-4 font-medium">{nameOf.driver(d.driverId)}</td>
                      <td className="py-2 pr-4 font-mono">{d.truckLabel}</td>
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
      )}

      {section === "multiday" && (
      <Panel
        eyebrow="Multi-Day View"
        title={`Customer Orders${rangeCustomerFilter ? ` — ${nameOf.customer(rangeCustomerFilter)}` : ""} — ${formatDateIST(rangeStart)} to ${formatDateIST(rangeEnd)}`}
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
            <select className={inputCls} value={rangeCustomerFilter} onChange={(e) => setRangeCustomerFilter(e.target.value)}>
              <option value="">All Customers</option>
              {state.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {rangeCustomerFilter && <Btn tone="ghost" onClick={() => setRangeCustomerFilter("")}><X size={14} /> Clear</Btn>}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="Orders Placed" value={rangeOrdersPlaced} tone="flame" />
          <Stat label="Cylinders Filled" value={rangeFilled} tone="flame" />
          <Stat label="Empties Returned" value={rangeEmpty} tone="teal" />
          <Stat label={rangeCustomerFilter ? "Empties at Customer" : "Empties at Customers (company-wide)"} value={rangeEmptiesAtCustomer} tone="warn" />
          <Stat label="Defects Logged" value={rangeDefect} tone="bad" />
          <Stat label="Total Amount (₹)" value={rangeAmount} tone="warn" />
          <Stat label="Total Paid (₹)" value={rangePaid} tone="teal" />
          <Stat label="Outstanding as of range end (₹)" value={rangeOutstanding} tone="bad" />
        </div>
        <p className="text-[11px] text-[#4B5661] font-mono -mt-2 mb-4">
          "Empties at Customer" = Cylinders Filled − Empties Returned − Empties Purchased{rangeCustomerFilter ? "" : ", summed across all customers"} — cylinders delivered but not yet collected back or bought outright.
          {" "}"Total Amount" = Delivery (₹{rangeDeliveryAmount}) + Empty Cylinder Purchases (₹{rangeBoughtAmount}) — cylinders delivered at the company MRP/discount rate, plus any empties the customer bought outright at their own price.
        </p>

        {rangeCustomerGroups.length === 0 ? (
          <Empty text={rangeCustomerFilter ? `No order activity for ${nameOf.customer(rangeCustomerFilter)} in this date range.` : "No order activity in this date range."} />
        ) : (
          rangeCustomerGroups.map((g) => (
            <CustomerLedgerGroup
              key={g.customerId}
              group={g}
              dueLabel="Due as of range end"
              showRate={false}
              onInvoice={() => setInvoiceRequest({ customerId: g.customerId, startDate: rangeStart, endDate: rangeEnd, periodLabel: `${formatDateIST(rangeStart)} to ${formatDateIST(rangeEnd)}` })}
            />
          ))
        )}
      </Panel>
      )}

      {invoiceRequest && (
        <InvoiceModal
          state={state}
          nameOf={nameOf}
          customerId={invoiceRequest.customerId}
          startDate={invoiceRequest.startDate}
          endDate={invoiceRequest.endDate}
          periodLabel={invoiceRequest.periodLabel}
          onClose={() => setInvoiceRequest(null)}
        />
      )}
    </div>
  );
}
