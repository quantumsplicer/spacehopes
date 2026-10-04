"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { get, uploadImage } from "@/lib/studio";
import type { MediaT } from "@/lib/types";
import { mediaUrl } from "@/lib/media";

type Kind = "image" | "drawing";

/**
 * Modal to pick from everything already uploaded or drawn (and to upload more without leaving the post).
 * `allow` decides which tabs appear. Resolves with the chosen items, in the order they were clicked.
 */
export default function MediaPicker({ allow = "image", multiple = false, max = 12, title, onDone, onCancel }: {
  allow?: Kind | "both"; multiple?: boolean; max?: number; title?: string; onDone: (items: MediaT[]) => void; onCancel: () => void;
}) {
  const kinds: Kind[] = allow === "both" ? ["image", "drawing"] : [allow];
  const [tab, setTab] = useState<Kind>(kinds[0]);
  const [lists, setLists] = useState<Partial<Record<Kind, MediaT[]>>>({});
  const [picked, setPicked] = useState<MediaT[]>([]);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const prev = useRef<Element | null>(null);

  const load = useCallback(async (k: Kind) => {
    try { const r = await get<MediaT[]>(`/media?kind=${k}&limit=100`); setLists((l) => ({ ...l, [k]: r })); }
    catch (e: any) { setErr(e.message || "Could not load your media."); setLists((l) => ({ ...l, [k]: [] })); }
  }, []);
  useEffect(() => { if (!lists[tab]) load(tab); }, [tab, lists, load]);
  useEffect(() => {
    prev.current = document.activeElement;
    box.current?.focus();
    return () => (prev.current as HTMLElement | null)?.focus?.();
  }, []);

  const limit = multiple ? max : 1;
  const isPicked = (m: MediaT) => picked.some((p) => p.id === m.id);
  function toggle(m: MediaT) {
    setErr("");
    if (!multiple) { setPicked([m]); return; }
    if (isPicked(m)) setPicked(picked.filter((p) => p.id !== m.id));
    else if (picked.length >= limit) setErr(`You can choose up to ${limit}.`);
    else setPicked([...picked, m]);
  }

  async function upload(files: File[]) {
    setErr(""); setBusy((n) => n + files.length);
    const made: MediaT[] = [];
    for (const f of files) {
      try { made.push(await uploadImage(f)); } catch (e: any) { setErr(`${f.name}: ${e.message}`); }
      setBusy((n) => n - 1);
    }
    if (made.length) {
      setLists((l) => ({ ...l, image: [...made.reverse(), ...(l.image ?? [])] }));
      setPicked((p) => (multiple ? [...p, ...made].slice(0, limit) : [made[0]]));
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "Tab") {
      const f = Array.from(box.current?.querySelectorAll<HTMLElement>("button, input, [tabindex='0']") ?? []).filter((x) => !x.hasAttribute("disabled"));
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  const items = lists[tab];
  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal picker" role="dialog" aria-modal="true" aria-label={title ?? "Choose from your media"} ref={box} tabIndex={-1} onKeyDown={onKey}>
        <div className="picker-head">
          <h2>{title ?? (allow === "drawing" ? "Choose a drawing" : "Choose from your media")}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close" style={{ width: 40, height: 40 }}>×</button>
        </div>
        {kinds.length > 1 && (
          <div className="seg" role="tablist" aria-label="Media type" style={{ marginBottom: 14 }}>
            {kinds.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k === "image" ? "Pictures" : "Drawings"}</button>)}
          </div>
        )}
        {tab === "image" && (
          <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => file.current?.click()}>Upload new</button>
            <input ref={file} type="file" hidden multiple={multiple} accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) upload(multiple ? fs : fs.slice(0, 1)); }} />
            {busy > 0 && <span role="status" style={{ fontSize: 13, color: "var(--muted)" }}>Uploading {busy}…</span>}
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Location data is removed on upload.</span>
          </div>
        )}
        <div className="thumb-grid picker-grid" role="listbox" aria-multiselectable={multiple} aria-label={tab === "image" ? "Pictures" : "Drawings"}>
          {items?.map((m) => (
            <button key={m.id} className={`tg pick ${isPicked(m) ? "on" : ""}`} role="option" aria-selected={isPicked(m)} onClick={() => toggle(m)}
              onDoubleClick={() => { if (!multiple) onDone([m]); }} aria-label={`${tab === "image" ? "Picture" : "Drawing"} ${m.id}${m.alt ? `: ${m.alt}` : ""}`}>
              <div className="im" style={m.kind === "drawing" ? { background: "#fff" } : undefined}>
                <img src={mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`)} alt="" draggable={false} />
                {isPicked(m) && <span className="tick-badge" aria-hidden>{multiple ? picked.findIndex((p) => p.id === m.id) + 1 : "✓"}</span>}
              </div>
              <p className="cap">{m.caption || m.alt || `${m.w}×${m.h}`}</p>
            </button>
          ))}
        </div>
        {items && !items.length && <p style={{ color: "var(--muted)", padding: "24px 4px" }}>{tab === "image" ? "No pictures yet. Use “Upload new” above." : "No saved drawings yet. Start one with the Drawing block."}</p>}
        {!items && <p style={{ color: "var(--muted)", padding: "24px 4px" }} aria-busy>Loading…</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <div className="picker-foot">
          <span style={{ fontSize: 13, color: "var(--muted)" }}>{multiple ? `${picked.length} chosen (up to ${limit})` : picked.length ? "1 chosen" : "Click one to choose it"}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn btn-teal" disabled={!picked.length || busy > 0} onClick={() => onDone(picked)}>{multiple && picked.length > 1 ? `Add ${picked.length}` : "Add"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
