"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cfetch } from "@/lib/api";
import type { Card, FeedPage } from "@/lib/types";
import { fmtDate } from "@/lib/format";

export default function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Card[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const prev = useRef<Element | null>(null);

  useEffect(() => {
    prev.current = document.activeElement;
    input.current?.focus();
    const lock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = lock; (prev.current as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) { setItems([]); return; }
      setBusy(true);
      try { const d = await cfetch<FeedPage>(`/feed?q=${encodeURIComponent(q)}&limit=6`); setItems(d.items); setSel(0); } catch { setItems([]); }
      setBusy(false);
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const href = (c: Card) => (c.type === "blog" ? `/p/${c.slug}` : `/t/${c.id}`);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (items[sel]) { router.push(href(items[sel])); onClose(); }
      else if (q.trim()) { router.push(`/feed?q=${encodeURIComponent(q)}`); onClose(); }
    } else if (e.key === "Tab") {
      const f = box.current?.querySelectorAll<HTMLElement>("input, a");
      if (!f?.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  return (
    <div className="palette-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search thoughts and blogs" ref={box} onKeyDown={onKey}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search thoughts and blogs" aria-label="Search" autoComplete="off" />
        <ul role="listbox" aria-label="Results">
          {items.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel}>
              <Link href={href(c)} onClick={onClose} aria-selected={i === sel}>
                <div className="t">{c.type === "blog" ? "Blog" : "Thought"} · {fmtDate(c.published_at)}</div>
                <div className="h" style={c.type === "thought" ? { fontStyle: "italic" } : { fontWeight: 600 }}>{c.title || c.text}</div>
              </Link>
            </li>
          ))}
          {q.trim() && !busy && items.length === 0 && <li style={{ padding: 16, color: "var(--muted)" }}>Nothing found for “{q}”.</li>}
          {!q.trim() && <li style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>Type to search titles, bodies and captions.</li>}
        </ul>
      </div>
    </div>
  );
}
