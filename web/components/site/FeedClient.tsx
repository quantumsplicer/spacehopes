"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cfetch } from "@/lib/api";
import type { Card, FeedPage } from "@/lib/types";
import { monthKey, monthLabel, monthName } from "@/lib/format";
import { Search, Arrow } from "@/components/Icons";
import FeedRow from "./FeedRow";
import { Tabs } from "./HomeFeed";

type Tab = "all" | "thought" | "blog";
type Topic = { slug: string; name: string; count: number };
type Arch = { month: string; count: number };

export default function FeedClient({ initial, topics, archive, q0 = "", topic0 = "", month0 = "" }: { initial: FeedPage; topics: Topic[]; archive: Arch[]; q0?: string; topic0?: string; month0?: string }) {
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState(q0);
  const [topic, setTopic] = useState(topic0);
  const [month, setMonth] = useState(month0);
  const [items, setItems] = useState<Card[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.next_cursor);
  const [total, setTotal] = useState<number | null>(initial.total);
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  const [now] = useState(() => new Date().toISOString());

  const qs = (cur?: string | null) => {
    const p = new URLSearchParams({ limit: "10" });
    if (tab !== "all") p.set("type", tab);
    if (q.trim()) p.set("q", q.trim());
    if (topic) p.set("topic", topic);
    if (month) p.set("month", month);
    if (cur) p.set("cursor", cur);
    return p.toString();
  };

  useEffect(() => {
    const pristine = first.current && !q0 && !topic0 && !month0 && tab === "all";
    first.current = false;
    if (pristine) return;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await cfetch<FeedPage>(`/feed?${qs()}`);
        if (!live) return;
        setItems(d.items); setCursor(d.next_cursor); setTotal(d.total);
      } catch { /* keep list */ }
      setLoading(false);
    }, q.trim() ? 250 : 0);
    const u = new URL(location.href);
    q.trim() ? u.searchParams.set("q", q.trim()) : u.searchParams.delete("q");
    topic ? u.searchParams.set("topic", topic) : u.searchParams.delete("topic");
    month ? u.searchParams.set("month", month) : u.searchParams.delete("month");
    history.replaceState(null, "", u.toString());
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, topic, month]);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    try { const d = await cfetch<FeedPage>(`/feed?${qs(cursor)}`); setItems((x) => [...x, ...d.items]); setCursor(d.next_cursor); } catch { /* */ }
    setLoading(false);
  }

  const grouped = useMemo(() => {
    if (q.trim()) return [{ key: "", label: "", items }];
    const out: { key: string; label: string; items: Card[] }[] = [];
    for (const c of items) {
      const k = c.published_at ? monthKey(c.published_at) : "";
      const g = out[out.length - 1];
      if (g && g.key === k) g.items.push(c); else out.push({ key: k, label: monthLabel(k, now), items: [c] });
    }
    return out;
  }, [items, q, now]);

  let n = 0;
  return (
    <>
    <section className="container-page" style={{ paddingTop: "clamp(40px, 6vw, 72px)" }}>
      <h1 className="page-h1 rise">Thoughts/<em>Feed</em></h1>
      <p className="page-intro rise" style={{ animationDelay: "120ms" }}>Everything, newest first. Short thoughts read in full here; blogs open on their own page.</p>
      <SearchField value={q} onChange={setQ} />
    </section>
    <div className="container-page home-grid" style={{ marginTop: 40 }}>
      <div className="home-main">
        <Tabs tab={tab} setTab={setTab} count={total} pinned />
        <div id="feed-panel" role="tabpanel" aria-live="polite" className="rows" style={{ opacity: loading && items.length ? 0.6 : 1, transition: "opacity .3s" }}>
          {grouped.map((g) => (
            <div key={g.key || "all"}>
              {g.label && <p className="month">{g.label}</p>}
              {g.items.map((c) => <FeedRow key={c.id} c={c} i={n++} />)}
            </div>
          ))}
          {!items.length && !loading && <p className="empty">{q ? `Nothing found for “${q}”.` : "[Nothing here yet.]"}</p>}
        </div>
        {cursor && <div className="more"><button className="btn btn-ghost" onClick={more} disabled={loading}>{loading ? "Loading…" : "Load older posts"}</button></div>}
      </div>
      <aside className="aside" aria-label="Browse">
        <div>
          <h2 className="side-h">Topics</h2>
          <div className="topics">
            {topics.map((t) => <button key={t.slug} className="chip" aria-pressed={topic === t.slug} onClick={() => setTopic(topic === t.slug ? "" : t.slug)}>{t.name}</button>)}
            {!topics.length && <span style={{ color: "var(--muted)", fontSize: 14 }}>[No topics yet]</span>}
          </div>
        </div>
        <div className="archive">
          <h2 className="side-h">Archive</h2>
          {archive.map((a) => (
            <a key={a.month} href={`/feed?month=${a.month}`} aria-current={month === a.month} onClick={(e) => { e.preventDefault(); setMonth(month === a.month ? "" : a.month); }}>
              <span>{monthName(a.month)}</span><span>{a.count}</span>
            </a>
          ))}
        </div>
        <div className="panel"><h3>Get new posts by email</h3><Link href="/subscribe" className="link-teal" style={{ display: "inline-flex", gap: 8, alignItems: "center", minHeight: 44 }}>Subscribe <Arrow width={16} height={16} /></Link></div>
      </aside>
    </div>
    </>
  );
}

/** The large rounded search field under the page title. */
export function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="search-big">
      <Search width={18} height={18} />
      <label className="sr-only" htmlFor="feed-q">Search thoughts and blogs</label>
      <input id="feed-q" type="search" placeholder="Search thoughts and blogs" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
