"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { get, post } from "@/lib/studio";
import { fmtDate, plural, timeAgo } from "@/lib/format";
import VisitorsChart, { Spark } from "@/components/studio/VisitorsChart";
import { useStudio } from "@/components/studio/StudioShell";

type Card = { value: number; delta: number | null; spark: number[] };
type Ov = {
  period: string; days: number; start: string; end: string;
  cards: { visitors: Card; readers: Card; read_rate: Card; new_subscribers: Card };
  series: { date: string; visitors: number; readers: number }[];
  attention: { waiting: number; oldest_waiting: string | null; flagged: number; drafts: number; last_draft_edit: string | null; next_scheduled: { id: number; title: string; at: string } | null; scheduled_count: number };
  top_blogs: { rank: number; id: number; title: string; readers: number; comments: number }[];
  activity: { kind: string; text: string; at: string }[];
  recent: { id: number; type: string; title: string; status: string; readers: number }[];
};
const PERIODS = [["today", "Today", "Today, compared with yesterday"], ["30d", "30 days", "Last 30 days, compared with the period before"], ["90d", "90 days", "Last 90 days, compared with the period before"], ["all", "All time", "Since the first visit"]] as const;

function Chg({ v, unit = "%", plain = false }: { v: number | null; unit?: string; plain?: boolean }) {
  if (v === null) return <span className="chg" style={{ color: "var(--muted)" }}>no comparison</span>;
  const up = v >= 0;
  return <span className={`chg ${up ? "" : "down"}`}>{v === 0 ? "–" : up ? "▲" : "▼"} {plain ? Math.abs(v) : `${Math.abs(v)}${unit}`}{unit === " pts" || plain ? "" : ""}</span>;
}

