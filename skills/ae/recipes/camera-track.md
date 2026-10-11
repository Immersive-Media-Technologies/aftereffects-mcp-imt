# Camera solve from footage — 3D Camera Tracker (AE 26.5, Russian UI verified 11.10.2026)

Goal: a `3D Tracker Camera` layer whose motion matches the footage, with the scene origin on the real
surface (ground plane), so that 3D content put at `[0,0,0]` sits on that surface. Expect ~10 calls.

## 0. Before

- Comp with the footage layer at the bottom (`layer.create_footage` or `ae_comp_info` to find it).
- `ae_do project.checkpoint {label:"before camera solve"}` — the UI steps below can crash AE; the
  checkpoint is the recovery point (`project.revert` after a relaunch).
- Choose the **frame for the ground plane** later (step 4): a time where the surface is widely visible
  (chess clip: 8.5 s; frame 0 was covered by pieces).

## 1. Launch the analysis (UI-only — menu is safe)

```
ae_do timeline.set_active_comp {comp}
ae_do timeline.select_layers {comp, indices:[<footage index>], deselectOthers:true}
Bash: $AE_SKILL/scripts/ae-menu.sh "Анимация" "Отслеживать камеру"      # en: "Animation" "Track Camera"
```

`effect.add ADBE 3D Tracker` only adds the effect and **never analyses** — remove such a stale effect
first (`effect.remove`) or the menu item re-applies on top.

## 2. Wait (one call)

Status lives in the effect's property **names** (NO_VALUE properties): `ADBE 3D Tracker-0313`
"Средняя ошибка: -" → analysing; `ADBE 3D Tracker-0311` "Ср. ош.: 1.06 пикс." → solved;
`ADBE 3D Tracker-0001` "224 кадр. @ 0:00:00:00" → frames analysed. Chess clip 720p, 224 frames: ~16 s.

```
status.jsx (writes OUT):
  (function(){var s="none";try{var c=app.project.activeItem;var t=c.layer(<idx>).Effects.property("ADBE 3D Tracker");
   if(t){s=t.property("ADBE 3D Tracker-0001").name+" | "+t.property("ADBE 3D Tracker-0311").name;}}catch(e){s="ERR "+e;}
   var f=new File("<OUT>");f.encoding="UTF-8";f.open("w");f.write(s);f.close();})();
Bash: $AE_SKILL/scripts/ae-wait.sh status.jsx out.txt 'Ср\. ош\.|Average error' 240 8
```

(Or `ae_do property.get {property:["Effects","ADBE 3D Tracker","ADBE 3D Tracker-0311"]}` once —
the `name` field carries the status: «Ср. ош.: 1.06 пикс.» when solved.)

## 3. «Create Camera» — a real click

1. `ae_save_project`. Bring the Effect Controls panel into view: `ae-dialogs.sh front`; the effect must
   be selected (`property.select {property:["Effects","ADBE 3D Tracker"]}`).
2. `ae-windows.js` → AE window bounds → `ae-shot.sh panel.png X Y W H` → Read → button position
   («Создать камеру» / «Create Camera», enabled only after the solve).
3. `ae-click.js click X Y` (points!). A tutorial tip («Пропустить обзор») may pop up: `ae-dialogs.sh close`.
4. Verify: `ae_comp_info` → layer `3D Tracker Camera` with position keys == frames analysed.
   `layer.create_camera` is **not** this camera — it has no solve.

Known failure: System Events `click` on that button → "внутренняя ошибка проверки {no current
context}" → fatal → AE quits. Recovery: `ae-dialogs.sh close 3`, relaunch with the saved project.

## 4. Ground plane and origin (recommended for anything that must stand on a surface)

1. Delete a camera made before the plane (`layer.delete`), hide the 3D content layer, go to the chosen
   time (`timeline.set_time`), select the footage layer and the tracker effect (step 3.1) so the viewer
   shows the track points.
2. `ae-shot.sh viewer.png …` → pick 3 points **on the surface** (not on edges/objects). `ae-click.js click X Y`
   on the triangle between them selects three; `shift` adds more.
3. `ae-click.js rclick X Y` on the target → menu item **«Задать горизонтальную проекцию и адрес начала»**
   (= "Set Ground Plane and Origin") → `ae-click.js click` on it (read positions from a crop).
4. «Create Camera» again (step 3). Verify the solve changed: camera position/orientation at 3 times.

## 5. Read the camera back (values, not screenshots) — one call

````
ae_do property.sample {comp, layer:"3D Tracker Camera",
  properties:[["Transform","Position"],["Transform","Orientation"],["Camera Options","Zoom"]]}   # times default to start / middle / end
``` Chess clip after
the plane: camera low over the board, nearly horizontal, zoom 5408 px — consistent with the shot.

## Gotchas
- Never click outside AE's window; a stray click opened the app menu and DoScript timed out (-1712)
  until `ae-dialogs.sh escape`.
- `screencapture` without `-D` fails on two displays. Window positions change after dialogs — re-shoot
  before each click.
- A second tracker run on the same layer: `effect.remove` the old one first (reset recipe:
  remove → deselect all → select footage → menu).
````
