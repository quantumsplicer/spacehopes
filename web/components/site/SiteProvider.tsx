"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicSettings } from "@/lib/types";
import { toast } from "@/lib/client";
import { Lock } from "@/components/Icons";

const Ctx = createContext<PublicSettings | null>(null);
export const useSite = () => useContext(Ctx)!;

export function SiteProvider({ settings, children }: { settings: PublicSettings; children: ReactNode }) {
  return (
    <Ctx.Provider value={settings}>
      {children}
      <ToastHost />
      <Analytics />
    </Ctx.Provider>
  );
}

function ToastHost() {
  const [msg, setMsg] = useState<{ t: string; k: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg({ t: (e as CustomEvent<string>).detail, k: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener("app-toast", on);
    return () => { window.removeEventListener("app-toast", on); clearTimeout(timer); };
  }, []);
  if (!msg) return null;
  return (
    <div className="toast" role="status" aria-live="polite" key={msg.k}>
      {msg.t.startsWith("Copying") && <Lock width={15} height={15} />}
      {msg.t}
    </div>
  );
}

/** Privacy-first counting: one visit per browser session. No cookies, no ids, nothing sent beyond the request itself. */
function Analytics() {
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("v")) {
        sessionStorage.setItem("v", "1");
        fetch("/api/v1/track/visit", { method: "POST", keepalive: true }).catch(() => {});
      }
    } catch { /* storage blocked: skip counting rather than count every page */ }
  }, []);
  return null;
}

export function ReadTracker({ postId }: { postId: number }) {
  useEffect(() => {
    try {
      const k = "r:" + postId;
      if (!sessionStorage.getItem(k)) {
        sessionStorage.setItem(k, "1");
        fetch("/api/v1/track/read", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ post_id: postId }) }).catch(() => {});
      }
    } catch { /* skip */ }
  }, [postId]);
  return null;
}

const MSG = "Copying is turned off. Use Share to send the link.";

/** Deterrent only: screenshots cannot be blocked. Form fields, the comment box and Copy link stay usable. */
export function ProtectedArea({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { disable_copy } = useSite();
  useEffect(() => {
    if (!disable_copy) return;
    const inForm = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, [contenteditable=true], .allow-copy");
    const block = (e: Event) => { if (!inForm(e.target)) { e.preventDefault(); toast(MSG); } };
    const quiet = (e: Event) => { if (!inForm(e.target)) e.preventDefault(); };
    const keys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["c", "x", "a"].includes(e.key.toLowerCase()) && !inForm(e.target)) { e.preventDefault(); toast(MSG); }
    };
    const root = document.getElementById("protected-root");
    if (!root) return;
    root.addEventListener("copy", block); root.addEventListener("cut", block); root.addEventListener("contextmenu", block);
    root.addEventListener("dragstart", quiet);
    document.addEventListener("keydown", keys);
    return () => {
      root.removeEventListener("copy", block); root.removeEventListener("cut", block); root.removeEventListener("contextmenu", block);
      root.removeEventListener("dragstart", quiet);
      document.removeEventListener("keydown", keys);
    };
  }, [disable_copy]);
  return <div id="protected-root" className={`${disable_copy ? "no-copy" : ""} ${className}`}>{children}</div>;
}
