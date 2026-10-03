import getStroke from "perfect-freehand";
import type { Doc, EraserMode, Layer, ShapeKind, Stroke, StrokeTool, Tool } from "./types";

/**
 * Drawing engine (iPad / Apple Pencil first). See docs/DRAWING.md.
 *  - Pointer Events with pressure, tilt/altitudeAngle and getCoalescedEvents().
 *  - perfect-freehand outlines. Committed strokes live on one offscreen canvas per layer;
 *    each frame only the live stroke is drawn on top (requestAnimationFrame, only when dirty).
 *  - DPR-aware sizing with caps so Safari's canvas memory limit is never hit.
 */

type Action =
  | { k: "add"; layer: string; stroke: Stroke }
  | { k: "remove"; layer: string; items: { stroke: Stroke; index: number }[] }
  | { k: "update"; layer: string; before: Stroke[]; after: Stroke[] };

type Tf = { k: number; dx: number; dy: number; ox: number; oy: number };
type Pointer = { id: number; x: number; y: number; sx: number; sy: number; type: string; t: number };
export type Hooks = { onState: () => void; onText: (p: { sx: number; sy: number; x: number; y: number }) => void; onToast: (m: string) => void; onStats?: (fps: number, ms: number) => void };

const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_SCALE = 8, MIN_SCALE = 0.15;

// ---------------------------------------------------------------- stroke geometry & rendering

const pathCache = new WeakMap<Stroke, Path2D>();
const hasRealPressure = (s: Stroke) => s.points.some((p) => p[2] !== 0.5);

function optionsFor(s: Stroke) {
  const base = { simulatePressure: !hasRealPressure(s), easing: (t: number) => t };
  switch (s.tool) {
    case "pencil": return { ...base, size: s.size * 0.8, thinning: 0.7, smoothing: 0.5, streamline: 0.45 };
    case "colour": return { ...base, size: s.size * 1.5, thinning: 0.6, smoothing: 0.5, streamline: 0.45 };
    case "marker": return { ...base, size: s.size * 2.4, thinning: 0, smoothing: 0.6, streamline: 0.6 };
    case "brush": return { ...base, size: s.size * 2.2, thinning: 0.85, smoothing: 0.6, streamline: 0.55, start: { taper: s.size * 3 }, end: { taper: s.size * 5 } };
    case "eraser": return { ...base, size: s.size * 2.6, thinning: 0, smoothing: 0.5, streamline: 0.4 };
    default: return { ...base, size: s.size, thinning: 0.55, smoothing: 0.55, streamline: 0.5 };
  }
}

function toPath(outline: number[][]): Path2D {
  const p = new Path2D();
  if (!outline.length) return p;
  p.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[i + 1];
    p.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  p.closePath();
  return p;
}

function outlinePath(s: Stroke, final: boolean): Path2D | null {
  if (!s.points.length) return null;
  if (final) { const c = pathCache.get(s); if (c) return c; }
  const path = toPath(getStroke(s.points, { ...optionsFor(s), last: final }));
  if (final) pathCache.set(s, path);
  return path;
}

function bbox(s: Stroke, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of s.points) add(p[0], p[1]);
  if (s.shape) { add(s.shape.a[0], s.shape.a[1]); add(s.shape.b[0], s.shape.b[1]); }
  if (s.text) { add(s.text.x, s.text.y - s.size * 4); add(s.text.x + s.text.value.length * s.size * 2.4, s.text.y + s.size); }
  const r = pad + s.size * (s.tool === "marker" ? 2.4 : s.tool === "brush" ? 2.2 : 1.6);
  return { x: x0 - r, y: y0 - r, w: x1 - x0 + 2 * r, h: y1 - y0 + 2 * r, x1: x1 + r, y1: y1 + r };
}

// Grain tiles for pencil and colour pencil (alpha = how much is rubbed away). Created lazily; one per density.
const noiseTiles = new Map<number, HTMLCanvasElement>();
function noise(density: number): HTMLCanvasElement {
  const key = Math.round(density * 20);
  let c = noiseTiles.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = c.height = 192;
  const g = c.getContext("2d")!;
  const img = g.createImageData(192, 192);
  let seed = 1234567 + key * 977;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 192 * 192; i++) { img.data[i * 4 + 3] = rnd() < key / 20 ? 140 + rnd() * 115 : 0; }
  g.putImageData(img, 0, 0);
  noiseTiles.set(key, c);
  return c;
}

