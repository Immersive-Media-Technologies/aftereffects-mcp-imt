# Layer conform in After Effects: sync a generated layer with the plate (time → geometry → colour → matte)

Read when two layers of one comp show the same scene and must coincide on the people before
compositing: «синхронизировать слои», «подогнать генерацию под плейт», «замена фона», «свести цвет
слоёв». Typical: a plate layer (people to keep) and an AI generation of the same shot whose action runs
~8–9 % faster with a frozen tail, sits 0.5–1.5 % larger with a shift of a few px, and is a few levels
lighter/redder. The model and the hard rules are those of the Premiere reference (Premiere-MCP-IMT
`pr_skill {doc:"layer-conform"}`): time before pixels; phase vs width; one constant per piece; measure
every clip again, never apply remembered numbers; the colour match goes on the lower layer, the matte
on the upper one; the geometry reference is the user's call.

The numerics are `scripts/conform.py` (Python 3 + numpy + opencv-python-headless; FFmpeg for
`frames`/`render`). It reads PNG frames and writes JSON plans; everything in AE goes through `ae_do`.

## 0. State and safety

`ae_project_info` → `ae_comp_info` (size, fps, layers with in/out, stretch, time remap) →
`ae_layer_info` of both layers (Transform values: Anchor Point, Position, Scale, Rotation; effects).
`project.checkpoint {label}` before the first change. Working folder: `<folder of the .aep>/renders/conform/<shot>/`.

## 1. Frames of each layer alone

Solo the layer (`layer.set_props {layer, props:{solo:true}}`), render the work area as a PNG sequence
(`render.add_to_queue` with a PNG output module and `render.set_output`, or `render.frame` per frame for
short pieces), then `solo:false`. Both exports cover the same frames in comp coordinates (frame i = work
area start + i/fps). Raw footage frames instead: `conform.py frames --video` and the layer's Transform as
`--mov-place "scale=<Scale %>;pos=<Position/comp size>;rot=<Rotation>"` with `--seq-size W,H`.

## 2. Time

1. `conform.py coarse-fit --ref REF/ --mov MOV/ --out S/ --frames 0,2,4,6` (the start of the shot, lag still 0).
2. `conform.py time-match --ref REF/ --mov MOV/ --out S/ --geom S/coarse.json --lag-min -3 --lag-max 10`
   → `S/time.json` (`lag`, `runs`, `points`, `segments`, `frozen_tail_*`, `hold`, `warnings`).
   A warning «moving layer has N frames … forced» = the moving export is too short: render `max lag`
   more frames and match again.
3. `conform.py time-plan --time S/time.json --fps <comp fps> --clip-start <moving layer inPoint s> --clip-in <moving layer source start s> --out S/plan.json`
   → `ae_time_remap_keys` = `{time, value}` pairs, comp time → source time.
4. Apply on the moving layer: `layer.set_props {layer, props:{timeRemapEnabled:true}}` → remove the
   two default keys and author the plan in one call:
   `keyframe.set_batch {comp, layer, property:["ADBE Time Remapping"], times:[…], values:[…]}` (linear
   interpolation between keys = the segment speeds). `hold` set → add a key at
   `hold.sequence_seconds_from` with value `hold.source_seconds` and make it a HOLD key
   (`keyframe.set_interpolation`), and extend the layer's out point if the comp range is longer.
   Show the plan table to the user before writing.
5. Verify: render the moving layer alone again → `conform.py verify --ref REF/ --mov MOV2/ --check-time --report S/t8.json`:
   `time_lost_frames` must be empty (every frame beats its neighbours ±2; ties listed).

## 3. Geometry

1. `conform.py global-fit --ref REF/ --mov MOV/ --out S/ --time S/time.json --step 2 --mov-motion <Scale x,Scale y,Position x/W,Position y/H,Rotation> --seq-size W,H [--boxes boxes.json]`
   → `S/geom.json`: per piece `mode constant|keys`, `delta`, `motion` (absolute values composed with the
   current Transform: `scale_w/scale_h` %, `rot` °, `pos_px`), residual, `person_check` with `--boxes`
   (normalised person boxes; mandatory on shots with several people — the frame statistic hides a
   doubling person).
2. Apply on the moving layer (anchor at the layer centre — the composition assumes it; with another
   anchor convert through `layer.calculate_transform`): constant piece → `property.set` Scale
   `[scale_w, scale_h]`, Rotation, Position `pos_px`; `keys` piece → `keyframe.set_batch` on each
   property at `keys[i].t` (comp time = work area start + t/fps), linear. Pieces follow the constant-lag
   runs; one constant for the whole layer when `pieces` all agree within 0.2 %.
3. Verify on a fresh solo render: `conform.py verify … --geom S/geom.json --boxes boxes.json` → p90 ≤ 2 px
   on people. A named person still above it → warp render (`conform.py render --geom … --encode out.mov`,
   ProRes 4444) → `footage.replace` / `layer.replace_source`, original footage kept in the project.
4. Empty strips at the frame edge after scaling (`render` reports `transparent_edges_lrtb`): offer
   Scale +1–2 % or a fill; never apply unasked.

## 4. Colour (lower layer towards the upper)

`conform.py exposure --ref REF/ --mov MOV/ --out S/levels.json --time S/time.json --geom S/geom.json --every 3 --apply-to <mov|ref>`
(`--apply-to` = the layer that gets the Levels: the lower one). Apply **Levels (Individual Controls)**
(`effect.add {matchName:"ADBE Pro Levels2"}`) and set per channel Input Black / Input White / Output
Black / Output White from `levels_per_channel` (AE takes 0–1 for 8-bpc comps: divide the 0–255 values by
255; 16/32 bpc likewise normalised) through `effect.set_property`; gamma stays 1. Accept when `bias_after`
is within ±1 level and `flicker_per_frame` shows no drift; a drift means the generator changed exposure
mid-shot → split the layer and fit per piece. Verify on a solo render with `conform.py verify`
(`colour_bias_rgb_mean` ±1).

## 5. Matte and seam (upper layer)

Roto Brush / Object Matte or a Pen mask on the upper layer per `recipes/masks-roto.md`; a people matte
from outside (Deep Matting) as a layer above → `layer.set_track_matte {matteType:"luma"}`. Mask
feather/expansion through `mask.set_props`; measure on rendered alpha with
`conform.py mask-measure --mask0 … --mask … --mask-prev … --report mask.json` (inset, transition width,
jitter < 0.5 px, lost subject). Every person and every visible fragment of a partly hidden person is in
the matte on every frame; faces first when something cannot hold.

## 6. Report and acceptance

Before → after on rendered frames: time (gain, speeds, frames lost), geometry (median / p90 / worst
frame, per person), colour (bias, median abs, per-frame drift), matte (inset, transition, jitter).
Accept: no frame lost in the time check, geometry p90 ≤ 2 px on people (or the best reached value with
the reason), colour bias ≤ 1 level, every person in the matte with faces holding. Out of scope:
relighting, parallax between layers from a moving camera (report and stop), audio. The checkpoint
stays; the project is saved only after the user accepts.
