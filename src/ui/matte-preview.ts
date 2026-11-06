// What a person sees when judging a matte: the picture over black (kept parts only) and, under it,
// the whole frame with the excluded parts washed red — a person missing a head shows a red head on
// top of a bright torso. Plus the matte's pieces (connected components) so a report can name them.
// Pure functions on downscaled buffers; the rendering happens in After Effects (ae_object_matte_ui).

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatteComponent {
  /** bounding box in COMP pixels: [x, y, w, h] */
  bbox: [number, number, number, number];
  /** share of the previewed region, % */
  area_pct: number;
}

export interface MatteStats {
  /** mean alpha over the region, % */
  coverage_pct: number;
  /** separate pieces of the matte (alpha > 0.5, 4-connected) */
  pieces: number;
  /** the largest pieces, biggest first */
  largest: MatteComponent[];
  /** pieces smaller than 0.05 % of the region — specks, stray fragments */
  small_fragments: number;
}

/**
 * Pieces of the matte at preview resolution. `step` = comp pixels per preview pixel, `origin` = the
 * region's top-left in comp pixels, so boxes come back in the same space as ae_object_matte_ui points.
 */
export function matteStats(
  alpha: Float64Array,
  w: number,
  h: number,
  step: number,
  origin: { x: number; y: number },
  keep = 15,
): MatteStats {
  const n = w * h;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += alpha[i];
  const label = new Int32Array(n).fill(-1);
  const comps: { area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (label[i] !== -1 || alpha[i] <= 0.5) continue;
    const id = comps.length;
    const c = { area: 0, x0: w, y0: h, x1: -1, y1: -1 };
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w,
        y = (j - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      const nb = [
        x > 0 ? j - 1 : -1,
        x < w - 1 ? j + 1 : -1,
        y > 0 ? j - w : -1,
        y < h - 1 ? j + w : -1,
      ];
      for (const k of nb) {
        if (k >= 0 && label[k] === -1 && alpha[k] > 0.5) {
          label[k] = id;
          stack.push(k);
        }
      }
    }
    comps.push(c);
  }
  comps.sort((a, b) => b.area - a.area);
  const small = comps.filter((c) => c.area / n < 0.0005).length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    coverage_pct: r1((sum / Math.max(1, n)) * 100),
    pieces: comps.length,
    largest: comps.slice(0, keep).map((c) => ({
      bbox: [
        Math.round(origin.x + c.x0 * step),
        Math.round(origin.y + c.y0 * step),
        Math.round((c.x1 - c.x0 + 1) * step),
        Math.round((c.y1 - c.y0 + 1) * step),
      ],
      area_pct: Math.round((c.area / n) * 10000) / 100,
    })),
    small_fragments: small,
  };
}

/**
 * The preview image: on top the matted picture over black (`matte` is premultiplied RGB), below —
 * if the plate is given — the plate with the excluded parts washed red, a 6 px grey bar between.
 * Returns row-major RGB 0..1 of size w × (h or 2h + 6).
 */
export function composePreview(
  matte: Float64Array,
  alpha: Float64Array,
  plate: Float64Array | null,
  w: number,
  h: number,
): { rgb: Float64Array; w: number; h: number } {
  const bar = plate ? 6 : 0;
  const H = plate ? h * 2 + bar : h;
  const out = new Float64Array(w * H * 3);
  out.set(matte.subarray(0, w * h * 3), 0);
  if (!plate) return { rgb: out, w, h: H };
  for (let i = w * h * 3; i < w * (h + bar) * 3; i++) out[i] = 0.5;
  const base = w * (h + bar) * 3;
  for (let i = 0; i < w * h; i++) {
    const a = Math.max(0, Math.min(1, alpha[i]));
    const r = plate[i * 3],
      g = plate[i * 3 + 1],
      b = plate[i * 3 + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // excluded: a red wash that keeps the shapes readable
    const er = 0.3 + 0.6 * lum,
      eg = 0.12 * lum,
      eb = 0.12 * lum;
    out[base + i * 3] = a * r + (1 - a) * er;
    out[base + i * 3 + 1] = a * g + (1 - a) * eg;
    out[base + i * 3 + 2] = a * b + (1 - a) * eb;
  }
  return { rgb: out, w, h: H };
}

/** Integer downscale step so the region fits `maxWidth` preview pixels. */
export function previewStep(regionW: number, maxWidth: number): number {
  return Math.max(1, Math.ceil(regionW / Math.max(1, maxWidth)));
}

// ---------------------------------------------------------------------------------------------
// Pointing at what the eye misses: the gaps between kept pieces (where a person hidden behind
// another, a lying figure or a child deep in a group tends to be left out), the people the agent
// listed — each point in or out of the matte — and markers drawn on the preview for both.

export interface Point2 {
  x: number;
  y: number;
}

/** 4-connected pieces of a binary mask: area and box, biggest first. */
export function maskPieces(
  mask: Uint8Array,
  w: number,
  h: number,
): { area: number; x0: number; y0: number; x1: number; y1: number }[] {
  const n = w * h;
  const seen = new Uint8Array(n);
  const out: { area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    const c = { area: 0, x0: w, y0: h, x1: -1, y1: -1 };
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w,
        y = (j - x) / w;
      c.area++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x > 0 && mask[j - 1] && !seen[j - 1]) {
        seen[j - 1] = 1;
        stack.push(j - 1);
      }
      if (x < w - 1 && mask[j + 1] && !seen[j + 1]) {
        seen[j + 1] = 1;
        stack.push(j + 1);
      }
      if (y > 0 && mask[j - w] && !seen[j - w]) {
        seen[j - w] = 1;
        stack.push(j - w);
      }
      if (y < h - 1 && mask[j + w] && !seen[j + w]) {
        seen[j + w] = 1;
        stack.push(j + w);
      }
    }
    out.push(c);
  }
  return out.sort((a, b) => b.area - a.area);
}

