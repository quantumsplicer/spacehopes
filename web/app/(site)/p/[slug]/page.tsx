import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sget } from "@/lib/api";
import type { Card, PostFull } from "@/lib/types";
import { fmtDate, plural, tintClass } from "@/lib/format";
import { largest } from "@/lib/media";
import { ProtectedArea, ReadTracker } from "@/components/site/SiteProvider";
import { LightboxProvider, Zoom } from "@/components/site/Lightbox";
import { Prose, lightboxItems } from "@/components/site/PostBody";
import { Blur, Pic, Thumb } from "@/components/site/Media";
import { ReadingProgress, Reactions, ShareTools } from "@/components/site/PostParts";
import Conversation from "@/components/site/Conversation";
import { Arrow } from "@/components/Icons";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await sget<PostFull>(`/posts/${(await params).slug}`);
  if (!p) return {};
  return {
    title: p.title ?? "Blog", description: p.excerpt || p.standfirst || undefined,
    openGraph: { type: "article", title: p.title ?? undefined, description: p.excerpt, publishedTime: p.published_at ?? undefined, images: p.cover ? [{ url: largest(p.cover, 1280) }] : undefined },
    alternates: { canonical: `/p/${p.slug}` },
  };
}

export default async function BlogPage({ params }: Props) {
  const { slug } = await params;
  const post = await sget<PostFull>(`/posts/${slug}`, 10);
  if (!post) notFound();
  const [rel, react] = await Promise.all([
    sget<{ blogs: Card[]; thoughts: Card[] }>(`/posts/${post.id}/related`, 30),
    sget<{ agree: number; think: number }>(`/posts/${post.id}/reactions`, 5),
  ]);
  const items = lightboxItems(post);
  const cover = post.cover;
  const jsonLd = { "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.excerpt, datePublished: post.published_at };

  return (
    <ProtectedArea>
      <ReadingProgress />
      <ReadTracker postId={post.id} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <LightboxProvider items={items}>
        <article>
          <header className="post-head">
            <nav className="crumbs" aria-label="Breadcrumb"><Link href="/feed">Thoughts/Feed</Link><span aria-hidden>/</span><b aria-current="page">Blog</b></nav>
            <h1 className="post-title rise">{post.title}</h1>
            {post.standfirst && <p className="standfirst rise" style={{ animationDelay: "120ms" }}>{post.standfirst}</p>}
            <div className="meta-row">
              <span>{fmtDate(post.published_at)}</span><span>{post.read_minutes} min read</span>
              <a href="#conversation" style={{ color: "inherit" }}>{plural(post.comment_count, "comment")}</a>
              <ShareTools title={post.title ?? "A blog"} />
            </div>
          </header>
          {cover ? (
            <figure className="cover">
              <Zoom index={0} label={cover.alt || post.title || "Cover"} className="frame">
                <div style={{ position: "relative", aspectRatio: `${cover.w} / ${cover.h}` }}><Blur hash={cover.blurhash} /><Pic m={cover} eager sizes="(max-width:1100px) 100vw, 1100px" style={{ position: "relative" }} /></div>
              </Zoom>
              {cover.caption && <figcaption className="cap">{cover.caption}</figcaption>}
            </figure>
          ) : (
            <div className="cover"><div className={`frame tint ${tintClass(post.id)}`} style={{ aspectRatio: "16 / 7", cursor: "default" }} aria-hidden /></div>
          )}
          <Prose body={post.body} media={post.media} startIndex={cover ? 1 : 0}>
            <Reactions postId={post.id} agree={react?.agree ?? post.likes} think={react?.think ?? 0} title={post.title ?? "A blog"} />
          </Prose>
        </article>
        <Conversation postId={post.id} open={post.comments_open} initialTotal={post.comment_count} />
        {rel && (rel.blogs.length > 0 || rel.thoughts.length > 0) && (
          <section className="keep" aria-labelledby="keep-h">
            <div className="head"><h2 id="keep-h">Keep reading</h2><Link href="/feed" className="link-teal" style={{ display: "inline-flex", gap: 6, alignItems: "center", minHeight: 44 }}>All posts <Arrow width={15} height={15} /></Link></div>
            <div className="grid">
              {[rel.blogs[0], rel.thoughts[0], rel.blogs[1]].filter(Boolean).map((c) => c.type === "blog" ? (
                <Link key={c.id} href={`/p/${c.slug}`} className="kcard">
                  <div className="img"><Thumbless c={c} /></div>
                  <div className="meta"><span className="t-blog">Blog</span><span>{fmtDate(c.published_at)}</span></div>
                  <div className="tt">{c.title}</div>
                </Link>
              ) : (
                <Link key={c.id} href={`/t/${c.id}`} className="kcard thought">
                  <div className="meta" style={{ margin: 0 }}><span className="t-thought">Thought</span></div>
                  <q>{c.text}</q>
                  <div className="meta" style={{ margin: 0 }}><span>{fmtDate(c.published_at)}</span></div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </LightboxProvider>
    </ProtectedArea>
  );
}

function Thumbless({ c }: { c: Card }) {
  if (!c.thumb) return <div className={`tint ${tintClass(c.id)}`} style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,.5) 1px, transparent 1.4px)", backgroundSize: "5px 5px" }} aria-hidden />;
  return <Pic m={c.thumb} sizes="400px" alt="" />;
}
