import Hero from "@/components/site/Hero";
import HomeFeed from "@/components/site/HomeFeed";
import { ProtectedArea } from "@/components/site/SiteProvider";
import { AboutLine, LatestDrawing, SubscribeBox, TopicChips } from "@/components/site/Sidebar";
import { sget } from "@/lib/api";
import type { Card, FeedPage } from "@/lib/types";

export default async function Home() {
  const [latest, feed] = await Promise.all([sget<Card>("/thoughts/latest"), sget<FeedPage>("/feed?limit=6")]);
  return (
    <ProtectedArea>
      <Hero latest={latest} />
      <div className="container-page home-grid">
        <div className="home-main"><HomeFeed initial={feed ?? { items: [], next_cursor: null, total: 0 }} /></div>
        <aside className="aside" aria-label="About and subscribe">
          <AboutLine />
          <SubscribeBox />
          <LatestDrawing />
          <TopicChips />
        </aside>
      </div>
    </ProtectedArea>
  );
}
