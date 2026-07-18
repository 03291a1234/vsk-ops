import React, { createContext, useContext, useEffect, useState } from "react";
import { Bell, ChevronRight, Menu, X } from "lucide-react";
import { AuthProvider, LoginPage, useAuth } from "./auth";
import { ThemeToggle } from "./theme";
import Sidebar, { NAV_ACCESS, navGroupOf } from "./Sidebar";
import { api, tryGet } from "./api";
import { formatDateTimeIST } from "./ui";
import Dashboard from "./tabs/Dashboard";
import NewOrderTab from "./tabs/NewOrder";
import OrdersTab from "./tabs/Orders";
import DispatchTab from "./tabs/Dispatch";
import { CustomersTab, CylindersTab, DriversTab, TrucksTab, VendorsTab } from "./tabs/MasterData";
import PricingTab from "./tabs/Pricing";
import ReportsTab from "./tabs/Reports";
import TeamTab from "./tabs/Team";
import AccountTab from "./tabs/Account";

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

/** shows where the current page sits in the order → approve → dispatch → report pipeline */
export function FlowNav({ current, setTab }) {
  const steps = [
    { id: "neworder", label: "1. New Order" },
    { id: "orders", label: "2. Approve" },
    { id: "dispatch", label: "3. Dispatch & Deliver" },
    { id: "reports-daily", label: "4. Reports", matchPrefix: "reports-" },
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-1">
      {steps.map((s, i) => {
        const active = s.matchPrefix ? current.startsWith(s.matchPrefix) : s.id === current;
        return (
          <React.Fragment key={s.id}>
            <button
              onClick={() => setTab(s.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono border transition ${
                active ? "bg-[#FF7A45]/15 text-[#FF9A6E] border-[#FF7A45]/30" : "bg-transparent text-[var(--c-text-dim)] border-transparent hover:bg-[var(--c-fill)]"
              }`}
            >
              {s.label}
            </button>
            {i < steps.length - 1 && <ChevronRight size={12} className="text-[var(--c-border-hover)]" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function NotifBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    let live = true;
    const poll = () => tryGet("/api/notifications", []).then((n) => live && setNotifications(n || []));
    poll();
    const t = setInterval(poll, 30000); // SignalR push replaces this poll in a later phase
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 rounded-lg hover:bg-[var(--c-fill)] border border-[var(--c-border)]">
        <Bell size={17} className="text-[var(--c-text-muted)]" />
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF7A45] text-[10px] flex items-center justify-center text-[var(--c-page)] font-bold">
            {Math.min(notifications.length, 9)}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl shadow-2xl z-30">
          <div className="px-4 py-3 border-b border-[var(--c-border)] flex items-center justify-between">
            <span className="text-sm font-medium">Notifications</span>
            <button onClick={() => setOpen(false)}><X size={14} className="text-[var(--c-text-dim)]" /></button>
          </div>
          {notifications.length === 0 && <div className="p-4 text-sm text-[var(--c-text-dim)]">No notifications yet.</div>}
          {notifications.map((n) => (
            <div key={n.id} className="px-4 py-2.5 border-b border-[var(--c-divider)] text-sm">
              <div className="text-[10px] font-mono text-[var(--c-text-dim)] uppercase">{n.audience} · {formatDateTimeIST(n.timestamp)} IST</div>
              <div className="text-[var(--c-text-bright)] mt-0.5">{n.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { profile } = useAuth();
  const [tab, setTab] = useState(profile.role === "Driver" ? "dispatch" : "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [openGroups, setOpenGroups] = useState({ masterdata: false, reports: false });
  const [toast, setToast] = useState(null);
  const [focusOrderId, setFocusOrderId] = useState(null);

  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3600);
  };
  const hasAccess = (id) => (NAV_ACCESS[navGroupOf(id)] || []).includes(profile.role);
  const goToOrderPayment = (orderId) => {
    setFocusOrderId(orderId);
    setTab("orders");
  };

  const ctx = { setTab, focusOrderId, setFocusOrderId, goToOrderPayment };

  return (
    <ToastContext.Provider value={notify}>
      <div className="min-h-screen bg-[var(--c-page)] text-[var(--c-text)] flex" style={{ fontFamily: "'Inter',sans-serif" }}>
        {/* Desktop: sticky sidebar. Mobile: hidden — replaced by the drawer below. */}
        <div className="hidden md:block">
          <Sidebar tab={tab} setTab={setTab} open={sidebarOpen} setOpen={setSidebarOpen} openGroups={openGroups} setOpenGroups={setOpenGroups} />
        </div>
        {mobileNav && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNav(false)} />
            <div className="absolute inset-y-0 left-0 shadow-2xl">
              <Sidebar
                tab={tab}
                setTab={(t) => { setTab(t); setMobileNav(false); }}
                open
                setOpen={() => setMobileNav(false)}
                openGroups={openGroups}
                setOpenGroups={setOpenGroups}
              />
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="border-b border-[var(--c-border)] px-4 md:px-6 h-[72px] flex items-center justify-between md:justify-end gap-2 sticky top-0 bg-[var(--c-page)] backdrop-blur z-20">
            <button
              type="button"
              onClick={() => setMobileNav(true)}
              title="Open menu"
              className="md:hidden p-2 rounded-lg hover:bg-[var(--c-fill)] border border-[var(--c-border)] text-[var(--c-text-muted)]"
            >
              <Menu size={17} />
            </button>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <NotifBell />
            </div>
          </div>

          <div className="p-4 md:p-6 max-w-6xl mx-auto w-full space-y-6">
            {tab === "dashboard" && hasAccess("dashboard") && <Dashboard {...ctx} />}
            {tab === "neworder" && hasAccess("neworder") && <NewOrderTab {...ctx} />}
            {tab === "orders" && hasAccess("orders") && <OrdersTab {...ctx} />}
            {tab === "dispatch" && hasAccess("dispatch") && <DispatchTab {...ctx} />}
            {tab === "drivers" && hasAccess("drivers") && <DriversTab {...ctx} />}
            {tab === "trucks" && hasAccess("trucks") && <TrucksTab {...ctx} />}
            {tab === "cylinders" && hasAccess("cylinders") && <CylindersTab {...ctx} />}
            {tab === "vendors" && hasAccess("vendors") && <VendorsTab {...ctx} />}
            {tab === "customers" && hasAccess("customers") && <CustomersTab {...ctx} />}
            {tab === "discounts" && hasAccess("discounts") && <PricingTab {...ctx} />}
            {tab === "team" && hasAccess("team") && <TeamTab {...ctx} />}
            {tab === "account" && <AccountTab {...ctx} />}
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
    </ToastContext.Provider>
  );
}

function Gate() {
  const { profile } = useAuth();
  return profile ? <Shell /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
