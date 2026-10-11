# Render — previews, segments, templates (localized AE)

## Frames (the agent's eyes)

`ae_render_frame {compNameOrId, time, outPath}` — PNG, viewer-accurate colour. Into your frames folder
with a short name (`entrance.png`, `t8.5.png`). 16-bit projects give ~10 MB PNGs — downscale with `sips -Z 1280` before reading.

## Segment / preview render (also the honest timing)

```
batch.run:
  comp.set_work_area  {comp, start:5, end:9.3}
  render.add_to_queue {comp}                                   # output folder is created
  render.set_output   {queueItem:1, outPath:"<aep folder>/renders/<comp>/<name>.mp4"}
  render.start        {}
```

then `render.status` (poll with `ae-wait.sh` only for long renders).

**Localized AE:** `render.set_output renderTemplate:"Best Settings"` is **rejected** (template names
are localized: «Наилучшие настройки»); the item still rendered with the default template, and the
default output module wrote **H.264 .mp4 even when the path ended in .mov**. Run
`render.list_templates` first and pass the localized names (`render.set_settings`, `render.set_om_settings`).
For a plate-size comparison keep the comp size and fps; for alpha use a PNG sequence / ProRes 4444
output module (`render.save_template` once, reuse).

## Where

Renders and sequences → `<folder of the .aep>/renders/<comp or purpose>/`. Name them in the reply.
