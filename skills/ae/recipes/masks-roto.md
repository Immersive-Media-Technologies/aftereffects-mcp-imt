# Masks, mattes, roto (AE 26)

- **Masks**: `mask.add {layer, path:[…], closed}`, `mask.set_props` (mode, feather, expansion, inverted),
  `mask.set_path` for animated vertices (`keyframe.add` on `["Masks","Mask 1","Mask Path"]`).
- **Track matte** (AE 23+ semantics, matte layer anywhere): `layer.set_track_matte {layer, matteLayer, matteType: alpha|alpha_inverted|luma|luma_inverted|none}`.
- **Object Matte** (AE 26, click-the-subject matte, disk cache): applied from the UI (Window → Object
  Matte / layer menu); the model can prepare the layer, the user clicks the subject; then use the result
  layer as a track matte. Untested through automation — if needed: `ae-menu.sh` for the menu item, a
  real click for the subject (`ae-click.js`), `ae-wait.sh` on `layer.info` until the matte exists.
- **Roto Brush 3**: `effect.add "ADBE Roto Brush"` is possible, the first stroke is UI-only; propagation
  runs on play/freeze from the UI. Prefer Object Matte on AE 26.
- **Alpha of a plugin render** (splat over footage): the effect draws over a solid — set the solid's
  blend normally and check the alpha with `ae_render_frame` of the plugin layer alone (solo via
  `layer.set_props {solo:true}`), looking for halos («облачка») at edges.
