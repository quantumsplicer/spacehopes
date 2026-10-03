import type { Metadata } from "next";
import FeedClient from "@/components/site/FeedClient";
import { ProtectedArea } from "@/components/site/SiteProvider";
import { sget } from "@/lib/api";
import type { FeedPage } from "@/lib/types";

export const metadata: Metadata = { title: "Thoughts/Feed", description: "Everything, newest first. Short thoughts read in full; blogs open on their own page." };

export default async function Feed({ searchParams }: { searchParams: Promise<{ q?: string; topic?: string; month?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: "10" });
  if (sp.q) qs.set("q", sp.q);
  if (sp.topic) qs.set("topic", sp.topic);
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) qs.set("month", sp.month);
  const [feed, topics, archive] = await Promise.all([
    sget<FeedPage>(`/feed?${qs}`), sget<any[]>("/topics", 30), sget<any[]>("/archive", 30),
  ]);
  return (
    <ProtectedArea>
      <FeedClient initial={feed ?? { items: [], next_cursor: null, total: 0 }} topics={topics ?? []} archive={archive ?? []} q0={sp.q ?? ""} topic0={sp.topic ?? ""} month0={sp.month ?? ""} />
    </ProtectedArea>
  );
}
