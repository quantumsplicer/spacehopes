"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, get, post, setCsrf } from "@/lib/studio";
import { turnstileToken } from "@/lib/client";
import { mmss, useThrottle } from "@/lib/throttle";

export default function Login() {
  const router = useRouter();
  const [name, setName] = useState("Space hopes");
  const [siteKey, setSiteKey] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const th = useThrottle("login");
  const pw = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get("/auth/me").then((m) => { if (m.authenticated) router.replace("/studio"); }).catch(() => {});
    fetch("/api/v1/settings/public").then((r) => r.json()).then((s) => { setName(s.site_name); setSiteKey(s.turnstile_site_key ?? ""); }).catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !th.allow()) return;
    setErr(""); setBusy(true);
    try {
      const turnstile = await turnstileToken(siteKey);
      const r = await post("/auth/login", { login_id: loginId, password, turnstile });
      setCsrf(r.csrf); th.succeeded();
      router.replace("/studio");
    } catch (x) {
      const api = x as ApiError;
      th.failed(api.status === 429 ? Number(api.data?.retry_after ?? 0) : 0);
      setErr(api.status === 429 ? api.message : api.status === 401 ? "Incorrect login ID or password." : "Could not sign in. Please try again.");
      setPassword(""); pw.current?.focus();
    }
    setBusy(false);
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit} noValidate>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="wordmark" style={{ fontSize: 26 }}>{name}</span><span className="s-pill">Studio</span></div>
        <h1>Welcome back.</h1>
        <p>Sign in to write, draw and look after the conversation.</p>
        <label className="label" htmlFor="lid" style={{ marginTop: 24 }}>Login ID</label>
        <input id="lid" className="field" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={64} required autoFocus disabled={busy} />
        <label className="label" htmlFor="pw" style={{ marginTop: 16 }}>Password</label>
        <div style={{ position: "relative" }}>
          <input id="pw" ref={pw} className="field" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={256} required disabled={busy} style={{ paddingRight: 76 }} />
          <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"} style={{ position: "absolute", right: 4, top: 0, minHeight: 44, minWidth: 64, fontSize: 13, color: "var(--teal)", fontWeight: 600 }}>{show ? "Hide" : "Show"}</button>
        </div>
        <button className="btn btn-teal btn-lg" style={{ width: "100%", marginTop: 22 }} disabled={busy || th.locked || !loginId || !password}>
          {busy ? "Signing in…" : th.locked ? `Try again in ${mmss(th.left)}` : "Sign in"}
        </button>
        <div aria-live="polite" role="alert" style={{ minHeight: 24 }}>
          {th.locked && !err.startsWith("Too many") && <p className="err">Too many wrong attempts. Please wait {mmss(th.left)} before trying again.</p>}
          {err && <p className="err">{err}</p>}
        </div>
        <p className="foot">Every sign-in is recorded and you get an email alert.</p>
      </form>
    </main>
  );
}
