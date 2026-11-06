// macOS desktop layer for the Object Matte UI tool: finds After Effects' window on any display, brings it to
// the front, captures it (`screencapture -R`, converted by `sips`), and posts hardware-level mouse and
// keyboard events (CGEvent through JavaScript for Automation). Needs, for the MCP client app that runs this
// server: Accessibility (events) and Screen Recording (capture). No native modules.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type RgbImage, encodeBmp, parseBmp } from "./image.js";

export type Exec = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string }>;

export const defaultExec: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const e = error as Error & { stderr?: string };
          e.stderr = String(stderr ?? "");
          reject(e);
        } else resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

export interface WindowBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
}

/** One JXA program for every desktop action; argv[0] selects it. */
export const JXA = String.raw`
ObjC.import('CoreGraphics'); ObjC.import('AppKit'); ObjC.import('ApplicationServices');
function ev(type, x, y) { var e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), $.kCGMouseButtonLeft); $.CGEventPost($.kCGHIDEventTap, e); }
function flagsOf(mods) { var f = 0;
  if (mods.indexOf('cmd') >= 0) f |= $.kCGEventFlagMaskCommand;
  if (mods.indexOf('alt') >= 0 || mods.indexOf('opt') >= 0) f |= $.kCGEventFlagMaskAlternate;
  if (mods.indexOf('shift') >= 0) f |= $.kCGEventFlagMaskShift;
  if (mods.indexOf('ctrl') >= 0) f |= $.kCGEventFlagMaskControl;
  return f; }
function modCodes(mods) { var c = [];
  if (mods.indexOf('shift') >= 0) c.push(56); if (mods.indexOf('cmd') >= 0) c.push(55);
  if (mods.indexOf('alt') >= 0 || mods.indexOf('opt') >= 0) c.push(58); if (mods.indexOf('ctrl') >= 0) c.push(59);
  return c; }
function releaseMods(codes) {
  for (var i = 0; i < codes.length; i++) { delay(0.03); var k = $.CGEventCreateKeyboardEvent(null, codes[i], false); $.CGEventSetFlags(k, 0); $.CGEventPost($.kCGHIDEventTap, k); }
  // make sure nothing stays down (shift / cmd / alt / ctrl, left and right)
  delay(0.05); var left = Number($.CGEventSourceFlagsState(1)) & (0x20000 | 0x100000 | 0x80000 | 0x40000);
  if (left) { var all = [56, 60, 55, 54, 58, 61, 59, 62]; for (var j = 0; j < all.length; j++) { var u = $.CGEventCreateKeyboardEvent(null, all[j], false); $.CGEventSetFlags(u, 0); $.CGEventPost($.kCGHIDEventTap, u); } } }
function hostApps() { var all = $.NSWorkspace.sharedWorkspace.runningApplications, out = [];
  for (var i = 0; i < all.count; i++) { var a = all.objectAtIndex(i), id = ObjC.unwrap(a.bundleIdentifier) || '';
    if (id.indexOf('com.adobe.AfterEffects') === 0) out.push(a); }
  return out; }
function run(argv) {
  var cmd = String(argv[0] || '');
  if (cmd === 'trusted') return JSON.stringify({ trusted: !!$.AXIsProcessTrusted() });
  if (cmd === 'front') { var apps = hostApps(); if (!apps.length) return JSON.stringify({ error: 'After Effects is not running' });
    apps[0].activateWithOptions($.NSApplicationActivateIgnoringOtherApps); return JSON.stringify({ activated: ObjC.unwrap(apps[0].localizedName) }); }
  if (cmd === 'window') {
    var arr = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
    var pids = hostApps().map(function (a) { return Number(a.processIdentifier); }), best = null;
    for (var j = 0; j < arr.length; j++) { var w = arr[j], b = w.kCGWindowBounds;
      if (pids.indexOf(Number(w.kCGWindowOwnerPID)) < 0 || w.kCGWindowLayer !== 0) continue;
      if (!best || b.Width * b.Height > best.w * best.h) best = { x: b.X, y: b.Y, w: b.Width, h: b.Height, name: String(w.kCGWindowName || '') }; }
    return JSON.stringify(best || { error: 'no After Effects window on screen' });
  }
  if (cmd === 'key') { var parts = String(argv[1]).toLowerCase().split('+'), code = parseInt(argv[2], 10), flags = flagsOf(parts);
    // modifier keys go down and up as key events too: a flag set only on the key event leaves the
    // system's modifier state stuck (a «held» Shift turned later "=" presses into Shift+=)
    var mods0 = modCodes(parts);
    for (var a = 0; a < mods0.length; a++) { var md = $.CGEventCreateKeyboardEvent(null, mods0[a], true); $.CGEventSetFlags(md, flags); $.CGEventPost($.kCGHIDEventTap, md); delay(0.03); }
    var kd = $.CGEventCreateKeyboardEvent(null, code, true), ku = $.CGEventCreateKeyboardEvent(null, code, false);
    if (flags) { $.CGEventSetFlags(kd, flags); $.CGEventSetFlags(ku, flags); }
    $.CGEventPost($.kCGHIDEventTap, kd); delay(0.05); $.CGEventPost($.kCGHIDEventTap, ku);
    releaseMods(mods0); return 'key'; }
  if (cmd === 'type') { var text = String(argv[1]), codes = {'0':29,'1':18,'2':19,'3':20,'4':21,'5':23,'6':22,'7':26,'8':28,'9':25,'-':27,' ':49};
    for (var t = 0; t < text.length; t++) { var ch = text.charAt(t), kc = codes.hasOwnProperty(ch) ? codes[ch] : 0;
      var d1 = $.CGEventCreateKeyboardEvent(null, kc, true), u1 = $.CGEventCreateKeyboardEvent(null, kc, false);
      if (!codes.hasOwnProperty(ch)) { $.CGEventKeyboardSetUnicodeString(d1, 1, [ch.charCodeAt(0)]); $.CGEventKeyboardSetUnicodeString(u1, 1, [ch.charCodeAt(0)]); }
      $.CGEventPost($.kCGHIDEventTap, d1); delay(0.02); $.CGEventPost($.kCGHIDEventTap, u1); delay(0.03); }
    return 'typed'; }
  if (cmd === 'path') { var pm = String(argv[1] || '').split('+').filter(function (z) { return z; }), pf = flagsOf(pm), pk = modCodes(pm), pts = [];
    for (var q = 2; q + 1 < argv.length; q += 2) pts.push([parseFloat(argv[q]), parseFloat(argv[q + 1])]);
    function pev(type, x, y) { var e = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), $.kCGMouseButtonLeft); if (pf) $.CGEventSetFlags(e, pf); $.CGEventPost($.kCGHIDEventTap, e); }
    for (var pa = 0; pa < pk.length; pa++) { var pd = $.CGEventCreateKeyboardEvent(null, pk[pa], true); $.CGEventSetFlags(pd, pf); $.CGEventPost($.kCGHIDEventTap, pd); delay(0.05); }
    pev($.kCGEventMouseMoved, pts[0][0], pts[0][1]); delay(0.3); pev($.kCGEventLeftMouseDown, pts[0][0], pts[0][1]); delay(0.25);
    // the host samples a lasso at its own rate: ~10-px steps with a short pause each (a fast sweep is not recorded)
    for (var s = 1; s < pts.length; s++) { var x0 = pts[s-1][0], y0 = pts[s-1][1], x1 = pts[s][0], y1 = pts[s][1], n = Math.max(4, Math.round(Math.hypot(x1-x0, y1-y0) / 10));
      for (var k = 1; k <= n; k++) { pev($.kCGEventLeftMouseDragged, x0 + (x1-x0)*k/n, y0 + (y1-y0)*k/n); delay(0.02); } delay(0.08); }
    delay(0.25); var last = pts[pts.length-1]; pev($.kCGEventLeftMouseUp, last[0], last[1]); if (pk.length) releaseMods(pk); return 'path'; }
  if (cmd === 'press' || cmd === 'release' || cmd === 'held') {
    // a drag in several calls (a capture between them): modifier keys go down with the button and up with
    // it; LeftMouseDragged events carry their deltas, which the host reads instead of the position
    var mods = String(argv[argv.length - 1] || '').split('+'), F = flagsOf(mods), mk = modCodes(mods);
    function post(e) { if (F) $.CGEventSetFlags(e, F); $.CGEventPost($.kCGHIDEventTap, e); }
    var px = parseFloat(argv[1]), py = parseFloat(argv[2]);
    if (cmd === 'press') { for (var m = 0; m < mk.length; m++) { var kdn = $.CGEventCreateKeyboardEvent(null, mk[m], true); $.CGEventSetFlags(kdn, F); $.CGEventPost($.kCGHIDEventTap, kdn); delay(0.05); }
      post($.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, $.CGPointMake(px, py), $.kCGMouseButtonLeft)); delay(0.3);
      post($.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, $.CGPointMake(px, py), $.kCGMouseButtonLeft)); delay(0.35); return 'pressed'; }
    if (cmd === 'release') { post($.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, $.CGPointMake(px, py), $.kCGMouseButtonLeft)); delay(0.1); releaseMods(mk); return 'released'; }
    var tx = parseFloat(argv[3]), ty = parseFloat(argv[4]), step = Math.max(0.5, parseFloat(argv[5]) || 1), dl = (parseFloat(argv[6]) || 12) / 1000;
    var n = Math.max(1, Math.round(Math.max(Math.abs(tx - px), Math.abs(ty - py)) / step)), lx = px, ly = py;
    for (var i = 1; i <= n; i++) { var cx = px + (tx - px) * i / n, cy = py + (ty - py) * i / n;
      var e = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDragged, $.CGPointMake(cx, cy), $.kCGMouseButtonLeft);
      $.CGEventSetIntegerValueField(e, 4, Math.round(cx) - Math.round(lx)); $.CGEventSetIntegerValueField(e, 5, Math.round(cy) - Math.round(ly));
      post(e); lx = cx; ly = cy; delay(dl); }
    delay(0.25); return 'held'; }
  var x = parseFloat(argv[1]), y = parseFloat(argv[2]);
  if (cmd === 'move') { ev($.kCGEventMouseMoved, x, y); return 'moved'; }
  if (cmd === 'rclick') { ev($.kCGEventMouseMoved, x, y); delay(0.3);
    var rd = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseDown, $.CGPointMake(x, y), $.kCGMouseButtonRight);
    var ru = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseUp, $.CGPointMake(x, y), $.kCGMouseButtonRight);
    $.CGEventPost($.kCGHIDEventTap, rd); delay(0.08); $.CGEventPost($.kCGHIDEventTap, ru); return 'rclicked'; }
  if (cmd === 'click') { var cm = argv.slice(3).map(String), fl = flagsOf(cm), cmk = modCodes(cm);
    ev($.kCGEventMouseMoved, x, y); delay(0.3);
    for (var c = 0; c < cmk.length; c++) { var cd = $.CGEventCreateKeyboardEvent(null, cmk[c], true); $.CGEventSetFlags(cd, fl); $.CGEventPost($.kCGHIDEventTap, cd); delay(0.03); }
    var d = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, $.CGPointMake(x, y), $.kCGMouseButtonLeft);
    var u = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, $.CGPointMake(x, y), $.kCGMouseButtonLeft);
    if (fl) { $.CGEventSetFlags(d, fl); $.CGEventSetFlags(u, fl); }
    $.CGEventPost($.kCGHIDEventTap, d); delay(0.08); $.CGEventPost($.kCGHIDEventTap, u);
    if (cmk.length) releaseMods(cmk); return 'clicked'; }
  return 'unknown command';
}`;

