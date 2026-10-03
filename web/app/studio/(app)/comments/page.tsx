"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { get, post } from "@/lib/studio";
import { timeAgo, initials } from "@/lib/format";
import { Check } from "@/components/Icons";
import { useStudio } from "@/components/studio/StudioShell";

type C = { id: number; name: string; body: string; status: string; flags: string[]; is_author: boolean; created_at: string; post: { id: number; title: string; type: string; slug: string | null } };
type Counts = { waiting: number; approved: number; hidden: number; spam: number };
const TABS = [["waiting", "Waiting"], ["approved", "Approved"], ["hidden", "Hidden"], ["spam", "Spam"]] as const;
const AV = ["#e3e8fb", "#f8e0d2", "#e0efe3", "#e6e3f3"];

export default function Comments() {
  const { me, refresh } = useStudio();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("waiting");
  const [items, setItems] = useState<C[]>([]);
  const [counts, setCounts] = useState<Counts>({ waiting: 0, approved: 0, hidden: 0, spam: 0 });
  const [mode, setMode] = useState("name");
  const [review, setReview] = useState(true);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  const [replying, setReplying] = useState<number | null>(null);
  const [reply, setReply] = useState("");
  const [menu, setMenu] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const r = await get<{ items: C[]; counts: Counts }>(`/comments?status=${tab}`);
    setItems(r.items); setCounts(r.counts); setLoaded(true);
  }, [tab]);
  useEffect(() => { setLoaded(false); load(); }, [load]);
  useEffect(() => { get("/settings").then((s) => { setMode(s.comment_mode); setReview(s.review_comments); }).catch(() => {}); }, []);

  async function act(id: number, action: "approve" | "hide" | "spam" | "waiting") {
    setLeaving((s) => new Set(s).add(id)); setMenu(null);
    await post("/comments/bulk", { ids: [id], action });
    setTimeout(() => { setItems((x) => x.filter((c) => c.id !== id)); load(); refresh(); }, 380);
  }
  async function block(id: number) {
    if (!confirm("Block this commenter? Their other waiting and approved comments will be hidden, and they cannot comment again.")) return;
    setLeaving((s) => new Set(s).add(id)); setMenu(null);
    await post(`/comments/${id}/block`);
    setTimeout(() => { load(); refresh(); }, 380);
  }
  async function sendReply(id: number) {
    if (!reply.trim()) return;
    await post(`/comments/${id}/reply`, { body: reply });
    setReply(""); setReplying(null); setLeaving((s) => new Set(s).add(id));
    setTimeout(() => { load(); refresh(); }, 380);
  }
  const label = (t: string) => `${TABS.find((x) => x[0] === t)![1]}${counts[t as keyof Counts] ? ` (${counts[t as keyof Counts]})` : ""}`;

  return (
    <>
      <header className="s-top">
        <h1>Comments</h1>
        <p className="sub" style={{ margin: 0 }}>Commenting: {mode === "name" ? "name only" : "signed-in readers"}, {review ? "reviewed first" : "published at once"}. {me.user.role === "owner" && <Link href="/studio/settings" className="link-teal">Change</Link>}</p>
      </header>
      <div className="tabs-s" role="tablist" aria-label="Comment status">
        {TABS.map(([k]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label(k)}</button>)}
      </div>
      <div>
        {items.map((c, i) => (
          <article key={c.id} className={`crow leave ${leaving.has(c.id) ? "out" : ""}`}>
            <span className="av" style={{ background: AV[c.id % 4] }} aria-hidden>{initials(c.name)}</span>
            <div className="main">
              <div className="who"><b>{c.name}</b><span>on</span><Link href={c.post.type === "blog" ? `/p/${c.post.slug}` : `/t/${c.post.id}`} target="_blank">{c.post.title}</Link><span>{timeAgo(c.created_at)}</span></div>
              <p className="txt">{c.body}</p>
              {tab === "waiting" && (c.flags.length ? <span className="stat-chip flag">Flagged: {c.flags.join(", ")}</span> : <span className="stat-chip">Looks fine</span>)}
              {replying === c.id && (
                <div className="reply-box">
                  <label className="sr-only" htmlFor={`r${c.id}`}>Reply as Author</label>
                  <textarea id={`r${c.id}`} className="field" rows={3} placeholder="Reply as Author…" value={reply} onChange={(e) => setReply(e.target.value)} autoFocus />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button className="btn btn-teal btn-sm" onClick={() => sendReply(c.id)}>Post reply</button><button className="btn btn-ghost btn-sm" onClick={() => setReplying(null)}>Cancel</button></div>
                </div>
              )}
            </div>
            <div className="acts">
              {tab !== "approved" && <button className="btn btn-teal btn-sm" onClick={() => act(c.id, "approve")}>Approve</button>}
              <button className="btn btn-ghost btn-sm" onClick={() => { setReplying(replying === c.id ? null : c.id); setReply(""); }}>Reply</button>
              {tab !== "hidden" && <button className="btn btn-ghost btn-sm" onClick={() => act(c.id, "hide")}>Hide</button>}
              {tab === "waiting" && <button className="btn btn-ghost btn-sm only-phone" aria-haspopup="menu" aria-expanded={menu === c.id} onClick={() => setMenu(menu === c.id ? null : c.id)}>…</button>}
              {menu === c.id && <div style={{ width: "100%", display: "flex", gap: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => act(c.id, "spam")}>Mark as spam</button><button className="btn btn-ghost btn-sm" onClick={() => block(c.id)}>Block</button></div>}
              <button className={`linkbtn ${tab === "waiting" ? "only-desktop" : ""}`} onClick={() => block(c.id)}>Block</button>
            </div>
          </article>
        ))}
        {loaded && items.length === 0 && (
          <div className="caught"><span className="tick"><Check width={34} height={34} /></span><h2>{tab === "waiting" ? "All caught up." : `No ${tab} comments.`}</h2>{tab === "waiting" && <p style={{ color: "var(--muted)", marginTop: 8 }}>New comments will wait here for you.</p>}</div>
        )}
      </div>
    </>
  );
}
