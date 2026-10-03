"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DrawingEngine } from "@/lib/drawing/engine";
import { SWATCHES, TOOL_LABEL, newDoc, type Doc, type EraserMode, type ShapeKind, type Tool } from "@/lib/drawing/types";
import { clearDraft, loadDraft, saveDraft } from "@/lib/drawing/draft";
import { get, sapi } from "@/lib/studio";
import type { MediaT } from "@/lib/types";

const ICON: Record<Tool, string> = {
  pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
  pencil: "M5 19l1-4 10-10 3 3-10 10zM14 7l3 3",
  colour: "M5 19l1-4 10-10 3 3-10 10zM14 7l3 3M6 15l3 3",
  marker: "M8 17l-3 3h5l1-2M9 16l8-8 3 3-8 8zM15 6l3 3",
  brush: "M20 4c-5 1-9 5-10 9l2 2c4-1 8-5 8-11zM9 14c-3 0-4 2-4 4 0 1-1 2-1 2 3 0 6 0 7-3",
  eraser: "M5 15l8-9 6 5-6 8H8zM9 19h11",
  lasso: "M12 6c4.500 0 8 1.500 8 4s-3.500 4-8 4-8-1.500-8-4 3.500-4 8-4zM8 14c0 3 1 4 3 5",
  shape: "M4 4h8v8H4zM15 17a3 3 0 1 0 0-.01",
  text: "M5 6h14M12 6v13M9 19h6",
};
const SIZES = [3, 7, 14];
const ORDER: Tool[] = ["pen", "pencil", "colour", "marker", "brush", "eraser", "lasso", "shape", "text"];
const nameOf = (hex: string) => SWATCHES.find((s) => s.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex.toUpperCase();

function LayerThumb({ eng, id, rev }: { eng: DrawingEngine; id: string; rev: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) eng.drawThumb(id, ref.current); }, [eng, id, rev]);
  return <canvas ref={ref} width={46} height={38} aria-hidden />;
}

