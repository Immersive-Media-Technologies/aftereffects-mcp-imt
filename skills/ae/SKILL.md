---
name: ae
description: Driving Adobe After Effects as an agent through AE-MCP-IMT (ae_catalog / ae_do / ae_render_frame …) — project hygiene, what ExtendScript cannot do and the UI workarounds for it, camera tracking, attaching 3D content to tracked footage, testing third-party plugins, rendering, native motion graphics — on localized After Effects in any UI language too. Read at the start of any After Effects task. This file is the router — read the recipe or plugin file it points to, not everything.
revision: 4
updated_at: 2026-10-27
---

# After Effects — agent skill (over ae-mcp, not instead of it)

**Rule of the house:** every state read and every change goes through **AE-MCP-IMT** (`ae_catalog` →
`ae_do`, `ae_comp_info`, `ae_layer_info`, `ae_render_frame`, `ae_save_project`). This skill adds what
the server cannot: the order of work, the things only the UI can do and how to do them safely, recipes
for multi-step jobs, and knowledge about plugins. **No script here duplicates an `ae_do` operation** —
if an atom is missing, it belongs in the server (an `ae_do` operation), not in `scripts/`.

Paths below are relative to this file's folder. `AE_SKILL` = this folder. Vendored references: run `fetch-vendor.sh` once (download only).

## 0. Budget — the live case that made this skill

The first plugin test (11.10.2026) took **~76 tool calls per hour**: scripts written to files and run
through `osascript`, status read back from files, a screenshot per step, several `Read`s of frames.
The same work fits in a fraction of that when:

1. Use `ae_do` **read operations** (`property.get`, `effect.list_on_layer`, `layer.info`, `ae_comp_info`)
   instead of writing a `.jsx` that writes a `.txt`. They return JSON in the same call.
2. Need raw ExtendScript? **`ae_do eval.run`** returns the function's `return` value directly — no
   file round-trip, no `osascript` from Bash. Keep ES3 (no `let`/`const`/arrow functions/`JSON`).
3. **`batch.run {ops:[{operation, args}…]}`** for a sequence (one undo group, one call; the array is
   called `ops`); **`atomic: true`** when the steps only make sense together — a failed child undoes
   the whole batch (`rollback.verified`). `ae_catalog` once with the operation name for its
   parameters — not category by category (the 11.10 live run spent 4 calls browsing).
4. **Verify writes with `comp.snapshot` → mutation → `comp.diff {snapshot}`** (tens of tokens: added /
   removed / changed layers and fields) instead of a second `ae_comp_info`; a picture check is
   `ae_render_frame {compareWith}` (changed ratio + bbox) before a `Read`.
5. **Polling** (tracker analysis, render) = one Bash call with `scripts/ae-wait.sh`, not a loop of calls.
6. **Screenshots only for UI-only steps** (§2) and only cropped to the panel (`scripts/ae-shot.sh X Y W H`).
   Verification of the *picture* is `ae_render_frame`, not a screenshot.
7. Check frames: render 3 (entrance / middle / exit), glue them with `scripts/frame-strip.py`,
   **one `Read`**. A contact sheet of a rendered preview: `frame-strip.py out.png render.mp4 --every 0.5`.
8. Ask the user for a UI click only when §2 says the step is UI-only *and* the scripted workaround
   failed; otherwise do it.

## 1. Order of work (always)

1. **Know the state:** `ae_project_info` (what is open, dirty?) → `ae_comp_info` of the target comp;
   on a project you did not build, `project.audit` first (missing footage/fonts, expression errors).
   Localized UI (verified on a **Russian** AE): address effects and properties by **matchName**
   (`ADBE 3D Tracker`, `ADBE Slider Control-0001`, `irrealix Gaussian Splatting-0031`), never by display
   name; menu commands by id (`ae_do command.execute {id}`, ids in `command.list` — the same on every
   UI language; the menu label is only a hint), `scripts/ae-menu.sh` only for an item without an id;
   render templates by the name `render.list_templates` gives (the built-in ones also by English name);
   wait on numbers or matchNames, never on UI text (`scripts/ae-wait.sh`).
