"use client";
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useState } from "react";
import type { MediaT } from "@/lib/types";
import { mediaUrl, largest } from "@/lib/media";

/** Shared between the editor page and node views: media records by id, plus actions the views need. */
export type EditorBridge = {
  media: Record<number, MediaT>;
  replaceImage: (nodeId: number) => Promise<MediaT | null>;
  cropImage: (m: MediaT) => Promise<MediaT | null>;
  editDrawing: (m: MediaT) => Promise<MediaT | null>;
  addToGallery: () => Promise<MediaT[]>;
  patchMedia: (id: number, p: { alt?: string; caption?: string }) => void;
};

export const PullQuote = Node.create({
  name: "pullQuote", group: "block", content: "inline*", defining: true,
  parseHTML: () => [{ tag: "blockquote.pull" }],
  renderHTML: ({ HTMLAttributes }) => ["blockquote", mergeAttributes(HTMLAttributes, { class: "pull" }), 0],
});

export const Divider = Node.create({
  name: "divider", group: "block", atom: true, selectable: true,
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: () => ["hr"],
});

function Img({ m, wide }: { m: MediaT; wide?: boolean }) {
  return (
    <div className="media-box" style={{ aspectRatio: `${m.w} / ${m.h}`, background: m.kind === "drawing" ? "#fff" : undefined }}>
      <img src={largest(m, 1280)} alt={m.alt || ""} draggable={false} style={wide ? undefined : undefined} />
    </div>
  );
}

function MediaView({ node, updateAttributes, deleteNode, selected, extension }: NodeViewProps) {
  const bridge = extension.options.bridge as EditorBridge;
  const isDrawing = node.type.name === "drawing";
  const [, force] = useState(0);
  const m = bridge.media[node.attrs.mediaId];
  if (!m) return <NodeViewWrapper className="nv"><p className="warn">This picture is missing.</p></NodeViewWrapper>;
  const needAlt = !(node.attrs.alt || "").trim();
  return (
    <NodeViewWrapper className={`nv ${selected ? "sel" : ""}`} data-drag-handle>
      <div style={{ position: "relative", width: node.attrs.wide ? "100%" : "86%", margin: "0 auto" }}>
        <Img m={m} />
        {selected && (
          <div className="bar" contentEditable={false}>
            {!isDrawing && <button type="button" onClick={async () => { const n = await bridge.replaceImage(node.attrs.mediaId); if (n) { updateAttributes({ mediaId: n.id }); force((x) => x + 1); } }}>Replace</button>}
            {!isDrawing && <button type="button" onClick={async () => { const n = await bridge.cropImage(m); if (n) { updateAttributes({ mediaId: n.id }); force((x) => x + 1); } }}>Crop</button>}
            {isDrawing && <button type="button" onClick={async () => { const n = await bridge.editDrawing(m); if (n) { updateAttributes({ mediaId: n.id }); force((x) => x + 1); } }}>Edit drawing</button>}
            <button type="button" onClick={() => updateAttributes({ wide: !node.attrs.wide })}>{node.attrs.wide ? "Narrow" : "Wide"}</button>
            <button type="button" onClick={() => deleteNode()}>Remove</button>
          </div>
        )}
      </div>
      <div className="meta-in" contentEditable={false}>
        <input className="field" placeholder="Caption" aria-label="Caption" value={node.attrs.caption} onChange={(e) => updateAttributes({ caption: e.target.value })} />
        <input className={`field ${needAlt ? "need" : ""}`} placeholder="Alt text for screen readers (required)" aria-label="Alt text (required)" aria-required value={node.attrs.alt} onChange={(e) => { updateAttributes({ alt: e.target.value }); bridge.patchMedia(m.id, { alt: e.target.value }); }} />
      </div>
      {needAlt && <p className="warn" contentEditable={false}>Alt text is required before this post can be published.</p>}
      {!isDrawing && <p className="priv" contentEditable={false}>Location data is removed on upload.</p>}
    </NodeViewWrapper>
  );
}

const mediaAttrs = () => ({ mediaId: { default: null }, alt: { default: "" }, caption: { default: "" }, wide: { default: false } });

