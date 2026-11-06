# Masks, mattes, roto (AE 26)

- **Masks**: `mask.add {layer, path:[…], closed}`, `mask.set_props` (mode, feather, expansion, inverted),
  `mask.set_path` for animated vertices (`keyframe.add` on `["Masks","Mask 1","Mask Path"]`).
- **Track matte** (AE 23+ semantics, matte layer anywhere): `layer.set_track_matte {layer, matteLayer, matteType: alpha|alpha_inverted|luma|luma_inverted|none}`.
- **Object Matte** (AE 26, AI matte by a click on the subject): by sight with `ae_object_matte_ui` — section below.
- **Roto Brush 3**: `effect.add "ADBE Roto Brush"` is possible, the first stroke is UI-only; propagation
  runs on play/freeze from the UI. Prefer Object Matte on AE 26 (section below).
- **Alpha of a plugin render** (splat over footage): the effect draws over a solid — set the solid's
  blend normally and check the alpha with `ae_render_frame` of the plugin layer alone (solo via
  `layer.set_props {solo:true}`), looking for halos («облачка») at edges.

## Object Matte by sight — `ae_object_matte_ui` (macOS)

The way to cut people (or any subject) out of a plate in AE 26: you look at a frame, outline groups
in its pixels; After Effects' Object Matte (Sensei) computes the matte and carries it through the
shot, so the edge does not flicker the way per-frame mattes do. No script can create a selection;
the tool drives the Layer panel with real mouse events and reads back what the effect recorded.

Facts (live, AE 26.5, 05–06.11.2026): Object Matte acts in the **Layer panel**. Option+W is the
shortcut of the whole Roto Brush tool **group** (Roto Brush, Refine Edge, Object Matte, Quick
Selection) and cycles its members — the tool now reads the active tool code and presses only until
Object Matte (code 161) is active; with Quick Selection active a lasso took the whole frame. A
**lasso** (Lasso marquee mode, closed drag) takes the subjects inside the outline and snaps to their
silhouettes — one lasso takes a whole group of people, provided the outline runs **close to the
group's contour** (so the matte knows what to snap to), not far out across the background. **A part
of a person is a subject too** — someone half hidden behind another, a figure lying on the ground, a
child deep in a group, a limb, a head: Object Matte takes such a part reliably only when the new lasso
**overlaps the matte already there** (it cuts ~40–80 comp px into the neighbouring kept people, start
and end inside the white), so the new piece merges with them into one matte; an outline that only
touches or stops short of the matte is often taken poorly or not at all. A **click** takes the subject under it **as Sensei segments it**:
on a lone figure that is the whole person, in a crowd often only a garment, a torso or one child of a
group — the first live run left headless torsos that way. Shift adds, Option removes. Every click or
lasso becomes a stroke under Effects › Object Matte (matchName `ADBE Samurai`) › Selections — «Add
object N», «Add lasso N», «Remove object N» — with its position in **layer pixels** and the frame it
was made on. Propagation runs when the comp time moves while the layer is open in the Layer panel.
The matte is the layer's alpha. One Object Matte effect per layer; a wrong stroke is removed with
`property.remove` on its row.

**The tool never judges the matte.** After every call it renders the layer solo and returns a
**preview image** — top: the matte over black (what stays, as the user sees it); bottom: the frame
with the excluded parts in **red** — with markers: **cyan numbered boxes** on the gaps wedged between
kept pieces (where hidden, lying and half-visible people are usually left out) and **rings on your
`people` points** (green = inside the matte, yellow = outside), plus per person whole / partial /
missing. `error_px` only
says where a stroke landed, not what Sensei took. **A person is whole only when you saw it whole in
the preview.**

1. **Prepare.** The plate layer on top, Opacity 100 %. Remove a stale Object Matte effect from an
   earlier attempt (`effect.remove`). The Layer panel must be visible and wide enough for the whole
   picture (the tool lowers its zoom to fit and refuses when it cannot find the picture); the Object
   Matte tool's marquee set to **Lasso** once (the ⌾ icon in the tool options bar — ask the user once if
   it is not; it stays). Pick a **base frame** where every person is clearly visible.
