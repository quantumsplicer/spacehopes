"use client";
import { useEffect, useState } from "react";
import { del, get, uploadImage } from "@/lib/studio";
import type { MediaT } from "@/lib/types";
import { mediaUrl } from "@/lib/media";
import { useStudio } from "@/components/studio/StudioShell";

export default function Media() {
  const { me } = useStudio();
  const [items, setItems] = useState<MediaT[] | null>(null);
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState("");
  const load = () => get<MediaT[]>("/media?limit=100").then(setItems);
  useEffect(() => { load(); }, []);
  async function add() {
    const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
    i.onchange = async () => { const fs = Array.from(i.files ?? []); setBusy(fs.length); setErr(""); for (const f of fs) { try { await uploadImage(f); } catch (e: any) { setErr(`${f.name}: ${e.message}`); } setBusy((n) => n - 1); } load(); };
    i.click();
  }
  async function remove(m: MediaT) { if (!confirm("Delete this picture for good?")) return; try { await del(`/media/${m.id}`); load(); } catch (e: any) { setErr(e.message); } }
  return (
    <>
      <header className="s-top"><h1>Media</h1><button className="btn btn-teal" onClick={add}>Upload pictures</button></header>
      <div className="s-body">
        {busy > 0 && <p role="status" style={{ color: "var(--muted)" }}>Uploading {busy}…</p>}
        {err && <p className="err" role="alert">{err}</p>}
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>Location data is removed on upload. Every picture is re-encoded as WebP and AVIF.</p>
        <div className="thumb-grid">
          {items?.map((m) => (
            <div key={m.id} className="tg">
              <div className="im"><img src={mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`)} alt={m.alt || ""} style={{ background: m.kind === "drawing" ? "#fff" : undefined }} /></div>
              <p className="cap">{m.kind === "drawing" ? "Drawing" : "Picture"} {m.id}, {m.w}×{m.h}{me.user.role === "owner" && m.kind === "image" && <button className="linkbtn" style={{ float: "right", minHeight: 24, padding: 0 }} onClick={() => remove(m)}>Delete</button>}</p>
            </div>
          ))}
        </div>
        {items && !items.length && <p style={{ color: "var(--muted)" }}>No pictures yet.</p>}
      </div>
    </>
  );
}
