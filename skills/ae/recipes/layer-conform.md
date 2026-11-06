# Layer conform in After Effects: sync a generated layer with the plate (time → geometry → colour → matte)

Read when two layers of one comp show the same scene and must coincide on the people before
compositing: «sync the layers / tracks», «conform the layers», «align the generation to the plate»,
«синхронизация видео дорожек», «подгонка видео дорожек», «синхронизировать слои», «подогнать
генерацию под плейт / исходник», «замена фона», «свести цвет слоёв». Typical: a plate layer (people to keep) and an AI generation of the same shot whose action runs
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
`project.checkpoint {label}` before the first change. Working files (frame renders for measuring, plans, reports): the session's own temporary folder, deleted with the session; renders for the user: `<folder of the .aep>/DA_render/`.

## 1. Frames of each layer alone

Solo the layer (`layer.set_props {layer, props:{solo:true}}`), render the work area as a PNG sequence
(`render.add_to_queue` with a PNG output module and `render.set_output`, or `render.frame` per frame for
short pieces), then `solo:false`. Both exports cover the same frames in comp coordinates (frame i = work
area start + i/fps). Raw footage frames instead: `conform.py frames --video` and the layer's Transform as
`--mov-place "scale=<Scale %>;pos=<Position/comp size>;rot=<Rotation>"` with `--seq-size W,H`.

## 2. Time — cuts on the generation layer, whole frames only

Who is who (user canon 05.11): the **generation is the lower layer** and is the one cut into pieces;
the **plate is the upper layer**, stays whole and carries the matte; colour goes on the lower layer
towards the upper. The generator plays the same action faster by whole frames — one frame ahead every
9–15 frames — then freezes. Time Remap with a speed between two coincidence points asks for frames
that do not exist and renders blends (34 of 84 frames on shot 850 in Premiere, 05.11); cutting the
layer at the steps and shifting each piece by whole frames shows native frames only, at the cost of
one repeated generation frame per step, hidden under the plate's people. Time Remap is not part of
this technique (it stays for speed ramps the user asks for).

Keep every frame export, plan and report of this work in the session's own temporary working folder
(deleted with the session), one subfolder per purpose — never in the user's repositories, media or
project folders; renders meant for the user go next to the project.

1. `conform.py coarse-fit --ref GEN/ --mov PLATE/ --out S/ --frames 0,2,4,6` (the start of the shot, lag still 0).
2. `conform.py time-match --ref GEN/ --mov PLATE/ --out S/ --geom S/coarse.json --lag-min -3 --lag-max 10`
   → `S/time.json` (`lag` — plate frame = generation frame + lag, `runs`, `frozen_tail_ref`, `summary`,
   `warnings`). A warning «moving layer has N frames … forced» = the plate render is too short: render
   `max lag` more frames and match again. The lag path is a staircase and is applied as it is.
3. `conform.py time-plan --time S/time.json --fps <comp fps> --clip-start <generation layer inPoint s> --clip-in <its source start s> --retime ref --out S/plan.json`
   → `ae_pieces`: one per constant-lag run — `in_point` / `out_point` (comp seconds),
   `start_time_shift_seconds` (= −slip; positive shift = the piece shows earlier source),
   `slip_frames`; plus `cut_table`, `expected_mapping` (comp frame → generation frame) and
   `trim.sequence_seconds` (where the frozen tail began). Show the user the `cut_table` first.
4. **Check the plan on the main moving subject before cutting.** The engine matches the whole frame
   and follows the majority; a subject moving differently (the priest on 850) can be one frame off in
   a run — run `time-match` again with `--boxes` on him, or compare crops at the suspected runs, and
   cut where his step is. One subject out of phase everywhere is p. 9.
5. **Prepare the generation layer:** stretch 100 %, Time Remap off, Transform and Levels already set
   (pieces are copies of the layer, so they inherit both). `project.checkpoint`.
6. **Cut and shift.** For every piece but the first, ascending: `layer.split {comp, layer, time: in_point}`
   (the later part becomes a new layer above). Then for each piece, by its in/out: `layer.set_props
   {comp, layer, props:{startTime: <current startTime> + start_time_shift_seconds, inPoint, outPoint}}`
   — `startTime` first (it moves in/out along), then `inPoint`/`outPoint` back to the piece's comp
   range. Read every piece's `startTime`/`inPoint`/`outPoint` with `ae_layer_info`. The last piece's
   `outPoint` = the plate's end; the frozen tail is gone because the shift pulled the source earlier.
   Frame Blending off on every piece.
7. **Read back:** table of pieces (comp in/out, source frame at in = (inPoint − startTime) × fps)
   against `cut_table`; any frame of difference is reported.
