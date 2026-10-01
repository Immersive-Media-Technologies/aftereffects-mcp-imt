---
name: ae-motion
description: Native, editable motion graphics built inside After Effects through the AE-MCP-IMT server (ae_catalog / ae_do) — from a reference image and a motion brief to an AE project whose titles, colours, timing and elements the user edits in AE (layers, shape layers, text animators, keyframes with real easing, expressions, a controls rig, Essential Graphics / MOGRT). Use when the user asks for motion graphics, titles, lower thirds, kinetic type, logo stings, infographics, transitions or overlays in AE.
---

# AE Motion — editable motion graphics in After Effects

The deliverable is **an After Effects composition the user can edit**, not a rendered clip: native text
layers, shape layers, masks, keyframes, expressions and a controls rig. Rendered pixels (generated
images, footage, a HyperFrames render) are _source material_ placed under or between native layers —
never a substitute for something AE can build natively. If the user wants a finished clip without AE
editability, an HTML/video renderer is the better tool, not this skill.

Paths below are relative to this file's folder.

## 1. Brief → breakdown (before touching AE)

1. Read the reference (attached image / frames / existing comp via `ae_render_frame`) and the brief.
   Write down: canvas (size, fps, duration — the user's or the active comp's), layout grid and
   safe areas, palette (hex), type (family / weight / size — check with `font.list` / `font.check_glyphs`
   that the font exists; propose the closest installed one otherwise), hierarchy, and for every element
   _what moves, when, how_ (entrance, hold, exit; easing character; overlap / stagger).
2. **Classify every element** and show the table to the user before building (one table, short):

   | element                                                    | how it is built                                                                                                                                        | motion | editable via                     |
   | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------- |
   | title / subtitle / labels / numbers                        | native **text layer** (+ text animator / per-letter layers if letters must move separately)                                                            | …      | text, Controls                   |
   | bars, plates, lines, frames, arrows, icons, charts, masks  | native **shape layer** (rect / ellipse / path, trim paths, repeater, offset, rounded corners) or **mask**                                              | …      | Controls / shape props           |
   | logo, vector art                                           | user's AI/SVG → **AE 26 SVG/AI import as composition** (separate editable shape layers)                                                                | …      | shape layers                     |
   | illustration, photo object, complex texture AE cannot draw | **generated source**: a separate transparent PNG per element (any image model, background removed) animated as a layer (transform, puppet pins, masks) | …      | layer transform, replace footage |
   | background                                                 | see §2                                                                                                                                                 | …      | replace footage                  |
   | complex generative effect (particles, 3D field)            | AE native first (Fractal Noise, CC Particle World, Advanced 3D, parametric meshes); an external render only as a last resort, as a footage layer       | …      | —                                |

3. Agree on the table (one message). Then build without further questions unless something blocks.

## 2. Backgrounds are not always static

