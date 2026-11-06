// ae_object_matte_ui — Object Matte by sight: the agent names points and lassos in the pixels of a frame
// it looked at; the tool opens the layer in the Layer panel, selects the Object Matte tool, clicks and
// drags on the panel, reads the strokes the effect recorded (positions in layer pixels), propagates the
// matte by stepping the composition's time, and reports every stroke against where it was meant to land.
// macOS only (CGEvent through osascript, screencapture); the MCP client app needs Accessibility and
// Screen Recording. See src/ui/object-matte.ts for the facts the spike established.
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

import { decodePngScaled, encodePngSrgb8 } from "../color/png16.js";
import { readFileSettled } from "../color/settled-read.js";
import { errorResult } from "../errors.js";
import { RENDER_FRAME_FN } from "../operations/snippets.js";
import { readOnlyMode } from "../policy.js";
import { jsxVal } from "../registry.js";
import type { AeTransport } from "../transport/AeTransport.js";
import { type Capture, DesktopError, MacDesktop, type WindowBounds } from "../ui/mac.js";
import {
  type Point,
  type PictureRect,
  type StrokeInfo,
  findPicture,
  layerToShot,
  newStrokes,
  normalizeLasso,
  strokeError,
} from "../ui/object-matte.js";
import {
  checkPeople,
  composePreview,
  drawMarkers,
  findGaps,
  type MatteGap,
  type MatteStats,
  matteStats,
  type PersonCheck,
  type PersonSpec,
  previewStep,
  type Region,
} from "../ui/matte-preview.js";
import { defineTool, jsonResult } from "./define-tool.js";
import type { ImageContent, ToolResult } from "./types.js";

const pointShape = z.object({ x: z.number(), y: z.number() });