/** Square-kernel morphology along one axis with prefix sums; outside the image is 0. */
function morph1d(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
  horizontal: boolean,
  dilate: boolean,
): Uint8Array {
  const out = new Uint8Array(w * h);
  const len = horizontal ? w : h,
    lines = horizontal ? h : w;
  const pre = new Int32Array(len + 1);
  for (let L = 0; L < lines; L++) {
    for (let k = 0; k < len; k++) pre[k + 1] = pre[k] + src[horizontal ? L * w + k : k * w + L];
    for (let k = 0; k < len; k++) {
      const a = Math.max(0, k - r),
        b = Math.min(len - 1, k + r);
      const s = pre[b + 1] - pre[a];
      // outside the image counts as 0 for both: dilation = any 1 in the window, erosion = the whole window 1
      const v = dilate ? (s > 0 ? 1 : 0) : s === 2 * r + 1 ? 1 : 0;
      out[horizontal ? L * w + k : k * w + L] = v;
    }
  }
  return out;
}

/** Morphological closing (dilate then erode) with a (2r+1)² square — fills gaps narrower than ~2r. */
export function closeMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return mask.slice();
  // pad by r+1 zeros so the dilated set has room and the erosion sees the true outside (0), then crop —
  // otherwise anything that touches the frame edge after dilation would never erode back
  const p = r + 1,
    W = w + 2 * p,
    H = h + 2 * p;
  const big = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) big.set(mask.subarray(y * w, (y + 1) * w), (y + p) * W + p);
  const d = morph1d(morph1d(big, W, H, r, true, true), W, H, r, false, true);
  const c = morph1d(morph1d(d, W, H, r, true, false), W, H, r, false, false);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(c.subarray((y + p) * W + p, (y + p) * W + p + w), y * w);
  return out;
}

export interface MatteGap {
  n: number;
  /** comp pixels [x, y, w, h] */
  bbox: [number, number, number, number];
  area_pct: number;
}

/**
 * Excluded pockets wedged between kept pieces: closing of the matte minus the matte. Not every gap
 * is a miss (sky between heads, ground between legs) — each is a place to look.
 */
export function findGaps(
  alpha: Float64Array,
  w: number,
  h: number,
  step: number,
  origin: Point2,
  radiusComp = 100,
  keep = 10,
): MatteGap[] {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = alpha[i] > 0.5 ? 1 : 0;
  const closed = closeMask(mask, w, h, Math.max(1, Math.round(radiusComp / step)));
  const gap = new Uint8Array(n);
  for (let i = 0; i < n; i++) gap[i] = closed[i] && !mask[i] ? 1 : 0;
  const minArea = Math.max(4, n * 0.0005);
  return maskPieces(gap, w, h)
    .filter((c) => c.area >= minArea)
    .slice(0, keep)
    .map((c, i) => ({
      n: i + 1,
      bbox: [
        Math.round(origin.x + c.x0 * step),
        Math.round(origin.y + c.y0 * step),
        Math.round((c.x1 - c.x0 + 1) * step),
        Math.round((c.y1 - c.y0 + 1) * step),
      ],
      area_pct: Math.round((c.area / n) * 10000) / 100,
    }));
}

export interface PersonSpec {
  id: number;
  name?: string;
  head?: Point2;
  body?: Point2;
  feet?: Point2;
}
export type PointState = "in" | "out" | "off_preview";
export interface PersonCheck {
  id: number;
  name?: string;
  head?: PointState;
  body?: PointState;
  feet?: PointState;
  status: "whole" | "partial" | "missing" | "off_preview";
}

/** Alpha around a comp-pixel point (mean in a small disc) → in / out of the matte. */
function sampleState(
  alpha: Float64Array,
  w: number,
  h: number,
  step: number,
  origin: Point2,
  p: Point2,
): PointState {
  const cx = (p.x - origin.x) / step,
    cy = (p.y - origin.y) / step;
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return "off_preview";
  const r = Math.max(1, Math.round(12 / step));
  let s = 0,
    k = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(cx + dx),
        y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      s += alpha[y * w + x];
      k++;
    }
  }
  return k && s / k > 0.5 ? "in" : "out";
}