The plate under the graphics can be: a still (generated clean plate — the reference without its text
and graphics — or the user's image), **video footage** (shot, stock, AI-generated video), or a
**generative/animated background** (AE: Fractal Noise / Gradient Ramp / Turbulent Displace driven by
expressions; or a rendered loop). Rules:

- Import footage with `project.import_file` into a folder `BG`; never bake graphics into the plate.
- Graphics that must **stick to moving footage**: ask the user to run _Track Camera_ / _Track Motion_ in
  AE (the analysis is interactive), then parent the graphics' null to the solved null / camera.
- Graphics that must go **behind a subject** in footage: the user runs _Object Matte_ (AE 26, click the
  subject) or Roto Brush; you then use the matte layer as a track matte (`layer.set_track_matte`).
- Long or heavy plates: keep graphics in their own precomp so the plate can be swapped.

## 3. Build — through ae-mcp (`ae_do` / `batch.run`)

Work in this order; each step is one `batch.run` where possible (one undo group):

1. **Structure**: `folder.create` (`DL_<name>`: `Comps`, `BG`, `Elements`), `comp.create` (size/fps/
   duration), shot precomps for complex elements (`comp.precompose`). Name everything meaningfully.
2. **Controls rig**: one null layer `CONTROLS` at the top (`layer.create_null`) with expression controls
   (`effect.add`: `ADBE Slider Control`, `ADBE Color Control`, `ADBE Checkbox Control`, `ADBE Point Control`)
   — at least _Speed_ (1 = as designed), _Delay_, the palette colours, and switches. Expressions on the
   elements read them (`thisComp.layer("CONTROLS").effect("Accent")("Color")`). Speed: drive timing with
   `valueAtTime` / time remapping on precomps rather than re-keying.
3. **Elements**: `layer.create_text` + `text.set_style` (+ `text.add_animator`, `text.add_font_axis`
   for variable fonts — AE 26.2), `layer.create_shape` + `shape.add_*`, `mask.add`, imported footage via
   `layer.create_footage`. Parent with `layer.set_parent` **at rest, before keying**.
4. **Motion**: `keyframe.add` / `keyframe.set_batch` then **real easing** — `keyframe.set_easing`
   (influence/speed per side) and `keyframe.set_interpolation` (hold for held poses; linear for pass-through
   waypoints). Never leave default linear keys on UI/type motion. Procedural motion (wiggle, loops,
   overshoot, counters, stagger) → `expression.set`, linked to CONTROLS.
5. **Essential Graphics**: expose what the user will change — texts, colours, Speed — with
   `egp.add_property` / `egp.set_name`; `egp.export_mogrt` only if asked (for Premiere).
6. **Save**: `ae_save_project` (a new version name before restructuring an existing project).

`eval.run` (raw ExtendScript) only when no operation covers it — read
`vendor/ae2026/after-effects/references/extendscript-gotchas.md` before writing one (ES3, ease array
sizes per property, text document quirks).

## 4. Verify, then report

- Read back what matters (`ae_layer_info`, `ae_comp_info`) — property values are the truth.
- `ae_render_frame` at entrance / mid / hold / exit (a handful, not a scrub) into a scratch folder;
  look at them and fix spacing, overlaps, readability, safe areas, easing that reads mechanical.
- Reply briefly: comp name, what is native vs source material, the CONTROLS (what each slider does),
  the Essential Graphics properties, and the check frames by name.

## 5. Edits later

The user edits in AE (texts, sliders, replacing footage) or asks in chat — then change the same
controls/properties rather than rebuilding. Read the current state first: the user may have edited by hand.

## Knowledge — read on demand (paths relative to this folder)

| topic                                                                                                         | read                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keyframes, easing, rigging rules (parent at rest, hold keys, waypoints), expressions                          | `vendor/ae2026/after-effects/references/animation.md`                                                                                                                 |
| shape layers (Contents tree, trim paths, repeaters)                                                           | `vendor/ae2026/after-effects/references/shapes.md`, `vendor/motion-design/aftereffects-motion/references/shape-layers.md`                                             |
| text layers, animators, per-letter editable typography                                                        | `vendor/ae2026/after-effects/references/text.md`, `vendor/motion-design/aftereffects-motion/references/text-animators.md`, `vendor/ae-agent/references/typography.md` |
| assembling shots, markers, retiming                                                                           | `vendor/ae2026/after-effects/references/assembly.md`                                                                                                                  |
| MOGRT, importing footage                                                                                      | `vendor/ae2026/after-effects/references/mogrt-and-footage.md`, `vendor/ae-agent/references/delivery.md`                                                               |
| compositing recipes (glows, textured titles, light sweeps)                                                    | `vendor/ae-agent/references/recipes.md`, `vendor/motion-design/aftereffects-motion/references/effects-catalog.md`                                                     |
| expression library (overshoot, loopOut, valueAtTime stagger, wiggle)                                          | `vendor/motion-design/aftereffects-motion/references/expressions.md`, `vendor/motion-fundamentals/after-effects/references/expression-library.md`                     |
| AE 2026 changes (variable fonts, SVG import, 3D, expressions)                                                 | `vendor/ae2026/after-effects/references/whats-new.md`                                                                                                                 |
| ExtendScript pitfalls                                                                                         | `vendor/ae2026/after-effects/references/extendscript-gotchas.md`, `vendor/motion-design/aftereffects-motion/references/limits-and-pitfalls.md`                        |
| motion principles, timing & spacing, easing taxonomy, defaults to avoid                                       | `vendor/motion-design/motion-design/references/*.md`, `vendor/motion-fundamentals/animation-principles/`                                                              |
| colour in motion, shot composition, logo reveals, motion backgrounds, art direction                           | `vendor/motion-fundamentals/{color-motion,shot-composition,logo-animation,motion-background,motion-art-direction}/SKILL.md`                                           |
| choreography rules, text-effect catalogue (engine-agnostic ideas; translate GSAP eases to AE influence/speed) | `vendor/hyperframes-animation/SKILL.md`                                                                                                                               |
| critique your result                                                                                          | `vendor/motion-design/motion-design-critique/SKILL.md`                                                                                                                |

`vendor/` is not in the repository: run `./fetch-vendor.sh` once (downloads the pinned skill repositories
from GitHub; nothing is uploaded). Without it the skill still works — only the deep references are missing.

The vendor skills were written for **other** AE bridges: their tool names (`add_keyframe`,
`set_temporal_ease`, `run_jsx`, `screenshot_frame`, `get_layer_full`, …) do **not** exist here. Map them:

| their tool                                            | ours                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| add_keyframe / set_temporal_ease / set_interpolation  | `ae_do keyframe.add` / `keyframe.set_easing` / `keyframe.set_interpolation`                       |
| set_expression / clear_expression                     | `ae_do expression.set` / `expression.remove`                                                      |
| create_text / create_shape / create_null / add_effect | `layer.create_text` / `layer.create_shape` (+ `shape.add_*`) / `layer.create_null` / `effect.add` |
| parent_layer                                          | `layer.set_parent`                                                                                |
| get_layer_full / list_layers                          | `ae_layer_info` / `ae_comp_info`                                                                  |
| screenshot_frame / screenshot_layer                   | `ae_render_frame` (one frame per call; a few key times)                                           |
| run_jsx / run_batch                                   | `eval.run` / `batch.run`                                                                          |
| get_house_style                                       | none — ask the user for brand colours/fonts once, or take them from the reference                 |

Their setup, licensing, Higgsfield/ChatGPT bridges, computer-use instructions and file-menu script runs
do not apply. Third-party skills — Engine-Room-Games/after-effects-mcp, fuuuuuuma/after-effects-agent,
LobzyJay/motion-design-with-claude, iart-ai/motion-design-skills (MIT) and heygen-com/hyperframes
`hyperframes-animation` (Apache-2.0) — are fetched, not redistributed; see `vendor/*/LICENSE`, `vendor/*/.source`.
