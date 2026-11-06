// Image helpers for the Object Mask UI tools: BMP read/write (macOS `sips` converts any format to BMP,
// so no image library is needed), gray conversion, bilinear resize, area downscale and crops.

export interface RgbImage {
  readonly w: number;
  readonly h: number;
  /** RGB, 3 bytes per pixel, row-major, top row first */
  readonly data: Uint8Array;
}

export interface GrayImage {
  readonly w: number;
  readonly h: number;
  readonly data: Float64Array;
}

function maskShift(mask: number): { shift: number; max: number } {
  if (!mask) return { shift: 0, max: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  return { shift, max: mask >>> shift };
}

/** Parse an uncompressed 24- or 32-bit BMP (BI_RGB or BI_BITFIELDS), bottom-up or top-down. */
export function parseBmp(buf: Buffer): RgbImage {
  if (buf.length < 54 || buf.toString("ascii", 0, 2) !== "BM") throw new Error("not a BMP file");
  const dataOffset = buf.readUInt32LE(10);
  const headerSize = buf.readUInt32LE(14);
  const w = buf.readInt32LE(18);
  const rawH = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (w <= 0 || rawH === 0) throw new Error("BMP has no pixels");
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP depth ${bpp}`);
  if (compression !== 0 && compression !== 3)
    throw new Error(`unsupported BMP compression ${compression}`);
  const h = Math.abs(rawH);
  const topDown = rawH < 0;
  let rMask = 0x00ff0000,
    gMask = 0x0000ff00,
    bMask = 0x000000ff;
  if (compression === 3 && bpp === 32) {
    // masks follow the 40-byte info header (V2/V3) or sit inside V4/V5 headers at the same place
    const at = headerSize >= 52 ? 14 + 40 : 14 + headerSize;
    rMask = buf.readUInt32LE(at);
    gMask = buf.readUInt32LE(at + 4);
    bMask = buf.readUInt32LE(at + 8);
  }
  const rs = maskShift(rMask),
    gs = maskShift(gMask),
    bs = maskShift(bMask);
  const bytesPP = bpp / 8;
  const stride = bpp === 24 ? (w * 3 + 3) & ~3 : w * 4;
  if (dataOffset + stride * h > buf.length) throw new Error("BMP is truncated");
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = dataOffset + (topDown ? y : h - 1 - y) * stride;
    const dst = y * w * 3;
    for (let x = 0; x < w; x++) {
      const p = src + x * bytesPP;
      if (bpp === 24) {
        out[dst + x * 3] = buf[p + 2];
        out[dst + x * 3 + 1] = buf[p + 1];
        out[dst + x * 3 + 2] = buf[p];
      } else {
        const v = buf.readUInt32LE(p);
        out[dst + x * 3] = rs.max ? Math.round((((v & rMask) >>> rs.shift) * 255) / rs.max) : 0;
        out[dst + x * 3 + 1] = gs.max ? Math.round((((v & gMask) >>> gs.shift) * 255) / gs.max) : 0;
        out[dst + x * 3 + 2] = bs.max ? Math.round((((v & bMask) >>> bs.shift) * 255) / bs.max) : 0;
      }
    }
  }
  return { w, h, data: out };
}

/** Write a 24-bit bottom-up BMP (input for `sips -s format png`). */
export function encodeBmp(img: RgbImage): Buffer {
  const stride = (img.w * 3 + 3) & ~3;
  const size = 54 + stride * img.h;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(img.w, 18);
  buf.writeInt32LE(img.h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(stride * img.h, 34);
  for (let y = 0; y < img.h; y++) {
    const dst = 54 + (img.h - 1 - y) * stride;
    for (let x = 0; x < img.w; x++) {
      const s = (y * img.w + x) * 3;
      buf[dst + x * 3] = img.data[s + 2];
      buf[dst + x * 3 + 1] = img.data[s + 1];
      buf[dst + x * 3 + 2] = img.data[s];
    }
  }
  return buf;
}

export function toGray(img: RgbImage): GrayImage {
  const out = new Float64Array(img.w * img.h);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) {
    out[i] = 0.299 * img.data[j] + 0.587 * img.data[j + 1] + 0.114 * img.data[j + 2];
  }
  return { w: img.w, h: img.h, data: out };
}

export function grayFromBytes(w: number, h: number, bytes: Uint8Array): GrayImage {
  if (bytes.length !== w * h) throw new Error("template size does not match its data");
  return { w, h, data: Float64Array.from(bytes) };
}

/** Bilinear resize to an exact size (pixel centres aligned). */
export function resizeGray(img: GrayImage, w: number, h: number): GrayImage {
  const W = Math.max(1, Math.round(w)),
    H = Math.max(1, Math.round(h));
  if (W === img.w && H === img.h) return img;
  // shrinking more than 2× first averages blocks, so thin lines do not alias away
  if (img.w / W >= 2 && img.h / H >= 2) {
    const f = Math.min(Math.floor(img.w / W), Math.floor(img.h / H));
    return resizeGray(boxShrink(img, f), W, H);
  }
  const out = new Float64Array(W * H);
  const sx = img.w / W,
    sy = img.h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy),
      y1 = Math.min(img.h - 1, y0 + 1),
      ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx),
        x1 = Math.min(img.w - 1, x0 + 1),
        tx = fx - x0;
      const a = img.data[y0 * img.w + x0],
        b = img.data[y0 * img.w + x1];
      const c = img.data[y1 * img.w + x0],
        d = img.data[y1 * img.w + x1];
      out[y * W + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { w: W, h: H, data: out };
}

/** Integer block average (f × f → 1). */
export function boxShrink(img: GrayImage, f: number): GrayImage {
  const k = Math.max(1, Math.floor(f));
  if (k === 1) return img;
  const W = Math.floor(img.w / k),
    H = Math.floor(img.h / k);
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let yy = 0; yy < k; yy++) {
        const row = (y * k + yy) * img.w + x * k;
        for (let xx = 0; xx < k; xx++) s += img.data[row + xx];
      }
      out[y * W + x] = s / (k * k);
    }
  }
  return { w: W, h: H, data: out };
}

/** Downscale by a real factor ≥ 1 (area-friendly: block average then bilinear). */
export function downscaleGray(img: GrayImage, factor: number): GrayImage {
  if (factor <= 1) return img;
  return resizeGray(img, img.w / factor, img.h / factor);
}

export function cropGray(img: GrayImage, x: number, y: number, w: number, h: number): GrayImage {
  const x0 = Math.max(0, Math.floor(x)),
    y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.w, Math.floor(x + w)),
    y1 = Math.min(img.h, Math.floor(y + h));
  const W = Math.max(0, x1 - x0),
    H = Math.max(0, y1 - y0);
  const out = new Float64Array(W * H);
  for (let yy = 0; yy < H; yy++)
    out.set(img.data.subarray((y0 + yy) * img.w + x0, (y0 + yy) * img.w + x0 + W), yy * W);
  return { w: W, h: H, data: out };
}

export function cropRgb(img: RgbImage, x: number, y: number, w: number, h: number): RgbImage {
  const x0 = Math.max(0, Math.floor(x)),
    y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.w, Math.floor(x + w)),
    y1 = Math.min(img.h, Math.floor(y + h));
  const W = Math.max(0, x1 - x0),
    H = Math.max(0, y1 - y0);
  const out = new Uint8Array(W * H * 3);
  for (let yy = 0; yy < H; yy++) {
    const s = ((y0 + yy) * img.w + x0) * 3;
    out.set(img.data.subarray(s, s + W * 3), yy * W * 3);
  }
  return { w: W, h: H, data: out };
}

/** Bilinear RGB resize (overlay comparison, preview images). */
export function resizeRgb(img: RgbImage, w: number, h: number): RgbImage {
  const W = Math.max(1, Math.round(w)),
    H = Math.max(1, Math.round(h));
  if (W === img.w && H === img.h) return img;
  const out = new Uint8Array(W * H * 3);
  const sx = img.w / W,
    sy = img.h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(img.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy),
      y1 = Math.min(img.h - 1, y0 + 1),
      ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(img.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx),
        x1 = Math.min(img.w - 1, x0 + 1),
        tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = img.data[(y0 * img.w + x0) * 3 + c],
          b = img.data[(y0 * img.w + x1) * 3 + c];
        const d0 = img.data[(y1 * img.w + x0) * 3 + c],
          d1 = img.data[(y1 * img.w + x1) * 3 + c];
        out[(y * W + x) * 3 + c] = Math.round(
          (a * (1 - tx) + b * tx) * (1 - ty) + (d0 * (1 - tx) + d1 * tx) * ty,
        );
      }
    }
  }
  return { w: W, h: H, data: out };
}
