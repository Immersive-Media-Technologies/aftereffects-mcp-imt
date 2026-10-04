# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
