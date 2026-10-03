"use client";
// Small browser-only helpers: anonymous id (for likes), toast events, share/copy, Turnstile.

export function anonId(): string {
  try {
    let id = localStorage.getItem("anon");
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "");
      localStorage.setItem("anon", id);
    }
    return id;
  } catch {
    return "session" + Math.random().toString(36).slice(2, 12);
  }
}

export function isLiked(key: string): boolean {
  try { return localStorage.getItem("liked:" + key) === "1"; } catch { return false; }
}
export function setLiked(key: string, on: boolean) {
  try { on ? localStorage.setItem("liked:" + key, "1") : localStorage.removeItem("liked:" + key); } catch { /* private mode */ }
}

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("app-toast", { detail: message }));
}

export async function copyLink(url?: string) {
  const link = url ?? location.href;
  try { await navigator.clipboard.writeText(link); toast("Link copied"); } catch { toast("Could not copy. Long-press the address bar instead."); }
}

export async function shareLink(title: string, url?: string) {
  const link = url ?? location.href;
  if (navigator.share) { try { await navigator.share({ title, url: link }); return; } catch { return; } }
  await copyLink(link);
}

declare global { interface Window { turnstile?: any; } }

let tsLoad: Promise<void> | null = null;
/** Invisible Cloudflare Turnstile. Resolves to a token, or "" if the widget cannot load (the API decides what to do). */
export async function turnstileToken(siteKey: string): Promise<string> {
  if (!siteKey) return "";
  try {
    tsLoad ??= new Promise<void>((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error("blocked"));
      document.head.appendChild(s);
    });
    await Promise.race([tsLoad, new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000))]);
    return await new Promise<string>((resolve) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(host);
      const done = (t: string) => { try { window.turnstile.remove(id); } catch { /* */ } host.remove(); resolve(t); };
      const id = window.turnstile.render(host, { sitekey: siteKey, callback: (t: string) => done(t), "error-callback": () => done(""), "timeout-callback": () => done("") });
      setTimeout(() => done(""), 8000);
    });
  } catch {
    return "";
  }
}
