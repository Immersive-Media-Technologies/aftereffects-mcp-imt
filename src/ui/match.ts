// Template matching for the Object Mask UI tools: zero-mean normalized cross-correlation (NCC) through
// a radix-2 FFT, a coarse-to-fine search for small UI icons and a multi-scale search for the Program
// Monitor picture (the exported frame inside a screenshot). Pure TypeScript, no native modules.
import { type GrayImage, cropGray, downscaleGray, resizeGray } from "./image.js";

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 FFT of length n (n a power of two). `inverse` does not divide by n. */
export function fft1(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang),
      wi = Math.sin(ang),
      half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k,
          b = a + half;
        const xr = re[b] * cr - im[b] * ci,
          xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** 2D FFT over an N×M buffer (N columns, M rows, both powers of two). */
export function fft2(
  re: Float64Array,
  im: Float64Array,
  N: number,
  M: number,
  inverse: boolean,
): void {
  const rr = new Float64Array(N),
    ri = new Float64Array(N);
  for (let y = 0; y < M; y++) {
    const o = y * N;
    rr.set(re.subarray(o, o + N));
    ri.set(im.subarray(o, o + N));
    fft1(rr, ri, N, inverse);
    re.set(rr, o);
    im.set(ri, o);
  }
  const cr = new Float64Array(M),
    ci = new Float64Array(M);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < M; y++) {
      cr[y] = re[y * N + x];
      ci[y] = im[y * N + x];
    }
    fft1(cr, ci, M, inverse);
    for (let y = 0; y < M; y++) {
      re[y * N + x] = cr[y];
      im[y * N + x] = ci[y];
    }
  }
}

export interface NccMap {
  /** valid positions: x ∈ [0, w), y ∈ [0, h) is the template's top-left corner */
  readonly w: number;
  readonly h: number;
  readonly map: Float64Array;
}

export interface Hit {
  x: number;
  y: number;
  score: number;
}

/** NCC of many templates against one image: the image FFT and its integral images are computed once. */
export class Correlator {
  readonly N: number;
  readonly M: number;
  private readonly sRe: Float64Array;
  private readonly sIm: Float64Array;
  private readonly ii: Float64Array;
  private readonly ii2: Float64Array;

  constructor(readonly image: GrayImage) {
    // Circular correlation is exact for the valid region as long as the buffer holds the image itself:
    // a template that starts at x ≤ W − tw never reads past column W − 1.
    this.N = nextPow2(image.w);
    this.M = nextPow2(image.h);
    this.sRe = new Float64Array(this.N * this.M);
    this.sIm = new Float64Array(this.N * this.M);
    for (let y = 0; y < image.h; y++)
      this.sRe.set(image.data.subarray(y * image.w, (y + 1) * image.w), y * this.N);
    fft2(this.sRe, this.sIm, this.N, this.M, false);
    const W1 = image.w + 1;
    this.ii = new Float64Array(W1 * (image.h + 1));
    this.ii2 = new Float64Array(W1 * (image.h + 1));
    for (let y = 0; y < image.h; y++) {
      let s = 0,
        s2 = 0;
      for (let x = 0; x < image.w; x++) {
        const v = image.data[y * image.w + x];
        s += v;
        s2 += v * v;
        this.ii[(y + 1) * W1 + x + 1] = this.ii[y * W1 + x + 1] + s;
        this.ii2[(y + 1) * W1 + x + 1] = this.ii2[y * W1 + x + 1] + s2;
      }
    }
  }

