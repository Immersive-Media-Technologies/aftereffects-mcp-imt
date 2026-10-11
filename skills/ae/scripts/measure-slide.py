#!/usr/bin/env python3
"""Does an inserted 3D object (splat, model, solid) slide on the plate?

Compares a comp render WITH the object against the original footage: the
object's contact point (bottom-centre of |render - plate|) is followed over
time, and the plate surface under it is tracked with Lucas-Kanade optical
flow (dozens of corner features around the contact, forward-backward
checked). Slide = contact motion - surface motion, in pixels. Eyeballing
frames 0.5 s apart missed a 66 px drift on 11.10.2026 — measure, do not look.

  measure-slide.py render.mp4 plate.mp4 RENDER_START_S OUT_DIR [--mask-red]

render  — render.* output of the comp segment (same size/fps as the plate)
plate   — the source footage; RENDER_START_S — comp time where the render begins
--mask-red  ignore thin saturated-red lines (irrealix trial watermark)
Writes OUT_DIR/slide.json and slide-markers.png (green = contact, magenta = the
plate point it started on). Needs opencv-python + numpy (venv in the session folder).
"""
import json, sys
import cv2, numpy as np

a = [x for x in sys.argv[1:] if not x.startswith("--")]
render_path, plate_path, start_s, out_dir = a[0], a[1], float(a[2]), a[3]
mask_red = "--mask-red" in sys.argv

def read_all(p):
    cap = cv2.VideoCapture(p); fr = []
    while True:
        ok, f = cap.read()
        if not ok: break
        fr.append(f)
    return fr, cap.get(cv2.CAP_PROP_FPS)

R, fps = read_all(render_path); P, _ = read_all(plate_path)
print(f"render {len(R)} frames @ {fps:.3f}; plate {len(P)} frames")
base = int(round(start_s * fps)); best = None
for off in range(base - 3, base + 4):                     # align on the top band (no object there)
    errs = [float(np.mean(np.abs(R[k][0:200].astype(np.float32) - P[off + k][0:200].astype(np.float32))))
            for k in (0, len(R) // 2, len(R) - 1) if 0 <= off + k < len(P)]
    e = float(np.mean(errs)) if errs else 1e9
    if best is None or e < best[1]: best = (off, e)
off = best[0]; H, W = R[0].shape[:2]
rows = []
for k in range(len(R)):
    r, p = R[k], P[off + k]
    m = (cv2.absdiff(r, p).max(axis=2) > 28).astype(np.uint8)
    if mask_red:
        rf = r.astype(np.int16); m[(rf[:, :, 2] - np.maximum(rf[:, :, 0], rf[:, :, 1])) > 60] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n <= 1: rows.append(None); continue
    i = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])); ys, xs = np.where(lab == i); ymax = int(ys.max())
    rows.append({"k": k, "x": float(xs[ys >= ymax - 6].mean()), "y": float(ymax), "cut": ymax >= H - 3})
first = next((r for r in rows if r and r["y"] < H - 30), None)
if not first: print("contact point never fully inside the frame"); sys.exit(0)
k0, cx, cy = first["k"], first["x"], first["y"]
f0 = off + k0; G = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in P]
mask = np.zeros_like(G[f0]); mask[max(0, int(cy - 60)):min(H - 10, int(cy + 60)), max(0, int(cx - 90)):min(W, int(cx + 90))] = 255
feat = cv2.goodFeaturesToTrack(G[f0], 80, 0.005, 6, mask=mask)
if feat is None or len(feat) < 8: print("not enough plate features around the contact"); sys.exit(1)
cur, ref, alive, res = feat, feat.reshape(-1, 2).copy(), np.ones(len(feat), bool), []
for k in range(k0, len(R)):
    f = off + k
    if k > k0:
        nxt, st, _ = cv2.calcOpticalFlowPyrLK(G[f - 1], G[f], cur, None, winSize=(21, 21), maxLevel=3)
        back, st2, _ = cv2.calcOpticalFlowPyrLK(G[f], G[f - 1], nxt, None, winSize=(21, 21), maxLevel=3)
        fb = np.linalg.norm(back.reshape(-1, 2) - cur.reshape(-1, 2), axis=1)
        alive &= (st.reshape(-1) == 1) & (st2.reshape(-1) == 1) & (fb < 0.7); cur = nxt
    if alive.sum() < 4 or rows[k] is None: continue
    mv = np.median(cur.reshape(-1, 2)[alive] - ref[alive], axis=0); surf = np.array([cx, cy]) + mv
    s = np.array([rows[k]["x"], rows[k]["y"]]) - surf
    res.append({"comp_t": round(f / fps, 3), "frame": f, "contact": [round(rows[k]["x"], 1), rows[k]["y"]],
                "surface": [round(float(surf[0]), 1), round(float(surf[1]), 1)], "slide_px": [round(float(s[0]), 1), round(float(s[1]), 1)],
                "plate_pts": int(alive.sum()), "cut": rows[k]["cut"]})
for e in res[::4] + [res[-1]]:
    print(f"t={e['comp_t']:.3f} pts={e['plate_pts']:2d} slide dx {e['slide_px'][0]:+6.1f} dy {e['slide_px'][1]:+6.1f} | {np.hypot(*e['slide_px']):5.1f}px{' (cut)' if e['cut'] else ''}")
mag = np.hypot(*np.array([e["slide_px"] for e in res]).T)
print(f"max slide {mag.max():.1f}px at t={res[int(mag.argmax())]['comp_t']}s; final {mag[-1]:.1f}px; {len(res)} frames")
json.dump({"offset": off, "k0": k0, "rows": res}, open(f"{out_dir}/slide.json", "w"), indent=1)
imgs = []
for e in (res[0], res[len(res) // 2], res[-1]):
    im = R[e["frame"] - off].copy(); c = tuple(int(v) for v in e["contact"]); s = tuple(int(v) for v in e["surface"])
    cv2.circle(im, c, 6, (0, 255, 0), 2); cv2.circle(im, s, 6, (255, 0, 255), 2); cv2.line(im, c, s, (255, 255, 255), 1)
    cv2.putText(im, f"t={e['comp_t']:.2f}s slide {np.hypot(*e['slide_px']):.1f}px", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    x0, y0 = max(0, c[0] - 220), max(0, c[1] - 260); imgs.append(cv2.resize(im[y0:y0 + 300, x0:x0 + 440], (440, 300)))
cv2.imwrite(f"{out_dir}/slide-markers.png", np.hstack(imgs)); print("wrote slide.json, slide-markers.png")
