// Object Matte in After Effects through its UI (no scripting API creates a selection): the picture of
// the Layer panel on a window capture, the mapping of layer pixels to screen points, and the bookkeeping
// of the strokes («Add object N», «Add lasso N», «Remove object N») the effect ADBE Samurai records.
// Facts from the live spike on After Effects 26.5 (macOS, 4K at 1:1, 05.11.2026):
//  - Option+W is the shortcut of the Roto Brush tool GROUP (Roto Brush, Refine Edge, Object Matte, Quick
//    Selection): it selects the group's current member and, pressed while one is active, cycles to the
//    next — 06.11 a blind press pushed Object Matte to Quick Selection and a lasso took the whole frame;
//    Project.toolType reports Object Matte as code 161 on AE 26.5, the tool presses until that is active;
//  - the Object Matte tool acts in the Layer panel; hovering previews the subject; a click
//    takes the subject under it as Sensei segments it — a lone figure whole, in a crowd often only a
//    garment or a torso (06.11: headless torsos); Shift-click adds, Option-click subtracts; with the
//    marquee in Lasso mode a closed drag takes the subjects inside the outline snapped to their
//    silhouettes — a whole group at once (Option-drag subtracts); the mode is set once;
//  - the panel's picture can shift by a few pixels after a stroke (the first one creates the effect):
//    06.11 it moved 6 px up and every later click of that call landed ~25 layer px low — so the
//    picture is found again after every action;
//  - every click or lasso becomes a stroke under Effects › Object Matte › Selections with its position in
//    LAYER pixels (ADBE Paint Position) and the frame it was made on (ADBE Paint Duration), so what the
//    tool did is read back by script, never guessed from the screen;
//  - propagation runs when the composition's time moves while the layer is open in the Layer panel —
//    a script stepping comp.time frame by frame is enough; the matte renders in the layer's alpha.
import { type GrayImage, type RgbImage, toGray } from "./image.js";
import { type Capture } from "./mac.js";

export interface Point {
  x: number;
  y: number;
}
export type Shape = { kind: "point"; x: number; y: number } | { kind: "lasso"; points: Point[] };

/** Where the Layer panel shows the layer: a rectangle in capture pixels and the layer size in it. */
export interface PictureRect {
  found: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  layerW: number;
  layerH: number;
  score: number;
  hint?: string;
}

/**
 * The viewer background is one flat colour; the picture is the rectangle of the expected size whose
 * pixels differ from it and whose rim just outside does not. Screens are scanned on a coarse grid
 * with integral images, then refined to the pixel. `expectedW/H` = layer size × viewer zoom × capture
 * scale; the tolerance covers rounding of the zoom.
 */
export function findPicture(
  cap: Capture,
  expectedW: number,
  expectedH: number,
  layerW: number,
  layerH: number,
): PictureRect {
  const img = cap.img;
  const g = toGray(img);
  const bg = viewerBackground(g);
  const W = g.w,
    H = g.h;
  // binary "not background" map + integral image
  const ii = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += Math.abs(g.data[y * W + x] - bg) > 10 ? 1 : 0;
      ii[(y + 1) * (W + 1) + (x + 1)] = ii[y * (W + 1) + (x + 1)] + row;
    }
  }
  const sum = (x0: number, y0: number, x1: number, y1: number): number => {
    // inclusive-exclusive box [x0,x1) × [y0,y1)
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(W, x1);
    y1 = Math.min(H, y1);
    if (x1 <= x0 || y1 <= y0) return 0;
    return (
      ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0]
    );
  };
  const w = Math.round(expectedW),
    h = Math.round(expectedH);
  if (w < 40 || h < 40 || w > W || h > H) {
    return {
      found: false,
      x: 0,
      y: 0,
      w,
      h,
      layerW,
      layerH,
      score: 0,
      hint: `expected picture ${w}×${h} px does not fit the capture ${W}×${H}`,
    };
  }
  const area = w * h;
  const rim = 6;
  let best = { s: -1, x: 0, y: 0 };
  const scoreAt = (x: number, y: number): number => {
    const inside = sum(x, y, x + w, y + h) / area;
    const outsideArea = (w + 2 * rim) * (h + 2 * rim) - area;
    const outside =
      (sum(x - rim, y - rim, x + w + rim, y + h + rim) - sum(x, y, x + w, y + h)) / outsideArea;
    return inside - 2 * outside;
  };
  const step = 4;
  for (let y = 0; y + h <= H; y += step) {
    for (let x = 0; x + w <= W; x += step) {
      const s = scoreAt(x, y);
      if (s > best.s) best = { s, x, y };
    }
  }
  for (let dy = -step; dy <= step; dy++) {
    for (let dx = -step; dx <= step; dx++) {
      const x = best.x + dx,
        y = best.y + dy;
      if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
      const s = scoreAt(x, y);
      if (s > best.s) best = { s, x, y };
    }
  }
  const found = best.s > 0.55;
  return {
    found,
    x: best.x,
    y: best.y,
    w,
    h,
    layerW,
    layerH,
    score: Math.round(best.s * 1000) / 1000,
    hint: found
      ? undefined
      : "the Layer panel's picture was not found at the expected size — the panel may be too small for the picture (enlarge it or lower the zoom), hidden, or showing another layer",
  };
}

/** The most common dark value in the capture — the viewer background around the picture. */
export function viewerBackground(g: GrayImage): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) hist[Math.max(0, Math.min(255, Math.round(g.data[i])))]++;
  let best = 0;
  for (let v = 0; v < 80; v++) if (hist[v] > hist[best]) best = v;
  return best;
}

/** Layer pixel → capture pixel. */
export function layerToShot(r: PictureRect, p: Point): Point {
  return { x: r.x + (p.x * r.w) / r.layerW, y: r.y + (p.y * r.h) / r.layerH };
}

/** Capture pixel → layer pixel. */
export function shotToLayer(r: PictureRect, p: Point): Point {
  return { x: (p.x - r.x) * (r.layerW / r.w), y: (p.y - r.y) * (r.layerH / r.h) };
}

export interface StrokeInfo {
  index: number;
  name: string;
  /** "add" | "subtract" by the stroke's blend mode (1 = add, else subtract) */
  mode: "add" | "subtract";
  /** layer pixels of the click / the first lasso vertex */
  position: [number, number] | null;
  /** [start, duration] in seconds — the frame the stroke was made on */
  duration: [number, number] | null;
}

/** Strokes present after an action and not before, by name — the readback of what the UI did. */
export function newStrokes(before: StrokeInfo[], after: StrokeInfo[]): StrokeInfo[] {
  const seen = new Set(before.map((s) => s.name));
  return after.filter((s) => !seen.has(s.name));
}

/** Distance in layer pixels between where a stroke landed and where it was meant to. */
export function strokeError(s: StrokeInfo, wanted: Point): number | null {
  if (!s.position) return null;
  return Math.round(Math.hypot(s.position[0] - wanted.x, s.position[1] - wanted.y) * 10) / 10;
}

/** A lasso needs at least three distinct points and is closed by the tool itself. */
export function normalizeLasso(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 1) out.push({ x: p.x, y: p.y });
  }
  if (out.length >= 3) {
    const a = out[0],
      z = out[out.length - 1];
    if (Math.hypot(a.x - z.x, a.y - z.y) > 1) out.push({ x: a.x, y: a.y });
  }
  return out;
}

export function sizeOf(img: RgbImage): { w: number; h: number } {
  return { w: img.w, h: img.h };
}
