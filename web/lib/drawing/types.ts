export type StrokeTool = "pen" | "pencil" | "colour" | "marker" | "brush" | "eraser" | "shape" | "text";
export type Tool = "pen" | "pencil" | "colour" | "marker" | "brush" | "eraser" | "lasso" | "shape" | "text";
export type ShapeKind = "auto" | "line" | "rect" | "ellipse";
export type EraserMode = "pixel" | "stroke";

export type Pt = number[]; // [x, y, pressure]
export type Stroke = {
  id: string; tool: StrokeTool; color: string; size: number; opacity: number; seed: number;
  points: Pt[];
  shape?: { kind: "line" | "rect" | "ellipse"; a: [number, number]; b: [number, number] };
  text?: { value: string; x: number; y: number };
};
export type Layer = { id: string; name: string; visible: boolean; locked: boolean; guide?: boolean; image?: string; strokes: Stroke[] };
/** The vector document is the source of truth: layers, then strokes. PNG/WebP/SVG are rendered from it. */
export type Doc = { version: 1; width: number; height: number; layers: Layer[] };

export const DOC_W = 1600, DOC_H = 1350;

export const SWATCHES: { name: string; hex: string }[] = [
  { name: "Black", hex: "#1a1a1a" }, { name: "Graphite", hex: "#4a4a4a" }, { name: "Silver", hex: "#a3a3a3" }, { name: "White", hex: "#ffffff" },
  { name: "Crimson", hex: "#c62828" }, { name: "Rose", hex: "#e57399" }, { name: "Saffron", hex: "#e8a317" }, { name: "Ochre", hex: "#c9a227" },
  { name: "Leaf", hex: "#2f7d4f" }, { name: "Teal", hex: "#0f766e" }, { name: "Indigo", hex: "#3b4fb8" }, { name: "Violet", hex: "#6a3fb5" }, { name: "Earth", hex: "#795548" },
];

export const TOOL_LABEL: Record<Tool, string> = { pen: "Pen", pencil: "Pencil", colour: "Colour pencil", marker: "Marker", brush: "Brush", eraser: "Eraser", lasso: "Lasso", shape: "Shapes", text: "Text" };

export const newDoc = (): Doc => ({
  version: 1, width: DOC_W, height: DOC_H,
  layers: [
    { id: "L" + Math.random().toString(36).slice(2, 8), name: "Background", visible: true, locked: false, strokes: [] },
    { id: "L" + Math.random().toString(36).slice(2, 8), name: "Ink", visible: true, locked: false, strokes: [] },
    { id: "L" + Math.random().toString(36).slice(2, 8), name: "Colour", visible: true, locked: false, strokes: [] },
  ],
});
