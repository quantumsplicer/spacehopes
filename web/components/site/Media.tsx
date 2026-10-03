"use client";
import { useEffect, useRef, useState } from "react";
import { decode } from "blurhash";
import { mediaUrl, srcSet, largest } from "@/lib/media";
import { tintClass } from "@/lib/format";
import type { MediaT } from "@/lib/types";

/** Blurhash placeholder painted behind an image while it loads. */
export function Blur({ hash }: { hash: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!hash || !ref.current) return;
    try {
      const px = decode(hash, 32, 32);
      const ctx = ref.current.getContext("2d")!;
      const img = ctx.createImageData(32, 32);
      img.data.set(px);
      ctx.putImageData(img, 0, 0);
    } catch { /* invalid hash: leave blank */ }
  }, [hash]);
  if (!hash) return null;
  return <canvas ref={ref} width={32} height={32} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

/** Responsive AVIF/WebP picture. Dragging is disabled so images cannot be dragged out of the page. */
export function Pic({ m, sizes = "100vw", alt, eager = false, className, style }: { m: MediaT; sizes?: string; alt?: string; eager?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <picture>
      {m.variants.avif.length > 0 && <source type="image/avif" srcSet={srcSet(m, "avif")} sizes={sizes} />}
      <source type="image/webp" srcSet={srcSet(m, "webp")} sizes={sizes} />
      <img src={largest(m, 1280)} alt={alt ?? m.alt} width={m.w} height={m.h} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} className={className} style={style} />
    </picture>
  );
}

/** Feed thumbnail: the picture, a drawing on white, or a tinted fallback cover. */
export function Thumb({ m, id }: { m: MediaT | null; id: number }) {
  if (!m) return <div className={`thumb tint ${tintClass(id)}`} aria-hidden />;
  return (
    <div className={`thumb ${m.kind === "drawing" ? "draw" : ""}`}>
      <Blur hash={m.kind === "image" ? m.blurhash : null} />
      <Pic m={m} sizes="220px" alt="" />
    </div>
  );
}

/**
 * A drawing inside a post. On first view the stored SVG draws itself stroke by stroke (dashoffset, one-time),
 * then the raster version (which keeps pencil grain) fades in over it. No replay control.
 */
export function DrawingFig({ m, wide = false, onClick }: { m: MediaT; wide?: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "drawing" | "done">("idle");
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!m.variants.svg || reduced) { setState("done"); return; }
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        io.disconnect();
        setState("drawing");
        setTimeout(() => setState("done"), 3800);
      }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [m.variants.svg]);
  return (
    <div ref={ref} className={`drawing-fig ${state === "done" ? "done" : ""} ${!m.variants.svg ? "static" : ""}`} style={{ aspectRatio: `${m.w} / ${m.h}` }}>
      {m.variants.svg && state === "drawing" && <img className="animated" src={mediaUrl(m, "drawing.svg")} alt="" draggable={false} />}
      <picture className="raster">
        {m.variants.avif.length > 0 && <source type="image/avif" srcSet={srcSet(m, "avif")} sizes="(max-width:760px) 100vw, 1000px" />}
        <source type="image/webp" srcSet={srcSet(m, "webp")} sizes="(max-width:760px) 100vw, 1000px" />
        <img src={largest(m, 1280)} alt={m.alt} width={m.w} height={m.h} loading="lazy" decoding="async" draggable={false} />
      </picture>
      {onClick && <button type="button" onClick={onClick} aria-label={`Open full screen: ${m.alt || "drawing"}`} style={{ position: "absolute", inset: 0, zIndex: 2, cursor: "zoom-in" }} />}
    </div>
  );
}
