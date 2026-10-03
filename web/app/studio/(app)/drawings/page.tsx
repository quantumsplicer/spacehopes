"use client";
import { useEffect, useState } from "react";
import { get } from "@/lib/studio";
import type { MediaT } from "@/lib/types";
import { mediaUrl } from "@/lib/media";
import DrawingStudio from "@/components/drawing/DrawingStudio";

/** Every drawing, kept as editable vector data. Open one to keep drawing; it updates wherever it is used. */
export default function Drawings() {
  const [items, setItems] = useState<MediaT[] | null>(null);
  const [open, setOpen] = useState<null | { id: number | null; caption: string }>(null);
  const load = () => get<MediaT[]>("/media?kind=drawing&limit=100").then(setItems);
  useEffect(() => { load(); }, []);
  return (
    <>
      <header className="s-top"><h1>Drawings</h1><button className="btn btn-teal" onClick={() => setOpen({ id: null, caption: "" })}>New drawing</button></header>
      <div className="s-body">
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18, maxWidth: 560 }}>Drawings live inside posts. To use a new one, start it from the editor (“/” then Drawing). Here you can reopen any drawing to keep working on it.</p>
        <div className="thumb-grid">
          {items?.map((m) => (
            <button key={m.id} className="tg" onClick={() => setOpen({ id: m.id, caption: m.caption })} aria-label={`Open drawing ${m.caption || m.id}`}>
              <div className="im"><img src={mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`)} alt={m.alt || ""} /></div>
              <p className="cap">{m.caption || m.alt || `Drawing ${m.id}`}</p>
            </button>
          ))}
        </div>
        {items && !items.length && <p style={{ color: "var(--muted)" }}>No drawings yet.</p>}
      </div>
      {open && <DrawingStudio mediaId={open.id} initialCaption={open.caption} onCancel={() => setOpen(null)} onSave={() => { setOpen(null); load(); }} />}
    </>
  );
}
