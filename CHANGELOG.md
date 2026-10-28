# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The server behaved differently depending on the After Effects UI language.** Everything below was
  checked offline against AE 26.5's own string tables (English in its binaries, de, es, fr, it, ja, ko,
  pt-BR, ru, zh-CN in `Dictionaries/`); nothing that worked on a Russian AE stops working.
  - **Render templates.** Their names are localized (a Russian AE lists «Оптимальные настройки», not
    "Best Settings"), and an unknown `renderTemplate` / `outputTemplate` of `render.set_output` only
    produced a warning while the item rendered with the template it already had. Both names are now
    checked before anything changes; a name this AE does not have fails the call and lists the available
    ones. The built-in templates (5 render settings, 11 output modules) also resolve from their English
    name, or their name in any of the ten languages, to the one this AE lists — through `localize()` of
    AE's own ZString first, then a table read from AE 26.5. A resolved alias is named in `warnings`; the
    result reports `renderTemplate` / `outputTemplate`.
  - **Display names AE translates.** Shape operations, project export/import, `ae_layer_info` and the
    capture calibration reached groups by "Contents", "Transform", "Material Options" and "Audio",
    which are not on Adobe's list of names accessible by name. They now use matchNames
    (`ADBE Root Vectors Group` / `ADBE Vectors Group`, `ADBE Transform Group`,
    `ADBE Material Options Group`, `ADBE Audio Group`). A test keeps them out of `src/` and `jsx/`.
  - **`command.list` gave wrong ids for most entries** — the list agents use instead of localized menu
    labels: 2040 is the Layer › Mask submenu (Deselect All is 2004), 2072 is Effect › Remove All (not
    "Move All Attributes"), 2157 is Add Marker, 2028 is not New Null Object (2767). It is rebuilt from the
    ids AE itself attaches to its menu strings (`$$$/AE/MenuID/<menu>/<Name>_<id>`), and gains Track
    Camera (3983), Track Motion (2568), Warp Stabilizer VFX (3986) and Track Mask (10311).
  - **The «Invalid numeric result» hint** (an array value concatenated into a string) matched only the
    English and Russian text. The error is After Effects' own (`$$$/AE/BEE/LStr/0392`), not an
    ExtendScript error code, so it is now recognised by AE's text for it in the running UI language
    (`localize()`), with its spelling in all ten languages as the fallback.
  - **`effect.apply_template`** tried the English property name before the index although its own
    comment called the index authoritative; the index now comes first (the same property on every UI
    language) and the name is only a fallback. The comment that called `"Effects"` locale-dependent is
    corrected — it is on Adobe's list; the matchName is kept as the canonical address.
  - **`ae_render_frame`**: a working space reported under the localized label of "None" («Нет», «Ohne»,
    …) counts as no color management.

- **The offline transport suite drove a real After Effects on macOS.** Its stand-in executable was `/bin/true`, which
  macOS does not have (`/usr/bin/true`); `resolveAfterFxPath` fell through to the installed AE, so every `npm test`
  booted it, left `osascript` processes blocked for two hours, and let the AE-gated e2e suite probe the instance it
  had just launched. With the path fixed instead, `osascript` could not address a non-bundle path and every timeout
  test failed as TRANSPORT. On macOS a path with no `.app` bundle (a wrapper script, a test stand-in) is now spawned
  directly — AppleScript can only address bundles — and the suite fails loudly if its stand-in is missing.

### Added

- **`error.details.errorNumber`** on a `JSX_THROW`: ExtendScript's `e.number` (2 "is undefined",
  8 "Syntax error", 21 "is not an object", 24 "is not a function", 25 "Expected", 45 "Object is
  invalid", 48 "File or folder does not exist", 55 "Object does not support the property or method") —
  classify a failure by it; After Effects' own messages are translated.

### Changed

- **The Claude Desktop extension name carries the version** («AE-MCP-IMT + SKILLS — After Effects for AI agents ·
  v0.5.8»): Claude Desktop does not show the manifest `version`, so an installed bundle could not be told apart
  from the previous one. `build-mcpb.mjs` appends it at pack time; `mcpb/manifest.json` keeps the bare name.
  Hosts that derive tool ids from the extension name (Claude Desktop) see new ids with each version.

