// The matte preview: pieces of a matte, the two-panel picture, the downscaled decode with alpha, and
// ae_object_matte_ui in preview-only mode on PNGs a scripted transport writes (no After Effects).
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { describe, expect, it } from "vitest";

import { decodePng, decodePngScaled } from "../../src/color/png16.js";
import type { EvalRequest, EvalResult } from "../../src/transport/AeTransport.js";
import { objectMatteUiTool } from "../../src/tools/object-matte-ui.js";
import {
  checkPeople,
  closeMask,
  composePreview,
  drawMarkers,
  findGaps,
  MARK,
  matteStats,
  previewStep,
} from "../../src/ui/matte-preview.js";

/** Minimal 8-bit RGBA PNG writer for fixtures. */
function rgbaPng(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const v = px(x, y),
        o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = v[0];
      raw[o + 1] = v[1];
      raw[o + 2] = v[2];
      raw[o + 3] = v[3];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// a 400×300 frame: two people (blocks) kept, one speck, the rest transparent
const inBlock = (x: number, y: number) =>
  (x >= 40 && x < 120 && y >= 60 && y < 260) ||
  (x >= 200 && x < 260 && y >= 80 && y < 240) ||
  (x === 350 && y === 20);
const mattePng = rgbaPng(400, 300, (x, y) => (inBlock(x, y) ? [200, 180, 160, 255] : [0, 0, 0, 0]));
const platePng = rgbaPng(400, 300, () => [120, 120, 120, 255]);

describe("matte preview parts", () => {
  it("decodes alpha, downscales premultiplied, crops", () => {
    const full = decodePng(mattePng);
    expect(full.alpha).toBeDefined();
    expect(full.alpha![60 * 400 + 40]).toBe(1);
    expect(full.alpha![0]).toBe(0);
    const half = decodePngScaled(mattePng, 2);
    expect([half.width, half.height]).toEqual([200, 150]);
    const crop = decodePngScaled(mattePng, 1, { x: 200, y: 80, w: 60, h: 160 });
    expect([crop.width, crop.height]).toEqual([60, 160]);
    expect(crop.alpha.every((a) => a === 1)).toBe(true);
    expect(crop.rgb[0]).toBeCloseTo(200 / 255, 5); // premultiplied by alpha 1
  });

  it("counts the pieces with boxes in comp pixels", () => {
    const m = decodePngScaled(mattePng, 2);
    const st = matteStats(m.alpha, m.width, m.height, 2, { x: 0, y: 0 });
    expect(st.pieces).toBe(2); // the 1-px speck vanishes at half size
    expect(st.largest[0].bbox).toEqual([40, 60, 80, 200]);
    expect(st.largest[1].bbox).toEqual([200, 80, 60, 160]);
    const full = decodePngScaled(mattePng, 1);
    const st1 = matteStats(full.alpha, full.width, full.height, 1, { x: 0, y: 0 });
    expect(st1.pieces).toBe(3);
    expect(st1.small_fragments).toBe(1);
    expect(previewStep(4608, 1000)).toBe(5);
  });

  it("composes matte-over-black on top and the red wash below", () => {
    const m = decodePngScaled(mattePng, 1),
      p = decodePngScaled(platePng, 1);
    const pic = composePreview(m.rgb, m.alpha, p.rgb, m.width, m.height);
    expect(pic.h).toBe(300 * 2 + 6);
    const at = (x: number, y: number) => [0, 1, 2].map((c) => pic.rgb[(y * pic.w + x) * 3 + c]);
    expect(at(0, 0)).toEqual([0, 0, 0]); // excluded → black on top
    expect(at(50, 100)[0]).toBeCloseTo(200 / 255, 5); // kept → picture on top
    const red = at(0, 306); // excluded → red below
    expect(red[0]).toBeGreaterThan(red[1] * 3);
    expect(at(50, 406)[0]).toBeCloseTo(120 / 255, 5); // kept → plate below
  });
});

describe("pointing at misses", () => {
  // two kept people 40 px apart with a third, unmatted one between them (alpha 0)
  const W = 300,
    H = 200;
  const a = new Float64Array(W * H);
  for (let y = 40; y < 180; y++)
    for (let x = 0; x < W; x++) if ((x >= 60 && x < 120) || (x >= 160 && x < 220)) a[y * W + x] = 1;

  it("closing fills a gap narrower than 2r and keeps the borders", () => {
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = a[i] > 0.5 ? 1 : 0;
    const c = closeMask(m, W, H, 25);
    expect(c[100 * W + 140]).toBe(1); // between the two
    expect(c[100 * W + 10]).toBe(0); // far outside stays out
    expect(c[100 * W + 60]).toBe(1); // edges of the kept pieces stay
  });

  it("reports the pocket between kept pieces as a gap in comp pixels", () => {
    const g = findGaps(a, W, H, 2, { x: 100, y: 50 }, 50);
    expect(g.length).toBeGreaterThanOrEqual(1);
    const [x, y, w, h] = g[0].bbox;
    expect(x).toBe(100 + 120 * 2);
    expect(w).toBe(40 * 2);
    expect(y).toBeGreaterThanOrEqual(50 + 40 * 2 - 2);
    expect(h).toBeGreaterThan(200);
  });

  it("checks each listed person's points: whole, partial, missing", () => {
    const people = [
      { id: 1, head: { x: 90, y: 50 }, feet: { x: 90, y: 170 } }, // inside the first block
      { id: 2, head: { x: 140, y: 50 }, body: { x: 190, y: 100 } }, // head in the gap, body in the second
      { id: 3, head: { x: 140, y: 60 }, body: { x: 140, y: 120 } }, // all in the gap
      { id: 4, head: { x: 900, y: 900 } }, // off the preview
    ];
    const r = checkPeople(a, W, H, 1, { x: 0, y: 0 }, people);
    expect(r.map((x) => x.status)).toEqual(["whole", "partial", "missing", "off_preview"]);
    expect(r[1].head).toBe("out");
    expect(r[1].body).toBe("in");
  });

  it("draws cyan gap boxes and green/yellow rings on both panels", () => {
    const img = { rgb: new Float64Array(W * (2 * H + 6) * 3), w: W, h: 2 * H + 6 };
    const people = [{ id: 7, head: { x: 140, y: 60 } }];
    const checks = checkPeople(a, W, H, 1, { x: 0, y: 0 }, people);
    const gaps = findGaps(a, W, H, 1, { x: 0, y: 0 }, 25);
    drawMarkers(img, H, 2, 1, { x: 0, y: 0 }, gaps, people, checks);
    const count = (c: number[], y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 3;
          if (img.rgb[i] === c[0] && img.rgb[i + 1] === c[1] && img.rgb[i + 2] === c[2]) n++;
        }
      return n;
    };
    expect(count(MARK.gap, 0, H)).toBeGreaterThan(50);
    expect(count(MARK.gap, H + 6, 2 * H + 6)).toBeGreaterThan(50);
    expect(count(MARK.out, 0, H)).toBeGreaterThan(10); // the person in the gap is yellow
    expect(count(MARK.in, 0, H)).toBe(0);
  });
});

