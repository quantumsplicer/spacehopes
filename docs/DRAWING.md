# Drawing studio

Open it from the editor (`/` then **Drawing**, or **Draw** on a thought) or from *Studio > Drawings*.

## Data model

The **vector JSON is the source of truth**: layers, then strokes. Each stroke has `tool`, `color`, `size`, `opacity`, `seed` and `points` `[x, y, pressure]`; shapes carry `shape` (`line | rect | ellipse` with corners) and text carries `text`. The canvas is 1600×1350.

On **Add to post** the browser renders a transparent PNG at 2× from the vector data (not from the screen) and uploads it with the JSON. The server then produces:

* WebP and AVIF at 640 / 1280 / 1600 px, with alpha;
* the original PNG (`full.png`);
* a **self-animating SVG**, generated *server-side* from the JSON (never accepted from the browser), used for the one-time draw-in animation. Documents containing pixel-eraser strokes cannot be vectorised faithfully, so they skip the SVG and simply fade in;
* the JSON itself, so reopening the drawing keeps it editable. Saving again updates the same drawing everywhere it is used.

Drafts autosave to **IndexedDB** every 5 seconds; reopening offers to continue.

There is **no stroke replay or time-lapse**. The reading-page animation is a one-time load effect.

## Input

* Pointer Events, `touch-action: none`, pressure, `altitudeAngle` (tilt widens pencil and colour-pencil marks, for shading) and `getCoalescedEvents()`.
* **Pencil only** switch: touch is ignored for drawing (palm rejection). Even with it off, touches are ignored while the Pencil is down.
* Two fingers pan and pinch-zoom. **Two-finger tap = undo, three-finger tap = redo.** Mouse: wheel pans, Ctrl/⌘ + wheel zooms, middle button or Space + drag pans.
* Suppressed: Scribble and the magnifier loupe (touchstart/move default prevented, no text selection or callout), double-tap zoom and Safari's pinch gesture.

## Tools

Pen · Pencil · **Colour pencil** (paper-tooth grain that gets denser with firmer pressure) · Marker (translucent, no build-up) · Brush (tapered) · Eraser (pixel, or whole strokes; tap the active eraser to switch) · Lasso (drag a loop; move, scale from the corner handle, **Recolour** with the current colour, Delete) · Shapes (tap the active tool for *Hold to straighten*, Line, Rectangle, Ellipse; in the first mode, hold still for 0.5 s to snap a stroke to a line, or a closed loop to an ellipse) · Text.

13 swatches (Black, Graphite, Silver, White, Crimson, Rose, Saffron, Ochre, Leaf, Teal, Indigo, Violet, Earth), a custom colour picker and recent colours. Three sizes and an opacity slider. Colour applies to every tool.

**Layers**: up to 12; hide, lock, reorder, rename, delete; *Import a photo to trace* adds a locked guide layer (45% opacity) that is never exported.

## Rendering and performance

* perfect-freehand outlines, cached per stroke as `Path2D`.
* One offscreen canvas per layer for committed strokes; each animation frame only draws the layer caches plus the live stroke, and only when something changed (`requestAnimationFrame`).
* DPR-aware sizing, capped at 2×, and reduced further so the display canvas never exceeds ~14 M pixels; layer caches at ≤1.5× (Safari canvas memory limit).
* Grain tools render in an isolated scratch canvas per stroke, so overlaps do not build up and the grain can be rubbed out.
* **FPS overlay**: shown only when `NEXT_PUBLIC_DEV_TOOLS=1` (development build). Target is under 16 ms per frame.
* Undo/redo rebuild only the affected layer. Hundreds of undo steps are kept.

## What needs a real iPad (not yet done)

Please check on an iPad with an Apple Pencil and report:

1. Pressure and tilt feel; no lag on long strokes with the colour pencil.
2. Palm rejection with and without **Pencil only**; two- and three-finger tap timing.
3. No loupe, selection handles or page zoom appear while drawing; Scribble does not engage on the canvas.
4. Smoothness with 2,000+ strokes (enable the FPS overlay with a dev build) and that Safari does not reload the tab for memory.
5. Saving a large drawing (the PNG is 3200×2700) on iPad memory.
