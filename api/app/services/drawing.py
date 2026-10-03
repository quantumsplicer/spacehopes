"""Drawing documents: validation, server-side SVG generation (so we never store client-supplied SVG),
and a simple PNG renderer used for seed data. The vector JSON is the source of truth."""
import html
import io
import re
from typing import Literal

from PIL import Image, ImageDraw
from pydantic import BaseModel, Field, field_validator

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
Tool = Literal["pen", "pencil", "colour", "marker", "brush", "eraser", "shape", "text"]


class Stroke(BaseModel):
    id: str = Field(max_length=40)
    tool: Tool
    color: str
    size: float = Field(ge=0.2, le=400)
    opacity: float = Field(ge=0, le=1)
    seed: int = 0
    points: list[list[float]] = Field(default_factory=list, max_length=30000)
    shape: dict | None = None  # {"kind": "line"|"rect"|"ellipse", "a": [x,y], "b": [x,y]}
    text: dict | None = None  # {"value": str, "x": float, "y": float}

    @field_validator("color")
    @classmethod
    def _color(cls, v):
        if not HEX.match(v):
            raise ValueError("bad colour")
        return v


class Layer(BaseModel):
    id: str = Field(max_length=40)
    name: str = Field(max_length=40)
    visible: bool = True
    locked: bool = False
    guide: bool = False  # "photo to trace" layers are never exported
    image: str | None = Field(default=None, max_length=3_000_000)
    strokes: list[Stroke] = Field(default_factory=list, max_length=9000)

    @field_validator("image")
    @classmethod
    def _img(cls, v):
        if v is not None and not re.match(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", v):
            raise ValueError("bad image")
        return v


class DrawingDoc(BaseModel):
    version: int = 1
    width: int = Field(ge=100, le=4000)
    height: int = Field(ge=100, le=4000)
    layers: list[Layer] = Field(max_length=12)


def _f(n: float) -> str:
    return f"{n:.1f}".rstrip("0").rstrip(".")


def _path(points: list[list[float]]) -> str:
    if not points:
        return ""
    if len(points) == 1:
        x, y = points[0][:2]
        return f"M{_f(x)} {_f(y)}l.01 0"
    d = [f"M{_f(points[0][0])} {_f(points[0][1])}"]
    for i in range(1, len(points) - 1):
        mx, my = (points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2
        d.append(f"Q{_f(points[i][0])} {_f(points[i][1])} {_f(mx)} {_f(my)}")
    d.append(f"L{_f(points[-1][0])} {_f(points[-1][1])}")
    return "".join(d)


def to_svg(doc: DrawingDoc) -> str | None:
    """A self-animating SVG (stroke-dashoffset draw-in). Returns None if the doc cannot be vectorised
    faithfully (pixel eraser strokes)."""
    items: list[Stroke] = []
    for layer in doc.layers:
        if layer.visible and not layer.guide:
            items += layer.strokes
    if any(s.tool == "eraser" for s in items):
        return None
    n = max(len(items), 1)
    step = min(0.22, 2.6 / n)
    out = []
    for i, s in enumerate(items):
        delay = f"{i * step:.2f}s"
        col, op = s.color, s.opacity
        if s.tool == "text" and s.text:
            out.append(f'<text class="t" style="animation-delay:{delay}" x="{_f(s.text["x"])}" y="{_f(s.text["y"])}" '
                       f'font-family="Georgia,serif" font-size="{_f(s.size * 4)}" fill="{col}" opacity="{op}">'
                       f'{html.escape(str(s.text["value"])[:300])}</text>')
        elif s.tool == "shape" and s.shape and len(s.points) < 2:
            a, b = s.shape.get("a", [0, 0]), s.shape.get("b", [0, 0])
            kind = s.shape.get("kind")
            base = f'class="t" style="animation-delay:{delay}" fill="none" stroke="{col}" stroke-width="{_f(s.size)}" opacity="{op}" stroke-linecap="round"'
            if kind == "rect":
                out.append(f'<rect {base} x="{_f(min(a[0], b[0]))}" y="{_f(min(a[1], b[1]))}" width="{_f(abs(a[0]-b[0]))}" height="{_f(abs(a[1]-b[1]))}"/>')
            elif kind == "ellipse":
                out.append(f'<ellipse {base} cx="{_f((a[0]+b[0])/2)}" cy="{_f((a[1]+b[1])/2)}" rx="{_f(abs(a[0]-b[0])/2)}" ry="{_f(abs(a[1]-b[1])/2)}"/>')
            else:
                out.append(f'<path {base} d="M{_f(a[0])} {_f(a[1])}L{_f(b[0])} {_f(b[1])}"/>')
        else:
            w = s.size * (2 if s.tool == "marker" else 1)
            if s.tool == "marker":
                op = min(op, 1) * 0.6
            out.append(f'<path class="s" pathLength="1" style="animation-delay:{delay}" d="{_path(s.points)}" fill="none" '
                       f'stroke="{col}" stroke-width="{_f(w)}" stroke-linecap="round" stroke-linejoin="round" opacity="{op}"/>')
    css = ("@keyframes d{to{stroke-dashoffset:0}}@keyframes f{to{opacity:1}}"
           ".s{stroke-dasharray:1 2;stroke-dashoffset:1;animation:d .8s ease-out forwards}"
           ".t{opacity:0;animation:f .6s ease forwards}"
           "@media (prefers-reduced-motion:reduce){.s{animation:none;stroke-dashoffset:0}.t{animation:none;opacity:1}}")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {doc.width} {doc.height}" width="{doc.width}" '
            f'height="{doc.height}"><style>{css}</style>{"".join(out)}</svg>')


def render_png(doc: DrawingDoc, scale: float = 1.0) -> bytes:
    """Plain renderer (no grain/pressure): used for seed drawings."""
    W, H = round(doc.width * scale), round(doc.height * scale)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for layer in doc.layers:
        if not layer.visible or layer.guide:
            continue
        for s in layer.strokes:
            rgb = tuple(int(s.color[i:i + 2], 16) for i in (1, 3, 5)) + (round(255 * s.opacity),)
            w = max(1, round(s.size * scale))
            if s.tool == "shape" and s.shape:
                a, b = s.shape["a"], s.shape["b"]
                box = [min(a[0], b[0]) * scale, min(a[1], b[1]) * scale, max(a[0], b[0]) * scale, max(a[1], b[1]) * scale]
                if s.shape.get("kind") == "ellipse":
                    d.ellipse(box, outline=rgb, width=w)
                elif s.shape.get("kind") == "rect":
                    d.rectangle(box, outline=rgb, width=w)
                else:
                    d.line([a[0] * scale, a[1] * scale, b[0] * scale, b[1] * scale], fill=rgb, width=w)
                continue
            pts = [(p[0] * scale, p[1] * scale) for p in s.points]
            if len(pts) > 1:
                d.line(pts, fill=rgb, width=w, joint="curve")
            for x, y in (pts[:1] + pts[-1:]):
                d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=rgb)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
