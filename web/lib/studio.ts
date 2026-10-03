"use client";
// Client for the Studio API: session cookie (httpOnly, set by the server) + CSRF header on every write.

const BASE = "/api/v1/studio";
let csrf = "";
try { csrf = sessionStorage.getItem("csrf") ?? ""; } catch { /* storage blocked */ }

export function setCsrf(t: string) {
  csrf = t;
  try { sessionStorage.setItem("csrf", t); } catch { /* */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message); }
}

export async function sapi<T = any>(method: string, path: string, body?: unknown, opts: { form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (csrf) headers["x-csrf-token"] = csrf;
  let payload: BodyInit | undefined;
  if (opts.form) payload = opts.form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload, credentials: "same-origin", cache: "no-store" });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = data?.detail;
    const msg = typeof d === "string" ? d : d?.message ?? (Array.isArray(d) ? "Please check what you entered." : "Something went wrong.");
    if (r.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("studio-signed-out"));
    if (r.status === 403 && d === "password_change_required") window.dispatchEvent(new Event("studio-password-required"));
    throw new ApiError(r.status, msg, d);
  }
  return data as T;
}

export const get = <T = any>(p: string) => sapi<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => sapi<T>("POST", p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => sapi<T>("PUT", p, b);
export const patch = <T = any>(p: string, b?: unknown) => sapi<T>("PATCH", p, b);
export const del = <T = any>(p: string) => sapi<T>("DELETE", p);

export async function uploadImage(file: File | Blob, name = "image"): Promise<import("./types").MediaT> {
  const f = new FormData();
  f.append("file", file, (file as File).name || name);
  return sapi("POST", "/media/upload", undefined, { form: f });
}
