"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, get, post as apiPost, put, uploadImage } from "@/lib/studio";
import type { Body, MediaT, Node, PostFull } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { largest } from "@/lib/media";
import BlockEditor, { type EditorActions } from "@/components/editor/BlockEditor";
import DrawingStudio from "@/components/drawing/DrawingStudio";
import MediaPicker from "@/components/studio/MediaPicker";
import { LightboxProvider } from "@/components/site/Lightbox";
import { Prose, lightboxItems } from "@/components/site/PostBody";
import { useStudio } from "@/components/studio/StudioShell";

type SP = PostFull & { status: "draft" | "scheduled" | "published"; updated_at: string; publish_at: string | null; cover_media_id: number | null; excerpt_custom: string };
const EMPTY: Body = { type: "doc", content: [] };
const textOf = (n?: Node[]) => (n ?? []).map((x) => x.text ?? (x.type === "hardBreak" ? "\n" : "")).join("");

function pickFiles(multiple: boolean): Promise<File[]> {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = multiple; i.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
    i.onchange = () => res(Array.from(i.files ?? [])); i.addEventListener("cancel", () => res([]));
    i.click();
  });
}

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me } = useStudio();
  const owner = me.user.role === "owner";
  const store = useRef<Record<number, MediaT>>({}).current;

  const [post, setPost] = useState<SP | null>(null);
  const [type, setType] = useState<"thought" | "blog">("thought");
  const [title, setTitle] = useState(""); const [standfirst, setStandfirst] = useState("");
  const [body, setBody] = useState<Body>(EMPTY);
  const [thought, setThought] = useState(""); const [attach, setAttach] = useState<Node[]>([]);
  const [excerpt, setExcerpt] = useState(""); const [topics, setTopics] = useState<string[]>([]); const [topicIn, setTopicIn] = useState("");
  const [allTopics, setAllTopics] = useState<string[]>([]);
  const [comments, setComments] = useState(true); const [cover, setCover] = useState<number | null>(null);
  const [when, setWhen] = useState("");
  const [state, setState] = useState<"saved" | "dirty" | "saving">("saved");
  const [savedAt, setSavedAt] = useState<string>("");
  const [conflict, setConflict] = useState<SP | null>(null);
  const [err, setErr] = useState(""); const [info, setInfo] = useState("");
  const [uploading, setUploading] = useState(0);
  const [drawing, setDrawing] = useState<null | { id: number | null; caption: string; resolve: (m: MediaT | null) => void }>(null);
  const [picker, setPicker] = useState<null | { allow: "image" | "drawing" | "both"; multiple: boolean; max: number; title?: string; resolve: (m: MediaT[]) => void }>(null);
  const [cropper, setCropper] = useState<null | { m: MediaT; resolve: (m: MediaT | null) => void }>(null);
  const [modal, setModal] = useState<null | "schedule" | "versions" | "preview">(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [ready, setReady] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const ver = useRef(0); const savedVer = useRef(0); const saving = useRef(false); const baseRef = useRef("");
  const mark = () => { ver.current++; setState("dirty"); };

  // ---- load
  const hydrate = useCallback((p: SP) => {
    Object.values(p.media).forEach((m) => { store[m.id] = m; });
    setPost(p); baseRef.current = p.updated_at; setType(p.type); setTitle(p.title ?? ""); setStandfirst(p.standfirst ?? "");
    setBody(p.body?.content ? p.body : EMPTY);
    const paras = p.body.content.filter((n) => n.type === "paragraph");
    setThought(paras.length ? textOf(paras[0].content) : "");
    setAttach(p.body.content.filter((n) => n.type === "image" || n.type === "drawing"));
    setExcerpt(p.excerpt_custom ?? ""); setTopics(p.topics.map((t) => t.name)); setComments(p.comments_open); setCover(p.cover_media_id);
    setWhen(p.publish_at && p.status === "scheduled" ? new Date(new Date(p.publish_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
    setSavedAt(new Date(p.updated_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
    setState("saved"); savedVer.current = ver.current;
  }, [store]);
  useEffect(() => { get<SP>(`/posts/${id}`).then((p) => { hydrate(p); setReady(true); }).catch((e) => setErr(e.message)); get<{ name: string }[]>("/topics").then((t) => setAllTopics(t.map((x) => x.name))).catch(() => {}); }, [id, hydrate]);

  // ---- body assembly: a thought is its text plus one drawing or up to four images
  const thoughtBody = useMemo<Body>(() => ({ type: "doc", content: [{ type: "paragraph", content: thought.trim() ? [{ type: "text", text: thought }] : [] }, ...attach] }), [thought, attach]);
  const payload = () => ({
    type, title, standfirst, body: type === "thought" ? thoughtBody : body, excerpt: type === "blog" ? excerpt : undefined,
    cover_media_id: type === "blog" ? cover : undefined, topics, comments_open: comments, base_updated_at: baseRef.current,
  });
  const payloadRef = useRef(payload); payloadRef.current = payload;

  // ---- autosave every 5 seconds, with conflict detection
  const save = useCallback(async (overwrite = false): Promise<boolean> => {
    if (saving.current || !ready) return false;
    saving.current = true; setState("saving"); setErr("");
    const v = ver.current;
    try {
      const { base_updated_at, ...rest } = payloadRef.current();
      const p = await put<SP>(`/posts/${id}`, overwrite ? rest : { ...rest, base_updated_at });
      baseRef.current = p.updated_at; setPost((x) => (x ? { ...x, ...p, media: x.media } : p));
      Object.values(p.media).forEach((m) => { store[m.id] = m; });
      savedVer.current = v; setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
      setState(ver.current === v ? "saved" : "dirty"); setConflict(null);
      saving.current = false; return true;
    } catch (e: any) {
      saving.current = false;
      if (e instanceof ApiError && e.status === 409) setConflict(e.data?.latest);
      else setErr(e.message);
      setState("dirty"); return false;
    }
  }, [id, ready, store]);

  useEffect(() => {
    const t = setInterval(() => { if (ver.current !== savedVer.current && !conflict) save(); }, 5000);
    const vis = () => { if (document.visibilityState === "hidden" && ver.current !== savedVer.current && !conflict) save(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [save, conflict]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (ver.current !== savedVer.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, []);

  // ---- media actions shared by both editors
  const upload = useCallback(async (files: File[]): Promise<MediaT[]> => {
    const out: MediaT[] = []; setErr("");
    setUploading((n) => n + files.length);
    for (const f of files) {
      try { const m = await uploadImage(f); store[m.id] = m; out.push(m); }
      catch (e: any) { setErr(`${f.name}: ${e.message}`); }
      setUploading((n) => n - 1);
    }
    return out;
  }, [store]);

  /** Opens the media library; everything chosen is registered so the editor can show it straight away. */
  const openPicker = useCallback((allow: "image" | "drawing" | "both", multiple: boolean, max: number, title?: string) =>
    new Promise<MediaT[]>((resolve) => setPicker({ allow, multiple, max, title, resolve: (items) => { items.forEach((m) => { store[m.id] = m; }); resolve(items); } })), [store]);

  const actions: EditorActions = useMemo(() => ({
    pickImages: (multiple) => openPicker("image", multiple, 12),
    pickDrawing: async () => (await openPicker("drawing", false, 1))[0] ?? null,
    uploadFiles: upload,
    newDrawing: () => new Promise<MediaT | null>((resolve) => setDrawing({ id: null, caption: "", resolve })),
    editDrawing: (m) => new Promise<MediaT | null>((resolve) => setDrawing({ id: m.id, caption: m.caption, resolve })),
    cropImage: (m) => new Promise<MediaT | null>((resolve) => setCropper({ m, resolve })),
    replaceImage: async () => (await openPicker("image", false, 1, "Choose a replacement picture"))[0] ?? null,
    patchMedia: (mid, p) => { if (store[mid]) store[mid] = { ...store[mid], ...p }; },
  }), [upload, store, openPicker]);

  const finishDrawing = (m: MediaT | null) => { if (m) store[m.id] = m; drawing?.resolve(m); setDrawing(null); if (m) mark(); };

  // ---- thought attachments
  async function addPhotos() {
    const hasDrawing = attach.some((a) => a.type === "drawing");
    if (hasDrawing && !confirm("A thought holds one drawing or up to four photos. Replace the drawing with photos?")) return;
    const room = 4 - (hasDrawing ? 0 : attach.length);
    if (room <= 0) { setInfo("A thought can hold up to four photos. Remove one first."); return; }
    const ms = await openPicker("image", true, room, "Choose photos for this thought"); if (!ms.length) return;
    setAttach((a) => [...(hasDrawing ? [] : a), ...ms.slice(0, room).map((m): Node => ({ type: "image", attrs: { mediaId: m.id, alt: m.alt || "", caption: "", wide: false } }))]); mark();
  }
  async function addSavedDrawing() {
    if (attach.some((a) => a.type === "image") && !confirm("A thought holds one drawing or up to four photos. Replace the photos with a drawing?")) return;
    const [m] = await openPicker("drawing", false, 1, "Choose a saved drawing"); if (!m) return;
    setAttach([{ type: "drawing", attrs: { mediaId: m.id, alt: m.alt || "", caption: m.caption || "", wide: true } }]); mark();
  }
  async function addDrawing() {
    if (attach.some((a) => a.type === "image") && !confirm("A thought holds one drawing or up to four photos. Replace the photos with a drawing?")) return;
    const existing = attach.find((a) => a.type === "drawing");
    const m = await actions.newDrawing(); if (!m) return;
    setAttach([{ type: "drawing", attrs: { mediaId: m.id, alt: existing?.attrs?.alt ?? "", caption: m.caption || "", wide: true } }]); mark();
  }

  // ---- crop (aspect-ratio crop, re-uploaded as a new picture)
  async function applyCrop(m: MediaT, ratio: number | null) {
    if (ratio === null) { cropper?.resolve(null); setCropper(null); return; }
    const img = new Image(); img.crossOrigin = "anonymous"; img.src = largest(m, 2048);
    await img.decode();
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w / h > ratio) w = Math.round(h * ratio); else h = Math.round(w / ratio);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h, 0, 0, w, h);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.92));
    const [n] = await upload([new File([blob], "crop.jpg", { type: "image/jpeg" })]);
    cropper?.resolve(n ?? null); setCropper(null);
  }

  // ---- actions
  const missingAlt = useMemo(() => {
    const nodes = type === "thought" ? attach : body.content;
    let n = 0;
    for (const b of nodes) { if ((b.type === "image" || b.type === "drawing") && !(b.attrs?.alt || "").trim()) n++; if (b.type === "gallery") n += (b.attrs?.items ?? []).filter((i: any) => !(i.alt || "").trim()).length; }
    return n;
  }, [type, attach, body]);

  async function publish() {
    setErr(""); setInfo("");
    if (missingAlt) { setErr(`Add alt text to ${missingAlt} picture${missingAlt === 1 ? "" : "s"} first. It is read aloud to people who cannot see them.`); return; }
    if (!(await save()) && ver.current !== savedVer.current) return;
    try { const p = await apiPost<SP>(`/posts/${id}/publish`); hydrate({ ...p, media: { ...(post?.media ?? {}), ...p.media } }); setInfo("Published."); }
    catch (e: any) { setErr(e.message); }
  }
  async function unpublish() { if (!confirm("Take this post off the site and make it a draft again?")) return; const p = await apiPost<SP>(`/posts/${id}/unpublish`); hydrate(p); }
  async function schedule() {
    setErr("");
    if (!when) { setErr("Pick a date and time."); return; }
    if (missingAlt) { setErr("Add alt text to every picture first."); return; }
    await save();
    try { const p = await apiPost<SP>(`/posts/${id}/schedule`, { publish_at: new Date(when).toISOString() }); hydrate(p); setModal(null); setInfo(`Scheduled for ${fmtDate(p.publish_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`); }
    catch (e: any) { setErr(e.message); }
  }
  async function switchType(t: "thought" | "blog") {
    if (t === type || post?.status !== "draft") return;
    if (t === "thought") {
      const paras = body.content.filter((n) => n.type === "paragraph");
      const lost = body.content.length > 1 + attach.length;
      if (lost && !confirm("A thought is one to four sentences with a drawing or photos. Only your first paragraph and first picture will be kept. Continue?")) return;
      setThought(paras.length ? textOf(paras[0].content) : ""); const pics = body.content.filter((n) => n.type === "image" || n.type === "drawing");
      setAttach(pics.some((p) => p.type === "drawing") ? pics.filter((p) => p.type === "drawing").slice(0, 1) : pics.slice(0, 4));
    } else { setBody(thoughtBody); setEditorKey((k) => k + 1); }
    setType(t); mark();
  }
  async function openVersions() { setVersions(await get(`/posts/${id}/versions`)); setModal("versions"); }
  async function restore(vid: number) { const p = await apiPost<SP>(`/posts/${id}/versions/${vid}/restore`); hydrate(p); setEditorKey((k) => k + 1); setModal(null); }
  async function takeLatest() { if (conflict) { hydrate(conflict); setEditorKey((k) => k + 1); setConflict(null); } }

  const addTopic = (t: string) => { t = t.trim(); if (t && !topics.includes(t) && topics.length < 12) { setTopics([...topics, t]); mark(); } setTopicIn(""); };
  const images = Object.values(store).filter((m) => m.kind === "image" && (type === "blog" ? JSON.stringify(body).includes(`"mediaId":${m.id}`) || m.id === cover : true));
  const coverM = cover ? store[cover] : null;
  const statusLabel = post?.status === "published" ? "Published" : post?.status === "scheduled" ? `Scheduled, ${fmtDate(post.publish_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Draft";

  if (!post) return <p style={{ padding: 40, color: "var(--muted)" }} aria-busy>{err || "Opening…"}</p>;
  const canPublish = owner;
  const mediaStr: Record<string, MediaT> = Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v]));

  return (
    <>
      <div className="ed-top">
        <div className="saved" role="status" aria-live="polite">
          <span className={state === "saving" ? "dot" : ""} style={state !== "saving" ? { width: 8, height: 8, borderRadius: "50%", background: state === "dirty" ? "#e8a317" : "var(--teal)", display: "inline-block" } : undefined} aria-hidden />
          {statusLabel === "Draft" ? (state === "saving" ? "Saving…" : state === "dirty" ? "Draft, unsaved changes" : `Draft, saved ${savedAt}`) : `${statusLabel}${state === "dirty" ? ", unsaved changes" : ""}`}
        </div>
        <div className="seg" role="group" aria-label="Post type">
          <button aria-pressed={type === "thought"} onClick={() => switchType("thought")} disabled={post.status !== "draft"}>Thought</button>
          <button aria-pressed={type === "blog"} onClick={() => switchType("blog")} disabled={post.status !== "draft"}>Blog</button>
        </div>
        <div className="s-actions">
          <button className="btn btn-ghost only-desktop" onClick={() => setModal("preview")}>Preview</button>
          {canPublish && post.status !== "published" && <button className="btn btn-ghost only-desktop" onClick={() => setModal("schedule")}>Schedule</button>}
          {canPublish ? <button className="btn btn-teal" onClick={post.status === "published" ? async () => { await save(); setInfo("Changes saved."); } : publish}>{post.status === "published" ? "Update" : "Publish"}</button>
            : <button className="btn btn-teal" onClick={() => save()}>Save draft</button>}
        </div>
      </div>
      {(err || info || conflict || uploading > 0) && (
        <div style={{ padding: "10px 32px" }}>
          {uploading > 0 && <p role="status" style={{ color: "var(--muted)", fontSize: 14 }}>Uploading {uploading} picture{uploading === 1 ? "" : "s"}…</p>}
          {err && <p className="err" role="alert" style={{ margin: 0 }}>{err}</p>}
          {info && <p role="status" style={{ color: "var(--teal)", fontSize: 14, margin: 0 }}>{info} {post.status === "published" && <Link className="link-teal" href={type === "blog" ? `/p/${post.slug}` : `/t/${post.id}`} target="_blank">View on the site</Link>}</p>}
          {conflict && <div className="footnote" role="alert" style={{ background: "var(--flag-bg)", color: "var(--flag-fg)" }}>This post was changed somewhere else (another tab or device). <button className="link-teal" onClick={takeLatest}>Load the latest version</button> or <button className="link-teal" onClick={() => save(true)}>keep what is on this screen</button>.</div>}
        </div>
      )}

      <div className="ed-grid">
        <div className="ed-main"><div className="ed-col">
          {type === "blog" ? (
            <>
              <textarea className="ed-title" rows={2} placeholder="Title" aria-label="Title" value={title} maxLength={240} onChange={(e) => { setTitle(e.target.value); mark(); }} />
              <input className="ed-stand" placeholder="A one-line standfirst" aria-label="Standfirst" value={standfirst} maxLength={500} onChange={(e) => { setStandfirst(e.target.value); mark(); }} />
              <BlockEditor key={editorKey} initial={body} media={store} actions={actions} onChange={(b) => { setBody(b); mark(); }} />
              <div className="dropzone" onDragOver={(e) => e.preventDefault()}>Drag pictures here, paste them, or <u onClick={async () => { const f = await pickFiles(true); if (f.length) { const ms = await upload(f); if (ms.length) { setBody((b) => ({ ...b, content: [...b.content, ...(ms.length === 1 ? [{ type: "image", attrs: { mediaId: ms[0].id, alt: "", caption: "", wide: false } }] : [{ type: "gallery", attrs: { items: ms.map((m) => ({ mediaId: m.id, alt: "", caption: "" })), caption: "" } }])] })); setEditorKey((k) => k + 1); mark(); } } }}>browse</u>. Location data is removed on upload. JPG, PNG, WebP and HEIC are accepted.</div>
            </>
          ) : (
            <>
              <label className="sr-only" htmlFor="thought">Thought</label>
              <textarea id="thought" className="ed-thought" placeholder="Write a thought. One to four sentences." value={thought} maxLength={1200} autoFocus
                onChange={(e) => { setThought(e.target.value); mark(); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }} />
              <div style={{ display: "flex", gap: 10, margin: "18px 0", flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={addDrawing}>Draw</button>
                <button className="btn btn-ghost" onClick={addPhotos}>Photo</button>
                <button className="btn btn-ghost" onClick={addSavedDrawing}>Saved drawing</button>
                <span style={{ alignSelf: "center", fontSize: 13, color: "var(--muted)" }}>One drawing, or up to four photos. Location data is removed on upload.</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: attach.length > 1 ? "1fr 1fr" : "1fr", gap: 14 }}>
                {attach.map((n, i) => {
                  const m = store[n.attrs?.mediaId]; if (!m) return null;
                  return (
                    <div key={i} className="nv">
                      <div className="media-box" style={{ aspectRatio: `${m.w} / ${m.h}`, background: m.kind === "drawing" ? "#fff" : undefined, border: m.kind === "drawing" ? "1px solid var(--line)" : undefined }}><img src={largest(m, 1280)} alt={n.attrs?.alt || ""} draggable={false} /></div>
                      <div className="meta-in" style={{ gridTemplateColumns: "1fr" }}>
                        <input className={`field ${(n.attrs?.alt || "").trim() ? "" : "need"}`} placeholder="Alt text for screen readers (required)" aria-label="Alt text (required)" value={n.attrs?.alt ?? ""} onChange={(e) => { setAttach(attach.map((x, j) => (j === i ? { ...x, attrs: { ...x.attrs, alt: e.target.value } } : x))); mark(); }} />
                        <div style={{ display: "flex", gap: 8 }}>
                          {m.kind === "drawing" && <button className="btn btn-ghost btn-sm" onClick={async () => { const r = await actions.editDrawing(m); if (r) { store[r.id] = r; setAttach([...attach]); mark(); } }}>Edit drawing</button>}
                          <button className="btn btn-ghost btn-sm" onClick={() => { setAttach(attach.filter((_, j) => j !== i)); mark(); }}>Remove</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div></div>

        <aside className="ed-side" aria-label="Post settings">
          {type === "blog" && (
            <>
              <div><span className="label">Cover</span>
                <div className="cover-box">{coverM ? <img src={largest(coverM, 640)} alt="" /> : null}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { const [m] = await openPicker("image", false, 1, "Choose a cover picture"); if (m) { setCover(m.id); mark(); } }}>{cover ? "Change cover" : "Choose cover"}</button>
                  {cover && <button className="linkbtn" onClick={() => { setCover(null); mark(); }}>Remove</button>}
                </div>
                {coverM && !coverM.alt && <p className="warn" style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>Describe the cover in its caption below the picture on the site.</p>}
              </div>
              <div><label className="label" htmlFor="ex">Excerpt</label><textarea id="ex" className="field" rows={3} maxLength={500} placeholder="Leave empty to use the first lines" value={excerpt} onChange={(e) => { setExcerpt(e.target.value); mark(); }} /></div>
            </>
          )}
          <div><span className="label">Topics</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {topics.map((t) => <span key={t} className="mini-chip">{t}<button aria-label={`Remove ${t}`} onClick={() => { setTopics(topics.filter((x) => x !== t)); mark(); }} style={{ minWidth: 24, minHeight: 24 }}>×</button></span>)}
              <input className="field" list="topic-list" style={{ width: 130, minHeight: 36, padding: "4px 10px", borderStyle: "dashed" }} placeholder="Add" aria-label="Add a topic" value={topicIn} onChange={(e) => setTopicIn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTopic(topicIn); } }} onBlur={() => topicIn && addTopic(topicIn)} />
              <datalist id="topic-list">{allTopics.filter((t) => !topics.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
            </div></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="label" style={{ margin: 0 }}>Comments open</span>
            <button type="button" role="switch" aria-checked={comments} aria-label="Comments open" className="switch-hit" onClick={() => { setComments(!comments); mark(); }}><span className="switch" aria-checked={comments} /></button></div>
          {canPublish && post.status !== "published" && <div><label className="label" htmlFor="when">Publish on</label><input id="when" type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} />{when && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={schedule}>Schedule for this time</button>}</div>}
          <button className="btn btn-ghost" onClick={openVersions}>Version history</button>
          {canPublish && post.status !== "draft" && <button className="linkbtn" onClick={unpublish} style={{ textAlign: "left" }}>Take off the site</button>}
        </aside>
      </div>

      {drawing && <DrawingStudio mediaId={drawing.id} initialCaption={drawing.caption} onCancel={() => finishDrawing(null)} onSave={(m) => finishDrawing(m)} />}

      {picker && <MediaPicker allow={picker.allow} multiple={picker.multiple} max={picker.max} title={picker.title} onDone={(items) => { picker.resolve(items); setPicker(null); }} onCancel={() => { picker.resolve([]); setPicker(null); }} />}

      {cropper && (
        <div className="modal-back" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-label="Crop picture">
          <h2>Crop</h2><p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 14 }}>Pick a shape. The picture is cropped from the centre.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([["Wide 16:9", 16 / 9], ["Landscape 4:3", 4 / 3], ["Square", 1], ["Portrait 3:4", 3 / 4]] as [string, number][]).map(([l, r]) => <button key={l} className="btn btn-ghost" onClick={() => applyCrop(cropper.m, r)}>{l}</button>)}
          </div>
          <button className="linkbtn" style={{ marginTop: 14 }} onClick={() => applyCrop(cropper.m, null)}>Cancel</button>
        </div></div>
      )}
      {modal === "schedule" && (
        <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="Schedule">
          <h2>Schedule</h2><label className="label" htmlFor="sw">Publish on</label>
          <input id="sw" type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} />
          {err && <p className="err">{err}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}><button className="btn btn-teal" onClick={schedule}>Schedule</button><button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button></div>
        </div></div>
      )}
      {modal === "versions" && (
        <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="Version history">
          <h2>Version history</h2>
          {versions.map((v) => <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 14 }}><span>{fmtDate(v.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}<br /><span style={{ color: "var(--muted)", fontSize: 12.5 }}>{v.words} words</span></span><button className="btn btn-ghost btn-sm" onClick={() => restore(v.id)}>Restore</button></div>)}
          {!versions.length && <p style={{ color: "var(--muted)" }}>Versions appear here as you write.</p>}
          <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => setModal(null)}>Close</button>
        </div></div>
      )}
      {modal === "preview" && (
        <div className="modal-back" role="presentation" style={{ alignItems: "stretch", padding: 0 }}><div style={{ background: "#fff", width: "100%", overflow: "auto" }} role="dialog" aria-modal="true" aria-label="Preview">
          <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: "1px solid var(--line)", padding: "10px 24px", display: "flex", justifyContent: "space-between", zIndex: 2 }}><b>Preview, as readers will see it</b><button className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>Close preview</button></div>
          <LightboxProvider items={lightboxItems({ body: type === "thought" ? thoughtBody : body, media: mediaStr, cover: type === "blog" ? coverM : null }, type === "blog")}>
            {type === "blog" ? (<><header className="post-head"><h1 className="post-title">{title || "Untitled"}</h1>{standfirst && <p className="standfirst">{standfirst}</p>}</header><Prose body={body} media={mediaStr} /></>)
              : (<div className="thought-page"><h1 className="big">{thought}</h1>{attach.length > 0 && <Prose body={{ type: "doc", content: attach }} media={mediaStr} />}</div>)}
          </LightboxProvider>
        </div></div>
      )}
    </>
  );
}
