"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { get, post, del } from "@/lib/studio";
import { fmtDate } from "@/lib/format";
import { useStudio } from "@/components/studio/StudioShell";

type P = { id: number; type: string; title: string | null; text: string | null; status: string; updated_at: string; publish_at: string | null; readers: number; waiting: number };
const FILTERS = [["", "All"], ["published", "Published"], ["scheduled", "Scheduled"], ["draft", "Drafts"]] as const;

function List() {
  const router = useRouter();
  const sp = useSearchParams();
  const { me } = useStudio();
  const [status, setStatus] = useState(sp.get("status") ?? "");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<P[] | null>(null);
  useEffect(() => { const t = setTimeout(() => get<P[]>(`/posts?${status ? `status=${status}&` : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`).then(setItems), q ? 250 : 0); return () => clearTimeout(t); }, [status, q]);
  async function create(type: "thought" | "blog") { const p = await post("/posts", { type }); router.push(`/studio/posts/${p.id}`); }
  async function remove(p: P) { if (!confirm("Delete this post for good? Its comments go with it.")) return; await del(`/posts/${p.id}`); setItems((x) => x!.filter((i) => i.id !== p.id)); }
  return (
    <>
      <header className="s-top">
        <h1>Posts</h1>
        <div className="s-actions"><button className="btn btn-ghost" onClick={() => create("thought")}>New thought</button><button className="btn btn-teal" onClick={() => create("blog")}>New blog</button></div>
      </header>
      <div className="tabs-s" role="tablist">{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <div style={{ padding: "16px 40px" }}><label className="sr-only" htmlFor="pq">Search posts</label><input id="pq" className="field pill" style={{ maxWidth: 380 }} placeholder="Search your posts" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {items?.map((p) => (
        <div key={p.id} className="post-row">
          <Link href={`/studio/posts/${p.id}`} className="tt">{p.type === "blog" ? (p.title || "Untitled blog") : <i>{p.text || "Empty thought"}</i>}</Link>
          <small>{p.type === "blog" ? "Blog" : "Thought"}</small>
          <small className="only-desktop">{p.type === "blog" && p.status === "published" ? `${p.readers} readers` : ""}{p.waiting ? ` · ${p.waiting} waiting` : ""}</small>
          <small className="only-desktop">{p.status === "scheduled" ? fmtDate(p.publish_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : fmtDate(p.updated_at)}</small>
          <span className={`stat-chip ${p.status === "draft" ? "draft" : p.status === "scheduled" ? "sched" : ""}`}>{p.status === "published" ? "Published" : p.status === "scheduled" ? "Scheduled" : "Draft"}</span>
          {me.user.role === "owner" && <button className="linkbtn only-desktop" onClick={() => remove(p)}>Delete</button>}
        </div>
      ))}
      {items && !items.length && <p style={{ padding: 40, color: "var(--muted)" }}>Nothing here yet.</p>}
    </>
  );
}
export default function Posts() { return <Suspense fallback={null}><List /></Suspense>; }
