# irrealix Gaussian Splatting 1.7.1 for After Effects

**Vendor:** irrealix (Dmitriy Liakshev), $49 on aescripts (trial with watermark); docs
irrealix.com/docs/gaussian-splatting. **Status:** tested 11.10.2026, AE 2026 (26.5), M1 Max, macOS 26.6.2,
**Russian UI**, trial. Verdict so far: loads, renders through the comp camera, Metal; **slide on tracked
footage (66 px) — cause not yet isolated** (see Open issues).

## Install

- Two bundles → `/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/`:
  `GaussianSplatting.plugin` (effect) + `PlyImporter.plugin` (importer). Admin rights (user runs `sudo cp`).
  Universal x86_64+arm64, Developer ID `LR6MWDV7BQ`, notarized, min macOS 10.15; links Metal.
- **Repack from cgzy.net** («Gaussian Splatting 1.7.1 for AE.pkg»): main binary modified (ad-hoc
  re-sign, cgzy strings), postinstall opens the site; **crashed AE 26.5 at first launch**. Do not install.
  Currently installed bundles are the official ones (checked 11.10: TeamIdentifier LR6MWDV7BQ, no cgzy strings).
- Restart AE after install. KIRI's plugin ships its own `.ply` importer — install one at a time
  (irrealix first), or the importer registration conflicts.
- Trial: red cross / thin red lines over the frame — mask them in diffs (`measure-slide.py --mask-red`).

## Effect

- matchName **`irrealix Gaussian Splatting`**, display «Gaussian Splatting [irrealix]». Apply on a
  **solid** the size of the comp (`layer.create_solid` + `effect.add`). 1 570 properties: 10 model slots
  (`Model 1…10`), Global Transform, Render Settings, Utilities.
- Up to 10 `.ply` models; `.ply` **sequences** (4DGS) via `1 Animate` / `1 Frame Index`.

## Parameters that matter (Model 1; Model N = same names prefixed `N`, different matchName numbers)

| matchName              | name                              | type               | meaning / quirk                                                                                           |
| ---------------------- | --------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| `-0002`                | 1 Show Model                      | checkbox           |                                                                                                           |
| `-0003`                | 1 Model                           | LAYER_INDEX (6421) | **the model is a layer** (imported .ply) — set the layer index                                            |
| `-0031`                | 1 Transform Scale                 | 1-D                | model scale %, 100 → 28 made the bread ≈ ⅔ of a rook on the chess clip                                    |
| `-0551`                | 1 Transform Uniform Scale         | checkbox           | 1 = `-0031` drives all axes                                                                               |
| `-0032/33/34`          | 1 Transform X/Y/Z Scale           |                    | per-axis when uniform off                                                                                 |
| `-0038`                | 1 Transform Position              | 3-D (6413)         | comp 3D units; default `[640,360,0]` (comp centre)                                                        |
| `-0035/36/37`          | 1 Transform X/Y/Z Rotation        | 1-D                | degrees                                                                                                   |
| `-0688`                | Null Object (group)               | NO_VALUE           | the «link to null» UI — **not scriptable** (group, no value); use expressions on `-0038/35/36/37` instead |
| `-0631`                | 1 Align Anchor Point              | 3-D                | model pivot                                                                                               |
| `-0009`, `-0006/07/08` | 1 Align Scale / X,Y,Z Rotation    |                    | pre-alignment of the model itself                                                                         |
| `-0016…-0023`          | 1 Crop Shape …                    |                    | sphere/box crop; `-0025/26/27` Crop Y Plane (altitude) — remove floor/background splats                   |
| `-1616…-1621`          | 1 Color Grading                   |                    | brightness/contrast/temperature/hue/saturation/vibrance per model                                         |
| `-2430`                | 1 Splat Scale                     |                    | splat size (sharpness vs holes)                                                                           |
| `-2289…-2303`          | Global Transform                  |                    | anchor `-2305`, translation `-2290`, scale `-2295`, rotations `-2301/02/03` — moves all models together   |
| `-2360`                | Enable HDR                        |                    |                                                                                                           |
| `-2350`                | Draw Quality                      |                    | default 2                                                                                                 |
| `-2208`                | Max Spherical Harmonics           |                    | default 3                                                                                                 |
| `-2204/-2205`          | Clip Plane Near/Far               |                    | 100 / 1 000 000                                                                                           |
| `-0865/66/67`          | Draw Z Depth Enabled / Near / Far |                    | depth output for compositing                                                                              |
| `-2471…-2475`          | Generate 3D Null Object …         |                    | «Utilities»: picks a 2D point → 3D null on the splat surface — **button-driven, UI-only**                 |
| `-2286`                | Show Gizmos                       |                    |                                                                                                           |

## Input

`project.import_file` the `.ply` (importer accepts `canImportAs FOOTAGE`; item 128×128, duration 0,
`hasVideo` true, 18 MB / 73 672 gaussians imported in 3 ms) → `layer.create_footage` at the bottom,
`layer.set_enabled false` → `effect.set_property {property:["irrealix Gaussian Splatting-0003"], value:<layer index>}`.
Only real 3DGS `.ply` (standard attributes) — meshes / point clouds in a .ply container are not supported.

## Camera / 3D

Picks up the comp's active camera by itself — with a `3D Tracker Camera` the splat follows the solve
without any linking (verified: first frame huge near the lens, last frame small among the pieces).
Model position is in comp 3D units; after «Set Ground Plane and Origin» `[0,0,0]` is on the surface.
The solid itself stays 2D (`threeDLayer` false) — the effect renders 3D inside it.

## UI-only

- «Null Object» link button and «Generate 3D Null Object» — replaced by expressions
  (`attach-3d.md` §2): position ← null position, rotations ← null rotation + orientation; all four
  `expressionError` none.
- Register / trial dialog — user.

## Scripting quirks

- Reading `.value` of some properties throws («недопустимый числовой результат (деление на ноль?)» on
  `1 Noise Shape Center -0100`; NO_VALUE groups `-0030`, `-0688`, `-0103/04`) — wrap reads in try/catch;
  `property.get` on `-0038` failed once right after the ground-plane change — write without reading.
- `saveFrameToPng` returned in 16 ms — asynchronous, not a timing.
- Names are English even on the Russian UI (plugin strings), matchNames are stable — use matchNames.

## Performance

Segment render 5–9.3 s (104 frames, 1280×720, 73.7 k splats, scale 28 %, tracked camera): **≈ 7.6 s**
on M1 Max (H.264 default output module).

## Open issues

1. **Slide:** bread on `GS_Origin` at `[0,0,0]` drifted 66 px over the last 1.2 s against the board
   (measured, `slide-check/slide.json`). Not yet known whether the tracker camera/plane or the plugin's
   camera coupling (FOV/zoom) is wrong. **Next test:** a native 3D solid at the same point, same
   measurement (`attach-3d.md` §4). Then: plane from points nearer the object; model in the board centre.
2. Alpha/edge quality («облачка») on the first frame looked clean — not checked across the shot.
3. Comparison with KIRI Engine AE 1.2.0 (arm64-only, ad-hoc signed, min macOS 15.7) — not run yet;
   same comp (`GS_test.aep`, `GS_test_chess`), swap the effect, repeat §4 of `attach-3d.md`.

## Sources

irrealix docs (first steps, 4DGS, export-ply); aescripts page; test notes of 11.10.2026 (AE 26.5, M1 Max).
