import { sget } from "@/lib/api";
import type { FeedPage } from "@/lib/types";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
export const dynamic = "force-dynamic";

export async function GET() {
  const base = process.env.PUBLIC_URL || "http://localhost:8080";
  const feed = await sget<FeedPage>("/feed?limit=30", 60);
  const items = (feed?.items ?? []).map((c) => {
    const url = c.type === "blog" ? `${base}/p/${c.slug}` : `${base}/t/${c.id}`;
    const title = c.title || (c.text ?? "").slice(0, 80);
    return `<item><title>${esc(title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${new Date(c.published_at ?? Date.now()).toUTCString()}</pubDate><description>${esc(c.type === "blog" ? c.excerpt : c.text ?? "")}</description></item>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Space hopes</title><link>${base}</link><description>Short thoughts and longer essays, written slowly and shared openly.</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