export default function DrawingStudio({ mediaId = null, initialCaption = "", onCancel, onSave }: { mediaId?: number | null; initialCaption?: string; onCancel: () => void; onSave: (m: MediaT) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const eng = useRef<DrawingEngine | null>(null);
  const [, setTick] = useState(0);
  const [rev, setRev] = useState(0);
  const [tool, setToolS] = useState<Tool>("colour");
  const [size, setSize] = useState(1);
  const [opacity, setOpacity] = useState(1);
  const [color, setColorS] = useState("#0f766e");
  const [recent, setRecent] = useState<string[]>([]);
  const [pencilOnly, setPencilOnly] = useState(false);
  const [eraserMode, setEraserMode] = useState<EraserMode>("pixel");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("auto");
  const [sub, setSub] = useState<null | "eraser" | "shape">(null);
  const [caption, setCaption] = useState(initialCaption);
  const [text, setText] = useState<null | { sx: number; sy: number; x: number; y: number; v: string }>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [fps, setFps] = useState<{ fps: number; ms: number } | null>(null);
  const [loading, setLoading] = useState(!!mediaId);
  const lastSaved = useRef(0);
  const draftKey = `drawing:${mediaId ?? "new"}`;
  const dev = process.env.NEXT_PUBLIC_DEV_TOOLS === "1";

  const toast = useCallback((m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(""), 1800); }, []);

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem("recent-colours") ?? "[]")); } catch { /* */ }
    const e = new DrawingEngine(newDoc(), {
      onState: () => { setTick((t) => t + 1); setRev(e.rev); },
      onText: (p) => setText({ ...p, v: "" }),
      onToast: toast,
      onStats: (f, ms) => setFps({ fps: f, ms }),
    });
    e.fpsOn = dev;
    eng.current = e;
    e.attach(canvas.current!);
    const ro = new ResizeObserver(() => e.resize(false)); ro.observe(stage.current!);
    e.color = "#0f766e"; e.size = SIZES[1];

    (async () => {
      let doc: Doc | null = null;
      if (mediaId) { try { doc = await get<Doc>(`/media/${mediaId}/drawing`); } catch { setErr("Could not open this drawing."); } }
      const d = await loadDraft(draftKey);
      if (d && d.doc.layers.some((l) => l.strokes.length) && confirm("You have unsaved changes to this drawing from earlier. Continue where you left off?")) { doc = d.doc; setCaption(d.caption || initialCaption); }
      if (doc) { e.load(doc); e.fit(); }
      setLoading(false);
    })();

    const key = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? e.redo() : e.undo(); }
    };
    window.addEventListener("keydown", key);
    const auto = setInterval(() => { if (e.rev !== lastSaved.current && e.strokeCount > 0) { lastSaved.current = e.rev; saveDraft(draftKey, e.doc, caption); } }, 5000);
    const lock = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { clearInterval(auto); window.removeEventListener("keydown", key); ro.disconnect(); e.destroy(); document.body.style.overflow = lock; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const e = eng.current;
  const setTool = (t: Tool) => {
    if (!e) return;
    if (t === tool && (t === "eraser" || t === "shape")) { setSub(sub === t ? null : t); return; }
    setSub(null); e.setTool(t); setToolS(t);
  };
  const pickColor = (hex: string) => {
    if (!e) return;
    setColorS(hex); e.setColor(hex);
    const r = [hex, ...recent.filter((c) => c.toLowerCase() !== hex.toLowerCase())].filter((c) => !SWATCHES.some((s) => s.hex.toLowerCase() === c.toLowerCase())).slice(0, 5);
    setRecent(r); try { localStorage.setItem("recent-colours", JSON.stringify(r)); } catch { /* */ }
  };

  async function save() {
    if (!e) return;
    if (e.strokeCount === 0) { setErr("Draw something first."); return; }
    setSaving(true); setErr("");
    try {
      const png = await e.toPngBlob(2);
      const f = new FormData();
      f.append("doc", JSON.stringify(e.toJSON())); f.append("png", png, "drawing.png"); f.append("caption", caption);
      if (mediaId) f.append("media_id", String(mediaId));
      const m = await sapi<MediaT>("POST", "/media/drawing", undefined, { form: f });
      await clearDraft(draftKey);
      onSave(m);
    } catch (x: any) { setErr(x.message || "Could not save the drawing."); setSaving(false); }
  }
  async function cancel() {
    if (e && e.strokeCount > 0 && e.rev !== 0 && !confirm("Leave without adding this drawing to the post? Your work is kept as a draft on this device.")) return;
    onCancel();
  }
  function commitText() {
    if (e && text && text.v.trim()) e.addText(text.v, text.x, text.y + e.size * 3);
    setText(null);
  }

  const layers = e ? [...e.doc.layers].reverse() : [];
  const sel = e?.selection;
  const label = `${TOOL_LABEL[tool]}, ${nameOf(color)}`;

  return (
    <div className="ds" role="dialog" aria-modal="true" aria-label="Drawing studio">
      <div className="ds-top">
        <div className="l">
          <button className="btn btn-sm" style={{ background: "none" }} onClick={cancel}>Cancel</button>
          <input className="cap-in" placeholder="[Drawing caption]" aria-label="Drawing caption" value={caption} onChange={(ev) => setCaption(ev.target.value)} maxLength={300} />
        </div>
        <div className="c">
          <button className="ds-round" aria-label="Undo" disabled={!e?.canUndo} onClick={() => e?.undo()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg></button>
          <button className="ds-round" aria-label="Redo" disabled={!e?.canRedo} onClick={() => e?.redo()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></svg></button>
          <button className="ds-zoom" onClick={() => e?.fit()} aria-label={`Zoom ${e?.zoomPercent ?? 100} percent. Reset`}>{e?.zoomPercent ?? 100}%</button>
          <button className="ds-pill" aria-pressed={pencilOnly} onClick={() => { const v = !pencilOnly; setPencilOnly(v); if (e) e.pencilOnly = v; }}><span className="dot" aria-hidden />Pencil only</button>
        </div>
        <div className="r">
          {err && <span role="alert" style={{ color: "var(--flag-fg)", fontSize: 13 }}>{err}</span>}
          <button className="btn btn-teal btn-lg" onClick={save} disabled={saving || loading}>{saving ? "Saving…" : "Add to post"}</button>
        </div>
      </div>

      <div className="ds-stage" ref={stage}>
        <canvas ref={canvas} aria-label="Drawing canvas" role="img" />
        {dev && fps && <div className="ds-fps">{fps.fps} fps · {fps.ms} ms/frame</div>}
        <p className="ds-hint">Two fingers to pan and zoom. Two-finger tap to undo.</p>
        {loading && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>Opening your drawing…</div>}
        {toastMsg && <div className="toast" role="status" style={{ position: "absolute", bottom: 100 }}>{toastMsg}</div>}

        <div className="ds-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
          {ORDER.map((t) => (
            <div key={t} style={{ position: "relative" }}>
              <button className="ds-tool" aria-pressed={tool === t} aria-label={TOOL_LABEL[t]} title={TOOL_LABEL[t]} onClick={() => setTool(t)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[t]} /></svg>
              </button>
              {sub === "eraser" && t === "eraser" && (
                <div className="ds-sub" role="menu">
                  <button role="menuitemradio" aria-pressed={eraserMode === "pixel"} onClick={() => { setEraserMode("pixel"); if (e) e.eraserMode = "pixel"; setSub(null); }}>Pixel eraser</button>
                  <button role="menuitemradio" aria-pressed={eraserMode === "stroke"} onClick={() => { setEraserMode("stroke"); if (e) e.eraserMode = "stroke"; setSub(null); }}>Stroke eraser</button>
                </div>
              )}
              {sub === "shape" && t === "shape" && (
                <div className="ds-sub" role="menu">
                  {([["auto", "Hold to straighten"], ["line", "Line"], ["rect", "Rectangle"], ["ellipse", "Ellipse"]] as [ShapeKind, string][]).map(([k, l]) => (
                    <button key={k} role="menuitemradio" aria-pressed={shapeKind === k} onClick={() => { setShapeKind(k); if (e) e.shapeKind = k; setSub(null); }}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <aside className="ds-layers" aria-label="Layers">
          <h3>Layers <button className="ds-round" style={{ width: 36, height: 36 }} aria-label="Add layer" onClick={() => e?.addLayer()}>+</button></h3>
          {layers.map((l) => {
            const active = e?.activeId === l.id;
            return (
              <div key={l.id} style={{ position: "relative" }}>
                <button className="ds-layer" aria-current={active} onClick={() => e?.setActive(l.id)}>
                  <LayerThumb eng={e!} id={l.id} rev={rev} />
                  <span className="nm">{l.name}</span>
                  <span className="ic" role="button" tabIndex={0} aria-pressed={!l.locked ? false : true} aria-label={l.locked ? "Unlock layer" : "Lock layer"} onClick={(ev) => { ev.stopPropagation(); e?.toggle(l.id, "locked"); }} onKeyDown={(ev) => ev.key === "Enter" && e?.toggle(l.id, "locked")}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" opacity={l.locked ? 1 : 0.35} /><path d="M8 11V8a4 4 0 0 1 8 0v3" opacity={l.locked ? 1 : 0.35} /></svg>
                  </span>
                  <span className="ic" role="button" tabIndex={0} aria-pressed={l.visible} aria-label={l.visible ? "Hide layer" : "Show layer"} onClick={(ev) => { ev.stopPropagation(); e?.toggle(l.id, "visible"); }} onKeyDown={(ev) => ev.key === "Enter" && e?.toggle(l.id, "visible")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity={l.visible ? 1 : 0.35}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />{!l.visible && <path d="M4 4l16 16" />}</svg>
                  </span>
                </button>
                {active && (
                  <div style={{ display: "flex", gap: 4, padding: "0 6px 6px" }}>
                    <button className="linkbtn" style={{ minHeight: 36, padding: "0 8px" }} onClick={() => e?.moveLayer(l.id, 1)} aria-label="Move layer up">↑ Up</button>
                    <button className="linkbtn" style={{ minHeight: 36, padding: "0 8px" }} onClick={() => e?.moveLayer(l.id, -1)} aria-label="Move layer down">↓ Down</button>
                    <button className="linkbtn" style={{ minHeight: 36, padding: "0 8px" }} onClick={() => { const n = prompt("Layer name", l.name); if (n) e?.rename(l.id, n); }}>Rename</button>
                    {layers.length > 1 && <button className="linkbtn" style={{ minHeight: 36, padding: "0 8px" }} onClick={() => confirm(`Delete “${l.name}” and everything on it?`) && e?.removeLayer(l.id)}>Delete</button>}
                  </div>
                )}
              </div>
            );
          })}
          <label className="ds-trace">
            <input type="checkbox" checked={!!e?.doc.layers.some((l) => l.guide)} onChange={(ev) => {
              if (!e) return;
              if (!ev.target.checked) { const g = e.doc.layers.find((l) => l.guide); if (g) e.removeLayer(g.id); return; }
              const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp";
              inp.onchange = () => inp.files?.[0] && e.importTrace(inp.files[0]); inp.click();
            }} />
            Import a photo to trace
          </label>
        </aside>

        {sel && (
          <div className="ds-sel-bar" style={{ top: 18, left: "50%", transform: "translateX(-50%)" }} role="toolbar" aria-label="Selection">
            <button onClick={() => e?.recolourSelection()}>Recolour</button>
            <button onClick={() => e?.deleteSelection()}>Delete</button>
            <button onClick={() => e?.commitSelection(true)}>Done</button>
          </div>
        )}
        {text && (
          <input className="ds-text-in" autoFocus aria-label="Type your text" value={text.v} style={{ left: text.sx, top: text.sy - (e?.size ?? 6) * 4, fontSize: (e?.size ?? 6) * 4 * (e?.scale ?? 1), color }}
            onChange={(ev) => setText({ ...text, v: ev.target.value })} onKeyDown={(ev) => { if (ev.key === "Enter") commitText(); if (ev.key === "Escape") setText(null); }} onBlur={commitText} />
        )}

        <div className="ds-bottom" role="toolbar" aria-label="Brush settings">
          <div style={{ display: "flex", gap: 4 }}>
            {SIZES.map((s, i) => (
              <button key={s} className="ds-size" aria-pressed={size === i} aria-label={`Size ${["small", "medium", "large"][i]}`} onClick={() => { setSize(i); if (e) e.size = s; }}><i style={{ width: 6 + i * 5, height: 6 + i * 5 }} /></button>
            ))}
          </div>
          <label className="ds-op">Opacity<input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(ev) => { const v = +ev.target.value; setOpacity(v); if (e) e.opacity = v; }} aria-label="Opacity" /></label>
          <div className="ds-sw" role="group" aria-label="Colour">
            {SWATCHES.map((s) => (
              <button key={s.hex} className="sw" style={{ background: s.hex }} aria-pressed={color.toLowerCase() === s.hex.toLowerCase()} aria-label={s.name} title={s.name} onClick={() => pickColor(s.hex)} />
            ))}
            {recent.map((c) => <button key={c} className="sw" style={{ background: c }} aria-pressed={color.toLowerCase() === c.toLowerCase()} aria-label={`Recent colour ${c}`} onClick={() => pickColor(c)} />)}
            <span className="sw add" aria-label="Custom colour" title="Custom colour">+<input type="color" aria-label="Pick a custom colour" value={color} onChange={(ev) => pickColor(ev.target.value)} /></span>
          </div>
          <span className="ds-cur" aria-live="polite">{label}</span>
        </div>
      </div>
    </div>
  );
}