export const ImageBlock = Node.create<{ bridge: EditorBridge }>({
  name: "image", group: "block", atom: true, draggable: true,
  addOptions: () => ({ bridge: null as any }),
  addAttributes: mediaAttrs,
  parseHTML: () => [{ tag: "div[data-type=image]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "image" })],
  addNodeView() { return ReactNodeViewRenderer(MediaView); },
});

export const DrawingBlock = Node.create<{ bridge: EditorBridge }>({
  name: "drawing", group: "block", atom: true, draggable: true,
  addOptions: () => ({ bridge: null as any }),
  addAttributes: mediaAttrs,
  parseHTML: () => [{ tag: "div[data-type=drawing]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "drawing" })],
  addNodeView() { return ReactNodeViewRenderer(MediaView); },
});

function GalleryView({ node, updateAttributes, deleteNode, selected, extension }: NodeViewProps) {
  const bridge = extension.options.bridge as EditorBridge;
  const items = node.attrs.items as { mediaId: number; alt: string; caption: string }[];
  const set = (next: typeof items) => updateAttributes({ items: next });
  return (
    <NodeViewWrapper className={`nv ${selected ? "sel" : ""}`} data-drag-handle>
      <div contentEditable={false}>
        <div className="media-box" style={{ padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, background: "var(--tint-3)" }}>
          {items.map((it, i) => {
            const m = bridge.media[it.mediaId];
            return (
              <div key={it.mediaId + ":" + i}>
                {m && <img src={mediaUrl(m, `${Math.min(...m.variants.webp)}.webp`)} alt={it.alt} style={{ borderRadius: 8, aspectRatio: "4/5", objectFit: "cover" }} draggable={false} />}
                <input className={`field ${it.alt.trim() ? "" : "need"}`} style={{ marginTop: 6, minHeight: 40, fontSize: 13 }} placeholder="Alt text (required)" aria-label={`Alt text for picture ${i + 1}`} value={it.alt} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
                <button type="button" className="linkbtn" onClick={() => set(items.filter((_, j) => j !== i))}>Remove</button>
              </div>
            );
          })}
        </div>
        <div className="meta-in">
          <input className="field" placeholder="Caption for the gallery" aria-label="Gallery caption" value={node.attrs.caption} onChange={(e) => updateAttributes({ caption: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { const more = await bridge.addToGallery(); if (more.length) set([...items, ...more.map((m) => ({ mediaId: m.id, alt: "", caption: "" }))]); }}>Add pictures</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteNode()}>Remove gallery</button>
          </div>
        </div>
        {items.some((i) => !i.alt.trim()) && <p className="warn">Alt text is required for every picture.</p>}
      </div>
    </NodeViewWrapper>
  );
}

export const GalleryBlock = Node.create<{ bridge: EditorBridge }>({
  name: "gallery", group: "block", atom: true, draggable: true,
  addOptions: () => ({ bridge: null as any }),
  addAttributes: () => ({ items: { default: [] }, caption: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-type=gallery]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "gallery" })],
  addNodeView() { return ReactNodeViewRenderer(GalleryView); },
});

export function parseYouTube(s: string): string | null {
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

function YouTubeView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [url, setUrl] = useState("");
  const id = node.attrs.videoId as string | null;
  return (
    <NodeViewWrapper className={`nv ${selected ? "sel" : ""}`} data-drag-handle>
      <div contentEditable={false}>
        {id ? <div className="media-box" style={{ aspectRatio: "16/9", background: "#eee", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontFamily: "var(--font-sans)", fontSize: 14 }}>YouTube video: {id}</span></div> : (
          <div className="dropzone" style={{ textAlign: "left" }}>
            <input className="field" placeholder="Paste a YouTube link" aria-label="YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const v = parseYouTube(url); if (v) updateAttributes({ videoId: v }); } }} />
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { const v = parseYouTube(url); if (v) updateAttributes({ videoId: v }); }}>Embed</button>
          </div>
        )}
        <div className="meta-in"><input className="field" placeholder="Caption" aria-label="Caption" value={node.attrs.caption} onChange={(e) => updateAttributes({ caption: e.target.value })} /><button type="button" className="btn btn-ghost btn-sm" onClick={() => deleteNode()}>Remove</button></div>
      </div>
    </NodeViewWrapper>
  );
}

export const YouTubeBlock = Node.create({
  name: "youtube", group: "block", atom: true, draggable: true,
  addAttributes: () => ({ videoId: { default: null }, caption: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-type=youtube]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-type": "youtube" })],
  addNodeView() { return ReactNodeViewRenderer(YouTubeView); },
});

export type SlashItem = { id: string; title: string; hint: string; first?: boolean; run: (ctx: { editor: any; range: { from: number; to: number } }) => void };
export type SlashUI = { onStart: (p: any) => void; onUpdate: (p: any) => void; onExit: () => void; onKey: (e: KeyboardEvent) => boolean };

/** The "/" menu. Items and UI callbacks are supplied by BlockEditor. */
export const SlashCommand = Extension.create<{ items: (q: string) => SlashItem[]; ui: SlashUI }>({
  name: "slashCommand",
  addOptions: () => ({ items: () => [], ui: null as any }),
  addProseMirrorPlugins() {
    const o = this.options;
    return [Suggestion<SlashItem, SlashItem>({
      editor: this.editor, char: "/", startOfLine: false, allowSpaces: false,
      items: ({ query }) => o.items(query),
      command: ({ editor, range, props }) => props.run({ editor, range }),
      render: () => ({
        onStart: (p) => o.ui.onStart(p), onUpdate: (p) => o.ui.onUpdate(p), onExit: () => o.ui.onExit(),
        onKeyDown: ({ event }) => o.ui.onKey(event),
      }),
    })];
  },
});

/** Keeps an empty paragraph after a picture/drawing so there is always somewhere to keep typing. */
export const TrailingParagraph = Extension.create({
  name: "trailingParagraph",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("trailingParagraph"),
      appendTransaction: (_t, _o, state) => {
        const last = state.doc.lastChild;
        if (last && last.type.name !== "paragraph") return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
        return null;
      },
    })];
  },
});