describe("ae_object_matte_ui preview only", () => {
  it("renders the layer solo, returns the images inline and never claims success", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "om-preview-"));
    const calls: EvalRequest[] = [];
    const transport = {
      async execute(req: EvalRequest): Promise<EvalResult> {
        calls.push(req);
        const base = {
          ok: true as const,
          error: null,
          errorCode: null,
          stack: null,
          logs: [] as string[],
          durationMs: 0,
        };
        if (req.label === "object_matte_preview") {
          await fs.writeFile(path.join(dir, "matte_1000.png"), mattePng);
          await fs.writeFile(path.join(dir, "plate_1000.png"), platePng);
          return {
            ...base,
            result: {
              ok: true,
              width: 400,
              height: 300,
              workingSpace: "None",
              overlay: true,
              frames: [
                {
                  time: 1,
                  ok: true,
                  matte: path.join(dir, "matte_1000.png"),
                  plate: path.join(dir, "plate_1000.png"),
                },
              ],
            },
          };
        }
        return { ...base, result: null };
      },
    };
    const res = await objectMatteUiTool.handler(
      {
        comp: 2,
        layer: 1,
        time: 1,
        preview_times: [1],
        preview_dir: dir,
        people: [
          { id: 1, head: { x: 80, y: 80 } },
          { id: 2, head: { x: 160, y: 40 } },
        ],
      },
      transport,
    );
    expect(res.isError).toBeFalsy();
    expect(calls.map((c) => c.label)).toEqual(["object_matte_preview"]); // no UI, no strokes
    expect(calls[0].code).toMatch(/solo = true/);
    expect(calls[0].code).toMatch(/enabled = false/);
    const sc = res.structuredContent as any;
    expect(sc.preview_only).toBe(true);
    expect(sc.verified).toBe(false);
    expect(sc.preview[0].pieces).toBe(3);
    expect(sc.preview[0].people.map((p: any) => p.status)).toEqual(["whole", "missing"]);
    expect(sc.preview[0].people_summary).toEqual({ whole: 1, partial: 0, missing: 1 });
    expect(sc.preview[0].gaps.length).toBeGreaterThanOrEqual(1); // the pocket between the two blocks
    expect(sc.check).toMatch(/OVERLAPS/);
    const imgs = res.content.filter((c) => c.type === "image");
    expect(imgs).toHaveLength(1);
    const back = decodePng(Buffer.from((imgs[0] as any).data, "base64"));
    expect([back.width, back.height]).toEqual([400, 606]);
    expect(await fs.stat(sc.preview[0].file)).toBeTruthy();
  });
});
