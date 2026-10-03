"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Pt = { date: string; visitors: number; readers: number };
const niceMax = (v: number) => { if (v <= 4) return 4; const p = 10 ** Math.floor(Math.log10(v)); const m = [1, 2, 2.5, 5, 10].find((x) => x * p >= v)!; return m * p; };
const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Paired bars (Visitors teal, Readers soft teal). Click a day for a dark tooltip; legend buttons hide/show a series. */
export default function VisitorsChart({ data }: { data: Pt[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [show, setShow] = useState({ visitors: true, readers: true });
  const [sel, setSel] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const H = 330, L = 48, B = 30, T = 14, R = 8;
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => setSel(null), [data]);
  const innerW = w - L - R, innerH = H - T - B;
  const max = useMemo(() => niceMax(Math.max(1, ...data.map((d) => Math.max(show.visitors ? d.visitors : 0, show.readers ? d.readers : 0)))), [data, show]);
  const n = data.length || 1, gw = innerW / n, bw = Math.max(2, Math.min(22, gw * 0.34));
  const ticks = [0, max / 3, (2 * max) / 3, max].map((t) => Math.round(t));
  const y = (v: number) => innerH - (v / max) * innerH;
  const tip = sel !== null ? data[sel] : null;
  const toggle = (k: "visitors" | "readers") => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <>
      <div className="chart-head">
        <h2 style={{ margin: 0 }}>Visitors and readers</h2>
        <div className="legend">
          <button aria-pressed={show.visitors} onClick={() => toggle("visitors")}><i style={{ background: "var(--teal)" }} />Visitors</button>
          <button aria-pressed={show.readers} onClick={() => toggle("readers")}><i style={{ background: "var(--teal-soft)" }} />Readers</button>
        </div>
      </div>
      <div className="chart" ref={wrap}>
        <svg viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Bar chart of daily visitors and readers, ${data.length} days`}>
          <g transform={`translate(${L},${T})`}>
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="#ececec" />
                <text x={-10} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#6b6b6b">{t}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = i * gw + (gw - (bw * 2 + 3)) / 2;
              const bar = (v: number, dx: number, color: string, on: boolean) => (
                <rect x={x0 + dx} y={0} width={bw} height={innerH} rx={Math.min(3, bw / 2)} fill={color} style={{ transformBox: "fill-box", transformOrigin: "bottom", transform: `scaleY(${mounted && on ? v / max : 0})`, transition: "transform .55s cubic-bezier(.2,.7,.2,1)" }} />
              );
              return (
                <g key={d.date}>
                  {sel === i && <rect x={i * gw} y={0} width={gw} height={innerH} fill="rgba(15,118,110,.07)" />}
                  {bar(d.visitors, 0, "var(--teal)", show.visitors)}
                  {bar(d.readers, bw + 3, "var(--teal-soft)", show.readers)}
                  <rect x={i * gw} y={0} width={gw} height={innerH} fill="transparent" tabIndex={0} style={{ cursor: "pointer" }} role="button"
                    aria-label={`${fmt(d.date)}: ${d.visitors} visitors, ${d.readers} readers`}
                    onClick={() => setSel(sel === i ? null : i)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(sel === i ? null : i))} />
                </g>
              );
            })}
            {data.length > 0 && <>
              <text x={0} y={innerH + 22} fontSize="12" fill="#6b6b6b">{fmt(data[0].date)}</text>
              <text x={innerW / 2} y={innerH + 22} fontSize="12" fill="#6b6b6b" textAnchor="middle">{fmt(data[Math.floor(data.length / 2)].date)}</text>
              <text x={innerW} y={innerH + 22} fontSize="12" fill="#6b6b6b" textAnchor="end">{fmt(data[data.length - 1].date)}</text>
            </>}
          </g>
        </svg>
        {tip && sel !== null && (
          <div className="tip" role="status" style={{ left: Math.min(Math.max(L + sel * gw + gw / 2, 80), w - 80), top: T + y(Math.max(show.visitors ? tip.visitors : 0, show.readers ? tip.readers : 0)) - 6 }}>
            <b>{fmt(tip.date)}</b><br />Visitors <b>{tip.visitors}</b><br />Readers <b>{tip.readers}</b>
          </div>
        )}
      </div>
    </>
  );
}

export function Spark({ values, color = "var(--teal)" }: { values: number[]; color?: string }) {
  const W = 110, H = 36;
  if (values.length < 2) return <svg className="spark" aria-hidden />;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 4 - ((v - min) / (max - min || 1)) * (H - 8)}`).join(" ");
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