export const KEYCODES: Readonly<Record<string, number>> = {
  a: 0,
  o: 31,
  l: 37,
  return: 36,
  enter: 36,
  escape: 53,
  tab: 48,
  // key codes, not characters: the host's shortcuts stay on these keys in any keyboard layout
  equal: 24,
  minus: 27,
  backslash: 42,
  v: 9,
  w: 13,
  slash: 44,
  pagedown: 121,
  pageup: 116,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
};

export interface Capture {
  img: RgbImage;
  /** screenshot pixels per screen point (2 on Retina) */
  scale: number;
  /** window origin in global screen points */
  origin: { x: number; y: number };
}

/** The desktop as the Object Mask actions see it; all coordinates are pixels of the latest capture. */
export interface Desktop {
  capture(): Promise<Capture>;
  click(x: number, y: number, mods?: string[]): Promise<void>;
  move(x: number, y: number): Promise<void>;
  drag(points: { x: number; y: number }[], mods?: string[]): Promise<void>;
  key(combo: string): Promise<void>;
  type(text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  savePng(img: RgbImage, path: string, maxWidth?: number): Promise<string>;
}

/** A drag held across captures (closed-loop dragging) and a right click — the Time Remapping actions. */
export interface PointerDesktop extends Desktop {
  rightClick(x: number, y: number): Promise<void>;
  /** press the left button (with modifier keys held) at capture pixels */
  mouseDown(x: number, y: number, mods?: string[]): Promise<void>;
  /** move the held button by capture pixels, in steps of `stepPx`, events carrying their deltas */
  mouseDragBy(dx: number, dy: number, mods?: string[], stepPx?: number): Promise<void>;
  /** release the button (and the modifier keys) where it is */
  mouseUp(mods?: string[]): Promise<void>;
}

export class DesktopError extends Error {}

export class MacDesktop implements PointerDesktop {
  private last: Capture | null = null;
  /** where the held button is, in screen points */
  private held: [number, number] | null = null;
  private readonly work: string;

