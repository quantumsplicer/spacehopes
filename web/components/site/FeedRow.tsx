"use client";
import Link from "next/link";
import type { Card } from "@/lib/types";
import { fmtDate, plural } from "@/lib/format";
import HeartButton from "./HeartButton";
import { Thumb } from "./Media";
import { Arrow } from "@/components/Icons";

export default function FeedRow({ c, i = 0 }: { c: Card; i?: number }) {
  const blog = c.type === "blog";
  const href = blog ? `/p/${c.slug}` : `/t/${c.id}`;
  const third = blog ? `${c.read_minutes} min read` : c.thumb?.kind === "drawing" ? "Thought with drawing" : "Thought";
  const showThumb = blog || (c.thumb && c.thumb.kind === "drawing") || !!c.thumb;
  const label = c.title || c.text || "Post";
  return (
    <article className={`row fade ${blog ? "" : "thought"}`} style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}>
      <Link href={href} className="stretch" aria-label={label} />
      <div className="body">
        <div className="meta">
          <span className={blog ? "t-blog" : "t-thought"}>{blog ? "Blog" : "Thought"}</span>
          <span>{fmtDate(c.published_at)}</span>
          <span>{third}</span>
        </div>
        {blog ? (
          <>
            <h3><span className="u">{c.title}</span></h3>
            {c.excerpt && <p className="excerpt">{c.excerpt}</p>}
          </>
        ) : (
          <h3 className="quote" style={{ fontWeight: 400 }}>{c.text}</h3>
        )}
        <div className="actions">
          <HeartButton postId={c.id} count={c.likes} />
          <span>{plural(c.comment_count, "comment")}</span>
        </div>
      </div>
      {showThumb && <Thumb m={c.thumb} id={c.id} />}
      <span className="read-more" aria-hidden>Read <Arrow width={14} height={14} style={{ verticalAlign: "-2px" }} /></span>
    </article>
  );
}
