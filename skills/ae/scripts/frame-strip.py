#!/usr/bin/env python3
"""Glue check frames into ONE image (one Read instead of N).
  frame-strip.py out.png a.png b.png c.png [--labels t0,t4.67,t8.5] [--width 640]
Also: frame-strip.py out.png video.mp4 --every 0.5 [--from 5 --to 9]  → contact sheet.
Needs Pillow (+ ffmpeg on PATH for video)."""
import subprocess, sys, tempfile, os
from PIL import Image, ImageDraw
args = sys.argv[1:]; out = args[0]
def opt(name, default=None):
    if name in args: i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return default
labels = opt("--labels"); width = int(opt("--width", 640)); every = opt("--every"); t_from = opt("--from"); t_to = opt("--to")
srcs = args[1:]
if every:
    d = tempfile.mkdtemp(); vf = f"fps=1/{every}"
    cmd = ["ffmpeg", "-loglevel", "error"] + (["-ss", t_from] if t_from else []) + ["-i", srcs[0]] + (["-to", str(float(t_to) - float(t_from or 0))] if t_to else []) + ["-vf", vf, f"{d}/f_%03d.png"]
    subprocess.run(cmd, check=True); srcs = sorted(f"{d}/{f}" for f in os.listdir(d))
    labels = ",".join(f"{float(t_from or 0) + i * float(every):.2f}s" for i in range(len(srcs)))
ims = [Image.open(s).convert("RGB") for s in srcs]
ims = [im.resize((width, int(im.height * width / im.width))) for im in ims]
cols = min(len(ims), 3); rows = (len(ims) + cols - 1) // cols; h = max(im.height for im in ims)
sheet = Image.new("RGB", (cols * width, rows * h), "black"); dr = ImageDraw.Draw(sheet)
lab = labels.split(",") if labels else [os.path.basename(s) for s in srcs]
for i, im in enumerate(ims):
    x, y = (i % cols) * width, (i // cols) * h; sheet.paste(im, (x, y)); dr.text((x + 8, y + 6), lab[i] if i < len(lab) else "", fill="yellow")
sheet.save(out); print(out, sheet.size, len(ims), "frames")