let tmp: HTMLCanvasElement | null = null;
function temp(w: number, h: number) {
  if (!tmp) tmp = document.createElement("canvas");
  if (tmp.width < w) tmp.width = w;
  if (tmp.height < h) tmp.height = h;
  return tmp;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, cs: number, live = false) {
  if (s.tool === "text" && s.text) {
    ctx.save(); ctx.globalAlpha = s.opacity; ctx.fillStyle = s.color; ctx.font = `${s.size * 4}px Georgia, serif`; ctx.textBaseline = "alphabetic";
    ctx.fillText(s.text.value, s.text.x, s.text.y); ctx.restore(); return;
  }
  if (s.tool === "shape" && s.shape) {
    const { kind, a, b } = s.shape;
    ctx.save(); ctx.globalAlpha = s.opacity; ctx.strokeStyle = s.color; ctx.lineWidth = s.size; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
    if (kind === "line") { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    else if (kind === "rect") ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    else ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(a[0] - b[0]) / 2 || 0.1, Math.abs(a[1] - b[1]) / 2 || 0.1, 0, 0, Math.PI * 2);
    ctx.stroke(); ctx.restore(); return;
  }
  const path = outlinePath(s, !live);
  if (!path) return;
  if (s.tool === "eraser") { ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "#000"; ctx.fill(path); ctx.restore(); return; }
  if (s.tool === "pen" || s.tool === "brush") { ctx.save(); ctx.globalAlpha = s.opacity * (s.tool === "brush" ? 0.94 : 1); ctx.fillStyle = s.color; ctx.fill(path); ctx.restore(); return; }

  // pencil, colour pencil, marker: drawn in isolation so overlapping dabs do not build up, and grain can be rubbed out
  const b = bbox(s, 4);
  const w = Math.ceil(b.w * cs), h = Math.ceil(b.h * cs);
  if (w <= 0 || h <= 0 || w * h > 36e6) { ctx.save(); ctx.globalAlpha = s.opacity; ctx.fillStyle = s.color; ctx.fill(path); ctx.restore(); return; }
  const t = temp(w, h), tc = t.getContext("2d")!;
  tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = "source-over"; tc.globalAlpha = 1; tc.clearRect(0, 0, w, h);
  tc.setTransform(cs, 0, 0, cs, -b.x * cs, -b.y * cs);
  tc.fillStyle = s.color; tc.fill(path);
  let alpha = s.opacity;
  if (s.tool === "marker") alpha *= 0.55;
  else {
    const avgP = s.points.reduce((a, p) => a + p[2], 0) / Math.max(1, s.points.length);
    // light pressure = grainier; firm pressure fills the paper tooth
    const density = s.tool === "colour" ? Math.max(0.12, 0.7 - avgP * 0.55) : 0.32;
    const pat = tc.createPattern(noise(density), "repeat");
    if (pat) {
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, s.seed % 192, (s.seed >> 8) % 192]));
      tc.globalCompositeOperation = "destination-out"; tc.fillStyle = pat; tc.fillRect(b.x, b.y, b.w, b.h);
      tc.globalCompositeOperation = "source-over";
    }
    if (s.tool === "pencil") alpha *= 0.92;
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(t, 0, 0, w, h, b.x, b.y, w / cs, h / cs); ctx.restore();
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hit(s: Stroke, x: number, y: number, r: number): boolean {
  const b = bbox(s, r);
  if (x < b.x || y < b.y || x > b.x1 || y > b.y1) return false;
  const reach = r + s.size / 2;
  if (s.shape) {
    const { kind, a, b: c } = s.shape;
    if (kind === "line") return distSeg(x, y, a[0], a[1], c[0], c[1]) <= reach;
    if (kind === "rect") { const x0 = Math.min(a[0], c[0]), x1 = Math.max(a[0], c[0]), y0 = Math.min(a[1], c[1]), y1 = Math.max(a[1], c[1]); return distSeg(x, y, x0, y0, x1, y0) <= reach || distSeg(x, y, x1, y0, x1, y1) <= reach || distSeg(x, y, x1, y1, x0, y1) <= reach || distSeg(x, y, x0, y1, x0, y0) <= reach; }
    const cx = (a[0] + c[0]) / 2, cy = (a[1] + c[1]) / 2, rx = Math.abs(a[0] - c[0]) / 2 || 1, ry = Math.abs(a[1] - c[1]) / 2 || 1;
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return Math.abs(d - 1) * Math.min(rx, ry) <= reach;
  }
  if (s.text) return true;
  const p = s.points;
  if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= reach;
  for (let i = 1; i < p.length; i++) if (distSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= reach) return true;
  return false;
}

