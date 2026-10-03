import type { PublicSettings } from "./types";

export const API = "/api/v1";
const INTERNAL = process.env.INTERNAL_API_URL || "http://api:8000";

/** Server-side GET (Server Components). Returns null on 404 / failure so pages can degrade gracefully. */
export async function sget<T>(path: string, revalidate = 15): Promise<T | null> {
  try {
    const r = await fetch(`${INTERNAL}${API}${path}`, { next: { revalidate } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const DEFAULT_SETTINGS: PublicSettings = {
  site_name: "Space hopes", about_byline: "Saravanan Murugan, IAS", about_quote: "Judge the thought, not the thinker. The words here are meant to stand on their own.",
  about_quote_confirmed: false, footer_line: "Views expressed are my own.", social_links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/saravanan-murugan-947369b9" }], comment_mode: "name",
  review_comments: true, disable_copy: true, turnstile_site_key: "",
};

export async function getSettings(): Promise<PublicSettings> {
  return (await sget<PublicSettings>("/settings/public", 10)) ?? DEFAULT_SETTINGS;
}

/** Client-side JSON request. Throws Error(message) with the API's friendly detail. */
export async function cfetch<T = any>(path: string, init: RequestInit & { json?: unknown; anon?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (init.anon) headers["x-anon-id"] = init.anon;
  const r = await fetch(`${API}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: "same-origin" });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = data?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? "Please check what you entered." : "Something went wrong. Please try again.");
  }
  return data as T;
}
