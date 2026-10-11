# Testing a third-party After Effects plugin (testing a plug-in through the server)

Inputs: an installed plugin (the user installs — `/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/`
needs admin; `sudo` is not available to the model), test materials, a question to answer (works on this
Mac? does what the page says? how fast? better than X?). Output: facts in `plugins/<slug>.md`, frames and renders, verdict. Budget: ≤ 25 calls for a first pass.

## 0. Before installing (file inspection — no AE)

Shell: architectures (`lipo -archs`), code signature (`codesign -dv`, TeamIdentifier,
notarization `spctl -a -vv`), min macOS (`otool -l … LC_BUILD_VERSION`), installer scripts
(`pkgutil --expand`: `postinstall` opening sites = repack), strings (`strings | grep -i http`).
Compare with the official download when there is one (hashes). A modified main binary = do not install.
Install order matters when two plugins register the same importer (`.ply`): one at a time.

## 1. After install

1. AE must be **restarted** to load a plugin. `project.checkpoint` → quit → `open -a "Adobe After Effects 2026" <aep>`.
   A repacked binary crashed AE 26.5 at first launch (11.10) — that is a verdict by itself.
2. Confirm it loaded: `project.list_effects` (or `eval.run` over `app.effects`) → the effect's
   **matchName** and display name; count of effects before/after.

## 2. Apply and dump (one call each)

```
batch.run:
  layer.create_solid   {comp, name:"FX_<plugin>", color:[0,0,0], width, height, duration}
  effect.add           {comp, layer:"FX_<plugin>", matchName:"<effect matchName>"}
  effect.list_on_layer {comp, layer:"FX_<plugin>"}
```

Big plugins have hundreds of parameters (irrealix: 1 570). Dump the tree once with `eval.run` (name ·
matchName · propertyValueType · value; wrap `.value` in try/catch — NO_VALUE groups and some plugin
properties throw, e.g. "деление на ноль") into a file next to the project, grep it, and write only the
parameters that matter into `plugins/<slug>.md`. Address them by **matchName** from then on.

## 3. Feed the input

- Model/file-based plugins take a **layer** as input (LAYER_INDEX type 6421): import the file
  (`project.import_file`), add it as a hidden layer at the bottom (`layer.create_footage`, `layer.set_enabled false`),
  `effect.set_property` with the layer **index**. Importers register as footage (irrealix PLY: item 128×128,
  duration 0, `hasVideo` true, import 3 ms).
- Camera-aware plugins pick up the comp's active camera by themselves — verify with a tracked camera
  (`camera-track.md`) by rendering first/last frames.

## 4. Render and measure

- One frame: `ae_render_frame` (PNG); `compareWith` an earlier frame to see _whether and where_ a
  parameter changed the picture before reading it. **Timing**: `saveFrameToPng` is asynchronous — the ms it reports
  mean nothing; time a **segment render** instead (`render.md`): e.g. irrealix 73.7 k splats over 720p,
  104 frames ≈ 7.6 s on M1 Max.
- Picture checks: 3-frame strip; contact sheet of the render; `measure-slide.py` for anything that must
  stick to the plate.
- Trial watermarks (irrealix: thin red lines) pollute diff masks — `--mask-red`.

## 5. Verdict and memory

Write `plugins/<slug>.md` (template `plugins/README.md`): install facts, matchNames, what is UI-only, timing, verdict, open issues.
Compare plugins **on the same comp, same camera, same material** — swap only the plugin.
