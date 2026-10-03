"use client";
import Link from "next/link";
import { useState } from "react";
import { cfetch } from "@/lib/api";
import { turnstileToken } from "@/lib/client";
import { Check } from "@/components/Icons";
import { useSite } from "./SiteProvider";

const TOPICS = ["A response to a post", "General message", "Media", "Something else"] as const;

export default function ContactForm() {
  const { turnstile_site_key } = useSite();
  const [f, setF] = useState({ name: "", email: "", topic: TOPICS[0] as string, message: "", consent: false, website: "" });
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setState("busy");
    try {
      await cfetch("/contact", { method: "POST", json: { ...f, turnstile: await turnstileToken(turnstile_site_key) } });
      setState("sent");
    } catch (x) { setErr((x as Error).message); setState("idle"); }
  }

  if (state === "sent")
    return (
      <div className="card-form"><div className="sent-big" role="status"><span className="tick"><Check width={34} height={34} /></span><h2>Received. Thank you.</h2><p style={{ color: "var(--muted)", marginTop: 10 }}>A reply may take a little while.</p></div></div>
    );
  return (
    <form className="card-form" onSubmit={submit}>
      <div className="gap">
        <div className="two">
          <div><label className="label" htmlFor="c-name">Your name</label><input id="c-name" className="field" maxLength={80} required value={f.name} onChange={(e) => set("name", e.target.value)} autoComplete="name" /></div>
          <div><label className="label" htmlFor="c-email">Email</label><input id="c-email" type="email" className="field" required value={f.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" /></div>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">What is this about?</legend>
          <div className="pills" role="group">
            {TOPICS.map((t) => <button type="button" key={t} aria-pressed={f.topic === t} onClick={() => set("topic", t)}>{t}</button>)}
          </div>
        </fieldset>
        <div><label className="label" htmlFor="c-msg">Message</label><textarea id="c-msg" className="field" rows={6} maxLength={4000} minLength={3} required value={f.message} onChange={(e) => set("message", e.target.value)} style={{ minHeight: 150 }} /></div>
        <div className="hp" aria-hidden><label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website", e.target.value)} /></label></div>
        <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} required /><span>My details will be used only to reply to this message. <Link href="/privacy">Privacy notice</Link></span></label>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Protected by an invisible bot check.</span>
          <button className="btn btn-teal btn-lg" disabled={state === "busy" || !f.consent}>{state === "busy" ? "Sending…" : "Send message"}</button>
        </div>
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </form>
  );
}
