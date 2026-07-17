import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { api } from "../api";
import { useToast } from "../App";
import { useAuth } from "../auth";
import { Badge, Btn, Field, inputCls, Panel } from "../ui";

/** Every role's own account page: who am I + self-service password change. */
export default function AccountTab() {
  const notify = useToast();
  const { profile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = confirm && newPassword !== confirm;

  const change = async () => {
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword, newPassword });
      notify("Password changed. Use the new one next time you sign in.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <Panel eyebrow="My Account" title={profile.name}>
        <div className="flex items-center gap-2">
          <Badge tone="flame">{profile.role}</Badge>
          {profile.driverId && <Badge tone="muted">Linked driver #{profile.driverId}</Badge>}
        </div>
      </Panel>

      <Panel eyebrow="Security" title="Change Password">
        <div className="space-y-3">
          <Field label="Current Password">
            <input type="password" className={inputCls} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New Password">
            <input type="password" className={inputCls} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm New Password">
            <input type="password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          {mismatch && <div className="text-[12px] text-[#FF8A8A]">Passwords don't match.</div>}
          <Btn
            tone="flame"
            disabled={busy || !currentPassword || !newPassword || newPassword !== confirm}
            onClick={change}
            className="w-full justify-center"
          >
            <KeyRound size={15} /> Change Password
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
