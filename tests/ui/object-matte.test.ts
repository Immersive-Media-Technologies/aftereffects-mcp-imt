// Object Matte by sight — the pure parts on a synthetic capture, and the tool on a fake desktop + a
// scripted transport (the strokes After Effects would record). No After Effects, no screen.
import { describe, expect, it } from "vitest";

import type { EvalRequest, EvalResult } from "../../src/transport/AeTransport.js";
import { desktopFactory, objectMatteUiTool } from "../../src/tools/object-matte-ui.js";
import type { RgbImage } from "../../src/ui/image.js";
import type { Capture } from "../../src/ui/mac.js";
import {
  findPicture,
  layerToShot,
  newStrokes,
  normalizeLasso,
  shotToLayer,
  strokeError,
  type StrokeInfo,
} from "../../src/ui/object-matte.js";

/** A window capture: flat viewer background with a textured picture of a given size at (px, py). */
function synthCapture(
  W: number,
  H: number,
  px: number,
  py: number,
  pw: number,
  ph: number,
  scale = 1,
): Capture {
  const data = new Uint8Array(W * H * 3);
  const bg = 31;
  data.fill(bg);
  for (let y = py; y < py + ph; y++) {
    for (let x = px; x < px + pw; x++) {
      const i = (y * W + x) * 3;
      const v = 60 + ((x * 7 + y * 13) % 150); // textured, nowhere exactly the background
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
  // another panel showing a picture of a different size (the Composition panel) must not win
  for (let y = 60; y < 60 + Math.round(ph * 0.8); y++) {
    for (let x = 40; x < 40 + Math.round(pw * 0.8); x++) {
      const i = (y * W + x) * 3;
      const v = 90 + ((x * 3 + y * 5) % 120);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
  const img: RgbImage = { w: W, h: H, data };
  return { img, scale, origin: { x: 0, y: 0 } };
}

describe("findPicture", () => {
  it("finds the picture of the expected size among other pictures and maps layer pixels onto it", () => {
    const cap = synthCapture(1400, 900, 820, 140, 460, 316);
    const pic = findPicture(cap, 460, 316, 4608, 3164);
    expect(pic.found).toBe(true);
    expect(pic.x).toBe(820);
    expect(pic.y).toBe(140);
    const q = layerToShot(pic, { x: 2304, y: 1582 });
    expect(Math.round(q.x)).toBe(820 + 230);
    expect(Math.round(q.y)).toBe(140 + 158);
    const back = shotToLayer(pic, q);
    expect(Math.round(back.x)).toBe(2304);
    expect(Math.round(back.y)).toBe(1582);
  });

  it("refuses when the expected size does not fit or nothing of that size is on screen", () => {
    const cap = synthCapture(1400, 900, 820, 140, 460, 316);
    expect(findPicture(cap, 2000, 1400, 4608, 3164).found).toBe(false);
    const none = findPicture(cap, 300, 206, 4608, 3164); // no 300×206 picture anywhere
    expect(none.found).toBe(false);
    expect(none.hint).toMatch(/not found/);
  });
});

describe("strokes", () => {
  const s = (
    name: string,
    pos: [number, number] | null,
    mode: "add" | "subtract" = "add",
  ): StrokeInfo => ({ index: 1, name, mode, position: pos, duration: [1.2, 0.0417] });
  it("reports the strokes an action added and how far they landed from the target", () => {
    const before = [s("Добавить объект 1", [2726, 1554])];
    const after = [s("Добавить объект 2", [3062, 2318]), ...before];
    const fresh = newStrokes(before, after);
    expect(fresh.map((x) => x.name)).toEqual(["Добавить объект 2"]);
    expect(strokeError(fresh[0], { x: 3060, y: 2320 })).toBe(2.8);
    expect(strokeError(s("x", null), { x: 0, y: 0 })).toBeNull();
  });
  it("normalizes a lasso: drops repeated points and closes it", () => {
    const l = normalizeLasso([
      { x: 0, y: 0 },
      { x: 0, y: 0.2 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(l).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]);
  });
});

describe("ae_object_matte_ui on a fake desktop", () => {
  const LW = 4608,
    LH = 3164,
    zoom = 0.1;
  const cap = synthCapture(1400, 900, 820, 140, Math.round(LW * zoom), Math.round(LH * zoom));
  const clicks: { x: number; y: number; mods: string[] }[] = [];
  const drags: { points: { x: number; y: number }[]; mods: string[] }[] = [];
  const keys: string[] = [];
  let strokes: StrokeInfo[] = [];
  const fake = {
    async checkAccess() {},
    async front() {
      return "After Effects";
    },
    async window() {
      return { x: 0, y: 0, w: 1400, h: 900, name: "AE" };
    },
    async capture() {
      return cap;
    },
    async click(x: number, y: number, mods: string[] = []) {
      clicks.push({ x, y, mods });
      const p = shotToLayer(findPicture(cap, LW * zoom, LH * zoom, LW, LH), { x, y });
      strokes = [
        {
          index: 1,
          name: `${mods.includes("alt") ? "Удалить" : "Добавить"} объект ${strokes.length + 1}`,
          mode: mods.includes("alt") ? "subtract" : "add",
          position: [Math.round(p.x), Math.round(p.y)],
          duration: [1.0, 0.0417],
        },
        ...strokes,
      ];
    },
    async drag(points: { x: number; y: number }[], mods: string[] = []) {
      drags.push({ points, mods });
      const p = shotToLayer(findPicture(cap, LW * zoom, LH * zoom, LW, LH), points[0]);
      strokes = [
        {
          index: 1,
          name: `Добавить лассо ${strokes.length + 1}`,
          mode: "add",
          position: [Math.round(p.x), Math.round(p.y)],
          duration: [1.0, 0.0417],
        },
        ...strokes,
      ];
    },
    async key(combo: string) {
      keys.push(combo);
    },
    async sleep() {},
    async savePng() {
      return "";
    },
  };
  const transport = {
    calls: [] as EvalRequest[],
    toolReads: 0,
    async execute(req: EvalRequest): Promise<EvalResult> {
      transport.calls.push(req);
      const base = {
        ok: true as const,
        error: null,
        errorCode: null,
        stack: null,
        logs: [] as string[],
        durationMs: 0,
      };
      if (req.label === "object_matte_tool_type") {
        transport.toolReads++;
        return { ...base, result: { ok: true, tool: transport.toolReads > 1 ? "161" : "160" } };
      }
      if (req.label === "object_matte_strokes")
        return {
          ...base,
          result: {
            ok: true,
            layerName: "plate",
            layerIndex: 1,
            width: LW,
            height: LH,
            hasEffect: strokes.length > 0,
            strokes: [...strokes],
          },
        };
      if (req.label === "object_matte_open_layer")
        return {
          ...base,
          result: { ok: true, zoom, width: LW, height: LH, viewerType: "VIEWER_LAYER" },
        };
      if (req.label === "object_matte_comp_to_source") {
        const m = /_in = (\[.*?\]), _o = \[\]/.exec(req.code);
        const pts = JSON.parse(m![1]) as [number, number][];
        return {
          ...base,
          result: { ok: true, points: pts.map(([x, y]) => [x / 1.00775, y / 1.0081]) },
        };
      }
      if (req.label === "object_matte_propagate")
        return { ...base, result: { ok: true, frames: 7, endTime: 1.25 } };
      return { ...base, result: null };
    },
  };

  it("lassos first, then clicks, reads every stroke back and propagates", async () => {
    if (process.platform !== "darwin") return;
    desktopFactory.make = () => fake;
    strokes = [];
    transport.toolReads = 0;
    const res = await objectMatteUiTool.handler(
      {
        comp: 2,
        layer: 1,
        time: 1.0,
        points: [
          { x: 2740, y: 1560 },
          { x: 3070, y: 2330 },
        ],
        lassos: [
          [
            { x: 2500, y: 2100 },
            { x: 2700, y: 2100 },
            { x: 2700, y: 2300 },
          ],
        ],
        zoom,
        propagate_to: 1.25,
      },
      transport,
    );
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const sc = res.structuredContent as any;
    expect(keys.filter((k) => k === "alt+w")).toHaveLength(1); // one press: the first read saw another tool
    expect(sc.tool).toEqual({ presses: 1, seen: ["160", "161"] });
    expect(clicks).toHaveLength(2);
    expect(drags[0].mods).toEqual([]); // the lasso goes first and creates the matte
    expect(clicks[0].mods).toEqual(["shift"]); // points after it add
    expect(clicks[1].mods).toEqual(["shift"]);
    expect(drags).toHaveLength(1);
    expect(drags[0].points.length).toBeGreaterThanOrEqual(4); // closed
    expect(sc.actions).toHaveLength(3);
    for (const a of sc.actions) expect(a.error_px).toBeLessThan(12); // one screen pixel ≈ 10 layer px at zoom 0.1
    expect(sc.worst_error_px).toBeLessThan(12);
    expect(sc.propagated).toMatchObject({ frames: 7, endTime: 1.25 });
    expect(sc.strokes_total).toBe(3);
    expect(sc.strokes).toBeUndefined(); // the full list is not repeated on every call
    expect(sc.mapping).toBeUndefined();
    expect(sc.verified).toBe(false); // never claims success by itself
    expect(sc.check).toMatch(/NOT VERIFIED/);
  });

  it("finds the picture again when the panel shifts after a stroke, so later actions still land", async () => {
    if (process.platform !== "darwin") return;
    const pw = Math.round(LW * zoom),
      ph = Math.round(LH * zoom);
    const capA = synthCapture(1400, 900, 820, 140, pw, ph);
    const capB = synthCapture(1400, 900, 820, 134, pw, ph); // 6 px up after the first stroke
    let current = capA;
    strokes = [];
    clicks.length = 0;
    desktopFactory.make = () => ({
      ...fake,
      async capture() {
        return current;
      },
      async click(x: number, y: number, mods: string[] = []) {
        clicks.push({ x, y, mods });
        const p = shotToLayer(findPicture(current, LW * zoom, LH * zoom, LW, LH), { x, y });
        strokes = [
          {
            index: 1,
            name: `Добавить объект ${strokes.length + 1}`,
            mode: "add",
            position: [Math.round(p.x), Math.round(p.y)],
            duration: [1.0, 0.0417],
          },
          ...strokes,
        ];
        current = capB;
      },
    });
    const res = await objectMatteUiTool.handler(
      {
        comp: 2,
        layer: 1,
        time: 1.0,
        points: [
          { x: 2740, y: 1560 },
          { x: 3070, y: 2330 },
        ],
        zoom,
        space: "layer",
        preview: false,
      },
      transport,
    );
    const sc = res.structuredContent as any;
    expect(res.isError).toBeFalsy();
    expect(sc.actions[0].picture_moved.dy).toBe(-6);
    expect(sc.tool.presses).toBe(0); // Object Matte was already active — no press, no cycling away
    expect(Math.abs(sc.actions[0].picture_moved.dx)).toBeLessThanOrEqual(1); // the search may tie by a pixel
    expect(sc.actions[1].error_px).toBeLessThan(12); // was ~60 layer px before the re-find
  });

  it("subtract mode Option-clicks and a click that records nothing is a failure, not a success", async () => {
    if (process.platform !== "darwin") return;
    desktopFactory.make = () => ({
      ...fake,
      async click(x: number, y: number, mods: string[] = []) {
        clicks.push({ x, y, mods }); /* nothing recorded */
      },
    });
    strokes = [
      {
        index: 1,
        name: "Добавить объект 1",
        mode: "add",
        position: [2726, 1554],
        duration: [1, 0.04],
      },
    ];
    clicks.length = 0;
    const res = await objectMatteUiTool.handler(
      { comp: 2, layer: 1, time: 1.0, points: [{ x: 3070, y: 2330 }], mode: "subtract", zoom },
      transport,
    );
    expect(res.isError).toBe(true);
    expect(clicks[0].mods).toEqual(["alt"]);
    expect(JSON.stringify(res.content)).toMatch(/recorded no stroke/);
  });

  it("dry_run reports the mapping without touching the desktop", async () => {
    if (process.platform !== "darwin") return;
    clicks.length = 0;
    keys.length = 0;
    desktopFactory.make = () => fake;
    const res = await objectMatteUiTool.handler(
      { comp: 2, layer: 1, time: 1.0, dry_run: true, zoom },
      transport,
    );
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const sc = res.structuredContent as any;
    expect(sc.mapping.picture.found).toBe(true);
    expect(sc.mapping.picture.x).toBe(820);
    expect(clicks).toHaveLength(0);
    expect(keys).toHaveLength(0);
  });
});
