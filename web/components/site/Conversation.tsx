"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cfetch } from "@/lib/api";
import { anonId, turnstileToken } from "@/lib/client";
import type { CommentT } from "@/lib/types";
import { fmtDate, initials, plural } from "@/lib/format";
import { Check } from "@/components/Icons";
import { useSite } from "./SiteProvider";

type Res = { items: CommentT[]; total: number; has_more: boolean };

function Folded({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => { const el = ref.current; if (el) setLong(el.scrollHeight > el.clientHeight + 2); }, [text]);
  return (
    <>
      {/* Plain text only: rendered escaped by React, never as HTML, and never as links */}
      <p ref={ref} className={`txt ${open ? "" : "fold"}`}>{text}</p>
      {long && !open && <button className="link-teal" style={{ fontSize: 13, minHeight: 44 }} onClick={() => setOpen(true)}>Read more</button>}
    </>
  );
}

/** Sign-in step shown only when the owner switched the site to "signed-in readers only". */
function ReaderSignIn({ onDone }: { onDone: (name: string) => void }) {
  const { turnstile_site_key, google_enabled } = useSite();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [code, setCode] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await cfetch("/reader/otp/request", { method: "POST", json: { email, name, turnstile: await turnstileToken(turnstile_site_key) } }); setStep("code"); }
    catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const r = await cfetch<{ name: string }>("/reader/otp/verify", { method: "POST", json: { email, code } }); onDone(r.name); }
    catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }
  return (
    <div className="cform">
      <p style={{ fontSize: 15, marginBottom: 14 }}>Please sign in to join the conversation. Only your name will be shown. Your email is never displayed.</p>
      {google_enabled && <a className="btn btn-ghost" style={{ width: "100%", marginBottom: 14 }} href="/api/v1/reader/google/start">Continue with Google</a>}
      {step === "email" ? (
        <form onSubmit={send}>
          <label className="label" htmlFor="rs-name">Your name</label>
          <input id="rs-name" className="field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="given-name" />
          <label className="label" htmlFor="rs-email" style={{ marginTop: 16 }}>Email, for a one-time code</label>
          <input id="rs-email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <div className="foot"><span>We send one code. No account to remember.</span><button className="btn btn-teal btn-sm" disabled={busy}>Send code</button></div>
        </form>
      ) : (
        <form onSubmit={verify}>
          <label className="label" htmlFor="rs-code">Six-digit code from your email</label>
          <input id="rs-code" className="field" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoComplete="one-time-code" />
          <div className="foot"><button type="button" className="link-teal" onClick={() => setStep("email")}>Use a different email</button><button className="btn btn-teal btn-sm" disabled={busy || code.length !== 6}>Sign in</button></div>
        </form>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

function CommentForm({ postId, parentId, onSent, autoFocus = false, compact = false }: { postId: number; parentId?: number; onSent: (approved: boolean) => void; autoFocus?: boolean; compact?: boolean }) {
  const site = useSite();
  const signedIn = site.comment_mode === "signed_in";
  const [reader, setReader] = useState<string | null | undefined>(signedIn ? undefined : null);
  const [name, setName] = useState(""); const [body, setBody] = useState(""); const [hp, setHp] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState(true);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (signedIn) cfetch<{ name: string | null }>("/reader/me").then((r) => setReader(r.name)).catch(() => setReader(null)); }, [signedIn]);
  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [autoFocus]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setState("busy");
    try {
      const turnstile = await turnstileToken(site.turnstile_site_key);
      const r = await cfetch<{ status: string }>(`/posts/${postId}/comments`, { method: "POST", json: { name, body, parent_id: parentId ?? null, website: hp, turnstile } });
      setMsg(r.status !== "approved");
      setState("sent"); setBody(""); onSent(r.status === "approved");
    } catch (x) { setErr((x as Error).message); setState("idle"); }
  }

  if (signedIn && reader === undefined) return <div className="cform" aria-busy>Loading…</div>;
  if (signedIn && !reader) return <ReaderSignIn onDone={(n) => setReader(n)} />;
  if (state === "sent")
    return (
      <div className="cform sent" role="status">
        <span className="tick"><Check width={20} height={20} /></span>
        <p>{msg ? "Thank you. Your comment is awaiting review. It will show up here once it has been read." : "Thank you. Your comment is now part of the conversation."}</p>
      </div>
    );
  return (
    <form className="cform" onSubmit={submit}>
      {signedIn ? <p style={{ fontSize: 14, marginBottom: 14, color: "var(--ink-2)" }}>Commenting as <b>{reader}</b></p> : (
        <>
          <label className="label" htmlFor={`cn-${parentId ?? 0}`}>Your name</label>
          <input id={`cn-${parentId ?? 0}`} className="field" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="nickname" />
        </>
      )}
      <label className="label" htmlFor={`cb-${parentId ?? 0}`} style={{ marginTop: signedIn ? 0 : 16 }}>Your thoughts</label>
      <textarea id={`cb-${parentId ?? 0}`} ref={ta} className="field" rows={compact ? 3 : 4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required style={{ minHeight: compact ? 84 : 110 }} />
      <div className="hp" aria-hidden><label>Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label></div>
      <div className="foot">
        <span>{signedIn ? "" : "No account needed. "}{site.review_comments ? "Every comment is read before it appears." : "Comments appear straight away."}</span>
        <button className="btn btn-teal btn-sm" disabled={state === "busy"}>{state === "busy" ? "Sending…" : parentId ? "Post reply" : "Post comment"}</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </form>
  );
}

function Item({ c, postId, reply = false, onChanged }: { c: CommentT; postId: number; reply?: boolean; onChanged: () => void }) {
  const [likes, setLikes] = useState(c.likes);
  const [liked, setLiked] = useState(false);
  const [replying, setReplying] = useState(false);
  useEffect(() => { try { setLiked(localStorage.getItem("cl:" + c.id) === "1"); } catch { /* */ } }, [c.id]);
  async function like() {
    try {
      const r = await cfetch<{ likes: number; liked: boolean }>(`/comments/${c.id}/like`, { method: "POST", anon: anonId() });
      setLikes(r.likes); setLiked(r.liked);
      try { r.liked ? localStorage.setItem("cl:" + c.id, "1") : localStorage.removeItem("cl:" + c.id); } catch { /* */ }
    } catch { /* ignore */ }
  }
  return (
    <>
      <div className={`comment ${reply ? "reply" : ""}`}>
        <span className={`avatar ${c.is_author ? "author" : ""}`} aria-hidden>{c.is_author ? "A" : initials(c.name)}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="who">{c.name}{c.is_author && <span className="author-badge">Author</span>}<span className="when">{fmtDate(c.created_at)}</span></div>
          <Folded text={c.body} />
          <div className="acts">
            <button aria-pressed={liked} onClick={like} aria-label={`Like, ${likes}`}>Like, {likes}</button>
            <button onClick={() => setReplying((r) => !r)} aria-expanded={replying}>Reply</button>
          </div>
        </div>
      </div>
      {replying && <div style={{ marginLeft: reply ? 52 : 52, marginBottom: 12 }}><CommentForm postId={postId} parentId={c.id} compact autoFocus onSent={(ok) => { if (ok) onChanged(); }} /></div>}
      {c.replies.map((r) => <Item key={r.id} c={r} postId={postId} reply onChanged={onChanged} />)}
    </>
  );
}

export default function Conversation({ postId, open = true, initialTotal = 0 }: { postId: number; open?: boolean; initialTotal?: number }) {
  const [data, setData] = useState<Res>({ items: [], total: initialTotal, has_more: false });
  const [sort, setSort] = useState<"liked" | "new">("liked");
  const [sheet, setSheet] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: "liked" | "new", offset = 0, append = false) => {
    setLoading(true);
    try {
      const r = await cfetch<Res>(`/posts/${postId}/comments?sort=${s}&offset=${offset}&limit=${offset ? 10 : 5}`);
      setData((d) => (append ? { ...r, items: [...d.items, ...r.items] } : r));
    } catch { /* keep */ }
    setLoading(false);
  }, [postId]);
  useEffect(() => { load(sort); }, [sort, load]);

  return (
    <section className="conversation" aria-labelledby="conv-h" id="conversation">
      <div className="inner">
        <div className="head"><h2 id="conv-h">Conversation</h2><span>{plural(data.total, "comment")}</span></div>
        {open ? (
          <>
            <div className="cform-inline"><CommentForm postId={postId} onSent={(ok) => ok && load(sort)} /></div>
            {sheet && (
              <div className="sheet-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setSheet(false); }} role="presentation">
                <div className="sheet" role="dialog" aria-modal="true" aria-label="Add your thoughts" onKeyDown={(e) => e.key === "Escape" && setSheet(false)}>
                  <div className="grab" aria-hidden />
                  <CommentForm postId={postId} autoFocus onSent={(ok) => ok && load(sort)} />
                  <button className="btn btn-ghost" style={{ width: "100%", marginTop: 12 }} onClick={() => setSheet(false)}>Close</button>
                </div>
              </div>
            )}
          </>
        ) : <p style={{ color: "var(--muted)" }}>Comments are closed on this post.</p>}
        {data.total > 1 && (
          <div className="sortbar" role="group" aria-label="Sort comments">
            <button aria-pressed={sort === "liked"} onClick={() => setSort("liked")}>Most liked</button>
            <button aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button>
          </div>
        )}
        <div style={{ marginTop: 8, borderTop: "1px solid var(--line)" }}>
          {data.items.map((c) => <Item key={c.id} c={c} postId={postId} onChanged={() => load(sort)} />)}
          {!data.items.length && !loading && <p style={{ color: "var(--muted)", padding: "24px 0" }}>No comments yet. Be the first to leave one.</p>}
        </div>
        {data.has_more && <div className="more"><button className="btn btn-ghost" onClick={() => load(sort, data.items.length, true)} disabled={loading}>Show more comments</button></div>}
      </div>
      {open && <button className="addbar" onClick={() => setSheet(true)}>Add your thoughts</button>}
    </section>
  );
}
