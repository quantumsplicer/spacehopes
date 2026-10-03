"use client";
import { useRef, type CSSProperties, type ReactNode } from "react";

/** Headline that rises word by word (80ms stagger). `em` words render teal italic. */
export function RiseWords({ text, em = "", start = 0, className }: { text: string; em?: string; start?: number; className?: string }) {
  const words = text.split(" ");
  const emWords = new Set(em.split(" ").filter(Boolean));
  return (
    <span className={className}>
      {words.map((w, i) => {
        const s: CSSProperties = { animationDelay: `${start + i * 80}ms` };
        const inner = <span className="word" style={s}>{w}</span>;
        const sp = i < words.length - 1 ? " " : "";
        return emWords.has(w.replace(/[.,]/g, "")) ? <em key={i}>{inner}{sp}</em> : <span key={i}>{inner}{sp}</span>;
      })}
    </span>
  );
}

/** A 600px teal glow at 8% that follows the pointer. */
export function Glow({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`glow-host ${className}`}
      onPointerMove={(e) => {
        const el = ref.current; if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--gx", `${e.clientX - r.left}px`);
        el.style.setProperty("--gy", `${e.clientY - r.top}px`);
      }}
    >
      <div className="glow" aria-hidden />
      {children}
    </div>
  );
}