2. **Look and list.** `ae_render_frame` of the comp at the base frame. Write the **list of people**
   that belong to the matte — number, what they look like, and a point on each one's **head, body and
   feet** in comp pixels («3 — boy in a striped polo: head 2440,1180 · body 2420,1600 · feet
   2380,2350»). Count everyone, including people **half hidden behind others** (only a head or a
   shoulder shows), anyone **lying on the ground**, children **deep inside a group**. Small or blurred
   people far behind are not on the list. Pass the list as `people` on **every** call — the tool marks
   and checks each point; this list is the checklist for every check below.
3. **Groups by lasso.** Split the list into groups of people who stand together; **one lasso per
   group, around all of them at once**, following the group's outer contour at a small distance
   (~20–40 comp px outside heads, hair, raised hands and feet — close enough that the matte snaps to
   the people, never a rectangle across large background): `lassos:[[…group 1…], […group 2…]]` in one
   call, 12–40 points each. Neighbouring group lassos **overlap each other** where the groups touch, so
   people standing between them are inside both. The ground the people stand on, when the
   task says it belongs to the plate — its own lasso. Points only for a lone, clearly separated person
   the lassos missed.
4. **Look at the preview.** Work list: every **yellow ring** and every person reported partial or
   missing; then every **cyan gap box** — look at the plate there in the bottom panel: is there a
   person or a part of one (behind someone, lying, deep in a group, an arm, a head)? Then go through the
   whole list in the image: head, hair, both arms, legs, feet bright in the top panel, nothing of them
   red in the bottom one. Write it down: «1 whole · 2 whole · 3 head missing · gap 2 = boy behind the
   priest, not in · gap 4 = ground between legs, fine · …». For a dense group whose heads are small in the full
   frame, preview it alone (`preview_times:[base]`, `preview_region` = the group's box).
5. **Fix by sight.** A missing person or part → a lasso around it that **overlaps the neighbouring
   kept matte** by ~40–80 comp px (the outline starts and ends inside the white area of the person it
   joins), close to the missing part's own contour elsewhere — so it merges into the matte. Never a
   point on the missing part, never an outline that stops at the matte's edge. Foreign background inside the matte (a green panel, sky
   between heads) → `mode:"subtract"` with a lasso that hugs **only that piece** — never one that
   touches a head or a face. Look at the new preview; repeat until every person on the list is whole
   on the base frame — at most three rounds, then report what still fails and where the image is.
6. **Propagate.** `ae_object_matte_ui {comp, layer, time, propagate_to: <end>}` and again to the start
   (`propagate_to: 0`) — the tool steps the comp time frame by frame; raise `settle_ms` on 4K material
   (≈ 400–800 ms per frame).
7. **Verify on frames — preview only.** `ae_object_matte_ui {comp, layer, time: <base>,
   preview_times: [up to 8 times, every ~12 frames]}` — no clicks, just the images. On each image the
   same checklist, the **head and face of every person first**, then torsos, limbs, clothing; no
   foreign background inside. A frame where someone is broken → `time` = that frame, fix by lasso as
   in step 5, propagate again from it. At most two repair rounds per stretch; a stretch where the
   matte keeps failing is cut as its own piece of the layer with ~2 s overlap and matted separately.
8. **Report from the images.** Per checked frame: the checklist as you saw it (who is whole, what is
   missing) and the preview file. Never «all heads present» for a frame whose image you did not look
   at; a check you could not do is reported as not done.
9. **Edge.** The matte's own Feather / Contrast / Shift Edge sit in Effect Controls (the «Object Matte»
   group of the effect), set by the task. **Plate over an AI-generated layer** (layer conform): the
   matte is shrunk inside the silhouette, feather 4 — `recipes/layer-conform.md` §5. Other mattes: shift
   the edge inward when a seam of background shows, keep feather small.
10. **Freeze** (the button under the Layer panel) when the matte is accepted — it locks the propagation
   cache; freezing is the user's call.

Shared canon with the Premiere skill (Object Mask): lasso as many people at once as needed, then remove
the unneeded fragments with the same lasso (subtract); the ground as the task says; then only faces and
foreign background; small or blurred people far behind are not cut.
