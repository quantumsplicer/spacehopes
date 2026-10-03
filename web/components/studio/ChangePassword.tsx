"use client";
import { useState } from "react";
import { ApiError, post, setCsrf } from "@/lib/studio";
import { mmss, useThrottle } from "@/lib/throttle";
import { useStudio } from "./StudioShell";

function strength(p: string) {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const score = (p.length >= 12 ? 1 : 0) + (p.length >= 16 ? 1 : 0) + (kinds >= 3 ? 1 : 0) + (kinds === 4 ? 1 : 0);
  return { score, label: ["Too short", "Weak", "Fair", "Good", "Strong"][p.length < 12 ? 0 : score], ok: p.length >= 12 && kinds >= 3 };
}

/** Change the password (and optionally the login ID). The current password is required and checked on the server. */
export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { me, refresh } = useStudio();
  const [old, setOld] = useState(""); const [next, setNext] = useState(""); const [again, setAgain] = useState("");
  const [login, setLogin] = useState(me.user.login_id);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const th = useThrottle("pw-change");
  const st = strength(next);
  const mismatch = again.length > 0 && again !== next;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !th.allow()) return;
    if (next !== again) { setErr("The two new passwords do not match."); return; }
    setErr(""); setDone(false); setBusy(true);
    try {
      const r = await post("/auth/password", { old_password: old, new_password: next, new_login_id: login !== me.user.login_id ? login : undefined });
      setCsrf(r.csrf); th.succeeded(); setDone(true); setOld(""); setNext(""); setAgain("");
      await refresh();
    } catch (x) {
      const a = x as ApiError;
      if (a.status === 401 || a.status === 429) th.failed(a.status === 429 ? Number(a.data?.retry_after ?? 0) : 0);
      setErr(a.message); setOld("");
    }
    setBusy(false);
  }

  const type = show ? "text" : "password";
  return (
    <form className="card" onSubmit={submit} style={forced ? { borderColor: "var(--flag-fg)" } : undefined} noValidate>
      <h2>Login and password</h2>
      {forced && <p role="alert" className="err" style={{ marginTop: 0, marginBottom: 12 }}>You are still using the starting password. Choose a new one to continue.</p>}
      <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 14 }}>You will be signed out of every other device when you change it.</p>
      <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
        <div><label className="label" htmlFor="cp-login">Login ID</label><input id="cp-login" className="field" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={32} /></div>
        <div><label className="label" htmlFor="cp-old">Current password</label><input id="cp-old" className="field" type={type} value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" required /></div>
        <div>
          <label className="label" htmlFor="cp-new">New password</label>
          <input id="cp-new" className="field" type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required aria-describedby="cp-hint" />
          <div style={{ display: "flex", gap: 4, marginTop: 8 }} aria-hidden>{[0, 1, 2, 3].map((i) => <i key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: next && i < st.score ? (st.score >= 3 ? "var(--teal)" : "#e8a317") : "#ececec" }} />)}</div>
          <p id="cp-hint" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>{next ? `${st.label}. ` : ""}At least 12 characters, with three kinds: lower case, upper case, numbers, symbols. Avoid names and common passwords.</p>
        </div>
        <div><label className="label" htmlFor="cp-again">Repeat the new password</label><input id="cp-again" className="field" type={type} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required aria-invalid={mismatch} />{mismatch && <p className="err">They do not match.</p>}</div>
        <label className="check" style={{ minHeight: 44 }}><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />Show passwords</label>
        <div><button className="btn btn-teal" disabled={busy || th.locked || !old || !st.ok || next !== again}>{busy ? "Saving…" : th.locked ? `Try again in ${mmss(th.left)}` : "Change password"}</button></div>
        <div aria-live="polite" role="status">
          {err && <p className="err" role="alert">{err}</p>}
          {done && <p style={{ color: "var(--teal)", fontSize: 14 }}>Password changed. Other devices were signed out.</p>}
        </div>
      </div>
    </form>
  );
}