## [0.5.8] - 2026-10-26

### Fixed

- **Every call died as «Syntax error (line 1–2)» while another CEP panel was open** (26.10, live session
  «Dream observation V3»). `com.fossa.tether` (panel «TETHER», `AutoVisible`) runs a `host.jsx` in the same
  ExtendScript engine that unconditionally replaces the global `JSON.parse` / `JSON.stringify` with its own;
  that parser does not decode string escapes, so a request's `\n` reached `new Function` as two characters
  and the agent's code collapsed onto one line. Proven in AE 26.5 with a probe: `JSON.parse('{"c":"a\\nb"}')`
  gave 4 characters (`a`, `\`, `n`, `b`); every `new Function`/`eval` variant compiled fine. Restarting AE did
  not help because the panel loads again.
  - `json2.jsx` now ALWAYS builds ae-mcp's own implementation as `$.global.AE_MCP_JSON`; the global `JSON` is
    installed only when there is none, as before — another extension's JSON is never touched.
  - The dispatcher reads the request and writes the response through `AE_MCP_JSON` only, and for the length
    of the call puts it into `$.global.JSON` (generated code and `eval.run` use `JSON.stringify`), restoring
    the panel's object in `finally`. A foreign JSON that fails the escape probe is named in the call's logs.
  - The quoted line of a one-line source with undecoded `\n` now carries the hint that a foreign
    `JSON.parse` is the cause.

### Changed

- The 0.5.7 notes called the 26.10 failure a stuck ExtendScript engine. It was the foreign `JSON.parse`
  above; `ENGINE_STUCK` stays for a real stuck engine (the canary `new Function("return 1")` throwing),
  which this case never was.

## [0.5.7] - 2026-10-26

### Added

- **`ENGINE_STUCK`** — a new error code for the state seen on AE 26.5 after a long session (26.10): every
  `new Function`, even `return 1`, throws «Syntax error» at line 1–2 while `$.evalFile` of the dispatcher still
  runs, so `ae_version_info`, `ae_project_info` and every `ae_do` died as `JSX_THROW` and agents kept retrying.
  The dispatcher now compiles a canary (`new Function("return 1")`) before the agent's code and answers with
  its own phase (`engine`); the server maps it to `ENGINE_STUCK` with the only cure spelled out — save, quit
  After Effects, open it again; do not retry until then.

### Fixed

- **The quoted line of an eval error** — for `new Function` code ExtendScript hands `e.source` as one line with
  the newlines written out as `\n`, so «(line 1 of your code: …)» quoted the whole source. Both formatters split
  on the literal `\n` too and quote the real line.

## [0.5.6] - 2026-10-22

Errors an agent can act on (live session «Dream observation», 22.10: three `eval.run` calls died with
«Invalid numeric result (divide by zero?) (line 5)» and `command.find` could not see a localized menu).

### Changed

- **eval errors quote the offending line of the agent's code** (`(line 2 of your code: "pos=" + L.transform.position.value)`)
  instead of the bare line number of the `new Function` wrapper; «Invalid numeric result» carries the hint
  that an array property value was concatenated into a string (ExtendScript throws there — use
  `value.join(',')` / `JSON.stringify`). `eval.run` says so in its description too.
- **`command.find` on a localized After Effects:** the label must be the one this AE shows («Сбор файлов…»);
  the ellipsis is tried as `...` and `…`; the failure text says why and points to `command.list`, whose ids
  are language-independent — `Collect Files...` (2482) added there.

### Verified

- **Windows 11 (ARM, Parallels) · Claude Desktop from the Microsoft Store (2.31226, arm64) · After
  Effects 2026 (26.5)** with the 0.5.5 `.mcpb`: the extension runs on Claude's built-in Node (no
  Node.js installed in the VM), `tools/list` returns the 12 tools, `tools/call` answers in 1–3 s and
  the dispatcher runs inside AE through `AfterFX.exe -r` (`%TEMP%\mcp-aftereffects\runtime\dispatcher_start.txt`
  shows `version:26.5x89`). The extension lives under
  `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\Claude Extensions\…` and logs to
  `%LOCALAPPDATA%\Claude\logs\mcp-server-<name>.log`.
- **macOS · Claude Desktop** with the 0.5.5 `.mcpb` (`ae_dialogs`, `project.list_checkpoints` called
  through the extension).

## [0.5.5] - 2026-10-11

Safety and verification for an agent that works on its own, plus the After Effects skill —
drawn from a survey of the AE-agent landscape (October 2026) and rewritten for this server.

### Added

- **Checkpoints:** `project.checkpoint {label}` saves the project and keeps a copy of the .aep
  next to it (`.ae-mcp-checkpoints/<project>/`, or `AE_MCP_CHECKPOINT_DIR`); `project.revert {id}`
  brings it back (the current state is kept as `…-before-revert` first); `project.list_checkpoints`.
  Undo covers a session — a checkpoint survives a crash, a relaunch and a `project.open`.
  Verified live on AE 26.5: checkpoint → edits → revert → `comp.diff` reports no change.
- **`batch.run { atomic: true }`** — all or nothing: the batch runs in its own undo group with a
  marker folder; on the first failure it is undone and the response says `rollback.verified`.
  Verified live: a null created by the first child vanished after the second child failed.
- **`comp.snapshot` / `comp.diff`** — a per-layer fingerprint (id, name, source, in/out/start,
  parent, enabled, 3D, key count, expressions, effects, transform values) with one hash. Take one
  before a mutation and pass it to `comp.diff` after: added / removed / changed layers with the
  changed fields, in tens of tokens instead of `ae_comp_info`.
- **`expression.validate`** — force-evaluates every enabled expression of a comp (or one layer) at
  a few times and lists the failing ones with their text. **`project.audit`** — missing footage,
  missing/substituted fonts, expression errors in every comp, unused footage, empty comps and
  folders, duplicate solids, each with a severity: the first call on a project you did not build.
- **`ae_dialogs`** tool and a **`DIALOG_OPEN`** error: a modal dialog is the usual reason a script
  never runs; a timeout now scans for one (Windows: PowerShell; macOS: CGWindowList + Accessibility)
  and reports its text, and `ae_dialogs { action: "dismiss", id }` closes it by its cancel action
  (a warning is acknowledged, a "save changes?" question cancelled — never answered for the user).
  Ported from upstream 0.3.1 (MIT).
- **Project lock** — `AE_MCP_PROJECT_LOCK=/path/to/project.aep`: writes are allowed only while
  that project is the open one; reads stay free, `project.open` may open the locked file itself,
  `project.new` and a Save As elsewhere are refused. For handing an agent one file in an AE that
  also holds your own work. Shown in the startup policy line.
- **`ae_render_frame { compareWith }`** — pixel metrics against an earlier frame (changed ratio,
  mean / max difference, bounding box of the change) — "did my edit change the picture, and
  where" without reading the image. Verified live: a 200×200 solid came back as a 200×200 bbox.
- `project.save_increment {comment}` (name_v001 → name_v002, never overwrites),
  `layer.stagger` (Quick Offset for a set of layers, seconds or frames, start or in-point),
  `layer.fit_to_comp` (fit / fill / width / height / stretch), `layer.align` (comp, action-safe,
  title-safe or first-layer reference, by rendered bounds), `comp.trim_to_content`.
- **The After Effects skill — `skills/ae/`** (replaces `skills/ae-motion`, which is now
  `skills/ae/recipes/motion-graphics.md`): a short router (`SKILL.md`: call budget, order of work,
  what a script cannot do in AE and the safe workaround), recipes (camera tracking, 3D content on
  tracked footage, plug-in tests, render, motion graphics, masks/roto, Mocha), plug-in knowledge
  files (`plugins/irrealix-gaussian-splatting.md` first) and scripts for the UI-only steps
  (hardware-level mouse events, windows, menus, dialogs, one-call waits, screenshots, frame strips,
  a slide measurement). Ships in the `.mcpb` and the npm package; `fetch-vendor.sh` pulls the MIT
  topic references the motion recipe routes to.
- `property.sample` — several properties of one layer at several times in one call (the
  motion-verification atom: a tracked camera's Position / Orientation / Zoom at start / middle / end,
  an effect parameter across a shot). Times default to `[0, duration/2, end]`.
- `layer.create_null` takes `threeD`, `position` and `anchorPoint`, so a 3D anchor at the scene
  origin is one operation (the "null at [0,0,0] on the ground plane" step of attaching a splat or a
  model to a tracked camera).

### Fixed

- ExtendScript misparses chained `?:` — `comp.diff` reported "3D" for "in"/"startTime" until the
  labels moved to a lookup table; the same pattern is avoided everywhere in the new operations.
- `property.get` no longer fails on properties whose value cannot be read: NO*VALUE status rows
  (the 3D Camera Tracker reports "Average error: 1.06 px" in a property \_name*), plug-in groups and
  the odd plug-in property that throws on read (irrealix: "division by zero"). The call returns
  `name` + `value: null` + `valueError` instead of a JSX_THROW. Seen live with AE 26.5 (Russian UI).
- `project.new` on an empty, untitled project: `app.newProject()` returns `null` there although the
  project is the new empty one — reported as success instead of "app.newProject returned null"
  (AE 26.5, live 09.10.2026).

## [0.4.4] - 2026-10-04

### Fixed

- Windows, Claude Desktop from the Microsoft Store: After Effects showed «Unable to execute script
  at line 2. File or folder does not exist» — the extension lives under an MSIX-virtualized
  `%APPDATA%\Claude\Claude Extensions\…` that exists for the server process but not for AE.
  The dispatcher and its `#include`d siblings are now copied under the temp folder next to
  `launch.jsx`, the one place both sides see. Verified on Windows 11 (ARM) with AE 2026.

## [0.4.3] - 2026-10-04

Windows verified: Windows 11 (ARM, Parallels) with After Effects 2026 (26.5) — `install.ps1`,
`tools/selftest.mjs`, `ae_version_info`, `ae_project_info`, `ae_do` (comp.create,
layer.create_footage, layer.create_text with Cyrillic), `ae_comp_info`, `ae_render_frame`.

### Fixed

- Windows: the server never reached After Effects when its own path contained a space —
  `AfterFX.exe -r <path>` cuts the path at the first space, quotes or not. That is every Claude
  Desktop install (`…\Claude Extensions\…`) and any clone under a folder with a space: the
  request timed out after 60 s with «never picked up by AE». The dispatcher is now started
  through a one-line `launch.jsx` under the runtime root (DOS 8.3 short name when even that
  path has a space), which also pins the mailbox like the macOS bootstrap.
- Windows: `install.ps1` did not parse in Windows PowerShell 5.1 (a non-ASCII dash in a string
  read through the ANSI code page). The script is ASCII-only now, guarded by a test.
- `npm version` failed on a `sync-server-version.mjs` / `server.json` pair that is not in the
  repository (upstream leftover); the version script only rewrites the CHANGELOG now.

### Notes

- On a machine without a supported GPU After Effects opens a «System Compatibility Report»
  before the project; scripting is blocked until it is dismissed (the server reports a timeout
  with that hint).

## [0.4.2] - 2026-10-01

### Fixed

- `…-chatgpt` run through `npx -p …` failed with «supergateway: command not found»: npm's
  `npm_config_*` variables leaked into the nested `npx -y supergateway`, which then searched only
  the parent's temporary tree. The gateway now strips them before spawning. Verified from a packed
  tarball through `npx -p`: public URL printed, tunnel and gateway stop on Ctrl+C.
- README: «Add to Cursor» button at a readable size.

## [0.4.1] - 2026-10-01

### Added

- **ChatGPT route in one command**: `npx -p @immersive-media-technologies/aftereffects-mcp-imt
aftereffects-mcp-imt-chatgpt` (`tools/chatgpt-gateway.mjs`, also `npm run chatgpt` from a
  checkout) starts the server behind supergateway (Streamable HTTP on `127.0.0.1:8001/mcp`) and a
  tunnel (`cloudflared`, no account, or `ngrok`), prints the public URL for ChatGPT → Settings →
  Connectors, and stops both on Ctrl+C. Verified end to end through a public ngrok URL:
  `ae_version_info` answered from After Effects 26.5.

### Changed

- README Install table: client icons, a smaller «Add to Cursor» button, a Google Antigravity row
  (`~/.gemini/config/mcp_config.json`); `install.sh` / `install.ps1` also write Antigravity's config.

## [0.4.0] - 2026-10-01

### Added

- **One-click installs.** Claude Desktop extension `aftereffects-mcp-imt.mcpb` (built by
  `npm run build:mcpb` from `mcpb/manifest.json`, attached to every release; Claude Desktop ships
  its own Node.js; the settings dialog carries read-only mode, `eval.run` and the AE path), an
  «Add to Cursor» install link, and the package on npm for every other client (`npx -y
@immersive-media-technologies/aftereffects-mcp-imt`).
- `install.sh` rewritten (English; was Russian with an internal path) and `install.ps1` for
  Windows: check After Effects and Node, build, run `tools/selftest.mjs` against the running AE,
  then write `mcpServers.aftereffects` into Claude Desktop's and Cursor's config files after asking
  (backup first); `--no-config`, `--yes`. The Windows script is not run by us yet.
- Boolean environment flags (`AE_MCP_READONLY`, `AE_MCP_ENABLE_EVAL`) accept `true` / `false` as
  well as `1` / `0` (`src/env-flag.ts`) — what MCPB user settings produce.

### Changed

- `engines.node` relaxed to `>=22` (nothing in the code needs 24; Claude Desktop's bundled Node is
  what the extension runs on); binary renamed `aftereffects-mcp-imt`; package published on npm.
- README: Install rewritten around the client routes (Claude Desktop, Cursor, ChatGPT through a
  gateway + tunnel, any MCP client).

## [0.3.5] - 2026-09-30

### Added

- **AE Motion skill** (`skills/ae-motion/SKILL.md`) — editable motion graphics built natively in After
  Effects through this server: reference + brief → element breakdown (native AE / generated source /
  background / external render as last resort) → build with `ae_do` / `batch.run` (folders, a `CONTROLS`
  rig with Speed / Delay / colour controls, text and shape layers, real easing via `keyframe.set_easing`,
  expressions driven by the controls, Essential Graphics and MOGRT) → verification with `ae_render_frame`.
  Backgrounds may be stills, video footage or generative; graphics are never baked into the plate
  (tracking and Object Matte handled by the user in AE). Covers After Effects 2026 features (variable
  font axes, SVG/AI import as editable shape layers, Advanced 3D, Object Matte, new expression methods).
- `skills/ae-motion/fetch-vendor.sh` — fetches the topic references the skill routes to, at pinned
  commits (download only, not redistributed): Engine-Room-Games/after-effects-mcp, fuuuuuuma/after-effects-agent,
  LobzyJay/motion-design-with-claude, iart-ai/motion-design-skills (MIT) and the `hyperframes-animation`
  skill of heygen-com/hyperframes (Apache-2.0). A table in the skill maps their tool names to this
  server's operations.
- README: «Motion-graphics skill» section, a comparison row and an example request.

## [0.3.0] - 2026-09-30 — Immersive Media Technologies fork

First public release of AE-MCP-IMT (the Immersive Media Technologies fork). License: IMT Non-Commercial (`LICENSE`);
upstream MIT notices in `THIRD-PARTY-NOTICES.md`.

### Added

- `ae_do` **dry run that really is one**: `dryRun: true` validates arguments and returns the
  generated ExtendScript without contacting After Effects (upstream accepted the flag only on
  `ae_project_import_json`; on `ae_do` the schema dropped it silently and the call ran for real).
- Effect presets `effect.apply_template` / `effect.list_templates` (nine named presets, ported from
  Dakkshin/after-effects-mcp) — **fixed on port**: `ADBE Directional Blur` / `ADBE Glow` do not exist
  in After Effects (verified against the live catalogue of 446 effects, AE 26.3) → `ADBE Motion Blur`
  / `ADBE Glo2`; effect properties addressed by index, so presets work on localized AE (ru_RU, ja_JP)
  where by-name lookup returned `null` and the original applied factory values while reporting
  success; misses are returned in `warnings`.
- `render.add_to_queue` / `render.set_om_settings` create the output folder (AE fails with
  "Directory does not exist" otherwise); hint about `render.set_om_settings` in the description.
- `install.sh`: environment check (macOS, After Effects, Node ≥ 24 at an absolute path), build, a
  **live self-test against After Effects** (`tools/selftest.mjs`) and the printed client config;
  every failure is named (Automation −1743, scripting write access, Node path).
- `docs/AGENT-POLICY.md` — the permission model for autonomous agents: deny what Cmd+Z cannot
  revert; gate by operation name, including nested `batch.run` ops.

### Changed

- Package identity → `@immersive-media-technologies/aftereffects-mcp-imt` (repo-only, not on npm); MCP registry
  manifest and the npm release workflow removed.

### Notes

- Upstream `npm test` is not safe on macOS with After Effects open (four transport tests reach the
  live application); run with AE closed or on CI.

## [0.2.0] - 2026-08-12

### Added

- **61 new operations closing the gap to the AE 2024–2026 scripting surface** (137 → 198, now 23 categories), verified end-to-end against a live After Effects 26.3:
  - **Text**: box and vertical text creation (`layer.create_text` with `boxSize`/`orientation`, AE 24.2), per-range styling (`text.set_style_range` over characters/paragraphs/composed lines, 24.3), layout measurement (`text.measure`: composed lines, paragraph spans, `baselineLocs`, box overflow), the 24.6 box controls on `text.set_box` (auto-fit policy, vertical alignment, first-baseline alignment, inset spacing), and the full 24.0 attribute surface on `text.set_style` (kerning, ligatures, RTL direction, tate-chu-yoko, paragraph indents/spacing, digit sets, composer engine, and more).
  - **Variable fonts**: `text.set_variable_font` (design-axis values by tag), `text.add_font_axis` (keyframeable axis on a text animator, 26.0), `font.info` (full FontObject incl. design axes), `font.check_glyphs` (glyph coverage, 25.1), `font.list_used` (`Project.usedFonts`, 24.5).
  - **Render queue**: raw settings access (`render.get_settings` / `render.set_settings` / `render.set_om_settings`, AE 13+), single-item `render.remove_item` and `render.duplicate_item`, and the render flag, `skipFrames`, `logType`, `postRenderAction`, `includeSourceXMP`, `queueItemNotify` on `render.set_output`.
  - **3D**: `comp.set_renderer` / `comp.list_renderers` with scheme-proof friendly names (`classic3d`/`advanced3d`/`cinema4d`), environment lights (24.3), `layer.create_parametric_mesh` (26.3), and `ThreeDModelLayer`/`ParametricMeshLayer` recognition in `project.find_layers` and layer summaries.
  - **Footage**: `footage.reload`, `footage.list_missing`, `footage.replace_with_solid` / `replace_with_placeholder`, solid/placeholder proxies, pulldown (`guessPulldown`/`removePulldown`), `item.usages` (reverse lookup), `project.import_placeholder`, and sequence frame ranges on `project.import_file`.
  - **Keyframes**: `keyframe.set_interpolation` (asymmetric in/out linear|bezier|hold plus the temporal continuity/auto-bezier flags) and `keyframe.set_label` (22.6).
  - **Effects and properties**: `effect.move` and `property.move` (stack/group reordering), `effect.set_dropdown_items` / `get_dropdown_items` (Dropdown Menu Control, the MOGRT-dropdown API, 17.0.1/26.0).
  - **Misc**: `project.new`, `project.parse_swatch` (.ase palettes), `project.get_xmp` / `set_xmp`, `egp.add_layer` (media replacement, 18.0), `layer.scene_edit_detection` (22.3), `layer.set_parent` with `jump`, Layer-panel ruler guides, `shape.add_wiggle_transform`, marker cue-point fields, and viewer fast-preview/channel controls.
  - **Preferences and app config** (new `pref` category): `pref.get` / `set` / `delete` (typed access to AE's preferences files incl. the PREFType selector), `pref.get_setting` / `set_setting` (script-scoped settings), `project.set_memory_limits`, `project.set_multi_frame_rendering` (22.0), `project.set_default_import_folder`, `project.get_tool` / `set_tool` (active Tools-panel tool), and the remaining project settings (`linearizeWorkingSpace`, `compensateForSceneReferredProfiles`, `displayStartFrame`, `feetFramesFilmType`, `footageTimecodeDisplayStartType`).
  - **Font management**: `font.list_duplicates` (24.6), `font.get_lists` / `set_favorites` (Favorites/MRU, 24.6), `font.set_substitution` (auto-replacement policy + Adobe Fonts sync freeze, 24.6), `font.get/set_default_for_script` (per-writing-script defaults, 25.1).
  - **More text/layer/render**: `text.paste_range` (copy text+styling between ranges, 25.1), `text.reset_style`, `keyframe.set_selected` / `property.select` (timeline selection staging), `render.save_template` (render/output-module templates), queue-wide `queueNotify` on `render.set_output`, `layer.calculate_transform` (corner-pin placement in 3D), `egp.open_in_panel`.
- **Explicit-consent gate for app-configuration operations.** The eleven operations that change After Effects itself rather than the project (`pref.set/delete/set_setting`, `project.set_memory_limits` / `set_multi_frame_rendering` / `set_default_import_folder` / `set_tool`, `font.set_substitution` / `set_favorites` / `set_default_for_script`, `render.save_template`) now require `confirm: true` — to be passed only when the user explicitly requested the change. `ae_do` and `batch.run` both enforce it, and `ae_catalog` marks the operations `appConfig: true`.
- **Enum names in `layer.set_props`**: `quality`, `samplingQuality`, `frameBlendingType`, `autoOrient`, `blendingMode`, and `lightType` accept string names — enum-valued attributes were previously unreachable through the generic passthrough.
- **`mask.set_props`** gains `inverted`, `locked`, `color`, `rotoBezier`, `motionBlur`, `featherFalloff`; **`mask.set_path`** accepts the variable-width feather arrays.
- **Dialog suppression in the dispatcher**: modal alerts raised while a request runs (missing fonts/footage on `project.open`, effect warnings) no longer wedge every later call.

### Fixed

- **`layer.set_blend_mode` silently failed for `silhouetteAlpha`** — the After Effects API spells that one member `SILHOUETE_ALPHA` (while luma is `SILHOUETTE_LUMA`); both spellings are now probed.
- **`layer.set_track_matte` demanded the matte sit directly above the target** — the AE 23.0 API it already used takes any layer; the matte can now also be addressed by name.
- **Project-boundary calls corrupted the undo stack.** `project.open` / `project.new` (and dialog suppression around undo/redo) ran inside the dispatcher's undo group; crossing a project boundary orphans the open group, After Effects 26 raises an async "UndoGroup Mismatch" dialog, and undo stays broken for the session. Both ops now run outside the group, the same exemption as undo/redo.
- `project.find_layers` reported `ThreeDModelLayer` / `ParametricMeshLayer` layers as plain `AVLayer`/`Layer`.
- Generic objects (swatch data, font usage records, design axes) serialized as `null` in results.

## [0.1.3] - 2026-08-11

### Fixed

- **`project.undo` reverted nothing.** Like every other call it was wrapped in an undo group, and After Effects resolves Undo against the group that is still open — so the previous call survived and the undo stack was left out of step with the project. Undo and redo (`project.undo`, `command.execute` with id 16 or 2035) now run outside the group. As a consequence they can no longer be children of a `batch.run`, which is itself one undo group: issue them as their own `ae_do` call.

## [0.1.2] - 2026-08-10

### Fixed

- **The GitHub Packages mirror never published anything.** Its "already published?" guard queried npmjs instead of GitHub Packages, so every release decided the version was already mirrored and skipped it. Installing from npmjs — the supported route — was never affected; GitHub Packages starts carrying the package at this version.

## [0.1.1] - 2026-08-10

### Fixed

- **Every call timed out on After Effects builds without a native `JSON` (seen on macOS).** Responses could not be serialized, so no call ever completed.
- **A failing dispatcher could raise a modal error dialog in After Effects,** which blocked every subsequent call until someone clicked OK.
- **`layer.move` never worked** — it failed for every layer. Reordering now works in both directions, and an out-of-range `toIndex` returns a clear error.
- Caught errors are now reported as readable messages instead of failing the call.
- A response that cannot be serialized returns an error immediately instead of costing the full 60 s timeout.

## [0.1.0] - 2026-08-09

Initial public release of `@kumoproductions/mcp-aftereffects`.

### Added

- **136 atomic operations across 21 categories** — keyframes, properties and expressions, layers, shapes, text, masks, footage, project items, markers, guides, comps, render queue, fonts, Essential Graphics / MOGRT, and the viewer.
- **Stable layer references.** Layer arguments accept `{ id: n }` alongside index and name, so references survive reordering and renaming.
- **Color-managed capture.** `ae_render_frame` matches the After Effects viewer in color-managed projects and writes sRGB-tagged PNGs.
- **Batched reads.** `ae_comp_info` accepts several comps, `ae_layer_info` accepts several layers or `"all"`, and both can run inside `batch.run` to verify a mutation in the same call.
- **macOS support.**
- **Argument validation** against the schema `ae_catalog` publishes, before After Effects is contacted.
- **Read-only mode** (`AE_MCP_READONLY=1`) and a category allowlist (`AE_MCP_ALLOW_CATEGORIES`).
- **Unified error envelope**: every failure returns `{ ok: false, error: { code, message, retryable } }`.
- `AE_MCP_RUNTIME_DIR` to relocate the IPC mailbox, and a `timeoutMs` parameter on `ae_do`.

### Changed

- **Arbitrary ExtendScript is opt-in** — `eval.run` requires `AE_MCP_ENABLE_EVAL=1`.
- **Concurrent calls are serialized across server processes,** so they no longer trigger After Effects' "second script" warning.
- Each call uses its own mailbox files under the OS temp dir, so multiple clients coexist and a read-only install works.
- Environment variables use the `AE_MCP_*` prefix (the legacy `AE_EXE` is still honored).

### Fixed

- Failed operations are reported as errors instead of success.
- A timed-out request can no longer execute later.
- A missing or blocked `AfterFX.exe` fails immediately instead of after 60 s.
- Omitting an optional argument no longer breaks code generation.
- Operation fixes: `layer.split`, `keyframe.set_easing`, `expression.restore_all`, `layer.create_light`, `project.undo`, `project.replace_font`, render queue indexing, and comp glob matching.

### Security

- Tool arguments can no longer be interpolated as executable code into the generated ExtendScript.
- `JSON.parse` on the ExtendScript side validates input before evaluating it.
- The IPC mailbox is created `0700`, the server warns when it is group- or world-writable, and no output path may target it.

### Known limitations

- Importing a project whose footage is missing can misattribute layer parenting.

[0.5.8]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.5.8
[0.5.7]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.5.7
[0.5.5]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.5.5
[0.4.4]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.4
[0.4.3]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.3
[0.4.2]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.2
[0.4.1]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.1
[0.4.0]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.4.0
[0.3.5]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.3.5
[0.3.0]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/releases/tag/v0.3.0
[0.2.0]: https://github.com/kumoproductions/mcp-aftereffects/releases/tag/v0.2.0
[0.1.3]: https://github.com/kumoproductions/mcp-aftereffects/releases/tag/v0.1.3
[0.1.2]: https://github.com/kumoproductions/mcp-aftereffects/releases/tag/v0.1.2
[0.1.1]: https://github.com/kumoproductions/mcp-aftereffects/releases/tag/v0.1.1
[0.1.0]: https://github.com/kumoproductions/mcp-aftereffects/releases/tag/v0.1.0
