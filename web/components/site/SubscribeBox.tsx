"use client";
import { useState } from "react";
import { cfetch } from "@/lib/api";
import { turnstileToken } from "@/lib/client";
import { Check } from "@/components/Icons";
import { useSite } from "./SiteProvider";

/** Double opt-in: the visitor gets an email and only counts once they confirm. */
export default function SubscribeBox({ heading = "Get new posts by email", bare = false }: { heading?: string; bare?: boolean }) {
  const { turnstile_site_key } = useSite();
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setState("busy");
    try {
      const turnstile = await turnstileToken(turnstile_site_key);
      await cfetch("/subscribe", { method: "POST", json: { email, website: hp, turnstile } });
      setState("done");
    } catch (x) {
      setErr((x as Error).message); setState("idle");
    }
  }

  const body = state === "done" ? (
    <div className="panel-ok" role="status"><span className="tick"><Check width={20} height={20} /></span>Almost there. Check your inbox to confirm.</div>
  ) : (
    <form onSubmit={submit} noValidate>
      <label className="sr-only" htmlFor="sub-email">Email address</label>
      <input id="sub-email" className="field pill" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ minHeight: 48 }} />
      <div className="hp" aria-hidden><label>Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label></div>
      <button className="btn btn-teal" style={{ width: "100%", marginTop: 12, minHeight: 48 }} disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Subscribe"}</button>
      {err && <p className="err" role="alert">{err}</p>}
      <p className="note">One email per new post.</p>
    </form>
  );
  if (bare) return body;
  return <div className="panel"><h3>{heading}</h3>{body}</div>;
}
