import React, { useEffect } from "react";
import {
  BarChart3, Building2, CalendarDays, ChevronDown, ChevronLeft, ClipboardList,
  Database, Flame, Fuel, LogOut, Receipt, Route, ShoppingCart, Tag, Truck, User, Users, Wallet,
} from "lucide-react";
import { useAuth } from "./auth";

/** Same access map as the prototype's NAV_ACCESS — the API enforces it; this just hides dead nav. */
export const NAV_ACCESS = {
  dashboard: ["Owner", "Dispatch", "Accountant"],
  neworder: ["Owner", "Dispatch"],
  orders: ["Owner", "Dispatch", "Accountant"],
  dispatch: ["Owner", "Dispatch", "Driver"],
  masterdata: ["Owner", "Dispatch"],
  discounts: ["Owner", "Accountant"],
  reports: ["Owner", "Dispatch", "Accountant"],
};

export const MASTER_DATA_ITEMS = [
  { id: "drivers", label: "Drivers", icon: User },
  { id: "trucks", label: "Trucks", icon: Truck },
  { id: "cylinders", label: "Cylinders", icon: Fuel },
  { id: "vendors", label: "Vendors", icon: Building2 },
  { id: "customers", label: "Customers", icon: Users },
];
export const REPORT_ITEMS = [
  { id: "reports-daily", label: "Daily Summary", icon: BarChart3 },
  { id: "reports-bytype", label: "By Cylinder Type", icon: Fuel },
  { id: "reports-ledger", label: "Cylinder Movement & Payments", icon: Wallet },
  { id: "reports-cash", label: "Cash Collection", icon: Receipt },
  { id: "reports-multiday", label: "Multi-Day View", icon: CalendarDays },
];

export const navGroupOf = (id) => {
  if (MASTER_DATA_ITEMS.some((i) => i.id === id)) return "masterdata";
  if (id.startsWith("reports-")) return "reports";
  return id;
};

export default function Sidebar({ tab, setTab, open, setOpen, openGroups, setOpenGroups }) {
  const { profile, logout } = useAuth();
  const hasAccess = (id) => (NAV_ACCESS[navGroupOf(id)] || []).includes(profile.role);

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

      <div className="px-3 py-3 border-t border-[#262E35] shrink-0">
        <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#8FA0AC]">
          <User size={16} className="shrink-0" />
          {open && (
            <span className="truncate text-left flex-1">
              <span className="block leading-tight">{profile.name}</span>
              <span className="block text-[10px] text-[#5C6975] font-mono leading-tight">{profile.role}</span>
            </span>
          )}
          {open && (
            <button type="button" onClick={logout} title="Sign out" className="p-1.5 rounded-lg hover:bg-white/5 hover:text-[#DDE3E7]">
              <LogOut size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
