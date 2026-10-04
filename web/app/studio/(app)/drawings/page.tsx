"use client";
import { useEffect, useState } from "react";
import { del, get } from "@/lib/studio";
import type { MediaT } from "@/lib/types";
import { mediaUrl } from "@/lib/media";
import DrawingStudio from "@/components/drawing/DrawingStudio";
import Trash from "@/components/studio/Trash";

/** Every drawing, kept as editable vector data. Open one to keep drawing; it updates wherever it is used. */
export default function Drawings() {
  const [items, setItems] = useState<MediaT[] | null>(null);
  const [open, setOpen] = useState<null | { id: number | null; caption: string }>(null);
  const [err, setErr] = useState("");
  const [gone, setGone] = useState<Set<number>>(new Set());
  const load = () => get<MediaT[]>("/media?kind=drawing&limit=100").then(setItems);
  useEffect(() => { load(); }, []);

  async function remove(m: MediaT) {
    if (!confirm("Delete this drawing for good, including its editable version? This cannot be undone.")) return;
    setErr("");
    try {
      await del(`/media/${m.id}`);
      setGone((g) => new Set(g).add(m.id));
      setTimeout(() => setItems((x) => (x ? x.filter((i) => i.id !== m.id) : x)), 300);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <header className="s-top"><h1>Drawings</h1><button className="btn btn-teal" onClick={() => setOpen({ id: null, caption: "" })}>New drawing</button></header>
      <div className="s-body">
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18, maxWidth: 560 }}>Drawings live inside posts. Start a new one from the editor (type “/” then Drawing) or reuse a saved one (“/” then Saved drawing). Here you can reopen any drawing to keep working on it, or delete it.</p>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="thumb-grid">
          {items?.map((m) => (
            <div key={m.id} className={`tile ${gone.has(m.id) ? "gone" : ""}`}>
              <button className="tg" onClick={() => setOpen({ id: m.id, caption: m.caption })} aria-label={`Open drawing ${m.caption || m.id}`}>
                <div className="im"><img src={mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`)} alt={m.alt || ""} /></div>
                <p className="cap">{m.caption || m.alt || `Drawing ${m.id}`}</p>
              </button>
              <Trash label={`Delete drawing ${m.caption || m.id}`} onClick={() => remove(m)} />
            </div>
          ))}
        </div>
        {items && !items.length && <p style={{ color: "var(--muted)" }}>No drawings yet.</p>}
      </div>
      {open && <DrawingStudio mediaId={open.id} initialCaption={open.caption} onCancel={() => setOpen(null)} onSave={() => { setOpen(null); load(); }} />}
    </>
  );
}
