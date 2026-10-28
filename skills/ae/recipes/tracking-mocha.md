# Point / planar tracking — Tracker panel and Mocha AE

- **Tracker panel (Track Motion / Stabilize)**: `effect`-less, lives on the layer's Motion Trackers
  property group (`ADBE MTrackers`). Scripting can read solved trackers (`property.list` on
  `["ADBE MTrackers"]`) and apply the result with expressions that address trackers and track points by
  index and matchName — «Tracker 1» / «Track Point 1» are names AE gives in its UI language:
  `thisComp.layer("…")("ADBE MTrackers")(1)(1)("ADBE MTracker Pt Attach Pt")` (tracker 1, track point 1,
  its Attach Point; from ExtendScript
  `layer.property("ADBE MTrackers").property(1).property(1).property("ADBE MTracker Pt Attach Pt")`).
  Starting the analysis is UI-driven → `ae_do command.execute {id: 2568}` (Animation › Track Motion,
  «Анимация › Отслеживать движение»: opens the Tracker panel for the selected layer; `ae-menu.sh` with
  this AE's labels as the fallback), place the feature box with `ae-click.js drag`, press ▶ in the
  Tracker panel (`ae-click.js click`), wait, then Apply (button click). Expect several screenshots —
  budget it or ask the user for the three clicks.
- **Mocha AE** (planar): effect `ADBE MochaAE`-family; the Mocha window is a separate app — the model
  cannot drive it reliably. Script what is around it: apply the effect (`effect.add`), prepare the layer,
  and after the user's track read the exported corner-pin / transform data back from the effect's
  properties or from an exported `.txt` (Mocha export → paste → `keyframe.set_batch`).
- **3D Camera Tracker**: `camera-track.md`.
- **Warp Stabilizer**: analysis starts automatically on `effect.add "ADBE SubspaceStabilizer"`; wait with
  `ae-wait.sh` on a token the status .jsx derives from a number or a matchName — the effect's banner and
  status names are translated UI text — then set Result / Method via `effect.set_property` (by index or
  matchName, see `effect.list_on_layer`).