  constructor(
    private readonly exec: Exec = defaultExec,
    workDir?: string,
  ) {
    this.work = workDir ?? mkdtempSync(join(tmpdir(), "ae-objmatte-ui-"));
  }

  private async jxa(...args: (string | number)[]): Promise<string> {
    try {
      const r = await this.exec(
        "/usr/bin/osascript",
        ["-l", "JavaScript", "-e", JXA, ...args.map(String)],
        30_000,
      );
      return r.stdout.trim();
    } catch (e) {
      throw new DesktopError(
        `osascript failed: ${String((e as { stderr?: string }).stderr || (e as Error).message)
          .trim()
          .slice(0, 300)}`,
      );
    }
  }

  private async json<T>(...args: (string | number)[]): Promise<T> {
    const out = await this.jxa(...args);
    try {
      return JSON.parse(out) as T;
    } catch {
      throw new DesktopError(`unexpected osascript output: ${out.slice(0, 200)}`);
    }
  }

  async checkAccess(): Promise<void> {
    const t = await this.json<{ trusted: boolean }>("trusted");
    if (!t.trusted) {
      throw new DesktopError(
        "Accessibility permission is missing for the app that runs this MCP server (Claude Desktop, Cursor, VS Code, Terminal …): System Settings → Privacy & Security → Accessibility → turn it on for that app, then restart it. Nothing was clicked.",
      );
    }
  }

