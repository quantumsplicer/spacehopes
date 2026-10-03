"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import type { Body, MediaT } from "@/lib/types";
import { DrawingBlock, Divider, GalleryBlock, ImageBlock, PullQuote, SlashCommand, TrailingParagraph, YouTubeBlock, type EditorBridge, type SlashItem } from "./extensions";

export type EditorActions = {
  pickImages: (multiple: boolean) => Promise<MediaT[]>;
  uploadFiles: (files: File[]) => Promise<MediaT[]>;
  newDrawing: () => Promise<MediaT | null>;
  editDrawing: (m: MediaT) => Promise<MediaT | null>;
  cropImage: (m: MediaT) => Promise<MediaT | null>;
  replaceImage: () => Promise<MediaT | null>;
  patchMedia: (id: number, p: { alt?: string; caption?: string }) => void;
};

type Menu = { items: SlashItem[]; x: number; y: number; sel: number; command: (i: SlashItem) => void } | null;

export default function BlockEditor({ initial, media, actions, onChange, onReady }: {
  initial: Body; media: Record<number, MediaT>; actions: EditorActions; onChange: (b: Body) => void; onReady?: (e: Editor) => void;
}) {
  const [menu, setMenu] = useState<Menu>(null);
  const menuRef = useRef<Menu>(null);
  menuRef.current = menu;
  const act = useRef(actions); act.current = actions;
  const mediaRef = useRef(media); mediaRef.current = media;
  const [plus, setPlus] = useState<{ x: number; y: number } | null>(null);

  const bridge = useMemo<EditorBridge>(() => ({
    get media() { return mediaRef.current; },
    replaceImage: () => act.current.replaceImage(),
    cropImage: (m) => act.current.cropImage(m),
    editDrawing: (m) => act.current.editDrawing(m),
    addToGallery: () => act.current.pickImages(true),
    patchMedia: (id, p) => act.current.patchMedia(id, p),
  }), []);

  const items = (q: string): SlashItem[] => {
    const all: SlashItem[] = [
      { id: "drawing", title: "Drawing", hint: "Sketch in colour, right inside the post", first: true, run: async ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); const m = await act.current.newDrawing(); if (m) editor.chain().focus().insertContent({ type: "drawing", attrs: { mediaId: m.id, alt: m.alt || "", caption: m.caption || "", wide: true } }).run(); } },
      { id: "image", title: "Image", hint: "Upload or paste", run: async ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); const ms = await act.current.pickImages(false); if (ms[0]) editor.chain().focus().insertContent({ type: "image", attrs: { mediaId: ms[0].id } }).run(); } },
      { id: "gallery", title: "Gallery", hint: "Several images, swipeable", run: async ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); const ms = await act.current.pickImages(true); if (ms.length) editor.chain().focus().insertContent({ type: "gallery", attrs: { items: ms.map((m) => ({ mediaId: m.id, alt: "", caption: "" })) } }).run(); } },
      { id: "heading", title: "Heading", hint: "Section title", run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run() },
      { id: "quote", title: "Quote", hint: "Pull a line out", run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("pullQuote").run() },
      { id: "divider", title: "Divider", hint: "A pause", run: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent([{ type: "divider" }, { type: "paragraph" }]).run() },
      { id: "video", title: "Video", hint: "Embed a YouTube link", run: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertContent({ type: "youtube", attrs: { videoId: null } }).run() },
    ];
    const s = q.trim().toLowerCase();
    return s ? all.filter((i) => i.title.toLowerCase().includes(s) || i.hint.toLowerCase().includes(s)) : all;
  };

  const ui = useMemo(() => {
    const place = (p: any, sel = 0) => {
      const r: DOMRect | null = p.clientRect?.();
      if (!r) return;
      const below = r.bottom + 8, y = below + 420 > window.innerHeight ? Math.max(8, r.top - 428) : below;
      setMenu({ items: p.items, x: Math.max(8, Math.min(r.left, window.innerWidth - 340)), y, sel, command: (i) => p.command(i) });
    };
    return {
      onStart: (p: any) => place(p), onUpdate: (p: any) => place(p, Math.min(menuRef.current?.sel ?? 0, Math.max(0, p.items.length - 1))), onExit: () => setMenu(null),
      onKey: (e: KeyboardEvent) => {
        const m = menuRef.current; if (!m || !m.items.length) return false;
        if (e.key === "ArrowDown") { setMenu({ ...m, sel: (m.sel + 1) % m.items.length }); return true; }
        if (e.key === "ArrowUp") { setMenu({ ...m, sel: (m.sel - 1 + m.items.length) % m.items.length }); return true; }
        if (e.key === "Enter") { m.command(m.items[m.sel]); return true; }
        if (e.key === "Escape") { setMenu(null); return true; }
        return false;
      },
    };
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    content: initial as any,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, blockquote: false, horizontalRule: false, codeBlock: false, code: false, bulletList: false, orderedList: false, listItem: false, strike: false }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow" } }),
      Placeholder.configure({ placeholder: "Body text as it is being written, in the same type readers will see." }),
      PullQuote, Divider, ImageBlock.configure({ bridge }), DrawingBlock.configure({ bridge }), GalleryBlock.configure({ bridge }), YouTubeBlock, TrailingParagraph,
      SlashCommand.configure({ items, ui }),
    ],
    editorProps: {
      attributes: { "aria-label": "Post body", spellcheck: "true" },
      handlePaste: (_v, e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        e.preventDefault(); insertFiles(files); return true;
      },
      handleDrop: (_v, e) => {
        const files = Array.from((e as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/") || /\.hei[cf]$/i.test(f.name));
        if (!files.length) return false;
        e.preventDefault(); insertFiles(files); return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as Body),
  });

  async function insertFiles(files: File[]) {
    const ms = await act.current.uploadFiles(files);
    if (!editor || !ms.length) return;
    if (ms.length === 1) editor.chain().focus().insertContent({ type: "image", attrs: { mediaId: ms[0].id } }).run();
    else editor.chain().focus().insertContent({ type: "gallery", attrs: { items: ms.map((m) => ({ mediaId: m.id, alt: "", caption: "" })) } }).run();
  }

  useEffect(() => { if (editor) onReady?.(editor); }, [editor, onReady]);

  // The "+" button sits beside an empty paragraph.
  useEffect(() => {
    if (!editor) return;
    const upd = () => {
      const { $from, empty } = editor.state.selection;
      if (empty && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && editor.isFocused) {
        const c = editor.view.coordsAtPos($from.pos);
        const host = editor.view.dom.getBoundingClientRect();
        setPlus({ x: host.left - 56, y: c.top - 8 });
      } else setPlus(null);
    };
    editor.on("selectionUpdate", upd); editor.on("update", upd); editor.on("focus", upd); editor.on("blur", () => setTimeout(() => setPlus(null), 200));
    return () => { editor.off("selectionUpdate", upd); editor.off("update", upd); editor.off("focus", upd); };
  }, [editor]);

  return (
    <div style={{ position: "relative" }}>
      <EditorContent editor={editor} />
      {plus && (
        <button type="button" className="plus" aria-label="Add a block (or type /)" style={{ position: "fixed", left: Math.max(8, plus.x), top: plus.y, zIndex: 30 }}
          onMouseDown={(e) => e.preventDefault()} onClick={() => editor?.chain().focus().insertContent("/").run()}>+</button>
      )}
      {menu && menu.items.length > 0 && (
        <div className="slash" role="listbox" aria-label="Insert a block" style={{ left: menu.x, top: menu.y }}>
          {menu.items.map((it, i) => (
            <button key={it.id} type="button" role="option" aria-selected={i === menu.sel} className={it.first ? "first" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => menu.command(it)}>
              <b>{it.title}</b><span>{it.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
