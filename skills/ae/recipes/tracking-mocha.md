# Point / planar tracking — Tracker panel and Mocha AE

- **Tracker panel (Track Motion / Stabilize)**: `effect`-less, lives on the layer's Motion Trackers
  property group. Scripting can read solved trackers (`property.list` on `["Motion Trackers"]`) and apply
  the result with expressions (`layer("…").motionTracker("Tracker 1")("Track Point 1").attachPoint`);
  starting the analysis is UI-only → `ae-menu.sh "Анимация" "Отслеживать движение"`, place the feature
  box with `ae-click.js drag`, press ▶ in the Tracker panel (`ae-click.js click`), wait, then
  `ae-menu.sh`/Apply (button click). Expect several screenshots — budget it or ask the user for the
  three clicks.
- **Mocha AE** (planar): effect `ADBE MochaAE`-family; the Mocha window is a separate app — the model
  cannot drive it reliably. Script what is around it: apply the effect (`effect.add`), prepare the layer,
  and after the user's track read the exported corner-pin / transform data back from the effect's
  properties or from an exported `.txt` (Mocha export → paste → `keyframe.set_batch`).
- **3D Camera Tracker**: `camera-track.md`.
- **Warp Stabilizer**: analysis starts automatically on `effect.add "ADBE SubspaceStabilizer"`; wait with
  `ae-wait.sh` on the effect's status property name, then set Result / Method via `effect.set_property`.
