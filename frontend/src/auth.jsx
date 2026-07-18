import React, { createContext, useContext, useState } from "react";
import { Flame } from "lucide-react";
import { api, auth } from "./api";
import { Btn, Field, inputCls, Panel } from "./ui";
import { ThemeToggle } from "./theme";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/**
 * Real login backed by the API's JWT auth — replaces the prototype's "who am I" preference page.
 * The role on the token is enforced server-side; the frontend only uses it to scope navigation.
 */
export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(auth.profile);

  const login = async (email, password) => {
    const res = await api.post("/api/auth/login", { email, password });
    const p = { name: res.name, role: res.role, driverId: res.driverId };
    auth.save(res.token, p);
    setProfile(p);
  };
  const logout = () => {
    auth.clear();
    setProfile(null);
  };

  return <AuthContext.Provider value={{ profile, login, logout }}>{children}</AuthContext.Provider>;
}

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("Owner");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (registerMode) {
        // Bootstrap path: only the very first account can self-register, and the server
        // forces it to Owner regardless of the selection.
        await api.post("/api/auth/register", { name, email, password, role, driverId: null });
      }
      await login(email, password);
    } catch (err) {
      if (registerMode && err.status === 403) {
        setError("The first account already exists — new accounts are created by an Owner from the Team page after they sign in. Ask your Owner to add you.");
      } else if (err.status === 401) {
        setError("Email or password didn't match.");
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--c-page)] flex items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2.5 justify-center mb-2">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#FF7A45] to-[#FFC857] flex items-center justify-center">
            <Flame size={20} className="text-[var(--c-page)]" />
          </div>
          <div>
            <div className="font-semibold tracking-tight text-[var(--c-text)]" style={{ fontFamily: "'Space Grotesk',sans-serif" }}>
              VSK Gas Ops
            </div>
            <div className="text-[9px] text-[var(--c-text-dim)] font-mono uppercase tracking-wide">Cylinder Distribution</div>
          </div>
        </div>
        <Panel eyebrow={registerMode ? "First-time setup" : "Sign in"} title={registerMode ? "Create the first (Owner) account" : "Welcome back"}>
          <form onSubmit={submit} className="space-y-3">
            {registerMode && (
              <>
                <Field label="Your Name">
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SK" />
                </Field>
                <Field label="Role" hint="The very first account always becomes Owner — later accounts are created by an Owner from the Team page">
                  <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
                    {["Owner", "Dispatch", "Accountant", "Driver"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
              </>
            )}
            <Field label="Email">
              <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password">
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {error && <div className="text-[12px] text-[#FF8A8A] bg-[#FF5D5D]/10 border border-[#FF5D5D]/30 rounded-lg px-3 py-2">{error}</div>}
            <Btn tone="flame" type="submit" disabled={busy || !email || !password || (registerMode && !name)} className="w-full justify-center">
              {registerMode ? "Create account & sign in" : "Sign in"}
            </Btn>
          </form>
          <button type="button" onClick={() => setRegisterMode((m) => !m)} className="mt-3 w-full text-[11px] text-[var(--c-text-dim)] hover:text-[var(--c-text-muted)] font-mono text-center">
            {registerMode ? "Already set up? Sign in instead" : "First time here? Create the first Owner account"}
          </button>
        </Panel>
        <p className="text-[11px] text-[var(--c-text-faint)] text-center">
          Additional accounts (Dispatch, Accountant, Driver) are created by an Owner after signing in.
        </p>
      </div>
    </div>
  );
}
