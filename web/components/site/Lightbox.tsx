"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Chevron, Close } from "@/components/Icons";

export type LbItem = { src: string; alt: string; caption?: string; drawing?: boolean };
const Ctx = createContext<{ open: (i: number) => void } | null>(null);

export function LightboxProvider({ items, children }: { items: LbItem[]; children: ReactNode }) {
  const [at, setAt] = useState<number | null>(null);
  const open = useCallback((i: number) => setAt(i), []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {at !== null && <Viewer items={items} start={at} onClose={() => setAt(null)} />}
    </Ctx.Provider>
  );
}

/** Wraps any image in a button that opens the lightbox at its index. */
export function Zoom({ index, label, className = "", children }: { index: number; label: string; className?: string; children: ReactNode }) {
  const c = useContext(Ctx);
  return <button type="button" className={`zoom-btn ${className}`} onClick={() => c?.open(index)} aria-label={`Open full screen: ${label}`}>{children}</button>;
}

export function useLightbox() { return useContext(Ctx); }

function Viewer({ items, start, onClose }: { items: LbItem[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const touch = useRef<number | null>(null);
  const go = useCallback((d: number) => setI((x) => (x + d + items.length) % items.length), [items.length]);

  useEffect(() => {
    prevFocus.current = document.activeElement;
    const lock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>(".lb-close")?.focus();
    return () => { document.body.style.overflow = lock; (prevFocus.current as HTMLElement | null)?.focus?.(); };
  }, []);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "Tab") {
      const f = Array.from(box.current?.querySelectorAll<HTMLElement>("button") ?? []);
      if (!f.length) return;
      const a = document.activeElement;
      if (e.shiftKey && a === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  const it = items[i];
  return (
    <div className="lightbox" ref={box} role="dialog" aria-modal="true" aria-label="Image viewer" onKeyDown={onKey}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (touch.current === null) return; const dx = e.changedTouches[0].clientX - touch.current; touch.current = null; if (Math.abs(dx) > 50 && items.length > 1) go(dx < 0 ? 1 : -1); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {items.length > 1 && <span className="lb-count" aria-live="polite">{i + 1} / {items.length}</span>}
      <button className="lb-btn lb-close" onClick={onClose} aria-label="Close"><Close /></button>
      {items.length > 1 && <button className="lb-btn lb-prev" onClick={() => go(-1)} aria-label="Previous image"><Chevron dir="left" /></button>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={it.src} alt={it.alt} draggable={false} style={it.drawing ? { background: "#fff" } : undefined} />
      {items.length > 1 && <button className="lb-btn lb-next" onClick={() => go(1)} aria-label="Next image"><Chevron /></button>}
      {it.caption && <p className="lb-cap">{it.caption}</p>}
    </div>
  );
}