  async front(): Promise<string> {
    const r = await this.json<{ activated?: string; error?: string }>("front");
    if (!r.activated) throw new DesktopError(r.error ?? "could not activate After Effects");
    await this.sleep(800);
    return r.activated;
  }

  async window(): Promise<WindowBounds> {
    const r = await this.json<WindowBounds & { error?: string }>("window");
    if (r.error || !(r.w > 0 && r.h > 0)) {
      throw new DesktopError(
        `${r.error ?? "no After Effects window"} — it may be minimized, on another Space or a Stage Manager thumbnail; bring After Effects to the front`,
      );
    }
    return r;
  }

  async capture(): Promise<Capture> {
    const b = await this.window();
    const png = join(this.work, `shot-${Date.now()}.png`);
    try {
      await this.exec(
        "/usr/sbin/screencapture",
        [
          "-x",
          "-R",
          `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`,
          png,
        ],
        30_000,
      );
    } catch (e) {
      const msg = String((e as { stderr?: string }).stderr || (e as Error).message);
      throw new DesktopError(
        /could not create image/i.test(msg)
          ? "Screen Recording permission is missing for the app that runs this MCP server: System Settings → Privacy & Security → Screen & System Audio Recording → turn it on for that app, then restart it."
          : `screencapture failed: ${msg.trim().slice(0, 200)}`,
      );
    }
    const img = await this.decode(png);
    // window bounds may be off by a point (3840 px of a 3841 pt window): snap to the backing scale
    const raw = img.w / b.w,
      near = Math.round(raw);
    this.last = {
      img,
      scale: near >= 1 && Math.abs(raw - near) < 0.01 ? near : raw,
      origin: { x: b.x, y: b.y },
    };
    return this.last;
  }