  ncc(t: GrayImage): NccMap {
    const S = this.image;
    const vw = S.w - t.w + 1,
      vh = S.h - t.h + 1;
    if (vw <= 0 || vh <= 0) return { w: 0, h: 0, map: new Float64Array(0) };
    const n = t.w * t.h;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += t.data[i];
    mean /= n;
    let tn = 0;
    const tRe = new Float64Array(this.N * this.M),
      tIm = new Float64Array(this.N * this.M);
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const v = t.data[y * t.w + x] - mean;
        tRe[y * this.N + x] = v;
        tn += v * v;
      }
    }
    const map = new Float64Array(vw * vh);
    if (tn < 1e-9) return { w: vw, h: vh, map };
    tn = Math.sqrt(tn);
    fft2(tRe, tIm, this.N, this.M, false);
    // S · conj(T) → correlation
    for (let i = 0; i < tRe.length; i++) {
      const a = this.sRe[i],
        b = this.sIm[i],
        c = tRe[i],
        d = -tIm[i];
      tRe[i] = a * c - b * d;
      tIm[i] = a * d + b * c;
    }
    fft2(tRe, tIm, this.N, this.M, true);
    const norm = this.N * this.M;
    const W1 = S.w + 1;
    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        const a = y * W1 + x,
          b = y * W1 + x + t.w,
          c = (y + t.h) * W1 + x,
          d = (y + t.h) * W1 + x + t.w;
        const s1 = this.ii[d] - this.ii[b] - this.ii[c] + this.ii[a];
        const s2 = this.ii2[d] - this.ii2[b] - this.ii2[c] + this.ii2[a];
        const varS = s2 - (s1 * s1) / n;
        map[y * vw + x] = varS > 1e-6 ? tRe[y * this.N + x] / norm / (Math.sqrt(varS) * tn) : 0;
      }
    }
    return { w: vw, h: vh, map };
  }
}

/** Peaks above `minScore`, best first, suppressing neighbours closer than `minDist`. */
export function peaks(m: NccMap, minScore: number, minDist: number, limit = 200): Hit[] {
  const out: Hit[] = [];
  if (m.w === 0) return out;
  const mm = Float64Array.from(m.map);
  while (out.length < limit) {
    let best = -Infinity,
      bi = -1;
    for (let i = 0; i < mm.length; i++)
      if (mm[i] > best) {
        best = mm[i];
        bi = i;
      }
    if (bi < 0 || best < minScore) break;
    const y = Math.floor(bi / m.w),
      x = bi - y * m.w;
    out.push({ x, y, score: best });
    for (let yy = Math.max(0, y - minDist); yy <= Math.min(m.h - 1, y + minDist); yy++) {
      for (let xx = Math.max(0, x - minDist); xx <= Math.min(m.w - 1, x + minDist); xx++)
        mm[yy * m.w + xx] = -2;
    }
  }
  return out;
}

/** Direct NCC of a template at one position (refinement step). */
export function nccAt(S: GrayImage, t: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x + t.w > S.w || y + t.h > S.h) return -1;
  const n = t.w * t.h;
  let ms = 0,
    mt = 0;
  for (let yy = 0; yy < t.h; yy++) {
    for (let xx = 0; xx < t.w; xx++) {
      ms += S.data[(y + yy) * S.w + x + xx];
      mt += t.data[yy * t.w + xx];
    }
  }
  ms /= n;
  mt /= n;
  let num = 0,
    ds = 0,
    dt = 0;
  for (let yy = 0; yy < t.h; yy++) {
    for (let xx = 0; xx < t.w; xx++) {
      const a = S.data[(y + yy) * S.w + x + xx] - ms,
        b = t.data[yy * t.w + xx] - mt;
      num += a * b;
      ds += a * a;
      dt += b * b;
    }
  }
  return ds > 1e-6 && dt > 1e-9 ? num / Math.sqrt(ds * dt) : 0;
}

/**
 * Find all occurrences of a small template: candidates on a `coarse`-times smaller image (shared
 * Correlator), then the exact position and score at full resolution within ±(coarse+2) px.
 */
export function findTemplate(
  S: GrayImage,
  coarseCorr: Correlator | null,
  coarse: number,
  t: GrayImage,
  minScore: number,
  minDist: number,
): Hit[] {
  let candidates: Hit[];
  if (coarseCorr && coarse > 1) {
    const tc = resizeGray(t, Math.max(5, t.w / coarse), Math.max(5, t.h / coarse));
    candidates = peaks(
      coarseCorr.ncc(tc),
      Math.max(0.2, minScore - 0.25),
      Math.max(2, Math.round(minDist / coarse)),
      80,
    ).map((h) => ({
      x: Math.round(h.x * coarse),
      y: Math.round(h.y * coarse),
      score: h.score,
    }));
  } else {
    candidates = peaks(new Correlator(S).ncc(t), minScore, minDist);
  }
  const r = coarse > 1 ? Math.ceil(coarse) + 2 : 0;
  const refined: Hit[] = [];
  for (const c of candidates) {
    let best: Hit = { x: c.x, y: c.y, score: -1 };
    for (let y = c.y - r; y <= c.y + r; y++) {
      for (let x = c.x - r; x <= c.x + r; x++) {
        const s = r === 0 ? c.score : nccAt(S, t, x, y);
        if (s > best.score) best = { x, y, score: s };
      }
    }
    if (best.score >= minScore) refined.push(best);
  }
  refined.sort((a, b) => b.score - a.score);
  const kept: Hit[] = [];
  for (const h of refined)
    if (!kept.some((k) => Math.abs(k.x - h.x) <= minDist && Math.abs(k.y - h.y) <= minDist))
      kept.push(h);
  return kept;
}