2. **Save before anything irreversible** — `project.checkpoint {label}` (saves + keeps a copy that
   survives a crash or relaunch; `project.revert {id}` brings it back) before a multi-step change,
   before `project.open/new`, before any UI-only step that can crash AE (§2); `project.save_increment`
   before restructuring a project the user keeps editing.
3. **Operate** with `ae_do` (`batch.run` when ≥ 2 steps). Keep everything in the project folder:
   renders → `<folder of the .aep>/renders/<comp or purpose>/`, check frames → a frames folder of
   your own (never the server's mailbox).
4. **Verify by values, then by frame:** `comp.diff` / `property.sample` / `ae_layer_info` is the truth;
   `ae_render_frame` shows it (`compareWith` says whether and where the picture changed); expressions —
   `expression.validate`. A "success" from a tool is not a verified picture.
5. **Save**, name the check frames in the reply, and write down what the next run should know
   (plugin facts → `plugins/<slug>.md`).

## 2. What ExtendScript / ae-mcp cannot do — and the workaround

| UI-only step | Why | Workaround (verified = ✓, plausible = ?) |
|---|---|---|
| **Start 3D Camera Tracker analysis** | `Effects.addProperty("ADBE 3D Tracker")` adds the effect but never analyses | select the footage layer (`timeline.select_layers`) → `ae_do command.execute {id: 3983}` (Animation › Track Camera, «Анимация › Отслеживать камеру»; ? — the ✓ path of 11.10 was the menu click, `scripts/ae-menu.sh`, kept as the fallback) → `scripts/ae-wait.sh` until the Average Error label carries a number → `recipes/camera-track.md` |
| **«Create Camera» button** of the tracker, **«Set Ground Plane and Origin»** | buttons in the Effect Controls panel / context menu of the viewer | ✓ real mouse events `scripts/ae-click.js` (CGEvent). **Never** System Events `click` on AE panel buttons — it crashed AE 26.5 ("no current context" → fatal) |
| Selecting tracker points, dragging in the viewer | viewer interaction | ✓ `ae-click.js click` on a point between solved points selects the triangle; shift-click adds; marquee drag did **not** select |
| Plugin buttons (irrealix «Generate 3D Null», Register…) | custom UI in the effect | ✓ expressions / property writes achieve the same where possible (`plugins/irrealix-gaussian-splatting.md`); else `ae-click.js` |
| Roto Brush / Object Matte propagation, Content-Aware Fill, Warp Stabilizer analysis | background analysis, UI-driven | ? apply with `effect.add` or by command id (`command.execute`: Warp Stabilizer VFX 3986, Track Mask 10311 — `command.list`), a menu item without an id via `ae-menu.sh`, poll with `ae-wait.sh`; the user may need to paint the first stroke |
| Mocha AE | separate app | → `recipes/tracking-mocha.md` (what to script, what the user does) |
| Dialogs («Save changes?», tutorial tips, crash dialogs) | modal — blocks DoScript; a timed-out call comes back as **`DIALOG_OPEN`** with the dialog text | ✓ `ae_dialogs {action:"list"}` / `{action:"dismiss", id}` (cancel action — a question is never answered for the user); the OK-only tutorial tip: `scripts/ae-dialogs.sh close`; an open **menu** blocks DoScript with `-1712` until `ae-dialogs.sh escape` |
| AE not responding, `-1719` from System Events | process gone (crashed) | ✓ relaunch with the saved project: `open -a "Adobe After Effects 2026" <project.aep>`; wait for `ae_version_info` to answer; then `ae-dialogs.sh close` for the recovery dialogs |

Screen geometry for clicks: `scripts/ae-windows.js` (AE windows, points, frontmost app) and
`ae-windows.js displays` (which display, scale). **macOS Stage Manager:** when AE is not the frontmost
app it sits in the strip on the left as a ~150 px thumbnail and those are the bounds you get — the
script marks it `[STAGE MANAGER THUMBNAIL]`. Always `scripts/ae-dialogs.sh front` → `ae-windows.js` →
crop → click; never click a thumbnail (it switches apps, the button is not there). This is the
"AE window shrank to a plate at the bottom left" of 11.10, not something AE does on save. `screencapture` needs `-D <n>` on a multi-display Mac. On a 4K display at
1:1 the screenshot pixels equal screen points; on Retina divide by the backing scale.

## 3. Recipes — read the one you need

| task | read |
|---|---|
| camera solve from footage (3D Camera Tracker): launch, wait, create camera, ground plane, read the camera back | `recipes/camera-track.md` |
| put a 3D thing (splat, model, solid, graphic) on tracked footage: null at the origin, parent/expressions, scale, slide check | `recipes/attach-3d.md` |
| test a third-party plugin (apply, dump parameters with matchNames, feed a model layer, render, timing, verdict) | `recipes/plugin-test.md` |
| render: templates on a localized AE, output module, a preview segment, frame checks | `recipes/render.md` |
| motion graphics (titles, lower thirds, logo stings, infographics) — the editable-comp method, CONTROLS rig, Essential Graphics | `recipes/motion-graphics.md` |
| masks, track mattes, Roto Brush / Object Matte, alpha | `recipes/masks-roto.md` |
| planar / point tracking in Mocha AE and the Tracker panel | `recipes/tracking-mocha.md` |

## 4. Plugins — knowledge files

One file per plugin in `plugins/<slug>.md` (template: `plugins/README.md`): what it is, install, the
effect's matchName and the parameters that matter (matchName · meaning · scripting quirks), how it takes
input, how it reacts to the comp camera, what is UI-only, measured performance, verdicts, open issues.
Read the file **before** touching the plugin; write a new one after a test.

| plugin | file |
|---|---|
| irrealix Gaussian Splatting for AE (1.7.1) | `plugins/irrealix-gaussian-splatting.md` |

## 5. Scripts (UI workarounds only)

| script | what |
|---|---|
| `scripts/ae-click.js move\|click\|dblclick\|rclick X Y [shift]`, `drag X1 Y1 X2 Y2` | hardware-level mouse events (CGEvent) |
| `scripts/ae-windows.js [displays]` | AE windows (flags a Stage Manager thumbnail), frontmost app, displays with bounds in points |
| `scripts/ae-menu.sh <menu> <item> [sub]` | click a menu item by its labels in this AE's UI language — only for an item without a command id (`command.execute {id}` first) |
| `scripts/ae-dialogs.sh list\|close [N]\|escape\|front\|menus <menu>` | menus, focus, Return on an OK-only tip (dialogs themselves: `ae_dialogs`) |
| `scripts/ae-wait.sh status.jsx out.txt REGEX [timeout] [interval]` | poll a status file written by a .jsx until it matches (a token the .jsx decides — SOLVED/PENDING — not UI text) |
| `scripts/ae-shot.sh out [X Y W H [D]]` | screenshot of display D, optionally cropped |
| `scripts/frame-strip.py` | glue check frames / contact sheet of a video into one image |
| `scripts/measure-slide.py` | does an inserted object slide on the plate — measured in px, not eyeballed |

All of them run from Bash on the Mac; `ae-click.js` and `ae-menu.sh`/`ae-dialogs.sh` need Accessibility
for the calling app, `ae-shot.sh` needs Screen Recording (grant them to the app that runs the scripts).

## 6. Knowledge — AE scripting references (vendored, read on demand)

`vendor/ae2026/after-effects/references/extendscript-gotchas.md` (ES3, ease arrays, text documents),
`vendor/ae2026/after-effects/references/whats-new.md` (AE 26.x), expression library and motion
references listed in `recipes/motion-graphics.md`. Vendored sets are MIT, fetched by
`fetch-vendor.sh` next to this file (not in git).
