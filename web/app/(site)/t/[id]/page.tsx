import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sget } from "@/lib/api";
import type { ThoughtFull } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { ProtectedArea } from "@/components/site/SiteProvider";
import { LightboxProvider, Zoom } from "@/components/site/Lightbox";
import { lightboxItems } from "@/components/site/PostBody";
import { Blur, Pic } from "@/components/site/Media";
import { Reactions, DrawingZoom } from "@/components/site/PostParts";
import { Glow, RiseWords } from "@/components/site/Motion";
import Conversation from "@/components/site/Conversation";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await sget<ThoughtFull>(`/thoughts/${(await params).id}`);
  if (!t) return {};
  const text = t.text ?? "";
  return { title: text.length > 60 ? text.slice(0, 58) + "…" : text, description: text, openGraph: { type: "article", description: text } };
}

export default async function ThoughtPage({ params }: Props) {
  const { id } = await params;
  const t = id.match(/^\d+$/) ? await sget<ThoughtFull>(`/thoughts/${id}`, 10) : null;
  if (!t) notFound();
  const react = await sget<{ agree: number; think: number }>(`/posts/${t.id}/reactions`, 5);
  const items = lightboxItems({ body: t.body, media: t.media, cover: null }, false);
  const nodes = t.body.content.filter((n) => n.type === "image" || n.type === "drawing");
  let idx = 0;
  return (
    <ProtectedArea>
      <LightboxProvider items={items}>
        <Glow>
          <article className="thought-page">
            <div className="meta"><span className="t-thought">Thought</span><span>{fmtDate(t.published_at)}</span></div>
            <h1 className="big" aria-label={t.text ?? ""}><span aria-hidden><RiseWords text={t.text ?? ""} /></span></h1>
            {nodes.length > 0 && (
              <div className={`attach ${nodes.length > 1 ? "grid2" : ""} fade`} style={{ animationDelay: "400ms" }}>
                {nodes.map((n, i) => {
                  const m = t.media[String(n.attrs?.mediaId)]; if (!m) return null;
                  const my = idx++;
                  return m.kind === "drawing" ? (
                    <figure key={i} style={{ margin: 0 }}>
                      <DrawingZoom index={my} m={{ ...m, alt: n.attrs?.alt || m.alt }} />
                      {(n.attrs?.caption || m.caption) && <figcaption className="cap" style={{ textAlign: "center" }}>{n.attrs?.caption || m.caption}</figcaption>}
                    </figure>
                  ) : (
                    <Zoom key={i} index={my} label={n.attrs?.alt || m.alt} className="zoom-frame">
                      <div style={{ position: "relative", height: "100%" }}><Blur hash={m.blurhash} /><Pic m={m} sizes="(max-width:760px) 100vw, 420px" alt={n.attrs?.alt || m.alt} style={{ position: "relative" }} /></div>
                    </Zoom>
                  );
                })}
              </div>
            )}
            <div style={{ maxWidth: 840 }}>
              <Reactions postId={t.id} agree={react?.agree ?? t.likes} think={react?.think ?? 0} title={t.text ?? "A thought"} />
            </div>
          </article>
        </Glow>
        <Conversation postId={t.id} open={t.comments_open} initialTotal={t.comment_count} />
        <nav className="pn" aria-label="More thoughts">
          {t.prev ? <Link href={`/t/${t.prev.id}`}><small>Previous thought</small><span>{t.prev.text.slice(0, 80)}{t.prev.text.length > 80 ? "…" : ""}</span></Link> : <span />}
          {t.next ? <Link href={`/t/${t.next.id}`}><small>Next thought</small><span>{t.next.text.slice(0, 80)}{t.next.text.length > 80 ? "…" : ""}</span></Link> : <span />}
        </nav>
      </LightboxProvider>
    </ProtectedArea>
  );
}
