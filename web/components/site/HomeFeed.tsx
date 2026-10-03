"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cfetch } from "@/lib/api";
import type { FeedPage } from "@/lib/types";
import { plural } from "@/lib/format";
import FeedRow from "./FeedRow";

export const TABS = [{ id: "all", label: "Everything" }, { id: "thought", label: "Thoughts" }, { id: "blog", label: "Blogs" }] as const;
type TabId = (typeof TABS)[number]["id"];

export function Tabs({ tab, setTab, count, pinned = false }: { tab: TabId; setTab: (t: TabId) => void; count: number | null; pinned?: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    const n = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : -1;
    if (n >= 0) { e.preventDefault(); setTab(TABS[n].id); refs.current[n]?.focus(); }
  }
  return (
    <div className={`tabs ${pinned ? "pinned" : ""}`} role="tablist" aria-label="Filter posts">
      {TABS.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="feed-panel" tabIndex={tab === t.id ? 0 : -1}
          className="tab" onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}
          {tab === t.id && <motion.span layoutId={pinned ? "tab-bar-feed" : "tab-bar"} className="tab-bar" transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }} />}
        </button>
      ))}
      {count !== null && <span className="count" aria-live="polite">{plural(count, "post")}</span>}
    </div>
  );
}

/** Home page feed: tabs filter the list with a fade; shows the first six. */
export default function HomeFeed({ initial }: { initial: FeedPage }) {
  const [tab, setTab] = useState<TabId>("all");
  const [page, setPage] = useState<FeedPage>(initial);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    let live = true;
    cfetch<FeedPage>(`/feed?limit=6${tab === "all" ? "" : `&type=${tab}`}`).then((d) => live && setPage(d)).catch(() => {});
    return () => { live = false; };
  }, [tab]);

  return (
    <div id="feed" tabIndex={-1} style={{ scrollMarginTop: 90 }}>
      <Tabs tab={tab} setTab={setTab} count={page.total} />
      <div id="feed-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="rows" key={tab}>
        {page.items.map((c, i) => <FeedRow key={c.id} c={c} i={i} />)}
        {page.items.length === 0 && <p className="empty">[Nothing here yet.]</p>}
      </div>
      <div className="more"><Link href="/feed" className="btn btn-ghost">See the whole feed</Link></div>
    </div>
  );
}