  /** Any image file → RGB through `sips` (optionally capped in width). */
  async decode(path: string, maxWidth?: number): Promise<RgbImage> {
    const bmp = join(this.work, `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bmp`);
    const args = [
      ...(maxWidth ? ["--resampleWidth", String(maxWidth)] : []),
      "-s",
      "format",
      "bmp",
      path,
      "--out",
      bmp,
    ];
    try {
      await this.exec("/usr/bin/sips", args, 60_000);
    } catch (e) {
      throw new DesktopError(
        `sips could not read ${path}: ${String(
          (e as { stderr?: string }).stderr || (e as Error).message,
        )
          .trim()
          .slice(0, 200)}`,
      );
    }
    return parseBmp(readFileSync(bmp));
  }

  /** Pixel size of an image file (`sips -g`), without decoding it. */
  async imageSize(path: string): Promise<{ w: number; h: number }> {
    let out = "";
    try {
      out = (
        await this.exec("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], 30_000)
      ).stdout;
    } catch (e) {
      throw new DesktopError(
        `sips could not read ${path}: ${String(
          (e as { stderr?: string }).stderr || (e as Error).message,
        )
          .trim()
          .slice(0, 200)}`,
      );
    }
    const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]),
      h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
    if (!(w > 0 && h > 0)) throw new DesktopError(`not an image: ${path}`);
    return { w, h };
  }

  async savePng(img: RgbImage, path: string, maxWidth?: number): Promise<string> {
    const bmp = join(this.work, `out-${Date.now()}.bmp`);
    writeFileSync(bmp, encodeBmp(img));
    const args = [
      ...(maxWidth && img.w > maxWidth ? ["--resampleWidth", String(maxWidth)] : []),
      "-s",
      "format",
      "png",
      bmp,
      "--out",
      path,
    ];
    await this.exec("/usr/bin/sips", args, 60_000);
    return path;
  }

  private toPoint(x: number, y: number): [number, number] {
    if (!this.last) throw new DesktopError("no capture yet — coordinates have no reference");
    return [
      Math.round((this.last.origin.x + x / this.last.scale) * 10) / 10,
      Math.round((this.last.origin.y + y / this.last.scale) * 10) / 10,
    ];
  }

  async click(x: number, y: number, mods: string[] = []): Promise<void> {
    await this.jxa("click", ...this.toPoint(x, y), ...mods);
  }

  async move(x: number, y: number): Promise<void> {
    await this.jxa("move", ...this.toPoint(x, y));
  }

  async rightClick(x: number, y: number): Promise<void> {
    await this.jxa("rclick", ...this.toPoint(x, y));
  }

  async mouseDown(x: number, y: number, mods: string[] = []): Promise<void> {
    const p = this.toPoint(x, y);
    await this.jxa("press", ...p, mods.join("+"));
    this.held = p;
  }

  async mouseDragBy(dx: number, dy: number, mods: string[] = [], stepPx = 1): Promise<void> {
    if (!this.held || !this.last) throw new DesktopError("mouseDragBy without a pressed button");
    const s = this.last.scale,
      [x, y] = this.held;
    const to: [number, number] = [
      Math.round((x + dx / s) * 10) / 10,
      Math.round((y + dy / s) * 10) / 10,
    ];
    await this.jxa("held", x, y, ...to, Math.max(0.5, stepPx / s), 12, mods.join("+"));
    this.held = to;
  }

  async mouseUp(mods: string[] = []): Promise<void> {
    const p = this.held ?? (this.last ? [this.last.origin.x, this.last.origin.y] : [0, 0]);
    this.held = null;
    await this.jxa("release", p[0], p[1], mods.join("+"));
  }

  async drag(points: { x: number; y: number }[], mods: string[] = []): Promise<void> {
    if (points.length < 2) throw new DesktopError("a drag needs at least two points");
    await this.jxa("path", mods.join("+"), ...points.flatMap((p) => this.toPoint(p.x, p.y)));
  }

  async key(combo: string): Promise<void> {
    const parts = combo.toLowerCase().split("+");
    const code = KEYCODES[parts[parts.length - 1]];
    if (code === undefined) throw new DesktopError(`unknown key: ${combo}`);
    await this.jxa("key", combo, code);
  }

  async type(text: string): Promise<void> {
    await this.jxa("type", text);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
