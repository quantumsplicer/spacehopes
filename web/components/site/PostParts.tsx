"use client";
import { useEffect, useRef } from "react";
import { Share, LinkIcon } from "@/components/Icons";
import { copyLink, shareLink } from "@/lib/client";
import { DrawingFig } from "./Media";
import { useLightbox } from "./Lightbox";
import type { MediaT } from "@/lib/types";
import HeartButton from "./HeartButton";

export function DrawingZoom({ index, m }: { index: number; m: MediaT }) {
  const lb = useLightbox();
  return <DrawingFig m={m} wide onClick={() => lb?.open(index)} />;
}

/** 3px teal bar at the top of post pages that fills as you read. */
export function ReadingProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current; if (!el) return;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      el.style.transform = `scaleX(${max > 0 ? Math.min(1, h.scrollTop / max) : 0})`;
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []);
  return <div className="progress" ref={ref} role="presentation" aria-hidden />;
}

export function ShareTools({ title }: { title: string }) {
  return (
    <div className="tools">
      <button className="icon-btn allow-copy" onClick={() => shareLink(title)} aria-label="Share"><Share width={17} height={17} /></button>
      <button className="icon-btn allow-copy" onClick={() => copyLink()} aria-label="Copy link"><LinkIcon width={17} height={17} /></button>
    </div>
  );
}

export function Reactions({ postId, agree, think, title }: { postId: number; agree: number; think: number; title: string }) {
  return (
    <div className="reactions">
      <HeartButton postId={postId} count={agree} kind="agree" label="Agree" />
      <HeartButton postId={postId} count={think} kind="think" label="Worth thinking about" />
      <ShareTools title={title} />
    </div>
  );
}