/** What the tool needs from the desktop — MacDesktop live, a fake in tests. */
export interface MatteDesktop {
  checkAccess(): Promise<void>;
  front(): Promise<string>;
  window(): Promise<WindowBounds>;
  capture(): Promise<Capture>;
  click(x: number, y: number, mods?: string[]): Promise<void>;
  drag(points: Point[], mods?: string[]): Promise<void>;
  key(combo: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  savePng(img: Capture["img"], path: string, maxWidth?: number): Promise<string>;
}

/** Replaced by tests; live runs get a MacDesktop. */
export const desktopFactory: { make: () => MatteDesktop } = { make: () => new MacDesktop() };

/** JSX: the strokes under Effects › Object Matte › Selections of the layer, with positions and frames. */
function strokesJsx(comp: unknown, layer: unknown): string {
  return `
    var _comp = AE.findCompByNameOrId(${jsxVal(comp)});
    if (!_comp) return { ok: false, error: "no comp matching " + ${jsxVal(String(comp))} };
    var _ls = AE.resolveLayers(_comp, ${jsxVal(layer)});
    if (_ls.length !== 1) return { ok: false, error: "layer must resolve to exactly one layer (got " + _ls.length + ")" };
    var _l = _ls[0];
    var _fx = _l.property("ADBE Effect Parade"), _om = null;
    for (var i = 1; i <= _fx.numProperties; i++) { if (_fx.property(i).matchName === "ADBE Samurai") { _om = _fx.property(i); break; } }
    var _out = { ok: true, layerName: _l.name, layerIndex: _l.index, width: _l.width, height: _l.height, hasEffect: !!_om, strokes: [] };
    if (_om) {
      var _g = null;
      for (var j = 1; j <= _om.numProperties; j++) { if (_om.property(j).matchName === "ADBE Samurai Strokes Group") { _g = _om.property(j); break; } }
      if (_g) for (var k = 1; k <= _g.numProperties; k++) {
        var _s = _g.property(k), _pos = null, _dur = null, _mode = 1;
        try { _mode = _s.property("ADBE Paint Transfer Mode").value; } catch (e1) {}
        try { _dur = _s.property("ADBE Paint Duration").value; } catch (e2) {}
        try { _pos = _s.property("ADBE Paint Transform").property("ADBE Paint Position").value; } catch (e3) {}
        _out.strokes.push({ index: k, name: _s.name, mode: _mode === 1 ? "add" : "subtract",
          position: _pos ? [Math.round(_pos[0] * 10) / 10, Math.round(_pos[1] * 10) / 10] : null,
          duration: _dur ? [Math.round(_dur[0] * 100000) / 100000, Math.round(_dur[1] * 100000) / 100000] : null });
      }
    }
    return _out;
  `;
}

interface StrokesPayload {
  ok: boolean;
  error?: string;
  layerName: string;
  layerIndex: number;
  width: number;
  height: number;
  hasEffect: boolean;
  strokes: StrokeInfo[];
}

async function readStrokes(
  transport: AeTransport,
  comp: unknown,
  layer: unknown,
): Promise<StrokesPayload> {
  const r = await transport.execute({
    code: strokesJsx(comp, layer),
    label: "object_matte_strokes",
    timeoutMs: 30_000,
  });
  if (!r.ok) throw new Error(r.error ?? "strokes readback failed");
  const p = r.result as StrokesPayload;
  if (!p || p.ok !== true) throw new Error(p?.error ?? "strokes readback failed");
  return p;
}

/** Comp pixels → layer source pixels at `time` (Layer.compPointToSource handles scale, position, rotation). */
async function compToSource(
  transport: AeTransport,
  comp: unknown,
  layer: unknown,
  time: number,
  pts: Point[],
): Promise<Point[]> {
  const code = `
    var _comp = AE.findCompByNameOrId(${jsxVal(comp)});
    if (!_comp) return { ok: false, error: "no comp matching " + ${jsxVal(String(comp))} };
    var _l = AE.resolveLayers(_comp, ${jsxVal(layer)})[0];
    if (!_l) return { ok: false, error: "layer not found" };
    var _t0 = _comp.time; _comp.time = ${jsxVal(time)};
    var _in = ${jsxVal(pts.map((p) => [p.x, p.y]))}, _o = [];
    for (var i = 0; i < _in.length; i++) { var _q = _l.compPointToSource(_in[i]); _o.push([_q[0], _q[1]]); }
    _comp.time = _t0;
    return { ok: true, points: _o };
  `;
  const r = await transport.execute({
    code,
    label: "object_matte_comp_to_source",
    timeoutMs: 30_000,
  });
  const p = r.result as { ok: boolean; error?: string; points?: [number, number][] };
  if (!r.ok || !p?.ok || !p.points)
    throw new Error(p?.error ?? r.error ?? "compPointToSource failed");
  return p.points.map(([x, y]) => ({ x, y }));
}

/** Open the layer in the Layer panel at `time`, make that viewer active and set its zoom. */
async function openLayerPanel(
  transport: AeTransport,
  comp: unknown,
  layer: unknown,
  time: number,
  zoom: number | null,
): Promise<{ zoom: number; width: number; height: number }> {
  const code = `
    var _comp = AE.findCompByNameOrId(${jsxVal(comp)});
    if (!_comp) return { ok: false, error: "no comp matching " + ${jsxVal(String(comp))} };
    var _l = AE.resolveLayers(_comp, ${jsxVal(layer)})[0];
    if (!_l) return { ok: false, error: "layer not found" };
    _comp.openInViewer();
    _comp.time = ${jsxVal(time)};
    var _v = _l.openInViewer();
    if (!_v) return { ok: false, error: "the layer could not be opened in the Layer panel" };
    try { _v.setActive(); } catch (eA) {}
    var _view = _v.views[_v.activeViewIndex], _opts = _view.options;
    if (${jsxVal(zoom)} !== null) { try { _opts.zoom = ${jsxVal(zoom)}; } catch (eZ) {} }
    $.sleep(400);
    return { ok: true, zoom: _opts.zoom, width: _l.width, height: _l.height, viewerType: String(_v.type) };
  `;
  const r = await transport.execute({ code, label: "object_matte_open_layer", timeoutMs: 30_000 });
  const p = r.result as {
    ok: boolean;
    error?: string;
    zoom: number;
    width: number;
    height: number;
  };
  if (!r.ok || !p?.ok) throw new Error(p?.error ?? r.error ?? "could not open the Layer panel");
  return p;
}

/** The active tool as After Effects reports it (Project.toolType) — a number for members the enum table does not name. */
async function readToolType(transport: AeTransport): Promise<string> {
  const r = await transport.execute({
    code: `try { return { ok: true, tool: String(app.project.toolType) }; } catch (e) { return { ok: false, error: AE.errText(e) }; }`,
    label: "object_matte_tool_type",
    timeoutMs: 15_000,
  });
  const p = r.result as { ok: boolean; tool?: string; error?: string };
  if (!r.ok || !p?.ok || p.tool === undefined)
    throw new Error(p?.error ?? r.error ?? "toolType read failed");
  return p.tool;
}

/**
 * Option+W is the shortcut of the whole Roto Brush tool GROUP (Roto Brush / Refine Edge / Object Matte /
 * Quick Selection): a press selects the group's current member, and a press while one of them is active
 * cycles to the next. So: never press when Object Matte is already active; otherwise press and read the
 * active tool until it is Object Matte (code `expected`, 161 on AE 26.5), at most one full cycle.
 */
async function selectObjectMatteTool(
  d: MatteDesktop,
  transport: AeTransport,
  expected: string,
): Promise<{ presses: number; seen: string[] }> {
  const seen: string[] = [];
  let cur = await readToolType(transport);
  seen.push(cur);
  if (cur === expected) return { presses: 0, seen };
  for (let i = 1; i <= 5; i++) {
    await d.key("alt+w");
    await d.sleep(350);
    cur = await readToolType(transport);
    seen.push(cur);
    if (cur === expected) return { presses: i, seen };
  }
  throw new Error(
    `the Object Matte tool could not be selected: Option+W cycled through tool codes ${seen.join(" → ")} and none is ${expected}. Select «Object Matte» in the Tools panel by hand and pass its code as tool_code (read it with ae_do project.get_tool while it is active).`,
  );
}

/** Step the composition's time frame by frame — Object Matte propagates while the Layer panel is open. */
async function propagate(
  transport: AeTransport,
  comp: unknown,
  from: number,
  to: number,
  settleMs: number,
): Promise<{ frames: number; endTime: number }> {
  const code = `
    var _comp = AE.findCompByNameOrId(${jsxVal(comp)});
    if (!_comp) return { ok: false, error: "no comp matching " + ${jsxVal(String(comp))} };
    var _fd = _comp.frameDuration, _a = ${jsxVal(from)}, _b = ${jsxVal(to)}, _n = 0, _dir = _b >= _a ? 1 : -1;
    for (var _t = _a; _dir > 0 ? _t <= _b + 1e-6 : _t >= _b - 1e-6; _t += _dir * _fd) { _comp.time = _t; _n++; $.sleep(${jsxVal(settleMs)}); }
    return { ok: true, frames: _n, endTime: _comp.time };
  `;
  const frames = Math.ceil(Math.abs(to - from) * 60) + 1; // an upper bound at 60 fps
  const r = await transport.execute({
    code,
    label: "object_matte_propagate",
    timeoutMs: Math.max(60_000, frames * (settleMs + 400) + 30_000),
  });
  const p = r.result as { ok: boolean; error?: string; frames: number; endTime: number };
  if (!r.ok || !p?.ok) throw new Error(p?.error ?? r.error ?? "propagation failed");
  return p;
}

interface PreviewRender {
  time: number;
  matte: string;
  plate: string | null;
  ok: boolean;
  error?: string;
}
interface PreviewPayload {
  ok: boolean;
  error?: string;
  width: number;
  height: number;
  workingSpace: string;
  overlay: boolean;
  overlayNote?: string;
  frames: PreviewRender[];
}

/**
 * Render the layer alone (solo) at each time: the matte is its alpha. With `overlay` the same frame is
 * rendered once more with the Object Matte effect switched off — the full plate, for the red-wash panel.
 * Solo states and the effect switch are restored; everything sits in one undo group.
 */
async function renderPreviewFrames(
  transport: AeTransport,
  comp: unknown,
  layer: unknown,
  times: number[],
  dir: string,
  overlay: boolean,
): Promise<PreviewPayload> {
  const code = `
    ${RENDER_FRAME_FN}
    var _comp = AE.findCompByNameOrId(${jsxVal(comp)});
    if (!_comp) return { ok: false, error: "no comp matching " + ${jsxVal(String(comp))} };
    var _l = AE.resolveLayers(_comp, ${jsxVal(layer)})[0];
    if (!_l) return { ok: false, error: "layer not found" };
    var _fx = _l.property("ADBE Effect Parade"), _om = null;
    for (var i = 1; i <= _fx.numProperties; i++) { if (_fx.property(i).matchName === "ADBE Samurai") { _om = _fx.property(i); break; } }
    var _ws = AE.safeGet(function () { return String(app.project.workingSpace); }, "None");
    var _times = ${jsxVal(times)}, _dir = ${jsxVal(dir)}, _wantPlate = ${jsxVal(overlay)} && !!_om;
    var _out = { ok: true, width: _comp.width, height: _comp.height, workingSpace: _ws, overlay: _wantPlate, frames: [] };
    if (${jsxVal(overlay)} && !_om) _out.overlayNote = "no Object Matte effect on the layer — matte panel only";
    var _solo = [], _t0 = _comp.time, _omOn = _om ? _om.enabled : true;
    app.beginUndoGroup("Object Matte preview");
    try {
      for (var a = 1; a <= _comp.numLayers; a++) { var _x = _comp.layer(a); _solo.push(AE.safeGet(function () { return _x.solo; }, false)); }
      for (var b = 1; b <= _comp.numLayers; b++) { var _y = _comp.layer(b); if (_y !== _l) { try { if (_y.solo) _y.solo = false; } catch (eS) {} } }
      _l.solo = true;
      for (var k = 0; k < _times.length; k++) {
        var _t = _times[k], _tag = String(Math.round(_t * 1000));
        var _m = _renderFrame(_comp, _t, _dir + "/matte_" + _tag + ".png", false);
        var _f = { time: _t, ok: _m.ok, matte: _m.ok ? _m.writtenTo : null, plate: null };
        if (!_m.ok) _f.error = _m.error;
        if (_m.ok && _wantPlate) {
          try { _om.enabled = false; } catch (eE) {}
          var _p = _renderFrame(_comp, _t, _dir + "/plate_" + _tag + ".png", false);
          try { _om.enabled = _omOn; } catch (eE2) {}
          if (_p.ok) _f.plate = _p.writtenTo;
        }
        _out.frames.push(_f);
      }
    } catch (eR) {
      _out.ok = false; _out.error = AE.errText(eR);
    } finally {
      if (_om) { try { if (_om.enabled !== _omOn) _om.enabled = _omOn; } catch (eE3) {} }
      for (var c = 1; c <= _comp.numLayers && c <= _solo.length; c++) { var _z = _comp.layer(c); try { if (_z.solo !== _solo[c - 1]) _z.solo = _solo[c - 1]; } catch (eS2) {} }
      try { _comp.time = _t0; } catch (eT) {}
      app.endUndoGroup();
    }
    return _out;
  `;
  const r = await transport.execute({
    code,
    label: "object_matte_preview",
    timeoutMs: 60_000 + times.length * (overlay ? 120_000 : 60_000),
  });
  const p = r.result as PreviewPayload;
  if (!r.ok || !p?.ok) throw new Error(p?.error ?? r.error ?? "preview render failed");
  return p;
}

export interface PreviewFrame extends MatteStats {
  time: number;
  /** excluded pockets between kept pieces — places to look (cyan boxes on the image) */
  gaps: MatteGap[];
  /** the listed people's points against the matte (only on the frame the points were picked on) */
  people?: PersonCheck[];
  people_summary?: { whole: number; partial: number; missing: number };
  /** the composed preview PNG (top: matte over black; bottom: excluded parts in red) */
  file: string | null;
  error?: string;
}

/** Render, measure and compose the preview for each time; images go inline into the tool result. */
async function buildPreview(
  transport: AeTransport,
  comp: unknown,
  layer: unknown,
  times: number[],
  opts: {
    dir: string;
    overlay: boolean;
    width: number;
    region?: Region;
    people: PersonSpec[];
    peopleTime: number;
    gapRadius: number;
  },
): Promise<{ frames: PreviewFrame[]; images: ImageContent[]; note: string }> {
  await fs.mkdir(opts.dir, { recursive: true });
  const rp = await renderPreviewFrames(
    transport,
    comp,
    layer,
    times,
    opts.dir.replace(/\\/g, "/"),
    opts.overlay,
  );
  const region: Region = opts.region ?? { x: 0, y: 0, w: rp.width, h: rp.height };
  const step = previewStep(region.w, opts.width);
  const frames: PreviewFrame[] = [];
  const images: ImageContent[] = [];
  for (const f of rp.frames) {
    if (!f.ok || !f.matte) {
      frames.push({
        time: f.time,
        file: null,
        error: f.error ?? "render failed",
        coverage_pct: 0,
        pieces: 0,
        largest: [],
        small_fragments: 0,
        gaps: [],
      });
      continue;
    }
    const m = decodePngScaled(await readFileSettled(f.matte), step, region);
    const plate = f.plate ? decodePngScaled(await readFileSettled(f.plate), step, region) : null;
    const origin = { x: m.crop.x, y: m.crop.y };
    const stats = matteStats(m.alpha, m.width, m.height, step, origin);
    const gaps = findGaps(m.alpha, m.width, m.height, step, origin, opts.gapRadius);
    const onPeopleFrame = opts.people.length > 0 && Math.abs(f.time - opts.peopleTime) < 1e-3;
    const checks = onPeopleFrame
      ? checkPeople(m.alpha, m.width, m.height, step, origin, opts.people)
      : [];
    const withPlate = !!(plate && plate.width === m.width && plate.height === m.height);
    const pic = composePreview(m.rgb, m.alpha, withPlate ? plate!.rgb : null, m.width, m.height);
    drawMarkers(
      pic,
      m.height,
      withPlate ? 2 : 1,
      step,
      origin,
      gaps,
      onPeopleFrame ? opts.people : [],
      checks,
    );
    const png = encodePngSrgb8(pic.w, pic.h, pic.rgb);
    const file = path.join(opts.dir, `preview_${Math.round(f.time * 1000)}.png`);
    await fs.writeFile(file, png);
    images.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
    const entry: PreviewFrame = { time: f.time, file, ...stats, gaps };
    if (onPeopleFrame) {
      entry.people = checks;
      entry.people_summary = {
        whole: checks.filter((c) => c.status === "whole").length,
        partial: checks.filter((c) => c.status === "partial").length,
        missing: checks.filter((c) => c.status === "missing").length,
      };
    }
    frames.push(entry);
  }
  const note =
    (rp.overlay
      ? "Each image: TOP — the matte over black (what stays); BOTTOM — the whole frame, excluded parts washed RED. "
      : "Each image: the matte over black (what stays). ") +
    "Markers: CYAN numbered boxes = gaps wedged between kept pieces (look there: a person behind another, a lying figure, a child deep in a group, a missing limb — or just sky/ground); " +
    "rings = your `people` points (GREEN inside the matte, YELLOW outside), the person's number by the first point. " +
    "Images follow in the order of `preview`. Boxes are comp pixels (the space of `points`)." +
    (rp.workingSpace && rp.workingSpace !== "None"
      ? ` Working space ${rp.workingSpace}: colours are raw render values — judge shapes, not colour.`
      : "") +
    (rp.overlay ? "" : rp.overlayNote ? ` ${rp.overlayNote}.` : "");
  return { frames, images, note };
}

const CHECK =
  "NOT VERIFIED — error_px only says where a stroke landed, not what AE selected. Work through the image: (1) every YELLOW ring " +
  "(a listed person's point outside the matte) and every person with status partial/missing; (2) every CYAN gap box — look at " +
  "the plate there (bottom panel): a person or a part of one (hidden behind someone, lying on the ground, deep in a group, a " +
  "limb, a head) is a subject too and must be added; (3) red on anyone in the bottom panel. Add a missing person or part with a " +
  "lasso around it that OVERLAPS the neighbouring kept matte by ~40–80 comp px (start and end inside the white area) so the " +
  'pieces merge — a separate outline that only touches is often ignored. Excess background → mode:"subtract" with a lasso ' +
  "around that piece only, never over a head. Report per person what the image shows; never claim a frame you did not look at.";

export const objectMatteUiTool = defineTool({
  name: "ae_object_matte_ui",
  title: "Object Matte by sight",
  description:
    "Object Matte (AE 26) on a layer through After Effects' UI — macOS only; no script can create a selection. " +
    "Give lassos and points in the pixels of a frame you looked at (comp pixels of an ae_render_frame by default, " +
    'or layer source pixels with space:"layer"). A LASSO takes the subjects inside the outline — AE snaps it to their ' +
    "silhouettes — so one lasso can take a whole group of people at once: outline them generously, heads and feet with a " +
    "margin. A POINT takes the subject under it as AE segments it — often only a garment or a torso in a crowd, so use points " +
    'only for a lone, clearly separated subject. mode:"subtract" removes (Option). The tool opens the layer in the Layer ' +
    "panel at `time` (the base frame), makes the Object Matte tool active (checked through the active-tool code — " +
    "Option+W is the Roto Brush group's shortcut and cycles its members), acts with real mouse events, reads back the " +
    "strokes the effect recorded (error_px = where each landed vs where it was meant to), optionally propagates by stepping " +
    "the comp time (propagate_to), and then RENDERS A PREVIEW and returns it as images: top — the matte over black, bottom — " +
    "the frame with the excluded parts in red, with markers: cyan boxes on gaps between kept pieces (where a hidden, lying or " +
    "partly visible person is usually left out) and green/yellow rings on the `people` points you listed. A part of a person, " +
    "someone behind another or lying on the ground is a subject too: add it with a lasso that overlaps the neighbouring kept " +
    "matte so the pieces merge. The result is never " +
    "verified by the tool: look at the images and check every person. With only preview_times (no points, lassos or " +
    "propagate_to) it renders the preview without touching the UI — use it to check any frames. The Layer panel must be " +
    "visible and large enough for the whole picture.",
  group: "operations",
  blockedInReadOnly: true,
  effect: "write",
  inputShape: {
    comp: z.union([z.string(), z.number()]).describe("Composition name or item id."),
    layer: z
      .union([z.string(), z.number()])
      .describe("1-based layer index or layer name (the layer that gets the matte — the plate)."),
    time: z
      .number()
      .nonnegative()
      .describe("Composition time (s) of the base frame the points were picked on."),
    points: z
      .array(pointShape)
      .optional()
      .describe(
        "Clicks: each takes the subject under it as AE segments it (in a crowd often only a part — prefer lassos).",
      ),
    lassos: z
      .array(z.array(pointShape).min(3))
      .optional()
      .describe(
        "Closed outlines (≥ 3 points each, ~12–40 points following the group's contour with a margin): each takes the subjects inside it, snapped to their silhouettes.",
      ),
    mode: z
      .enum(["add", "subtract"])
      .optional()
      .describe(
        "add (default): Shift-click / lasso adds to the matte; subtract: Option-click / Option-lasso removes.",
      ),
    space: z
      .enum(["comp", "layer"])
      .optional()
      .describe(
        "Coordinate space of points and lassos: comp (default — pixels of an ae_render_frame of this comp) or layer (source pixels).",
      ),
    zoom: z
      .number()
      .positive()
      .max(4)
      .optional()
      .describe(
        "Layer panel zoom to set before acting (1 = 100 %). Default: the current zoom, lowered until the picture fits 45 % of the window width.",
      ),
    propagate_to: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        "After the actions, step the comp time from `time` to this time frame by frame so AE propagates the matte (both directions allowed).",
      ),
    settle_ms: z
      .number()
      .int()
      .min(0)
      .max(5000)
      .optional()
      .describe("Pause per propagated frame (default 250 ms; raise on 4K)."),
    preview: z
      .boolean()
      .optional()
      .describe("Render the preview after the actions (default true)."),
    preview_times: z
      .array(z.number().nonnegative())
      .max(8)
      .optional()
      .describe(
        "Times (s) to preview. Default: the base frame, plus propagate_to when given. Alone (no points/lassos/propagate_to) = preview only, no UI.",
      ),
    preview_region: z
      .object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })
      .optional()
      .describe(
        "Comp-pixel rectangle to preview at higher detail (e.g. a group of people) instead of the whole frame.",
      ),
    preview_width: z
      .number()
      .int()
      .min(400)
      .max(1600)
      .optional()
      .describe("Width of each preview panel in pixels (default 1000)."),
    preview_overlay: z
      .boolean()
      .optional()
      .describe(
        "Add the bottom panel with excluded parts in red (default true; renders the frame once more with the effect switched off, then restores it).",
      ),
    people: z
      .array(
        z.object({
          id: z.number().int().min(1),
          name: z.string().optional(),
          head: pointShape.optional(),
          body: pointShape.optional(),
          feet: pointShape.optional(),
        }),
      )
      .max(60)
      .optional()
      .describe(
        "Your checklist of the people who belong in the matte, picked on the frame `people_time` in COMP pixels: a point on each one's head, body and feet (any you can see). The preview marks each point green (inside the matte) or yellow (outside) and reports whole / partial / missing per person. Pass it on every call.",
      ),
    people_time: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        "Frame (s) the people points were picked on (default `time`); people are checked only on that preview frame.",
      ),
    gap_radius: z
      .number()
      .positive()
      .max(1000)
      .optional()
      .describe(
        "Comp pixels: gaps narrower than ~2× this between kept pieces are reported (default 100; raise to 150–200 to catch wider holes).",
      ),
    preview_dir: z
      .string()
      .optional()
      .describe(
        "Absolute folder for the preview PNGs (default: the system temp folder, files overwritten each call). Use the chat's working folder.",
      ),
    tool_code: z
      .string()
      .optional()
      .describe(
        'Project.toolType code of the Object Matte tool (default "161", AE 26.5). The tool reads the active tool and presses Option+W only until this code is active — Option+W is the Roto Brush group\'s shortcut and cycles its members.',
      ),
    dry_run: z
      .boolean()
      .optional()
      .describe("Find the picture and report the mapping without clicking."),
    shot_path: z
      .string()
      .optional()
      .describe(
        "Absolute path to save the capture with the picture rectangle (PNG, ≤ 1600 px wide) for the user.",
      ),
  },
  handler: async (args, transport): Promise<ToolResult> => {
    const points = args.points ?? [];
    const lassos = (args.lassos ?? []).map(normalizeLasso);
    const previewOnly =
      !args.dry_run &&
      !points.length &&
      !lassos.length &&
      args.propagate_to === undefined &&
      !!args.preview_times?.length;
    if (readOnlyMode())
      return errorResult(
        "FORBIDDEN",
        "read-only mode: Object Matte changes the layer's effects (the preview toggles solo and the effect switch).",
      );
    if (!previewOnly && process.platform !== "darwin")
      return errorResult(
        "FORBIDDEN",
        "ae_object_matte_ui drives the macOS UI; on Windows apply Object Matte in the Layer panel by hand and check it here with preview_times only.",
      );
    if (
      !args.dry_run &&
      !points.length &&
      !lassos.length &&
      args.propagate_to === undefined &&
      !previewOnly
    ) {
      return errorResult(
        "INVALID_ARGS",
        "give lassos and/or points, or propagate_to, or preview_times (preview only), or dry_run.",
      );
    }
    const previewOpts = {
      dir: args.preview_dir ?? path.join(os.tmpdir(), "ae-mcp-object-matte"),
      overlay: args.preview_overlay ?? true,
      width: args.preview_width ?? 1000,
      region: args.preview_region,
      people: (args.people ?? []) as PersonSpec[],
      peopleTime: args.people_time ?? args.time,
      gapRadius: args.gap_radius ?? 100,
    };
    const withPreview = async (
      payload: Record<string, unknown>,
      times: number[],
    ): Promise<ToolResult> => {
      if (!times.length) return jsonResult(payload);
      try {
        const pv = await buildPreview(transport, args.comp, args.layer, times, previewOpts);
        const res = jsonResult({
          ...payload,
          preview: pv.frames,
          preview_note: pv.note,
          verified: false,
          check: CHECK,
        });
        res.content.push(...pv.images);
        return res;
      } catch (e) {
        return jsonResult({
          ...payload,
          preview: null,
          preview_error: (e as Error).message,
          verified: false,
          check:
            CHECK +
            " The preview failed — render the layer solo with ae_render_frame and look at it.",
        });
      }
    };
    if (previewOnly) return withPreview({ preview_only: true }, args.preview_times!);

    const mode = args.mode ?? "add";
    const d = desktopFactory.make();
    const log: string[] = [];
    try {
      await d.checkAccess();
      // 1. layer source pixels
      const space = args.space ?? "comp";
      const toSource = async (pts: Point[]): Promise<Point[]> =>
        space === "layer" || !pts.length
          ? pts
          : compToSource(transport, args.comp, args.layer, args.time, pts);
      const srcPoints = await toSource(points);
      const srcLassos: Point[][] = [];
      for (const l of lassos) srcLassos.push(await toSource(l));
      // 2. the Layer panel, the picture on screen
      await d.front();
      const win = await d.window();
      const before = await readStrokes(transport, args.comp, args.layer);
      const { width: LW, height: LH } = before;
      let zoom = args.zoom ?? null;
      let opened = await openLayerPanel(transport, args.comp, args.layer, args.time, zoom);
      if (zoom === null) {
        // lower the zoom until the picture takes at most 45 % of the window width / 60 % of its height
        const fit = Math.min((0.45 * win.w) / LW, (0.6 * win.h) / LH);
        if (opened.zoom > fit) {
          zoom = Math.floor(fit * 1000) / 1000;
          opened = await openLayerPanel(transport, args.comp, args.layer, args.time, zoom);
        }
      }
      await d.sleep(500);
      let cap = await d.capture();
      const expected = (c: Capture) =>
        [LW * opened.zoom * c.scale, LH * opened.zoom * c.scale] as const;
      let pic: PictureRect = findPicture(cap, ...expected(cap), LW, LH);
      if (!pic.found) {
        // one retry at a clearly smaller zoom: the panel may be narrower than the window share assumed above
        const z2 = Math.floor(opened.zoom * 0.6 * 1000) / 1000;
        opened = await openLayerPanel(transport, args.comp, args.layer, args.time, z2);
        await d.sleep(500);
        cap = await d.capture();
        pic = findPicture(cap, ...expected(cap), LW, LH);
      }
      if (args.shot_path) {
        try {
          await d.savePng(cap.img, args.shot_path, 1600);
        } catch (e) {
          log.push(`shot not saved: ${(e as Error).message}`);
        }
      }
      if (!pic.found) {
        return errorResult(
          "OPERATION_FAILED",
          pic.hint ?? "the Layer panel's picture was not found",
          { details: { picture: pic, zoom: opened.zoom, window: win } },
        );
      }
      const mapping = {
        picture: pic,
        zoom: opened.zoom,
        captureScale: cap.scale,
        window: win,
        layer: { name: before.layerName, index: before.layerIndex, width: LW, height: LH },
      };
      if (args.dry_run)
        return jsonResult({ dry_run: true, mapping, strokes_total: before.strokes.length });
      // 3. the Object Matte tool
      const done: {
        kind: string;
        wanted: Point;
        stroke: StrokeInfo | null;
        error_px: number | null;
        picture_moved?: { dx: number; dy: number };
      }[] = [];
      let toolSel: { presses: number; seen: string[] } | null = null;
      if (srcPoints.length || srcLassos.length) {
        toolSel = await selectObjectMatteTool(d, transport, args.tool_code ?? "161");
        await d.sleep(300);
        let prev = before;
        const act = async (kind: "point" | "lasso", wanted: Point, go: () => Promise<void>) => {
          await go();
          await d.sleep(1800); // the host computes the selection
          const after = await readStrokes(transport, args.comp, args.layer);
          const fresh = newStrokes(prev.strokes, after.strokes);
          const s = fresh.length ? fresh[fresh.length - 1] : null;
          const entry: (typeof done)[number] = {
            kind,
            wanted,
            stroke: s,
            error_px: s ? strokeError(s, wanted) : null,
          };
          // The panel can shift after a stroke (the first one creates the effect and the panel's layout
          // changes by a few pixels): find the picture again so the next action lands where it should.
          const c2 = await d.capture();
          const p2 = findPicture(c2, ...expected(c2), LW, LH);
          if (p2.found && (p2.x !== pic.x || p2.y !== pic.y)) {
            entry.picture_moved = { dx: p2.x - pic.x, dy: p2.y - pic.y };
            pic = p2;
          }
          done.push(entry);
          prev = after;
          return s;
        };
        for (let i = 0; i < srcLassos.length; i++) {
          const l = srcLassos[i];
          const s = await act("lasso", l[0], () =>
            d.drag(
              l.map((p) => layerToShot(pic, p)),
              mode === "subtract" ? ["alt"] : [],
            ),
          );
          if (!s) {
            return errorResult(
              "OPERATION_FAILED",
              `lasso ${i + 1} recorded no stroke (active tool code ${await readToolType(transport)}, Object Matte reached with ${toolSel?.presses ?? 0} presses) — set the tool's marquee to Lasso (the ⌾ icon in the tool options bar) once, or the outline lies outside the picture.`,
              { details: { mapping, done, tool: toolSel } },
            );
          }
        }
        for (let i = 0; i < srcPoints.length; i++) {
          const p = srcPoints[i];
          const mods = mode === "subtract" ? ["alt"] : prev.strokes.length ? ["shift"] : [];
          const s = await act("point", p, () => {
            const q = layerToShot(pic, p);
            return d.click(q.x, q.y, mods);
          });
          if (!s) {
            return errorResult(
              "OPERATION_FAILED",
              `click ${i + 1} at layer (${Math.round(p.x)}, ${Math.round(p.y)}) recorded no stroke (active tool code ${await readToolType(transport)}) — the click did not reach After Effects (Accessibility for the client app?) or the point is outside the picture.`,
              { details: { mapping, done, tool: toolSel } },
            );
          }
        }
      }
      // 4. propagation
      let propagated: { frames: number; endTime: number } | null = null;
      if (args.propagate_to !== undefined) {
        propagated = await propagate(
          transport,
          args.comp,
          args.time,
          args.propagate_to,
          args.settle_ms ?? 250,
        );
      }
      const after = await readStrokes(transport, args.comp, args.layer);
      const worst = done.reduce((m, x) => Math.max(m, x.error_px ?? 0), 0);
      const times =
        args.preview === false
          ? []
          : args.preview_times?.length
            ? args.preview_times
            : args.propagate_to !== undefined
              ? [args.time, args.propagate_to]
              : [args.time];
      // The result is read by a model whose context every byte costs: the full stroke list (100+ rows on a
      // worked matte) and the screen mapping are left out — the new strokes sit in `actions`, the mapping
      // comes with dry_run, the whole list with ae_layer_info.
      const brief = {
        tool: toolSel,
        actions: done.map((x) => ({
          kind: x.kind,
          wanted: x.wanted,
          stroke: x.stroke?.name ?? null,
          error_px: x.error_px,
          ...(x.picture_moved ? { picture_moved: x.picture_moved } : {}),
        })),
        worst_error_px: worst,
        strokes_total: after.strokes.length,
        propagated,
        ...(log.length ? { logs: log } : {}),
      };
      return await withPreview(brief, [...new Set(times)]);
    } catch (e) {
      if (e instanceof DesktopError)
        return errorResult("OPERATION_FAILED", e.message, { logs: log });
      return errorResult("OPERATION_FAILED", (e as Error).message, { logs: log });
    }
  },
});