function inPoly(x: number, y: number, poly: number[][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function transformed(s: Stroke, t: Tf): Stroke {
  const m = (x: number, y: number): [number, number] => [(x - t.ox) * t.k + t.ox + t.dx, (y - t.oy) * t.k + t.oy + t.dy];
  const n: Stroke = { ...s, size: s.size * t.k, points: s.points.map((p) => { const [x, y] = m(p[0], p[1]); return [x, y, p[2]]; }) };
  if (s.shape) n.shape = { kind: s.shape.kind, a: m(s.shape.a[0], s.shape.a[1]), b: m(s.shape.b[0], s.shape.b[1]) };
  if (s.text) { const [x, y] = m(s.text.x, s.text.y); n.text = { value: s.text.value, x, y }; }
  return n;
}

// ---------------------------------------------------------------- the engine

export class DrawingEngine {
  doc: Doc;
  canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  scale = 1; ox = 0; oy = 0; fitScale = 1;
  dpr = 1; cs = 1;
  tool: Tool = "colour"; color = "#0f766e"; size = 6; opacity = 1;
  shapeKind: ShapeKind = "auto"; eraserMode: EraserMode = "pixel"; pencilOnly = false;
  activeId: string;
  rev = 0;
  fpsOn = false;

  private caches = new Map<string, HTMLCanvasElement>();
  private images = new Map<string, HTMLImageElement>();
  private undoStack: Action[] = []; private redoStack: Action[] = [];
  private pointers = new Map<number, Pointer>();
  private live: Stroke | null = null;
  private liveId = -1; private liveLayer: Layer | null = null;
  private lassoPath: number[][] | null = null;
  private shapeDrag: { a: [number, number]; b: [number, number]; kind: "line" | "rect" | "ellipse" } | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null; private snapped: "line" | "ellipse" | null = null; private lastMove = { x: 0, y: 0 };
  selection: { ids: Set<string>; box: { x: number; y: number; w: number; h: number }; tf: Tf } | null = null;
  private selMode: null | { kind: "move" | "scale"; sx: number; sy: number; tf0: Tf } = null;
  private gesture: { t0: number; maxN: number; moved: boolean; d0: number; mx: number; my: number; s0: number; ox0: number; oy0: number } | null = null;
  private panning: { x: number; y: number; ox: number; oy: number } | null = null;
  private spaceDown = false;
  private dirty = true; private raf = 0; private frames: number[] = [];
  private lastStats = 0;
  private destroyed = false;
  private erasedLive = new Set<string>();
  private cleanups: (() => void)[] = [];

  constructor(doc: Doc, public hooks: Hooks) {
    this.doc = doc;
    this.activeId = doc.layers[Math.min(doc.layers.length - 1, 2)].id;
    for (const l of doc.layers) if (l.image) this.loadImage(l);
  }

  // ---- setup
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas; this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true })!;
    const on = (el: HTMLElement | Window | Document, ev: string, fn: (e: any) => void, opt?: AddEventListenerOptions) => { el.addEventListener(ev, fn, opt); this.cleanups.push(() => el.removeEventListener(ev, fn, opt as any)); };
    on(canvas, "pointerdown", (e) => this.down(e));
    on(canvas, "pointermove", (e) => this.move(e));
    on(canvas, "pointerup", (e) => this.up(e));
    on(canvas, "pointercancel", (e) => this.cancel(e));
    on(canvas, "wheel", (e) => this.wheel(e), { passive: false });
    on(canvas, "contextmenu", (e) => e.preventDefault());
    // iOS: stop the magnifier loupe, text selection, double-tap zoom and Safari's pinch-zoom while drawing
    on(canvas, "touchstart", (e) => e.preventDefault(), { passive: false });
    on(canvas, "touchmove", (e) => e.preventDefault(), { passive: false });
    on(canvas, "gesturestart", (e) => e.preventDefault());
    on(canvas, "gesturechange", (e) => e.preventDefault());
    on(canvas, "selectstart", (e) => e.preventDefault());
    on(window, "keydown", (e) => { if (e.code === "Space" && !(e.target as HTMLElement)?.closest?.("input,textarea")) { this.spaceDown = true; } });
    on(window, "keyup", (e) => { if (e.code === "Space") this.spaceDown = false; });
    this.resize(true);
    this.loop();
  }

  destroy() { this.destroyed = true; cancelAnimationFrame(this.raf); this.cleanups.forEach((f) => f()); this.cleanups = []; }

  resize(refit = false) {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    while (r.width * r.height * dpr * dpr > 14e6 && dpr > 1) dpr -= 0.25; // Safari memory ceiling
    this.dpr = dpr; this.cs = Math.min(1.5, Math.max(1, dpr));
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    const fit = this.computeFit(r.width, r.height);
    this.fitScale = fit.scale;
    if (refit) { this.scale = fit.scale; this.ox = fit.ox; this.oy = fit.oy; }
    this.request(); this.hooks.onState();
  }

  private computeFit(cw: number, ch: number) {
    const left = cw > 900 ? 110 : 20, right = cw > 900 ? 280 : 20, top = 20, bottom = cw > 900 ? 110 : 120;
    const aw = Math.max(240, cw - left - right), ah = Math.max(200, ch - top - bottom);
    const scale = Math.min(aw / this.doc.width, ah / this.doc.height);
    return { scale, ox: left + (aw - this.doc.width * scale) / 2, oy: top + (ah - this.doc.height * scale) / 2 };
  }
  fit() { const r = this.canvas.parentElement!.getBoundingClientRect(); const f = this.computeFit(r.width, r.height); this.scale = f.scale; this.ox = f.ox; this.oy = f.oy; this.request(); this.hooks.onState(); }
  get zoomPercent() { return Math.round((this.scale / this.fitScale) * 100); }

  // ---- doc / layers
  get activeLayer(): Layer { return this.doc.layers.find((l) => l.id === this.activeId) ?? this.doc.layers[0]; }
  private layer(id: string) { return this.doc.layers.find((l) => l.id === id); }
  private touch() { this.rev++; this.request(); this.hooks.onState(); }
  get strokeCount() { return this.doc.layers.reduce((n, l) => n + (l.guide ? 0 : l.strokes.length), 0); }
  get canUndo() { return this.undoStack.length > 0; } get canRedo() { return this.redoStack.length > 0; }

  load(doc: Doc) {
    this.commitSelection(false);
    this.doc = doc; this.caches.clear(); this.images.clear(); this.undoStack = []; this.redoStack = [];
    this.activeId = doc.layers[Math.min(doc.layers.length - 1, 2)].id;
    for (const l of doc.layers) if (l.image) this.loadImage(l);
    this.touch();
  }

  addLayer(name?: string) {
    if (this.doc.layers.length >= 12) { this.hooks.onToast("A drawing can have up to 12 layers."); return; }
    const l: Layer = { id: "L" + uid(), name: name ?? `Layer ${this.doc.layers.length + 1}`, visible: true, locked: false, strokes: [] };
    const i = this.doc.layers.findIndex((x) => x.id === this.activeId);
    this.doc.layers.splice(i + 1, 0, l); this.activeId = l.id; this.touch();
  }
  removeLayer(id: string) {
    if (this.doc.layers.length <= 1) return;
    this.commitSelection(false);
    this.doc.layers = this.doc.layers.filter((l) => l.id !== id); this.caches.delete(id);
    if (this.activeId === id) this.activeId = this.doc.layers[this.doc.layers.length - 1].id;
    this.touch();
  }
  moveLayer(id: string, dir: 1 | -1) {
    const i = this.doc.layers.findIndex((l) => l.id === id), j = i + dir;
    if (j < 0 || j >= this.doc.layers.length) return;
    const a = this.doc.layers; [a[i], a[j]] = [a[j], a[i]]; this.touch();
  }
  setActive(id: string) { this.commitSelection(true); this.activeId = id; this.hooks.onState(); }
  toggle(id: string, key: "visible" | "locked") { const l = this.layer(id); if (l) { l[key] = !l[key]; this.touch(); } }
  rename(id: string, name: string) { const l = this.layer(id); if (l) { l.name = name.slice(0, 40); this.touch(); } }

  async importTrace(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/jpeg", 0.7);
      if (data.length > 2_900_000) { this.hooks.onToast("That photo is too large to trace. Try a smaller one."); return; }
      const l: Layer = { id: "L" + uid(), name: "Photo to trace", visible: true, locked: true, guide: true, image: data, strokes: [] };
      this.doc.layers.unshift(l); this.loadImage(l); this.touch();
    } finally { URL.revokeObjectURL(url); }
  }
  private loadImage(l: Layer) {
    const i = new Image();
    i.onload = () => { this.images.set(l.id, i); this.caches.delete(l.id); this.request(); this.hooks.onState(); };
    i.src = l.image!;
  }

  // ---- caches
  private cacheOf(l: Layer): HTMLCanvasElement {
    let c = this.caches.get(l.id);
    if (!c) {
      c = document.createElement("canvas"); c.width = Math.round(this.doc.width * this.cs); c.height = Math.round(this.doc.height * this.cs);
      this.caches.set(l.id, c); this.rebuild(l);
    }
    return c;
  }
  private cx(l: Layer): CanvasRenderingContext2D {
    const g = this.cacheOf(l).getContext("2d")!;
    g.setTransform(this.cs, 0, 0, this.cs, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
    return g;
  }
  private rebuild(l: Layer, skip?: Set<string>) {
    const c = this.caches.get(l.id); if (!c) return;
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); g.setTransform(this.cs, 0, 0, this.cs, 0, 0);
    if (l.guide) {
      const img = this.images.get(l.id);
      if (img) { const k = Math.min(this.doc.width / img.width, this.doc.height / img.height); g.globalAlpha = 0.45; g.drawImage(img, (this.doc.width - img.width * k) / 2, (this.doc.height - img.height * k) / 2, img.width * k, img.height * k); g.globalAlpha = 1; }
      return;
    }
    for (const s of l.strokes) if (!skip?.has(s.id)) drawStroke(g, s, this.cs);
  }

  /** Paint a layer's thumbnail into a small canvas (for the Layers card). */
  drawThumb(id: string, target: HTMLCanvasElement) {
    const l = this.layer(id); if (!l) return;
    const g = target.getContext("2d")!; g.clearRect(0, 0, target.width, target.height);
    g.drawImage(this.cacheOf(l), 0, 0, target.width, target.height);
  }

  // ---- history
  private push(a: Action) { this.undoStack.push(a); if (this.undoStack.length > 400) this.undoStack.shift(); this.redoStack = []; this.touch(); }
  private apply(a: Action, undo: boolean) {
    const l = this.layer(a.layer); if (!l) return;
    if (a.k === "add") {
      if (undo) l.strokes = l.strokes.filter((s) => s.id !== a.stroke.id); else l.strokes.push(a.stroke);
    } else if (a.k === "remove") {
      if (undo) [...a.items].sort((x, y) => x.index - y.index).forEach((it) => l.strokes.splice(Math.min(it.index, l.strokes.length), 0, it.stroke));
      else l.strokes = l.strokes.filter((s) => !a.items.some((it) => it.stroke.id === s.id));
    } else {
      const src = undo ? a.before : a.after;
      l.strokes = l.strokes.map((s) => src.find((x) => x.id === s.id) ?? s);
    }
    this.rebuild(l);
  }
  undo() { this.commitSelection(true); const a = this.undoStack.pop(); if (!a) return; this.apply(a, true); this.redoStack.push(a); this.touch(); }
  redo() { this.commitSelection(true); const a = this.redoStack.pop(); if (!a) return; this.apply(a, false); this.undoStack.push(a); this.touch(); }

  // ---- coordinates
  private pos(e: { clientX: number; clientY: number }) { const r = this.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top, x: (e.clientX - r.left - this.ox) / this.scale, y: (e.clientY - r.top - this.oy) / this.scale }; }

  // ---- view
  zoomAt(sx: number, sy: number, factor: number) {
    const ns = Math.max(this.fitScale * MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    const k = ns / this.scale;
    this.ox = sx - (sx - this.ox) * k; this.oy = sy - (sy - this.oy) * k; this.scale = ns; this.request(); this.hooks.onState();
  }
  private wheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.pos(e);
    if (e.ctrlKey || e.metaKey) this.zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * 0.01));
    else { this.ox -= e.deltaX; this.oy -= e.deltaY; this.request(); }
  }

  // ---- input
  private canDraw(type: string) { return !(type === "touch" && this.pencilOnly); }
  private penActive() { for (const p of this.pointers.values()) if (p.type === "pen") return true; return false; }

  private down(e: PointerEvent) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    const p = this.pos(e);
    if (e.pointerType === "touch" && this.penActive()) return; // palm resting while the Pencil is down
    this.pointers.set(e.pointerId, { id: e.pointerId, x: p.x, y: p.y, sx: p.sx, sy: p.sy, type: e.pointerType, t: performance.now() });
    const touches = [...this.pointers.values()].filter((q) => q.type === "touch");

    if (touches.length >= 2) { // two or three fingers: pan / pinch, and taps for undo / redo
      this.discardLive();
      const [a, b] = touches;
      if (!this.gesture) this.gesture = { t0: performance.now(), maxN: touches.length, moved: false, d0: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2, s0: this.scale, ox0: this.ox, oy0: this.oy };
      else this.gesture.maxN = Math.max(this.gesture.maxN, touches.length);
      return;
    }
    if (e.pointerType === "touch" && !this.canDraw("touch")) return; // Pencil-only mode: one finger does nothing (palm rejection)
    if (e.pointerType === "mouse" && (e.button === 1 || e.button === 2 || this.spaceDown)) { this.panning = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy }; return; }
    if (e.button > 0 && e.pointerType === "mouse") return;
    this.begin(e, p);
  }

  private begin(e: PointerEvent, p: { x: number; y: number; sx: number; sy: number }) {
    const layer = this.activeLayer;
    if (this.tool === "lasso" || this.selection) { if (this.selectionDown(p)) return; }
    if (!layer.visible || layer.locked) { this.hooks.onToast(layer.locked ? "This layer is locked." : "This layer is hidden."); return; }
    this.liveLayer = layer; this.liveId = e.pointerId;
    this.lastMove = { x: p.x, y: p.y };
    if (this.tool === "text") { this.hooks.onText(p); this.liveId = -1; return; }
    if (this.tool === "lasso") { this.lassoPath = [[p.x, p.y]]; this.request(); return; }
    if (this.tool === "shape" && this.shapeKind !== "auto") { this.shapeDrag = { a: [p.x, p.y], b: [p.x, p.y], kind: this.shapeKind }; this.request(); return; }
    if (this.tool === "eraser" && this.eraserMode === "stroke") { this.erasedLive.clear(); this.eraseAt(p.x, p.y); return; }
    const tool: StrokeTool = this.tool === "shape" ? "pen" : (this.tool as StrokeTool);
    this.live = { id: uid(), tool, color: this.color, size: this.size, opacity: this.opacity, seed: Math.floor(Math.random() * 65535), points: [] };
    this.addPoint(e, p);
    if (this.tool === "shape") this.armHold();
    this.request();
  }

  private pressureOf(e: PointerEvent): number {
    let pr = e.pointerType === "pen" ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
    if (e.pointerType === "pen" && (this.tool === "pencil" || this.tool === "colour")) {
      // Tilt the Pencil to shade: a low altitude angle (flat) widens the mark.
      const alt = (e as any).altitudeAngle as number | undefined;
      const tilt = alt !== undefined ? 1 - Math.min(alt, Math.PI / 2) / (Math.PI / 2) : Math.min(1, Math.hypot(e.tiltX || 0, e.tiltY || 0) / 90);
      pr = Math.min(1, pr * (1 + 1.4 * tilt));
    }
    return Math.round(pr * 1000) / 1000;
  }
  private addPoint(e: PointerEvent, p: { x: number; y: number }) {
    if (!this.live) return;
    const pts = this.live.points, last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - p.x, last[1] - p.y) < 0.4) return;
    pts.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, this.pressureOf(e)]);
  }

  private move(e: PointerEvent) {
    const q = this.pointers.get(e.pointerId);
    if (this.panning && e.pointerType === "mouse") { this.ox = this.panning.ox + e.clientX - this.panning.x; this.oy = this.panning.oy + e.clientY - this.panning.y; this.request(); return; }
    if (!q) return;
    const p = this.pos(e);
    q.sx = p.sx; q.sy = p.sy; q.x = p.x; q.y = p.y;

    if (this.gesture) {
      const t = [...this.pointers.values()].filter((z) => z.type === "touch");
      if (t.length >= 2) {
        const [a, b] = t, g = this.gesture;
        const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        if (Math.abs(d - g.d0) > 14 || Math.hypot(mx - g.mx, my - g.my) > 14) g.moved = true;
        const ns = Math.max(this.fitScale * 0.15, Math.min(MAX_SCALE, g.s0 * (d / g.d0)));
        const wx = (g.mx - g.ox0) / g.s0, wy = (g.my - g.oy0) / g.s0; // doc point under the initial midpoint
        this.scale = ns; this.ox = mx - wx * ns; this.oy = my - wy * ns;
        this.request(); this.hooks.onState();
      }
      return;
    }
    if (e.pointerId !== this.liveId && !this.selMode) return;

    const events = (e.getCoalescedEvents?.() ?? []).length ? e.getCoalescedEvents() : [e];
    if (this.selMode) { this.selectionMove(p); return; }
    for (const ce of events) {
      const cp = this.pos(ce);
      if (this.lassoPath) { this.lassoPath.push([cp.x, cp.y]); }
      else if (this.shapeDrag) { this.shapeDrag.b = [cp.x, cp.y]; }
      else if (this.tool === "eraser" && this.eraserMode === "stroke") { this.eraseAt(cp.x, cp.y); }
      else if (this.live) {
        if (this.snapped) { this.shapeSnapUpdate(cp.x, cp.y); }
        else {
          this.addPoint(ce, cp);
          if (this.tool === "shape" && Math.hypot(cp.x - this.lastMove.x, cp.y - this.lastMove.y) > 4 / this.scale * 1) { this.lastMove = { x: cp.x, y: cp.y }; this.armHold(); }
        }
      }
    }
    if (this.live?.tool === "eraser") this.eraseLive();
    this.request();
  }

  private up(e: PointerEvent) {
    const q = this.pointers.get(e.pointerId);
    if (this.panning && e.pointerType === "mouse") { this.panning = null; this.pointers.delete(e.pointerId); return; }
    if (!q) return;
    this.pointers.delete(e.pointerId);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* */ }

    if (this.gesture) {
      const left = [...this.pointers.values()].filter((z) => z.type === "touch").length;
      if (left === 0) {
        const g = this.gesture; this.gesture = null;
        if (!g.moved && performance.now() - g.t0 < 380) { if (g.maxN >= 3) this.redo(); else this.undo(); } // two-finger tap = undo, three = redo
      }
      return;
    }
    if (this.selMode) { this.selectionUp(); return; }
    if (e.pointerId !== this.liveId) return;
    this.liveId = -1;
    this.clearHold();
    const layer = this.liveLayer; this.liveLayer = null;
    if (!layer) return;

    if (this.lassoPath) { this.finishLasso(layer); return; }
    if (this.shapeDrag) {
      const { a, b, kind } = this.shapeDrag; this.shapeDrag = null;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 3) this.commit(layer, { id: uid(), tool: "shape", color: this.color, size: this.size, opacity: this.opacity, seed: 0, points: [], shape: { kind, a, b } });
      this.request(); return;
    }
    if (this.tool === "eraser" && this.eraserMode === "stroke") { this.finishStrokeErase(layer); return; }
    const s = this.live; this.live = null;
    if (!s || !s.points.length) { this.request(); return; }
    if (this.snapped && s.shape) { this.snapped = null; this.commit(layer, { ...s, tool: "shape", points: [] }, s.tool === "eraser"); return; }
    this.commit(layer, s, s.tool === "eraser");
  }

  private cancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (e.pointerId === this.liveId) this.discardLive();
    if (!this.pointers.size) this.gesture = null;
  }

  private discardLive() {
    if (this.live?.tool === "eraser" && this.liveLayer) this.rebuild(this.liveLayer); // undo the incremental pixel erase
    this.live = null; this.lassoPath = null; this.shapeDrag = null; this.liveId = -1; this.liveLayer = null; this.snapped = null; this.clearHold();
    if (this.selMode) { this.selMode = null; }
    this.request();
  }

  private commit(layer: Layer, s: Stroke, alreadyDrawn = false) {
    layer.strokes.push(s);
    if (!alreadyDrawn) drawStroke(this.cx(layer), s, this.cs);
    this.push({ k: "add", layer: layer.id, stroke: s });
  }

  /** Pixel eraser: erases straight into the layer cache as you drag (idempotent), rebuilt from strokes if cancelled. */
  private eraseLive() {
    const l = this.liveLayer, s = this.live; if (!l || !s) return;
    drawStroke(this.cx(l), s, this.cs, true);
  }

  // ---- stroke eraser
  private eraseAt(x: number, y: number) {
    const l = this.liveLayer ?? this.activeLayer;
    const r = Math.max(6, this.size * 1.5);
    const hits = l.strokes.filter((s) => !this.erasedLive.has(s.id) && hit(s, x, y, r));
    if (!hits.length) return;
    hits.forEach((s) => this.erasedLive.add(s.id));
    this.rebuild(l, this.erasedLive);
    this.request();
  }
  private finishStrokeErase(layer: Layer) {
    if (!this.erasedLive.size) return;
    const items = layer.strokes.map((stroke, index) => ({ stroke, index })).filter((it) => this.erasedLive.has(it.stroke.id));
    layer.strokes = layer.strokes.filter((s) => !this.erasedLive.has(s.id));
    this.erasedLive.clear(); this.rebuild(layer);
    this.push({ k: "remove", layer: layer.id, items });
  }

  // ---- auto-straighten (Shapes > Auto): hold still to snap to a line, or a closed loop to an ellipse
  private armHold() { this.clearHold(); this.holdTimer = setTimeout(() => this.snap(), 550); }
  private clearHold() { if (this.holdTimer) clearTimeout(this.holdTimer); this.holdTimer = null; }
  private snap() {
    const s = this.live; if (!s || s.points.length < 3 || this.snapped) return;
    const a = s.points[0], b = s.points[s.points.length - 1];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const diag = Math.hypot(x1 - x0, y1 - y0);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < diag * 0.2 && diag > 30) { s.shape = { kind: "ellipse", a: [x0, y0], b: [x1, y1] }; this.snapped = "ellipse"; }
    else { s.shape = { kind: "line", a: [a[0], a[1]], b: [b[0], b[1]] }; this.snapped = "line"; }
    this.hooks.onToast(this.snapped === "line" ? "Straightened" : "Rounded");
    this.request();
  }
  private shapeSnapUpdate(x: number, y: number) {
    const s = this.live; if (!s?.shape || this.snapped !== "line") return;
    s.shape.b = [x, y];
  }

  // ---- lasso / selection
  private finishLasso(layer: Layer) {
    const poly = this.lassoPath!; this.lassoPath = null;
    if (poly.length < 3) { this.request(); return; }
    const ids = new Set<string>();
    for (const s of layer.strokes) {
      const pts = s.points.length ? s.points : s.shape ? [s.shape.a, s.shape.b, [(s.shape.a[0] + s.shape.b[0]) / 2, (s.shape.a[1] + s.shape.b[1]) / 2]] : s.text ? [[s.text.x, s.text.y]] : [];
      if (!pts.length) continue;
      const inside = pts.filter((p) => inPoly(p[0], p[1], poly)).length;
      if (inside / pts.length >= 0.5) ids.add(s.id);
    }
    if (!ids.size) { this.hooks.onToast("Nothing inside the loop."); this.request(); return; }
    this.startSelection(layer, ids);
  }
  private startSelection(layer: Layer, ids: Set<string>) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of layer.strokes) if (ids.has(s.id)) { const b = bbox(s, 0); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    this.selection = { ids, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, tf: { k: 1, dx: 0, dy: 0, ox: x0, oy: y0 } };
    this.rebuild(layer, ids); this.request(); this.hooks.onState();
  }
  private handleAt(p: { x: number; y: number }) {
    const s = this.selection!, b = s.box, tf = s.tf;
    const x = b.x + tf.dx, y = b.y + tf.dy;
    const w = b.w * tf.k, h = b.h * tf.k;
    const hs = 22 / this.scale;
    if (Math.hypot(p.x - (x + w), p.y - (y + h)) < hs) return "scale";
    if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h) return "move";
    return null;
  }
  private selectionDown(p: { x: number; y: number }) {
    if (!this.selection) return false;
    const h = this.handleAt(p);
    if (!h) { this.commitSelection(true); return false; }
    this.selMode = { kind: h, sx: p.x, sy: p.y, tf0: { ...this.selection.tf } };
    return true;
  }
  private selectionMove(p: { x: number; y: number }) {
    const m = this.selMode, s = this.selection; if (!m || !s) return;
    if (m.kind === "move") { s.tf.dx = m.tf0.dx + p.x - m.sx; s.tf.dy = m.tf0.dy + p.y - m.sy; }
    else {
      // scale about the box's top-left corner: the handle follows the pointer
      const b = s.box, x0 = b.x + m.tf0.dx, y0 = b.y + m.tf0.dy;
      s.tf.k = Math.max(0.1, Math.min(10, Math.hypot(p.x - x0, p.y - y0) / (Math.hypot(b.w, b.h) || 1)));
      s.tf.dx = m.tf0.dx; s.tf.dy = m.tf0.dy;
    }
    this.request();
  }
  private selectionUp() { this.selMode = null; this.request(); }

  /** Bake the pending move/scale into the strokes (one undo step). */
  commitSelection(_keepNothing = true) {
    const sel = this.selection; if (!sel) return;
    const layer = this.activeLayer;
    const before = layer.strokes.filter((s) => sel.ids.has(s.id));
    const t = sel.tf;
    const after = (t.k === 1 && t.dx === 0 && t.dy === 0) ? before : before.map((s) => transformed(s, t));
    this.selection = null; this.selMode = null;
    if (after !== before) { layer.strokes = layer.strokes.map((s) => after.find((x) => x.id === s.id) ?? s); this.rebuild(layer); this.push({ k: "update", layer: layer.id, before, after }); }
    else { this.rebuild(layer); this.request(); this.hooks.onState(); }
  }
  /** Recolour the lassoed strokes with the current colour. */
  recolourSelection() {
    const sel = this.selection; if (!sel) return;
    const ids = new Set(sel.ids), layer = this.activeLayer;
    this.commitSelection(true); // bake any pending move first
    const before = layer.strokes.filter((s) => ids.has(s.id));
    const after = before.map((s) => ({ ...s, color: this.color }));
    layer.strokes = layer.strokes.map((s) => after.find((x) => x.id === s.id) ?? s);
    this.push({ k: "update", layer: layer.id, before, after });
    this.rebuild(layer);
    this.startSelection(layer, ids);
  }
  deleteSelection() {
    const sel = this.selection; if (!sel) return;
    const layer = this.activeLayer;
    const items = layer.strokes.map((stroke, index) => ({ stroke, index })).filter((it) => sel.ids.has(it.stroke.id));
    layer.strokes = layer.strokes.filter((s) => !sel.ids.has(s.id)); this.selection = null; this.rebuild(layer);
    this.push({ k: "remove", layer: layer.id, items });
  }

  // ---- text
  addText(value: string, x: number, y: number) {
    const layer = this.activeLayer; if (!value.trim() || layer.locked || !layer.visible) return;
    this.commit(layer, { id: uid(), tool: "text", color: this.color, size: this.size, opacity: this.opacity, seed: 0, points: [], text: { value: value.slice(0, 200), x, y } });
  }

  // ---- tool state
  setTool(t: Tool) { if (t !== "lasso") this.commitSelection(true); this.tool = t; this.hooks.onState(); }
  setColor(c: string) { this.color = c; if (this.selection) this.recolourSelection(); else this.hooks.onState(); }

  // ---- rendering loop
  request() { this.dirty = true; }
  private loop = () => {
    if (this.destroyed) return;
    const t0 = performance.now();
    if (this.dirty) { this.dirty = false; this.render(); const dt = performance.now() - t0; if (this.fpsOn) { this.frames.push(dt); if (this.frames.length > 60) this.frames.shift(); } }
    if (this.fpsOn && t0 - this.lastStats > 500 && this.frames.length) {
      this.lastStats = t0; const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
      this.hooks.onStats?.(Math.round(Math.min(1000 / Math.max(avg, 1), 120)), Math.round(avg * 10) / 10);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private render() {
    const g = this.ctx, k = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(k * this.scale, 0, 0, k * this.scale, k * this.ox, k * this.oy);
    g.save(); g.shadowColor = "rgba(0,0,0,.10)"; g.shadowBlur = 20 * k; g.shadowOffsetY = 4 * k; g.fillStyle = "#fff"; g.fillRect(0, 0, this.doc.width, this.doc.height); g.restore();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    for (const l of this.doc.layers) {
      if (!l.visible) continue;
      if (l.strokes.length || l.guide || l.id === this.activeId) g.drawImage(this.cacheOf(l), 0, 0, this.doc.width, this.doc.height);
      if (l.id === this.activeId) {
        if (this.live && this.live.tool !== "eraser") {
          if (this.snapped && this.live.shape) drawStroke(g, { ...this.live, tool: "shape", points: [] }, this.cs, true);
          else drawStroke(g, this.live, this.cs, true);
        }
        if (this.shapeDrag) drawStroke(g, { id: "p", tool: "shape", color: this.color, size: this.size, opacity: this.opacity, seed: 0, points: [], shape: { kind: this.shapeDrag.kind, a: this.shapeDrag.a, b: this.shapeDrag.b } }, this.cs, true);
        if (this.selection) {
          const t = this.selection.tf;
          for (const s of l.strokes) if (this.selection.ids.has(s.id)) drawStroke(g, transformed(s, t), this.cs, true);
        }
      }
    }
    // lasso loop, selection box and handle (editor chrome, drawn in screen-sized units)
    const px = 1 / this.scale;
    if (this.lassoPath && this.lassoPath.length > 1) {
      g.save(); g.setLineDash([8 * px, 6 * px]); g.lineWidth = 2 * px; g.strokeStyle = "#0f766e"; g.beginPath();
      this.lassoPath.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.restore();
    }
    if (this.selection) {
      const s = this.selection, b = s.box, x = b.x + s.tf.dx, y = b.y + s.tf.dy, w = b.w * s.tf.k, h = b.h * s.tf.k;
      g.save(); g.setLineDash([7 * px, 5 * px]); g.lineWidth = 1.5 * px; g.strokeStyle = "#0f766e"; g.strokeRect(x, y, w, h); g.setLineDash([]);
      g.fillStyle = "#fff"; g.lineWidth = 2 * px; g.beginPath(); g.arc(x + w, y + h, 9 * px, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
    }
  }

  // ---- export (always from the vector data, never from the screen)
  render2x(scale = 2): HTMLCanvasElement {
    const W = Math.round(this.doc.width * scale), H = Math.round(this.doc.height * scale);
    const out = document.createElement("canvas"); out.width = W; out.height = H;
    const og = out.getContext("2d")!;
    const lc = document.createElement("canvas"); lc.width = W; lc.height = H;
    const lg = lc.getContext("2d")!;
    for (const l of this.doc.layers) {
      if (!l.visible || l.guide) continue;
      lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, W, H); lg.setTransform(scale, 0, 0, scale, 0, 0);
      for (const s of l.strokes) drawStroke(lg, s, scale);
      og.drawImage(lc, 0, 0);
    }
    return out;
  }
  async toPngBlob(scale = 2): Promise<Blob> {
    this.commitSelection(true);
    const c = this.render2x(scale);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not render the picture"))), "image/png"));
  }
  toJSON(): Doc { this.commitSelection(true); return JSON.parse(JSON.stringify(this.doc)); }
}