/** Each listed person's points against the matte: whole = all given points in, missing = none. */
export function checkPeople(
  alpha: Float64Array,
  w: number,
  h: number,
  step: number,
  origin: Point2,
  people: PersonSpec[],
): PersonCheck[] {
  return people.map((p) => {
    const r: PersonCheck = { id: p.id, ...(p.name ? { name: p.name } : {}), status: "whole" };
    const st: PointState[] = [];
    for (const key of ["head", "body", "feet"] as const) {
      const q = p[key];
      if (!q) continue;
      const s = sampleState(alpha, w, h, step, origin, q);
      r[key] = s;
      st.push(s);
    }
    const on = st.filter((s) => s !== "off_preview");
    if (!on.length) r.status = "off_preview";
    else if (on.every((s) => s === "in")) r.status = "whole";
    else if (on.some((s) => s === "in")) r.status = "partial";
    else r.status = "missing";
    return r;
  });
}

// --- drawing on the composed preview (row-major RGB 0..1) -------------------------------------

const DIGITS: Record<string, string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};
type RGB = [number, number, number];

function put(img: { rgb: Float64Array; w: number; h: number }, x: number, y: number, c: RGB): void {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 3;
  img.rgb[i] = c[0];
  img.rgb[i + 1] = c[1];
  img.rgb[i + 2] = c[2];
}

function rect(
  img: { rgb: Float64Array; w: number; h: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGB,
  t: number,
): void {
  for (let k = 0; k < t; k++) {
    for (let x = x0; x <= x1; x++) {
      put(img, x, y0 + k, c);
      put(img, x, y1 - k, c);
    }
    for (let y = y0; y <= y1; y++) {
      put(img, x0 + k, y, c);
      put(img, x1 - k, y, c);
    }
  }
}

function ring(
  img: { rgb: Float64Array; w: number; h: number },
  cx: number,
  cy: number,
  r: number,
  c: RGB,
  t: number,
): void {
  for (let y = -r - t; y <= r + t; y++) {
    for (let x = -r - t; x <= r + t; x++) {
      const d = Math.hypot(x, y);
      if (d >= r - t / 2 && d <= r + t / 2) put(img, cx + x, cy + y, c);
    }
  }
}

function label(
  img: { rgb: Float64Array; w: number; h: number },
  x: number,
  y: number,
  text: string,
  c: RGB,
  s: number,
): void {
  const wPx = text.length * 4 * s + s,
    hPx = 7 * s;
  for (let yy = 0; yy < hPx; yy++)
    for (let xx = 0; xx < wPx; xx++) put(img, x + xx, y + yy, [0, 0, 0]);
  for (let i = 0; i < text.length; i++) {
    const g = DIGITS[text[i]];
    if (!g) continue;
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 3; gx++) {
        if (g[gy][gx] !== "1") continue;
        for (let yy = 0; yy < s; yy++)
          for (let xx = 0; xx < s; xx++)
            put(img, x + s + i * 4 * s + gx * s + xx, y + s + gy * s + yy, c);
      }
  }
}

export const MARK = { gap: [0, 1, 1] as RGB, in: [0.2, 1, 0.2] as RGB, out: [1, 1, 0] as RGB };

/**
 * Draw the gap boxes (cyan, numbered) and every listed person's points (green ring = in the matte,
 * yellow = out, the person's number next to the head) on each panel of the composed preview.
 */
export function drawMarkers(
  img: { rgb: Float64Array; w: number; h: number },
  panelH: number,
  panels: number,
  step: number,
  origin: Point2,
  gaps: MatteGap[],
  people: PersonSpec[],
  checks: PersonCheck[],
): void {
  const s = Math.max(2, Math.round(img.w / 300));
  const t = Math.max(2, Math.round(img.w / 500));
  const toPx = (x: number, y: number) => ({ x: (x - origin.x) / step, y: (y - origin.y) / step });
  for (let p = 0; p < panels; p++) {
    const oy = p * (panelH + 6);
    for (const g of gaps) {
      const a = toPx(g.bbox[0], g.bbox[1]);
      const b = toPx(g.bbox[0] + g.bbox[2], g.bbox[1] + g.bbox[3]);
      rect(
        img,
        Math.round(a.x),
        Math.round(a.y + oy),
        Math.round(b.x),
        Math.round(b.y + oy),
        MARK.gap,
        t,
      );
      label(img, Math.round(a.x) + t, Math.round(a.y + oy) + t, String(g.n), MARK.gap, s);
    }
    for (const person of people) {
      const chk = checks.find((c) => c.id === person.id);
      for (const key of ["head", "body", "feet"] as const) {
        const q = person[key];
        if (!q) continue;
        const st = chk?.[key];
        if (st === "off_preview") continue;
        const c = toPx(q.x, q.y);
        ring(img, c.x, c.y + oy, Math.max(4, 3 * s), st === "in" ? MARK.in : MARK.out, t);
        if (key === (person.head ? "head" : person.body ? "body" : "feet")) {
          label(
            img,
            Math.round(c.x + 4 * s),
            Math.round(c.y + oy - 9 * s),
            String(person.id),
            st === "in" && chk?.status === "whole" ? MARK.in : MARK.out,
            s,
          );
        }
      }
    }
  }
}
