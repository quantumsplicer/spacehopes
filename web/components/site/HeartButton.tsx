"use client";
import { useEffect, useState } from "react";
import { Heart } from "@/components/Icons";
import { cfetch } from "@/lib/api";
import { anonId, isLiked, setLiked } from "@/lib/client";

/** One reaction per browser, tracked with an anonymous id kept in localStorage (never sent as-is: the server hashes it). */
export default function HeartButton({ postId, count, kind = "agree", label, className = "" }: { postId: number; count: number; kind?: "agree" | "think"; label?: string; className?: string }) {
  const key = `${kind}:${postId}`;
  const [n, setN] = useState(count);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(isLiked(key)), [key]);
  useEffect(() => setN(count), [count]);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !on;
    setOn(next); setN((v) => v + (next ? 1 : -1)); setLiked(key, next);
    try {
      const r = await cfetch<{ agree: number; think: number; mine: string[] }>(`/posts/${postId}/reactions`, { method: "POST", json: { kind }, anon: anonId() });
      setN(r[kind]); setOn(r.mine.includes(kind)); setLiked(key, r.mine.includes(kind));
    } catch {
      setOn(!next); setN((v) => v + (next ? -1 : 1)); setLiked(key, !next);
    }
    setBusy(false);
  }

  const aria = label ? `${label}, ${n}` : `${on ? "Remove your like" : "Like"}, ${n} likes`;
  return (
    <button type="button" className={`heart ${kind === "think" ? "think" : ""} ${className}`} aria-pressed={on} aria-label={aria} onClick={toggle}>
      {kind === "agree" && <Heart width={16} height={16} />}
      {label ? <span>{label}, {n}</span> : <span>{n}</span>}
    </button>
  );
}