export interface MonitorRect {
  found: boolean;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
  frameW: number;
  frameH: number;
  hint?: string;
}

/**
 * Locate the exported frame inside a screenshot (Program Monitor at «Fit»): multi-scale NCC on a
 * ~640 px wide copy, then a fine pass on a crop at about one third of full resolution.
 * `frame` is any downscaled copy of the exported frame; `frameW/H` are its original pixel size.
 */
export function findMonitor(
  shot: GrayImage,
  frame: GrayImage,
  frameW: number,
  frameH: number,
  minScore = 0.5,
): MonitorRect {
  const aspect = frame.h / frame.w;
  const c = Math.max(1, shot.w / 640);
  const Sc = downscaleGray(shot, c);
  const corr = new Correlator(Sc);
  let best = { s: -2, x: 0, y: 0, w: 0, h: 0 };
  for (
    let w = Math.max(24, Math.round(Sc.w * 0.12));
    w <= Sc.w;
    w = Math.max(w + 1, Math.round(w * 1.03))
  ) {
    const h = Math.round(w * aspect);
    if (h > Sc.h) break;
    const m = corr.ncc(resizeGray(frame, w, h));
    for (let i = 0; i < m.map.length; i++) {
      if (m.map[i] > best.s) best = { s: m.map[i], x: i % m.w, y: Math.floor(i / m.w), w, h };
    }
  }
  if (best.s < -1)
    return {
      found: false,
      score: 0,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      frameW,
      frameH,
      hint: "the screenshot is smaller than any monitor size tried",
    };
  // fine pass
  const f = Math.max(1, c / 3);
  const Sf = downscaleGray(shot, f);
  const k = c / f,
    pad = Math.ceil(2 * k) + 4;
  const cx = Math.max(0, Math.floor(best.x * k - pad)),
    cy = Math.max(0, Math.floor(best.y * k - pad));
  const crop = cropGray(Sf, cx, cy, best.w * k + 2 * pad, best.h * k + 2 * pad);
  const corr2 = new Correlator(crop);
  const W0 = best.w * k;
  let fine = { s: best.s, x: best.x * k, y: best.y * k, w: W0, h: best.h * k };
  const step = Math.max(1, Math.round(W0 * 0.003));
  for (let w = Math.floor(W0 * 0.985); w <= Math.ceil(W0 * 1.015); w += step) {
    const h = Math.round(w * aspect);
    if (w > crop.w || h > crop.h) continue;
    const m = corr2.ncc(resizeGray(frame, w, h));
    for (let i = 0; i < m.map.length; i++) {
      if (m.map[i] > fine.s)
        fine = { s: m.map[i], x: cx + (i % m.w), y: cy + Math.floor(i / m.w), w, h };
    }
  }
  const rect: MonitorRect = {
    found: fine.s >= minScore,
    score: Math.round(fine.s * 1000) / 1000,
    x: Math.round(fine.x * f),
    y: Math.round(fine.y * f),
    w: Math.round(fine.w * f),
    h: Math.round(fine.h * f),
    frameW,
    frameH,
  };
  if (!rect.found) {
    rect.hint =
      "weak match — show the whole frame in the Program Monitor («Fit»), keep the playhead on the exported frame, and make sure no window covers the monitor";
  }
  return rect;
}

/** Exported-frame pixel → screenshot pixel. */
export function frameToShot(rect: MonitorRect, px: number, py: number): { x: number; y: number } {
  return { x: rect.x + (px * rect.w) / rect.frameW, y: rect.y + (py * rect.h) / rect.frameH };
}
