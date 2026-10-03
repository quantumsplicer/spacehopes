import type { MetadataRoute } from "next";
import { sget } from "@/lib/api";
import type { FeedPage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.PUBLIC_URL || "http://localhost:8080";
  const out: MetadataRoute.Sitemap = ["", "/feed", "/about", "/contact"].map((p) => ({ url: base + p }));
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const page: FeedPage | null = await sget<FeedPage>(`/feed?limit=30${cursor ? `&cursor=${cursor}` : ""}`, 300);
    if (!page) break;
    for (const c of page.items) out.push({ url: c.type === "blog" ? `${base}/p/${c.slug}` : `${base}/t/${c.id}`, lastModified: c.published_at ?? undefined });
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}
