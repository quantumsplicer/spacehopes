"use client";
import { useEffect, useState } from "react";
import { del, get, uploadImage } from "@/lib/studio";
import type { MediaT } from "@/lib/types";
import { mediaUrl } from "@/lib/media";
import Trash from "@/components/studio/Trash";

export default function Media() {
  const [items, setItems] = useState<MediaT[] | null>(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState("");
  const [gone, setGone] = useState<Set<number>>(new Set());
  const load = () => get<MediaT[]>("/media?limit=100").then(setItems);
  useEffect(() => { load(); }, []);

  async function add() {
    const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
    i.onchange = async () => {
      const fs = Array.from(i.files ?? []); setBusy(fs.length); setErr("");
      for (const f of fs) { try { await uploadImage(f); } catch (e: any) { setErr(`${f.name}: ${e.message}`); } setBusy((n) => n - 1); }
      load();
    };
    i.click();
  }

  async function remove(m: MediaT) {
    if (!confirm(`Delete this ${m.kind === "drawing" ? "drawing" : "picture"} for good? This cannot be undone.`)) return;
    setErr("");
    try {
      await del(`/media/${m.id}`);
      setGone((g) => new Set(g).add(m.id));
      setTimeout(() => setItems((x) => (x ? x.filter((i) => i.id !== m.id) : x)), 300);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <>
      <header className="s-top"><h1>Media</h1><button className="btn btn-teal" onClick={add}>Upload pictures</button></header>
      <div className="s-body">
        {busy > 0 && <p role="status" style={{ color: "var(--muted)" }}>Uploading {busy}…</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>Location data is removed on upload. Every picture is re-encoded as WebP. A picture or drawing used in a post cannot be deleted until it is removed from that post.</p>
        <div className="thumb-grid">
          {items?.map((m) => (
            <div key={m.id} className={`tile tg ${gone.has(m.id) ? "gone" : ""}`}>
              <div className="im"><img src={mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`)} alt={m.alt || ""} style={{ background: m.kind === "drawing" ? "#fff" : undefined }} /></div>
              <p className="cap">{m.kind === "drawing" ? "Drawing" : "Picture"} {m.id}, {m.w}×{m.h}</p>
              <Trash label={`Delete ${m.kind === "drawing" ? "drawing" : "picture"} ${m.id}`} onClick={() => remove(m)} />
            </div>
          ))}
        </div>
        {items && !items.length && <p style={{ color: "var(--muted)" }}>No pictures yet.</p>}
      </div>
    </>
  );
}
