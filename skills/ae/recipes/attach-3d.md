# Attach 3D content to tracked footage (splat / model / solid)

Needs a solved camera (`camera-track.md`), ideally with the ground plane set so `[0,0,0]` is on the
surface. Works the same for a plugin model (irrealix, KIRI) and for a native 3D layer.

## 1. Anchor null at the origin (one call)

```
ae_do layer.create_null {comp, name:"GS_Origin", threeD:true, position:[0,0,0], anchorPoint:[50,50,0]}
```

Before and after the linking steps: `comp.snapshot` → … → `comp.diff` shows exactly what moved.

## 2. Link the content to the null

- **Native layer** (solid / precomp / shape in 3D): `layer.set_parent {layer, parentLayer:"GS_Origin"}`;
  then move/scale the _null_. Several links → one `batch.run {atomic:true}`.
- **Plugin model without a layer transform** (irrealix: the model lives inside the effect): expressions
  on the effect's transform properties → `expression.set` on each:
  - position ← `thisComp.layer("GS_Origin").transform.position`
  - X/Y/Z rotation ← `…xRotation + …orientation[0]` etc.
    Verified 11.10 (irrealix `-0038`, `-0035/36/37`): all four `expressionError` none.
- Plugins with their own "pick null layer" parameter (LAYER_INDEX type 6421): `effect.set_property` with
  the null's **index**.

## 3. Scale and place

- Scale by the plugin's own scale (irrealix `-0031` Transform Scale, 100 → 28 for bread ≈ ⅔ rook height)
  or the null's scale for native layers. Keep uniform scale on.
- Position: move the null, not the model; keep Z = 0 to stay on the plane.
- Check **3 frames**: `ae_render_frame` at entrance / middle / exit → `frame-strip.py` → one Read.
  Look for: size vs reference objects, feet on the surface, perspective matching the surface lines,
  camera passing _through_ the object (too big / on the camera path).

## 4. Does it slide? Measure, do not look

A 0.5 s contact sheet hid a 66 px drift (11.10). Render the segment where the object is in frame
(`render.md`, plate size/fps), then:

```
python3 $AE_SKILL/scripts/measure-slide.py render.mp4 plate.mp4 <start_s> out/ [--mask-red]
```

Slide < ~3 px over the shot = holds. Larger → find which side is wrong **before** adjusting anything:
put a native 3D solid (`layer.create_solid` + `threeDLayer` + parent to the null) at the same point and
measure it the same way. Solid slides too → camera/plane (re-solve, pick plane points nearer the
object, more frames); solid holds but the plugin model slides → the plugin's camera coupling (FOV /
zoom, see the plugin file).

## 5. Report

Comp, the null, how the content is linked (parent / expressions / plugin parameter), scale, the 3 check
frames by name, the slide figure in px, open issues → `plugins/<plugin>.md`.