8. **Verify every frame:** solo-render both layers again → `conform.py verify --ref GEN2/ --mov PLATE2/ --check-time --every 1 --report S/t8.json`.
   **A run of lost frames is never accepted** — a repeated frame at the wrong place (cut too early or
   too late) or a duplicate frame of the generator left in: the plate moves, the generation stands
   still, heads double. Fix it from the same report: `conform.py refine-cuts --verify S/t8.json --plan
   S/plan.json --fps <comp fps> --clip-start <comp s of frame 0> --clip-in <source s of frame 0> --out
   S/refine.json` (or `--layout 'seq:src,…'` = each piece's start frame and the source frame it shows,
   read back in p. 7) → `ae_pieces`, `cut_table`, `layout_after`. Apply it to the existing pieces in
   order: piece k gets `startTime` = piece 0's `startTime` + `start_time_shift_seconds`, then `inPoint` /
   `outPoint` (they are copies of one layer — any piece can show any range); one more piece → split
   one; a piece no longer needed → ask the user before removing it. Render and verify again; accept
   when `disagree_after` is empty and the only lost frames left are single ties at the repeated frames.
   A layout taken from Premiere, another shot or an earlier run is a starting point only — the
   per-frame check of this render decides (850, 06.11: the Premiere layout had its last two repeats 3
   and 5 frames early; refine-cuts → pieces at 0 / 0.375 / 0.875 / 1.375 / 2.000 / 2.583 / 3.083 s,
   in-frames 0 / 8 / 19 / 30 / 44 / 57 / 68). Strongest
   check: match every rendered generation frame against its native frames — each must be a native
   frame, none a blend.
9. **One object drifts, the rest coincides:** the layer stays as cut; the object gets its own copy of
   the generation layer above, matted to him, cut and shifted by its own lag (`--boxes` on him alone).
   A patch layer locked to the generation (e.g. one covering a leftover green area) is cut and shifted
   exactly like the generation.

`ae_time_remap_keys` (step keys, comp time → source time) remain in the plan for a comp where
pieces are impossible; they reproduce the same staircase, not a smooth speed.

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
from outside (Deep Matting) as a layer above → `layer.set_track_matte {matteType:"luma"}`. Every person
and every visible fragment of a partly hidden person is in the matte on every frame; faces first when
something cannot hold.

**The matte sits slightly inside the silhouette — this task only** (plate over an AI-generated layer;
other mattes follow their own task). The plate's people are cut a little smaller than their outline,
so the outline's edge comes from the generation underneath and no seam of the plate's old background
shows. The user's standard: **feather 4**, the 50 % edge **8–12 px inside** the silhouette on 4608 px
frames (Premiere: expansion −8 … −12) as the start.
- Object Matte (effect `ADBE Samurai`) — **a mandatory step of this task, not a request to wait for.**
  The effect carries TWO groups with the same display names: the **Object Matte** group (what the
  matte renders with) and the **Refine Edge** group (applies only where the Refine Edge tool was used —
  on a plain matte it changes nothing). Set the Object Matte group **by matchName**, never by display
  name or a guessed index: Feather («Растушевка») = `/spatialsmoothing2` (property 16 on AE 26.5)
  → **4**, set explicitly (the effect starts at 5); Shift Edge («Сместить край») = `/rmshiftedges`
  (property 18) → **−8** to start (negative shrinks the matte); Contrast `/spatialsoftness2` stays.
  The look-alikes `/HBspatialsoftness2` (26) and `/HBspatialchoke` (28) belong to Refine Edge — 06.11
  an agent set 4 / −8 there, reported the halo gone, and the matte on screen had not changed.
  `effect.set_property {comp, layer, effectIndex, property:["/rmshiftedges"], value:-8}` and the same
  with `["/spatialsmoothing2"]`; then **read both groups back** (`ae_layer_info` of the layer, or an
  `effect.list_on_layer` + the values) and put the four numbers in the report — Object Matte feather /
  shift edge and Refine Edge feather / shift edge — so a wrong group is visible at once.
- A Pen mask: `mask.set_props` feather 4 and a negative expansion.
- Measure, never guess the units: render the layer's alpha (solo) on 3 frames once at Shift Edge 0 /
  Feather 0 (M0), then at the final values (M) → `conform.py mask-measure --mask0 M0.png --mask M.png
  [--mask-prev Mprev.png] --report mask.json` → `inset_px` median 8–12, `jitter_vs_prev_px` std < 0.5,
  `lost_subject` false. Quote the measured inset, not the parameter.
- The edge never crosses a face: eyes, nose and mouth inside on every frame (only cheeks may be
  clipped) — a smaller shift there. Feather goes down, even to 0, when it would spill past the
  silhouette (small figures) or soften a face; the remaining border is hidden by the colour match of
  the lower layer (§4), not by a softer edge.

## 6. Report and acceptance

Before → after on rendered frames: time (gain, speeds, frames lost), geometry (median / p90 / worst
frame, per person), colour (bias, median abs, per-frame drift), matte (inset, transition, jitter).
Accept: no frame lost in the time check, geometry p90 ≤ 2 px on people (or the best reached value with
the reason), colour bias ≤ 1 level, every person in the matte with faces holding, the matte's edge
set in the Object Matte group (feather 4, Shift Edge negative, inset measured — the four numbers of
§5 in the report). Out of scope:
relighting, parallax between layers from a moving camera (report and stop), audio. The checkpoint
stays; the project is saved only after the user accepts.