export default function Overview() {
  const router = useRouter();
  const { me } = useStudio();
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("30d");
  const [d, setD] = useState<Ov | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { let live = true; get<Ov>(`/stats/overview?period=${period}`).then((x) => live && setD(x)).catch((e) => live && setErr(e.message)); return () => { live = false; }; }, [period]);

  async function create(type: "thought" | "blog") { const p = await post("/posts", { type }); router.push(`/studio/posts/${p.id}`); }
  const sub = PERIODS.find((p) => p[0] === period)![2];
  const top = d?.top_blogs[0]?.readers || 1;
  const a = d?.attention;

  return (
    <>
      <header className="s-top">
        <div><h1>Overview</h1><p className="sub only-desktop">{sub}</p></div>
        <div className="s-actions only-desktop">
          <div className="seg" role="group" aria-label="Period">
            {PERIODS.map((p) => <button key={p[0]} aria-pressed={period === p[0]} onClick={() => setPeriod(p[0])}>{p[1]}</button>)}
          </div>
          <button className="btn btn-ghost" onClick={() => create("thought")}>New thought</button>
          <button className="btn btn-teal" onClick={() => create("blog")}>New blog</button>
        </div>
        <span className="s-pill only-phone">Studio</span>
      </header>
      <div className="s-body">
        {err && <p className="err" role="alert">{err}</p>}
        {d && (
          <>
            {/* Desktop */}
            <div className="only-desktop">
              <div className="stat-grid">
                <div className="stat tint"><div className="top">Visitors <Chg v={d.cards.visitors.delta} /></div><div className="mid"><span className="num">{d.cards.visitors.value.toLocaleString("en-IN")}</span><Spark values={d.cards.visitors.spark} /></div><p className="def">Times the site was opened. One per browser session.</p></div>
                <div className="stat"><div className="top">Readers <Chg v={d.cards.readers.delta} /></div><div className="mid"><span className="num">{d.cards.readers.value.toLocaleString("en-IN")}</span><Spark values={d.cards.readers.spark} /></div><p className="def">Blog pages opened. Each blog once per browser session.</p></div>
                <div className="stat"><div className="top">Read rate <Chg v={d.cards.read_rate.delta} unit=" pts" /></div><div className="mid"><span className="num">{d.cards.read_rate.value}%</span><Spark values={d.cards.read_rate.spark} /></div><p className="def">Readers divided by visitors: how many visits turn into reading.</p></div>
                <div className="stat"><div className="top">New subscribers <Chg v={d.cards.new_subscribers.delta} plain /></div><div className="mid"><span className="num">{d.cards.new_subscribers.value}</span><Spark values={d.cards.new_subscribers.spark} /></div><p className="def">People who confirmed their email in this period.</p></div>
              </div>
              <div className="grid-2">
                <div className="card"><VisitorsChart data={d.series} /></div>
                <div className="card">
                  <h2>Needs your attention</h2>
                  <div className="attn">
                    <div className="attn-row"><span className="n">{a!.waiting}</span><div className="t"><b>Comments waiting</b><span>{a!.oldest_waiting ? `Oldest from ${timeAgo(a!.oldest_waiting)}` : "All caught up"}</span></div><Link href="/studio/comments">Review</Link></div>
                    <div className="attn-row"><span className="n red">{a!.flagged}</span><div className="t"><b>Flagged comments</b><span>Links or possible abuse</span></div><Link href="/studio/comments">Check</Link></div>
                    <div className="attn-row"><span className="n grey">{a!.drafts}</span><div className="t"><b>Drafts</b><span>{a!.last_draft_edit ? `Last edited ${timeAgo(a!.last_draft_edit)}` : "None yet"}</span></div><Link href="/studio/posts?status=draft">Continue</Link></div>
                    <div className="attn-row"><span className="n blue">{a!.scheduled_count}</span><div className="t"><b>Scheduled</b><span>{a!.next_scheduled ? `${a!.next_scheduled.title}, ${fmtDate(a!.next_scheduled.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Nothing scheduled"}</span></div><Link href={a!.next_scheduled ? `/studio/posts/${a!.next_scheduled.id}` : "/studio/posts?status=scheduled"}>Open</Link></div>
                  </div>
                  <p className="footnote">Counted without cookies or personal data. Bots are filtered out.</p>
                </div>
              </div>
              <div className="grid-2">
                <div className="card">
                  <table className="toplist"><thead><tr><th>#</th><th>Top blogs by readers</th><th style={{ width: "34%" }}>Readers</th><th style={{ textAlign: "right" }}>Comments</th></tr></thead>
                    <tbody>
                      {d.top_blogs.map((b) => (
                        <tr key={b.id}><td className="rank">{b.rank}</td><td className="tt"><Link href={`/studio/posts/${b.id}`}>{b.title}</Link></td>
                          <td><div style={{ display: "flex", alignItems: "center", gap: 12 }}><div className="hbar"><i style={{ width: `${(b.readers / top) * 100}%` }} /></div><b style={{ fontSize: 13 }}>{b.readers}</b></div></td>
                          <td style={{ textAlign: "right", color: "var(--muted)" }}>{b.comments}</td></tr>
                      ))}
                      {!d.top_blogs.length && <tr><td colSpan={4} style={{ color: "var(--muted)", padding: 24 }}>No blog has been read yet in this period.</td></tr>}
                    </tbody></table>
                </div>
                <div className="card">
                  <h2>Latest activity</h2>
                  <ul className="activity">{d.activity.map((e, i) => <li key={i}><i className={`k-${e.kind}`} /><span>{e.text}<small>{timeAgo(e.at)}</small></span></li>)}{!d.activity.length && <li style={{ color: "var(--muted)" }}>Nothing yet.</li>}</ul>
                </div>
              </div>
            </div>
            {/* Phone */}
            <div className="only-phone">
              <div className="stat-grid">
                <div className="stat"><div className="top">Visitors</div><span className="num">{d.cards.visitors.value.toLocaleString("en-IN")}</span><p className="def">Site opens, per session</p></div>
                <div className="stat"><div className="top">Readers</div><span className="num">{d.cards.readers.value.toLocaleString("en-IN")}</span><p className="def">Blog opens, per session</p></div>
              </div>
              <Link href="/studio/comments" className="m-card"><div><div style={{ fontSize: 14, fontWeight: 600 }}>Comments waiting</div><div className="num" style={{ marginTop: 8 }}>{a!.waiting}</div></div><b>Review</b></Link>
              <div style={{ display: "flex", gap: 12 }}>
                <button className="btn btn-ghost btn-lg" style={{ flex: 1 }} onClick={() => create("thought")}>New thought</button>
                <button className="btn btn-ink btn-lg" style={{ flex: 1 }} onClick={() => create("blog")}>New blog</button>
              </div>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: "26px 0 4px" }}>Recent</h2>
              {d.recent.map((r) => (
                <Link key={r.id} href={`/studio/posts/${r.id}`} className="m-recent"><div><div className="tt">{r.title || "Untitled"}</div><small>{r.type === "blog" ? `Blog, ${plural(r.readers, "reader")}` : "Thought"}</small></div><span className={`stat-chip ${r.status === "draft" ? "draft" : r.status === "scheduled" ? "sched" : ""}`}>{r.status === "published" ? "Published" : r.status === "scheduled" ? "Scheduled" : "Draft"}</span></Link>
              ))}
            </div>
          </>
        )}
        {!d && !err && <p style={{ color: "var(--muted)" }} aria-busy>Loading numbers…</p>}
      </div>
    </>
  );
}
