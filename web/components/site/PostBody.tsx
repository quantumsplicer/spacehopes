import type { Body, MediaT, Node, PostFull } from "@/lib/types";
import { largest } from "@/lib/media";
import { Blur, DrawingFig, Pic } from "./Media";
import { Zoom, type LbItem } from "./Lightbox";
import { DrawingZoom } from "./PostParts";

/** Every image/drawing in reading order: the lightbox index of a node is its position in this list. */
export function lightboxItems(post: Pick<PostFull, "body" | "media" | "cover">, includeCover = true): LbItem[] {
  const out: LbItem[] = [];
  const add = (m: MediaT | undefined, alt = "", caption = "") => m && out.push({ src: largest(m, 2048), alt: alt || m.alt, caption: caption || m.caption || undefined, drawing: m.kind === "drawing" });
  if (includeCover && post.cover) add(post.cover);
  for (const n of post.body.content) {
    const a = n.attrs ?? {};
    if (n.type === "image" || n.type === "drawing") add(post.media[String(a.mediaId)], a.alt, a.caption);
    else if (n.type === "gallery") for (const it of a.items) add(post.media[String(it.mediaId)], it.alt, it.caption);
  }
  return out;
}

function Inline({ nodes }: { nodes?: Node[] }) {
  return <>{(nodes ?? []).map((n, i) => {
    if (n.type === "hardBreak") return <br key={i} />;
    let el: React.ReactNode = n.text;
    for (const m of n.marks ?? []) {
      if (m.type === "bold") el = <strong>{el}</strong>;
      else if (m.type === "italic") el = <em>{el}</em>;
      else if (m.type === "link") el = <a href={m.attrs?.href} rel="noopener noreferrer nofollow" target="_blank">{el}</a>;
    }
    return <span key={i}>{el}</span>;
  })}</>;
}

export function Prose({ body, media, startIndex = 0, children }: { body: Body; media: PostFull["media"]; startIndex?: number; children?: React.ReactNode }) {
  let idx = startIndex;
  return (
    <div className="prose">
      {body.content.map((n, i) => {
        const a = n.attrs ?? {};
        switch (n.type) {
          case "paragraph": return n.content?.length ? <p key={i}><Inline nodes={n.content} /></p> : null;
          case "heading": return a.level === 3 ? <h3 key={i}><Inline nodes={n.content} /></h3> : <h2 key={i}><Inline nodes={n.content} /></h2>;
          case "pullQuote": return <blockquote key={i} className="pull"><Inline nodes={n.content} /></blockquote>;
          case "divider": return <hr key={i} className="divider" aria-hidden />;
          case "image": {
            const m = media[String(a.mediaId)]; if (!m) return null;
            const my = idx++;
            return (
              <figure key={i} className={a.wide ? "wide" : ""}>
                <Zoom index={my} label={a.alt || m.alt} className="zoom-frame">
                  <div style={{ position: "relative", aspectRatio: `${m.w} / ${m.h}` }}><Blur hash={m.blurhash} /><Pic m={m} sizes="(max-width:760px) 100vw, 1000px" alt={a.alt || m.alt} style={{ position: "relative" }} /></div>
                </Zoom>
                {(a.caption || m.caption) && <figcaption className="cap">{a.caption || m.caption}</figcaption>}
              </figure>
            );
          }
          case "drawing": {
            const m = media[String(a.mediaId)]; if (!m) return null;
            const my = idx++;
            return (
              <figure key={i} className="wide">
                <DrawingZoom index={my} m={{ ...m, alt: a.alt || m.alt }} />
                {(a.caption || m.caption) && <figcaption className="cap" style={{ textAlign: "center" }}>{a.caption || m.caption}</figcaption>}
              </figure>
            );
          }
          case "gallery": {
            const items = (a.items as { mediaId: number; alt?: string }[]).map((it) => ({ ...it, m: media[String(it.mediaId)] })).filter((x) => x.m);
            const first = idx; idx += items.length;
            return (
              <figure key={i} className="wide">
                <div className={`gallery ${items.length > 2 ? "swipe" : ""}`}>
                  {items.map((it, j) => (
                    <Zoom key={it.mediaId} index={first + j} label={it.alt || it.m.alt} className="zoom-frame">
                      <div style={{ position: "relative", height: "100%" }}><Blur hash={it.m.blurhash} /><Pic m={it.m} sizes="(max-width:760px) 82vw, 500px" alt={it.alt || it.m.alt} style={{ position: "relative" }} /></div>
                    </Zoom>
                  ))}
                </div>
                {a.caption && <figcaption className="cap">{a.caption}</figcaption>}
              </figure>
            );
          }
          case "youtube":
            return (
              <figure key={i}>
                <div className="video"><iframe src={`https://www.youtube-nocookie.com/embed/${a.videoId}`} title={a.caption || "Video"} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
                {a.caption && <figcaption className="cap">{a.caption}</figcaption>}
              </figure>
            );
          default: return null;
        }
      })}
      {children}
    </div>
  );
}
