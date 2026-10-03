"use client";
import { useEffect, useState } from "react";
import { get } from "@/lib/studio";
import { fmtDate } from "@/lib/format";
import { useStudio } from "@/components/studio/StudioShell";

type S = { id: number; email: string; status: string; created_at: string; confirmed_at: string | null };
type M = { id: number; name: string; email: string; topic: string; message: string; created_at: string; is_read: boolean };

export default function Subscribers() {
  const { me } = useStudio();
  const [subs, setSubs] = useState<{ items: S[]; counts: Record<string, number> } | null>(null);
  const [msgs, setMsgs] = useState<M[]>([]);
  const [tab, setTab] = useState<"subs" | "msgs">("subs");
  useEffect(() => { get("/subscribers").then(setSubs); get("/contact-messages").then(setMsgs); }, []);
  async function open(m: M) {
    setMsgs((x) => x.map((i) => (i.id === m.id ? { ...i, is_read: true } : i)));
    const csrf = sessionStorage.getItem("csrf") ?? "";
    fetch(`/api/v1/studio/contact-messages/${m.id}/read`, { method: "POST", headers: { "x-csrf-token": csrf } });
  }
  const unread = msgs.filter((m) => !m.is_read).length;
  return (
    <>
      <header className="s-top">
        <h1>Subscribers</h1>
        {me.user.role === "owner" && <a className="btn btn-ghost" href="/api/v1/studio/subscribers/export.csv">Export confirmed (CSV)</a>}
      </header>
      <div className="tabs-s" role="tablist">
        <button role="tab" aria-selected={tab === "subs"} onClick={() => setTab("subs")}>Subscribers{subs ? ` (${subs.counts.confirmed ?? 0})` : ""}</button>
        <button role="tab" aria-selected={tab === "msgs"} onClick={() => setTab("msgs")}>Messages{unread ? ` (${unread} new)` : ""}</button>
      </div>
      {tab === "subs" && subs && (
        <div>
          <p style={{ padding: "16px 40px", color: "var(--muted)", fontSize: 14 }}>{subs.counts.confirmed ?? 0} confirmed, {subs.counts.pending ?? 0} waiting to confirm, {subs.counts.unsubscribed ?? 0} unsubscribed.</p>
          {subs.items.map((s) => <div key={s.id} className="post-row"><span className="tt" style={{ fontFamily: "var(--font-sans)", fontSize: 15 }}>{s.email}</span><small>{fmtDate(s.confirmed_at ?? s.created_at)}</small><span className={`stat-chip ${s.status === "confirmed" ? "" : "draft"}`}>{s.status}</span></div>)}
        </div>
      )}
      {tab === "msgs" && (
        <div>
          {msgs.map((m) => (
            <details key={m.id} className="post-row" style={{ display: "block", fontWeight: m.is_read ? 400 : 600 }} onToggle={(e) => (e.target as HTMLDetailsElement).open && !m.is_read && open(m)}>
              <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", gap: 16, alignItems: "center" }}><span style={{ flex: 1 }}>{m.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>&lt;{m.email}&gt;</span></span><small>{m.topic}</small><small>{fmtDate(m.created_at)}</small></summary>
              <p style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 400, whiteSpace: "pre-wrap", margin: "10px 0 6px", overflowWrap: "anywhere" }}>{m.message}</p>
            </details>
          ))}
          {!msgs.length && <p style={{ padding: 40, color: "var(--muted)" }}>No messages yet.</p>}
        </div>
      )}
    </>
  );
}
