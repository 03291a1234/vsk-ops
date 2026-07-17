import React, { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { api, tryGet } from "../api";
import { useToast } from "../App";
import { byId, useLoad } from "../hooks";
import { Badge, Btn, Empty, Field, inputCls, Panel, Row, LoadError } from "../ui";

const ROLES = ["Owner", "Dispatch", "Accountant", "Driver"];
const ROLE_BLURB = {
  Owner: "Full access — approve orders, set pricing, manage the team, everything.",
  Dispatch: "Day-to-day operations — orders, dispatch, deliveries, reports. No pricing changes.",
  Accountant: "Reports, payments, and pricing — no order placement or dispatch.",
  Driver: "Just their own assigned trips — mark deliveries, record payment collected.",
};
const ROLE_TONE = { Owner: "flame", Dispatch: "teal", Accountant: "warn", Driver: "muted" };

/** Owner-only: create and list the staff accounts (the register API requires an Owner token
 *  once the first account exists — this is the screen that uses it). */
export default function TeamTab() {
  const notify = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [users, drivers] = await Promise.all([api.get("/api/auth/users"), tryGet("/api/drivers", [])]);
    return { users, drivers };
  });
  const empty = { name: "", email: "", password: "", role: "Dispatch", driverId: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="text-sm text-[#5C6975] font-mono">Loading team…</div>;
  if (error) return <LoadError error={error} onRetry={reload} />;
  const { users, drivers } = data;
  const driverById = byId(drivers);

  const add = async () => {
    setBusy(true);
    try {
      await api.post("/api/auth/register", {
        name: f.name,
        email: f.email,
        password: f.password,
        role: f.role,
        driverId: f.role === "Driver" && f.driverId ? Number(f.driverId) : null,
      });
      notify(`${f.role} account created for ${f.name}.`);
      setF(empty);
      reload();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid md:grid-cols-3 gap-6">
      <Panel eyebrow="New" title="Add Team Member" className="md:col-span-1 h-fit">
        <div className="space-y-3">
          <Field label="Name">
            <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Samhitha" />
          </Field>
          <Field label="Email">
            <input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="Password" hint="They can't change it themselves yet — pick something you can hand over safely">
            <input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[11px] text-[#4B5661] mt-1">{ROLE_BLURB[f.role]}</p>
          </Field>
          {f.role === "Driver" && (
            <Field label="Which driver record?" hint="Dispatch will show only trips assigned to them">
              <select className={inputCls} value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}>
                <option value="">Select driver…</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          )}
          <Btn tone="flame" disabled={busy || !f.name.trim() || !f.email.trim() || !f.password} onClick={add} className="w-full justify-center">
            <Plus size={15} /> Create Account
          </Btn>
        </div>
      </Panel>

      <Panel eyebrow="Who can sign in" title={`Team (${users.length})`} className="md:col-span-2">
        {users.length === 0 ? <Empty text="No accounts yet." /> : (
          <div className="space-y-2">
            {users.map((u) => (
              <UserRow key={u.id} user={u} driverName={u.driverId ? driverById[u.driverId]?.name ?? u.driverId : null} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/** One account row with an expandable Owner-driven password reset. */
function UserRow({ user: u, driverName }) {
  const notify = useToast();
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      await api.put(`/api/auth/users/${u.id}/password`, { newPassword });
      notify(`Password updated for ${u.name}.`);
      setNewPassword("");
      setResetting(false);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row>
      <div className="font-medium">{u.name}</div>
      <div className="text-[12px] text-[#8FA0AC] font-mono">{u.email}</div>
      <div className="flex gap-2 mt-1 items-center flex-wrap">
        <Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge>
        {driverName && <Badge tone="muted">Driver: {driverName}</Badge>}
        <Btn tone="ghost" onClick={() => { setResetting((r) => !r); setNewPassword(""); }}>
          <KeyRound size={13} /> {resetting ? "Cancel" : "Reset password"}
        </Btn>
      </div>
      {resetting && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="password"
            className={`${inputCls} w-44`}
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Btn tone="teal" disabled={busy || !newPassword} onClick={reset}>Save</Btn>
        </div>
      )}
    </Row>
  );
}
