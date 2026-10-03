import Link from "next/link";
import { sget } from "@/lib/api";
import type { MediaT } from "@/lib/types";
import { DrawingFig } from "./Media";
import SubscribeBox from "./SubscribeBox";

type Topic = { slug: string; name: string; count: number };

export async function LatestDrawing() {
  const d = await sget<{ media: MediaT; post: { id: number; type: string; slug: string | null; title: string | null; text: string } } | null>("/drawings/latest", 30);
  if (!d?.media) return null;
  const href = d.post.type === "blog" ? `/p/${d.post.slug}` : `/t/${d.post.id}`;
  return (
    <div>
      <h2 className="side-h">Latest drawing</h2>
      <Link href={href} aria-label={`Open the post: ${d.post.title || d.post.text}`} style={{ display: "block", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        <DrawingFig m={d.media} />
      </Link>
      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>From {d.post.title || d.post.text.slice(0, 50)}</p>
    </div>
  );
}

export async function TopicChips() {
  const topics = (await sget<Topic[]>("/topics", 30)) ?? [];
  return (
    <div>
      <h2 className="side-h">Topics</h2>
      <div className="topics">
        {topics.map((t) => <Link key={t.slug} className="chip" href={`/feed?topic=${t.slug}`}>{t.name}</Link>)}
        {!topics.length && <span style={{ color: "var(--muted)", fontSize: 14 }}>[No topics yet]</span>}
      </div>
    </div>
  );
}

export function AboutLine() {
  return (
    <div className="side-about">
      <h2 className="side-h">About Space hopes</h2>
      <p>A place to give hopeful ideas room: short thoughts and longer essays, shared one at a time.</p>
      <Link href="/about" className="link-teal" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: 14 }}>Read more</Link>
    </div>
  );
}

export { SubscribeBox };
