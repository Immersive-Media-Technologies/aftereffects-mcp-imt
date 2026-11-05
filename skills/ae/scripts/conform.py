#!/usr/bin/env python3
"""conform.py — numerical engine of the layer-conform skills (Premiere, After Effects, Photoshop).

Two layers show the same scene: a *reference* layer that stays as it is and a *moving* layer
(usually an AI generation of the plate, or the plate itself when the generation is the reference)
whose time, geometry and colour have drifted. The engine measures the drift on exported frames
and writes plans the host application applies: speed keyframes, Motion/Transform values,
Levels, a retimed+warped render.

Everything is measured on PNG frames exported from the host (both layers in the host's
sequence/composition coordinates), or on raw media frames placed with `--mov-place`.
Nothing here talks to Premiere or After Effects; the skill does that.

Subcommands (see --help of each):
  frames        ffmpeg → PNG frames of a media file
  coarse-fit    uniform scale + shift of the moving layer on a few frames (Stage T2 / G0)
  time-match    which moving frame matches each reference frame (Stage T3–T6)
  time-plan     speed keyframes / cut-and-slip plan from time.json (Stage T7)
  global-fit    5-parameter affine per frame → constants or keys per piece (Stage G0)
  exposure      per-channel Levels of the moving layer towards the reference (Stage E)
  verify        time, geometry and colour residuals on the real result (T8 / G / E)
  render        retimed + warped (+ colour-baked) frames, optional ProRes 4444 (route C)
  mask-measure  inset, transition width and jitter of an exported mask alpha (Stage S)

Conventions: frame indexes are 0-based positions in the exported frame folders; `lag[t]` is the
moving-frame index that plays with reference frame t minus t; geometry deltas are what must be
applied to the moving layer so it lands on the reference (scale in %, rotation in degrees,
translation in full-resolution pixels of the sequence frame).
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    sys.exit("conform.py needs opencv-python-headless and numpy: pip install opencv-python-headless numpy")

VERSION = "1.1.0"
IMG_EXT = (".png", ".tif", ".tiff", ".jpg", ".jpeg", ".exr")


# ----------------------------------------------------------------------------- frames & placement

def list_frames(folder: str) -> List[str]:
    files = [f for f in sorted(glob.glob(os.path.join(folder, "*"))) if f.lower().endswith(IMG_EXT)]
    if not files:
        raise SystemExit(f"no frames in {folder}")
    return files


@dataclass
class Placement:
    """How raw moving-layer media sits in the sequence frame (Premiere Motion / AE Transform)."""
    scale_w: float = 100.0   # percent
    scale_h: float = 100.0
    rot: float = 0.0         # degrees, clockwise positive like Premiere
    pos: Tuple[float, float] = (0.5, 0.5)  # anchor (media centre) in normalised sequence coords
    seq: Optional[Tuple[int, int]] = None  # sequence W,H in full px; None = same as media

    @staticmethod
    def parse(spec: Optional[str], seq: Optional[Tuple[int, int]]) -> "Placement":
        p = Placement(seq=seq)
        if not spec:
            return p
        for part in spec.split(";"):
            if not part.strip():
                continue
            k, v = part.split("=", 1)
            k = k.strip().lower()
            vals = [float(x) for x in v.split(",")]
            if k == "scale":
                p.scale_w = vals[0]
                p.scale_h = vals[1] if len(vals) > 1 else vals[0]
            elif k == "pos":
                p.pos = (vals[0], vals[1])
            elif k == "rot":
                p.rot = vals[0]
            else:
                raise SystemExit(f"unknown placement key {k} (scale=, pos=, rot=)")
        return p

    def is_identity(self) -> bool:
        return (self.scale_w == 100 and self.scale_h == 100 and self.rot == 0 and self.pos == (0.5, 0.5)
                and self.seq is None)

    def matrix(self, media_wh: Tuple[int, int], ds: float) -> Tuple[np.ndarray, Tuple[int, int]]:
        """2×3 matrix taking media pixels (full res) to analysis pixels (sequence / ds)."""
        mw, mh = media_wh
        sw, sh = self.seq or (mw, mh)
        W, H = int(round(sw / ds)), int(round(sh / ds))
        sx, sy = self.scale_w / 100 / ds, self.scale_h / 100 / ds
        th = math.radians(self.rot)
        A = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.diag([sx, sy])
        P = np.array([self.pos[0] * W, self.pos[1] * H])
        C = np.array([mw / 2, mh / 2])
        M = np.hstack([A, (P - A @ C)[:, None]]).astype(np.float32)
        return M, (W, H)


def read_rgba(path: str) -> Tuple[np.ndarray, np.ndarray]:
    """float32 RGB 0..1 (composited over black) and alpha 0..1 at native size."""
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot read {path}")
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    maxv = 65535.0 if im.dtype == np.uint16 else 255.0
    im = im.astype(np.float32) / maxv
    if im.shape[2] == 4:
        a = im[..., 3]
        rgb = im[..., :3][..., ::-1] * a[..., None]
    else:
        a = np.ones(im.shape[:2], np.float32)
        rgb = im[..., :3][..., ::-1]
    return np.ascontiguousarray(rgb), a


class Layer:
    """A folder of frames, read lazily, downscaled and placed into analysis coordinates."""

    def __init__(self, folder: str, ds: float, place: Optional[Placement] = None, seq: Optional[Tuple[int, int]] = None):
        self.files = list_frames(folder)
        self.ds = ds
        self.place = place or Placement(seq=seq)
        self._cache: Dict[int, Tuple[np.ndarray, np.ndarray, np.ndarray]] = {}
        rgb, a = read_rgba(self.files[0])
        self.media_wh = (rgb.shape[1], rgb.shape[0])
        if self.place.seq is None and seq is not None:
            self.place.seq = seq
        self.M, self.wh = self.place.matrix(self.media_wh, ds)
        self.W, self.H = self.wh

    def __len__(self) -> int:
        return len(self.files)

    def get(self, i: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(gray 0..255 float32, rgb 0..1, alpha 0..1) in analysis coordinates."""
        if i in self._cache:
            return self._cache[i]
        rgb, a = read_rgba(self.files[i])
        flags = cv2.INTER_AREA
        rgb_s = cv2.warpAffine(rgb, self.M, self.wh, flags=flags)
        a_s = cv2.warpAffine(a, self.M, self.wh, flags=flags)
        g = cv2.cvtColor(rgb_s, cv2.COLOR_RGB2GRAY) * 255.0
        out = (g.astype(np.float32), rgb_s.astype(np.float32), a_s.astype(np.float32))
        if len(self._cache) > 400:
            self._cache.clear()
        self._cache[i] = out
        return out

    def gray(self, i: int) -> np.ndarray:
        return self.get(i)[0]

    def alpha(self, i: int) -> np.ndarray:
        return self.get(i)[2]


# ----------------------------------------------------------------------------- image measures

def norm(g: np.ndarray, s: float = 3.0) -> np.ndarray:
    """Normalised high-pass of log luma: what the live prototypes correlate."""
    g = np.log1p(np.maximum(g.astype(np.float32), 0))
    mu = cv2.GaussianBlur(g, (0, 0), s)
    hp = g - mu
    sd = np.sqrt(cv2.GaussianBlur(hp * hp, (0, 0), s)) + 1e-3
    return hp / sd


def valid_mask(alphas: Sequence[np.ndarray], margin: int = 12, erode: int = 25) -> np.ndarray:
    H, W = alphas[0].shape
    v = np.zeros((H, W), np.float32)
    v[margin:H - margin, margin:W - margin] = 1
    for a in alphas:
        v *= (a > 0.98).astype(np.float32)
    if erode > 1:
        v = cv2.erode(v, np.ones((erode, erode), np.uint8))
    return v


def motion_weight(layer: Layer, n: int, valid: np.ndarray, reach: int = 2, sigma: float = 6.0) -> np.ndarray:
    """Where the layer moves around frame n (|n−reach − n+reach|): static set carries no time information."""
    a = layer.gray(max(0, n - reach))
    b = layer.gray(min(len(layer) - 1, n + reach))
    d = cv2.GaussianBlur(np.abs(a - b), (0, 0), sigma)
    w = np.clip(d / (np.percentile(d, 99) + 1e-3), 0, 1)
    return w * valid + 0.02 * valid


def wncc(a: np.ndarray, b: np.ndarray, w: np.ndarray, win: np.ndarray, max_shift: float) -> Tuple[float, float, float]:
    """Weighted NCC of b against a after removing a global translation (phase correlation)."""
    (dx, dy), _ = cv2.phaseCorrelate(b, a, win)
    if abs(dx) > max_shift or abs(dy) > max_shift:
        dx = dy = 0.0
    if dx or dy:
        b = cv2.warpAffine(b, np.float32([[1, 0, dx], [0, 1, dy]]), (a.shape[1], a.shape[0]))
    sw = w.sum() + 1e-6
    p = a - (a * w).sum() / sw
    q = b - (b * w).sum() / sw
    den = math.sqrt(float((w * p * p).sum()) * float((w * q * q).sum())) + 1e-9
    return float((w * p * q).sum() / den), float(dx), float(dy)


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / (math.sqrt(float((a * a).sum()) * float((b * b).sum())) + 1e-6))


def tiles(ref_n: np.ndarray, mov_n: np.ndarray, valid: Optional[np.ndarray] = None, T: int = 48, step: int = 32,
          max_shift: float = 20.0, min_resp: float = 0.15, min_ncc: float = 0.45) -> np.ndarray:
    """Local translations (dx, dy) that bring the moving layer onto the reference, per tile.

    Returns rows (x, y, dx, dy, c): tile centre, shift to apply to mov, NCC after the shift.
    """
    H, W = ref_n.shape
    win = cv2.createHanningWindow((T, T), cv2.CV_32F)
    out = []
    for y in range(12, H - T - 12, step):
        for x in range(12, W - T - 12, step):
            if valid is not None and valid[y:y + T, x:x + T].mean() < 0.95:
                continue
            a = ref_n[y:y + T, x:x + T].astype(np.float32)
            b = mov_n[y:y + T, x:x + T].astype(np.float32)
            if a.std() < 1e-3 or b.std() < 1e-3:
                continue
            (dx, dy), resp = cv2.phaseCorrelate(b, a, win)
            if abs(dx) > max_shift or abs(dy) > max_shift:
                continue
            bs = cv2.warpAffine(b, np.float32([[1, 0, dx], [0, 1, dy]]), (T, T))
            c = ncc(a[6:-6, 6:-6], bs[6:-6, 6:-6])
            if resp > min_resp and c > min_ncc:
                out.append((x + T / 2, y + T / 2, dx, dy, c))
    return np.array(out, np.float64).reshape(-1, 5)


def fit5(t: np.ndarray, W: int, H: int, iters: int = 8) -> Tuple[np.ndarray, np.ndarray]:
    """Robust 5-parameter fit d(p) = A (p − c) + t with A = [[ax, −th], [th, ay]] (small-angle)."""
    if len(t) < 6:
        return np.zeros(5), np.full(len(t), np.nan)
    x, y, dx, dy = t[:, 0], t[:, 1], t[:, 2], t[:, 3]
    X = x - W / 2
    Y = y - H / 2
    n = len(t)
    A = np.zeros((2 * n, 5))
    b = np.zeros(2 * n)
    A[0::2] = np.stack([X, np.zeros_like(X), -Y, np.ones_like(X), np.zeros_like(X)], 1)
    b[0::2] = dx
    A[1::2] = np.stack([np.zeros_like(X), Y, X, np.zeros_like(X), np.ones_like(X)], 1)
    b[1::2] = dy
    w = np.ones(2 * n)
    p = np.zeros(5)
    for _ in range(iters):
        p = np.linalg.lstsq(A * w[:, None], b * w, rcond=None)[0]
        r = np.abs(b - A @ p)
        rr = np.hypot(r[0::2], r[1::2])
        s = np.median(rr) * 1.5 + 0.05
        ww = 1 / np.maximum(1, rr / s)
        w = np.repeat(ww, 2)
    res = np.hypot((b - A @ p)[0::2], (b - A @ p)[1::2])
    return p, res


def params_to_delta(p: np.ndarray, ds: float) -> Dict[str, float]:
    ax, ay, th, tx, ty = [float(v) for v in p]
    return {"scale_w": round(100 * (1 + ax), 4), "scale_h": round(100 * (1 + ay), 4),
            "rot": round(math.degrees(th), 4), "tx": round(tx * ds, 2), "ty": round(ty * ds, 2)}


def delta_to_params(d: Dict[str, float], ds: float) -> np.ndarray:
    return np.array([d["scale_w"] / 100 - 1, d["scale_h"] / 100 - 1, math.radians(d["rot"]), d["tx"] / ds, d["ty"] / ds])


def compose_deltas(first: Dict[str, float], second: Dict[str, float]) -> Dict[str, float]:
    """Delta equal to applying `first`, then `second` (both about the frame centre, full-px translations)."""
    def mat(d):
        th = math.radians(d["rot"])
        return np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.diag([d["scale_w"] / 100, d["scale_h"] / 100])
    A1, A2 = mat(first), mat(second)
    A = A2 @ A1
    t = A2 @ np.array([first["tx"], first["ty"]]) + np.array([second["tx"], second["ty"]])
    sx = math.hypot(A[0, 0], A[1, 0])
    sy = math.hypot(A[0, 1], A[1, 1])
    rot = math.degrees(math.atan2(A[1, 0], A[0, 0]))
    return {"scale_w": round(100 * sx, 4), "scale_h": round(100 * sy, 4), "rot": round(rot, 4), "tx": round(float(t[0]), 2), "ty": round(float(t[1]), 2)}


def delta_matrix(d: Dict[str, float], W: float, H: float, ds: float = 1.0) -> np.ndarray:
    """2×3 matrix applying a delta (full-px translation) to an image of size W×H at scale 1/ds."""
    sx, sy = d["scale_w"] / 100, d["scale_h"] / 100
    th = math.radians(d["rot"])
    A = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.diag([sx, sy])
    C = np.array([W / 2, H / 2])
    t = np.array([d["tx"], d["ty"]]) / ds
    return np.hstack([A, (C - A @ C + t)[:, None]]).astype(np.float32)


def apply_delta(img: np.ndarray, d: Dict[str, float], ds: float, flags=cv2.INTER_LINEAR) -> np.ndarray:
    H, W = img.shape[:2]
    return cv2.warpAffine(img, delta_matrix(d, W, H, ds), (W, H), flags=flags)


def compose_motion(base: Dict[str, float], d: Dict[str, float], seq_wh: Tuple[int, int]) -> Dict[str, float]:
    """Premiere Motion / AE Transform values of the moving clip after applying delta d on top of base.

    base: {scale_w, scale_h, rot, pos:[nx, ny]} (Premiere: Position normalised, Uniform Scale off).
    """
    W, H = seq_wh
    sx, sy = d["scale_w"] / 100, d["scale_h"] / 100
    th = math.radians(d["rot"])
    A = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]]) @ np.diag([sx, sy])
    C = np.array([W / 2, H / 2])
    P = np.array([base["pos"][0] * W, base["pos"][1] * H])
    P2 = A @ (P - C) + C + np.array([d["tx"], d["ty"]])
    return {"scale_w": round(base["scale_w"] * sx, 4), "scale_h": round(base["scale_h"] * sy, 4),
            "rot": round(base["rot"] + d["rot"], 4),
            "pos": [round(float(P2[0] / W), 6), round(float(P2[1] / H), 6)],
            "pos_px": [round(float(P2[0]), 2), round(float(P2[1]), 2)]}


def smooth_121(arr: np.ndarray) -> np.ndarray:
    sm = arr.copy()
    for i in range(1, len(arr) - 1):
        sm[i] = (arr[i - 1] + 2 * arr[i] + arr[i + 1]) / 4
    return sm


def box_offsets(ref_n: np.ndarray, mov_n: np.ndarray, boxes: Dict[str, Sequence[float]], ds: float,
                max_shift: float = 25.0) -> Dict[str, Dict[str, float]]:
    """Per-person offsets (top and bottom half separately): phase correlation inside normalised boxes."""
    H, W = ref_n.shape
    out = {}
    for name, (x0, x1, y0, y1) in boxes.items():
        ym = (y0 + y1) / 2
        for suffix, (ya, yb) in (("top", (y0, ym)), ("bot", (ym, y1))):
            X0, X1, Y0, Y1 = int(x0 * W), int(x1 * W), int(ya * H), int(yb * H)
            if X1 - X0 < 24 or Y1 - Y0 < 24:
                continue
            a = ref_n[Y0:Y1, X0:X1].astype(np.float32)
            c = mov_n[Y0:Y1, X0:X1].astype(np.float32)
            win = cv2.createHanningWindow((a.shape[1], a.shape[0]), cv2.CV_32F)
            (dx, dy), resp = cv2.phaseCorrelate(c, a, win)
            cs = cv2.warpAffine(c, np.float32([[1, 0, dx], [0, 1, dy]]), (c.shape[1], c.shape[0]))
            m = 8
            score = ncc(a[m:-m, m:-m], cs[m:-m, m:-m])
            ok = score > 0.35 and abs(dx) < max_shift and abs(dy) < max_shift
            out[f"{name}_{suffix}"] = {"dx": round(dx * ds, 1), "dy": round(dy * ds, 1), "ncc": round(score, 2),
                                       "ok": bool(ok), "cx": (X0 + X1) / 2, "cy": (Y0 + Y1) / 2}
    return out


def load_json(path: str):
    with open(path) as f:
        return json.load(f)


def save_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)


def parse_frames_arg(spec: Optional[str], n: int, every: Optional[int]) -> List[int]:
    if spec:
        out: List[int] = []
        for part in spec.split(","):
            if "-" in part:
                a, b = part.split("-")
                out += list(range(int(a), int(b) + 1))
            else:
                out.append(int(part))
        return [t for t in out if 0 <= t < n]
    step = every or 1
    return list(range(0, n, step))


def pct(v, q):
    return float(np.percentile(v, q)) if len(v) else float("nan")


# ----------------------------------------------------------------------------- frames

def cmd_frames(a: argparse.Namespace) -> None:
    os.makedirs(a.out, exist_ok=True)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if a.start is not None:
        cmd += ["-ss", str(a.start)]
    cmd += ["-i", a.video]
    if a.end is not None:
        cmd += ["-to", str(a.end - (a.start or 0))]
    vf = []
    if a.every and a.every > 1:
        vf.append(f"select=not(mod(n\\,{a.every}))")
        cmd += ["-vsync", "vfr"]
    if a.fps:
        vf.append(f"fps={a.fps}")
    if vf:
        cmd += ["-vf", ",".join(vf)]
    pix = "rgba64be" if a.bits == 16 else "rgba"
    if not a.alpha:
        pix = "rgb48be" if a.bits == 16 else "rgb24"
    cmd += ["-pix_fmt", pix, os.path.join(a.out, f"{a.prefix}%05d.png")]
    subprocess.run(cmd, check=True)
    n = len(glob.glob(os.path.join(a.out, f"{a.prefix}*.png")))
    print(json.dumps({"out": a.out, "frames": n, "cmd": " ".join(cmd)}))


# ----------------------------------------------------------------------------- coarse-fit

def global_shift(ref_g: np.ndarray, mov_g: np.ndarray) -> Tuple[float, float]:
    """Whole-frame translation (analysis px) that brings mov onto ref — for offsets too large for tiles."""
    a = norm(ref_g, 6)
    b = norm(mov_g, 6)
    win = cv2.createHanningWindow((a.shape[1], a.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(b.astype(np.float32), a.astype(np.float32), win)
    return float(dx), float(dy)


def fit_frame(ref: Layer, mov: Layer, t: int, m: int, geom: Optional[Dict[str, float]], T: int, step: int,
              max_shift: float, pre_shift: bool = False) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Tiles + fit5 between reference frame t and moving frame m (moving placed by geom first).

    pre_shift: measure the whole-frame translation first and fold it into the result, so that offsets
    larger than a tile (the generation placed by eye, a 4:3 generation in a wider frame) still fit.
    """
    rg, _, ra = ref.get(t)
    mg, _, ma = mov.get(m)
    if geom:
        mg = apply_delta(mg, geom, ref.ds)
        ma = apply_delta(ma, geom, ref.ds)
    s = (0.0, 0.0)
    if pre_shift:
        s = global_shift(rg, mg)
        if abs(s[0]) > 4 or abs(s[1]) > 4:
            d0 = {"scale_w": 100, "scale_h": 100, "rot": 0, "tx": s[0] * ref.ds, "ty": s[1] * ref.ds}
            mg = apply_delta(mg, d0, ref.ds)
            ma = apply_delta(ma, d0, ref.ds)
        else:
            s = (0.0, 0.0)
    valid = valid_mask([ra, ma])
    tt = tiles(norm(rg, 6), norm(mg, 6), valid, T=T, step=step, max_shift=max_shift)
    p, res = fit5(tt, ref.W, ref.H)
    if s != (0.0, 0.0) and len(tt) >= 6:
        ax, ay, th, tx, ty = p
        A = np.array([[1 + ax, -th], [th, 1 + ay]])
        tt_total = A @ np.array(s) + np.array([tx, ty])
        p = np.array([ax, ay, th, tt_total[0], tt_total[1]])
        tt = tt.copy()
        tt[:, 2] += s[0]
        tt[:, 3] += s[1]
    return tt, p, res


def cmd_coarse_fit(a: argparse.Namespace) -> None:
    seq = tuple(int(v) for v in a.seq_size.split(",")) if a.seq_size else None
    ref = Layer(a.ref, a.ds, Placement.parse(getattr(a, "ref_place", None), seq), seq=seq)
    mov = Layer(a.mov, a.ds, Placement.parse(a.mov_place, seq), seq=seq)
    n = min(len(ref), len(mov) - a.lag) if a.lag >= 0 else min(len(ref) + a.lag, len(mov))
    frames = parse_frames_arg(a.frames, n, None) if a.frames else [int(v) for v in np.linspace(0, n - 1, min(5, n))]
    rows = []
    for t in frames:
        m = t + a.lag
        if not (0 <= m < len(mov)):
            continue
        tt, p, res = fit_frame(ref, mov, t, m, None, a.tile, a.step, a.max_shift / a.ds, pre_shift=True)
        if len(tt) < 12:
            print(f"frame {t}: only {len(tt)} tiles, skipped", file=sys.stderr)
            continue
        d = params_to_delta(p, a.ds)
        d["resid_px"] = round(float(np.median(res)) * a.ds, 2)
        d["tiles"] = int(len(tt))
        d["t"] = t
        rows.append(d)
        print(json.dumps(d))
    if not rows:
        raise SystemExit("coarse-fit: no frame gave enough tiles — check placement, lag and that both layers show the same scene")
    # frames whose time is off fit badly: keep the frames within 1.5× the best residual (+0.5 px)
    best = min(r["resid_px"] for r in rows)
    good = [r for r in rows if r["resid_px"] <= 1.5 * best + 0.5]
    med = {k: round(float(np.median([r[k] for r in good])), 4) for k in ("scale_w", "scale_h", "rot", "tx", "ty", "resid_px")}
    med["frames_used"] = [r["t"] for r in good]
    if a.uniform:
        s = (med["scale_w"] + med["scale_h"]) / 2
        med["scale_w"] = med["scale_h"] = round(s, 4)
        med["rot"] = 0.0
    out = {"version": VERSION, "ds": a.ds, "lag": a.lag, "frames": [r["t"] for r in rows], "per_frame": rows, "delta": med,
           "search_ranges": {"scale_pct": [99, 102], "shift_px": 40, "rot_deg": 0.5, "aniso_pct": 0.3},
           "in_range": bool(99 <= med["scale_w"] <= 102 and 99 <= med["scale_h"] <= 102 and abs(med["tx"]) <= 40
                            and abs(med["ty"]) <= 40 and abs(med["rot"]) <= 0.5)}
    save_json(os.path.join(a.out, "coarse.json"), out)
    print(json.dumps({"coarse": out["delta"], "in_range": out["in_range"], "file": os.path.join(a.out, "coarse.json")}))


# ----------------------------------------------------------------------------- time-match

def dp_path(S: np.ndarray, pen: float) -> List[int]:
    """Lowest-cost path through the score matrix: |Δ offset| ≤ 1 per frame, `pen` per change."""
    n, k = S.shape
    cost = np.full((n, k), np.inf)
    back = np.zeros((n, k), int)
    cost[0] = -S[0]
    for t in range(1, n):
        for j in range(k):
            best = (np.inf, j)
            for i in (j - 1, j, j + 1):
                if 0 <= i < k:
                    c = cost[t - 1, i] + (pen if i != j else 0)
                    if c < best[0]:
                        best = (c, i)
            cost[t, j] = best[0] - S[t, j]
            back[t, j] = best[1]
    path = [int(np.argmin(cost[-1]))]
    for t in range(n - 1, 0, -1):
        path.append(int(back[t, path[-1]]))
    return path[::-1]


def frozen_tail(layer: Layer, thr: float, valid: np.ndarray) -> Dict[str, object]:
    """Longest suffix where consecutive frames are near-identical (the generator ran out of action).

    Frozen = the motion energy |frame i − frame i−1| drops below 20 % of the shot's median (or the
    neighbours are practically identical, similarity > 0.995). A mostly static set keeps the plain
    similarity high everywhere; the energy ratio is what separates a real freeze. `thr` is reported.
    """
    n = len(layer)
    sims, energy = [], []
    for i in range(1, n):
        g0, g1 = layer.gray(i - 1), layer.gray(i)
        a = norm(g0) * valid
        b = norm(g1) * valid
        sims.append(ncc(a, b))
        energy.append(float((np.abs(g1 - g0) * valid).sum() / (valid.sum() + 1e-6)))
    med_e = float(np.median(energy)) if energy else 0.0
    start = n
    for i in range(n - 1, 0, -1):
        if energy[i - 1] < 0.2 * med_e or sims[i - 1] > 0.995:
            start = i - 1
        else:
            break
    frozen = start < n - 1
    return {"from_frame": int(start) if frozen else None, "frames": int(n - start) if frozen else 0,
            "threshold": thr, "consecutive_similarity": [round(s, 3) for s in sims],
            "motion_energy": [round(e, 3) for e in energy], "median_energy": round(med_e, 3),
            "median_similarity": round(float(np.median(sims)), 3) if sims else None}


def runs_of_constant(lag: List[int]) -> List[Tuple[int, int, int]]:
    """(first_frame, last_frame, lag) for each maximal run of constant lag."""
    runs = []
    s = 0
    for t in range(1, len(lag) + 1):
        if t == len(lag) or lag[t] != lag[s]:
            runs.append((s, t - 1, lag[s]))
            s = t
    return runs


def coincidence_points(lag: List[int], min_run: int = 3) -> List[Dict[str, int]]:
    """A point per stable run (≥ min_run frames) at the run's middle, plus the first and last frame."""
    n = len(lag)
    pts: List[Dict[str, int]] = []
    runs = runs_of_constant(lag)
    for (s, e, l) in runs:
        if e - s + 1 >= min_run:
            mid = (s + e) // 2
            pts.append({"ref_frame": mid, "mov_frame": mid + l, "lag": l, "run": [s, e]})
    first = {"ref_frame": 0, "mov_frame": lag[0], "lag": lag[0], "run": list(runs[0][:2])}
    last = {"ref_frame": n - 1, "mov_frame": n - 1 + lag[-1], "lag": lag[-1], "run": list(runs[-1][:2])}
    if not pts or pts[0]["ref_frame"] != 0:
        pts.insert(0, first)
    # keep only points whose moving frame strictly increases (a repeated frame never becomes a key)
    kept = [pts[0]]
    for p in pts[1:]:
        if p["mov_frame"] > kept[-1]["mov_frame"] and p["ref_frame"] > kept[-1]["ref_frame"]:
            kept.append(p)
    if kept[-1]["ref_frame"] != n - 1:
        if last["mov_frame"] > kept[-1]["mov_frame"]:
            kept.append(last)
        elif len(kept) > 1 and last["mov_frame"] > kept[-2]["mov_frame"]:
            kept[-1] = last
    return kept


def cmd_time_match(a: argparse.Namespace) -> None:
    seq = tuple(int(v) for v in a.seq_size.split(",")) if a.seq_size else None
    ref = Layer(a.ref, a.ds, Placement.parse(getattr(a, "ref_place", None), seq), seq=seq)
    mov = Layer(a.mov, a.ds, Placement.parse(a.mov_place, seq), seq=seq)
    geom = load_json(a.geom)["delta"] if a.geom else None
    nt = len(ref) if a.count is None else min(a.count, len(ref))
    offs = list(range(a.lag_min, a.lag_max + 1))
    win = cv2.createHanningWindow((ref.W, ref.H), cv2.CV_32F)
    # moving frames placed by the coarse geometry, normalised once
    mov_n: Dict[int, np.ndarray] = {}
    mov_a: Dict[int, np.ndarray] = {}

    def movn(m: int) -> Tuple[np.ndarray, np.ndarray]:
        if m not in mov_n:
            g, _, al = mov.get(m)
            if geom:
                g = apply_delta(g, geom, a.ds)
                al = apply_delta(al, geom, a.ds)
            mov_n[m] = norm(g, a.sigma)
            mov_a[m] = al
        return mov_n[m], mov_a[m]

    base_valid = valid_mask([np.ones((ref.H, ref.W), np.float32)], erode=1)
    S = np.full((nt, len(offs)), -1.0)
    SH = np.zeros((nt, len(offs), 2))
    mw_cache: Dict[int, np.ndarray] = {}
    for t in range(nt):
        rg, _, ra = ref.get(t)
        rn = norm(rg, a.sigma)
        for j, o in enumerate(offs):
            m = t + o
            if not (0 <= m < len(mov)):
                continue
            mn, ma = movn(m)
            # motion weight from the moving layer around m (where the action is), masked by both alphas
            valid = base_valid * (ra > 0.98) * (ma > 0.98)
            if a.no_motion_weight:
                w = valid + 0.02
            else:
                if m not in mw_cache:
                    mw_cache[m] = motion_weight(mov, m, base_valid)
                w = mw_cache[m] * valid
            s, dx, dy = wncc(rn, mn, w, win, a.max_shift / a.ds)
            S[t, j] = s
            SH[t, j] = (dx * a.ds, dy * a.ds)
        if a.verbose:
            b = int(np.argmax(S[t]))
            print(f"t {t:3d} best {offs[b]:+d} {S[t, b]:.3f}", file=sys.stderr)
    path = dp_path(S, a.pen)
    lag = [offs[j] for j in path]
    free = [offs[int(np.argmax(S[t]))] for t in range(nt)]
    # confidence: margin between the chosen score and the best other offset
    margins = []
    for t in range(nt):
        row = S[t].copy()
        chosen = row[path[t]]
        row[path[t]] = -2
        margins.append(float(chosen - row.max()))
    valid_all = valid_mask([ref.alpha(0)])
    tail_ref = frozen_tail(ref, a.freeze_thr, valid_all) if nt > 3 else {}
    tail_mov = frozen_tail(mov, a.freeze_thr, valid_mask([mov.alpha(0)])) if len(mov) > 3 else {}
    # after the reference freezes, the lag path carries no information: points and gain stop there
    active = nt
    if tail_ref.get("from_frame") is not None and tail_ref["from_frame"] >= 2:
        active = tail_ref["from_frame"] + 1
    # when the moving frames end before the reference, the path is forced downhill at the end:
    # trust the lag only while the moving frame at the largest lag seen so far still exists
    warnings = []
    peak = max(lag[:active])
    trusted = len(mov) - peak  # ref frames 0..trusted-1 can reach mov frame t+peak
    if trusted < active:
        warnings.append(f"moving layer has {len(mov)} frames: the lag path after reference frame {trusted - 1} is forced by the "
                        f"missing frames — export at least {peak} more moving frames (or accept the plan up to frame {trusted - 1})")
        active = max(2, trusted)
    pts = coincidence_points(lag[:active], a.min_run)
    segments = []
    for p0, p1 in zip(pts, pts[1:]):
        dr = p1["ref_frame"] - p0["ref_frame"]
        dm = p1["mov_frame"] - p0["mov_frame"]
        segments.append({"ref_frames": [p0["ref_frame"], p1["ref_frame"]], "mov_frames": [p0["mov_frame"], p1["mov_frame"]],
                         "speed_pct": round(100 * dm / dr, 2) if dr else None})
    total_gain = lag[active - 1] - lag[0]
    hold = None
    if tail_ref.get("from_frame") is not None:
        f = tail_ref["from_frame"]
        hold = {"why": "the reference layer freezes from this frame while the moving layer keeps acting (Stage T6)",
                "ref_from_frame": f, "mov_frame_to_hold": f + lag[min(f, nt - 1)]}
    out = {"version": VERSION, "ds": a.ds, "ref_frames": nt, "mov_frames": len(mov), "offsets": offs, "pen": a.pen,
           "geom_used": geom, "lag": lag, "free_best": free, "margin": [round(m, 4) for m in margins],
           "score_chosen": [round(float(S[t, path[t]]), 4) for t in range(nt)],
           "shift_px_chosen": [[round(float(v), 1) for v in SH[t, path[t]]] for t in range(nt)],
           "runs": [{"frames": [s, e], "lag": l} for (s, e, l) in runs_of_constant(lag[:active])],
           "points": pts, "segments": segments,
           "active_frames": active,
           "summary": {"total_gain_frames": total_gain, "mean_speed_pct": round(100 * (1 + total_gain / max(1, active - 1)), 2),
                       "changes": sum(1 for i in range(1, active) if lag[i] != lag[i - 1]),
                       "disagree_with_free_best": sum(1 for i in range(active) if lag[i] != free[i]),
                       "low_margin_frames": [i for i in range(active) if margins[i] < a.min_margin],
                       "model_range_speed_pct": [100, 115],
                       "in_model_range": bool(100 <= 100 * (1 + total_gain / max(1, active - 1)) <= 115)},
           "frozen_tail_ref": tail_ref, "frozen_tail_mov": tail_mov, "hold": hold, "warnings": warnings}
    os.makedirs(a.out, exist_ok=True)
    np.save(os.path.join(a.out, "time_scores.npy"), S)
    save_json(os.path.join(a.out, "time.json"), out)
    print(json.dumps({"lag": lag, "points": [(p["ref_frame"], p["mov_frame"]) for p in pts], "segments": segments,
                      "summary": out["summary"], "hold": hold, "warnings": warnings, "file": os.path.join(a.out, "time.json")}))


# ----------------------------------------------------------------------------- time-plan

def frame_mapping(lag: List[int], retime_ref: bool, active: Optional[int] = None) -> List[Tuple[int, int]]:
    """Exact integer mapping for the retimed layer: (sequence frame index, source frame index), both
    relative to the exported range. `lag[t]` = moving frame − reference frame t. The sequence index is
    the frame index of the layer that keeps its own time. Collisions (a lag decrease) drop one source
    frame; gaps (a lag increase) leave a sequence frame to be filled by its neighbour."""
    n = len(lag) if active is None else min(active, len(lag))
    pairs: List[Tuple[int, int]] = []
    seen_seq, seen_src = set(), set()
    for t in range(n):
        seq, srcf = (t + lag[t], t) if retime_ref else (t, t + lag[t])
        if seq < 0 or srcf < 0 or seq in seen_seq or srcf in seen_src:
            continue
        seen_seq.add(seq); seen_src.add(srcf)
        pairs.append((seq, srcf))
    pairs.sort()
    return pairs


def step_keys(pairs: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Breakpoints of the piecewise-linear path through the integer mapping: a key wherever the slope
    (segment speed) changes, plus the first and the last point. Inside a constant-lag run the speed is
    100 %; a lag change costs one short segment (50 % over 2 frames, or 200 % over 1 frame)."""
    if len(pairs) < 2:
        return list(pairs)
    keys = [pairs[0]]
    for i in range(1, len(pairs) - 1):
        (q0, s0), (q1, s1), (q2, s2) = pairs[i - 1], pairs[i], pairs[i + 1]
        if (s1 - s0) * (q2 - q1) != (s2 - s1) * (q1 - q0):
            keys.append(pairs[i])
    keys.append(pairs[-1])
    return keys


def pieces_of(pairs: List[Tuple[int, int]]) -> List[Dict[str, object]]:
    """Runs of constant offset (source − sequence) → the cut-and-slip pieces; a gap in the sequence
    (lag increase on a slowed layer) is covered by extending the previous piece by one frame."""
    out: List[Dict[str, object]] = []
    for seq, srcf in pairs:
        o = srcf - seq
        if out and out[-1]["offset_frames"] == o:
            out[-1]["seq_frames"][1] = seq
        else:
            out.append({"offset_frames": o, "seq_frames": [seq, seq]})
    for k in range(len(out) - 1):
        nxt = out[k + 1]["seq_frames"][0]
        gap = nxt - out[k]["seq_frames"][1] - 1
        out[k]["repeat_frames"] = gap
        out[k]["seq_frames"][1] = nxt - 1
    if out:
        out[-1]["repeat_frames"] = 0
    return out


def cmd_time_plan(a: argparse.Namespace) -> None:
    tm = load_json(a.time)
    fps = a.fps
    lag = tm["lag"]
    pts = tm["points"]
    active = tm.get("active_frames") or len(lag)
    rs = a.range_start if a.range_start is not None else a.clip_start
    retime_ref = a.retime == "ref"
    first_src = a.clip_in + a.mov_first_frame / fps

    def seq_s(i: float) -> float:
        return round(rs + i / fps, 6)

    def src_s(i: float) -> float:
        return round(first_src + i / fps, 6)

    pairs = frame_mapping(lag, retime_ref, active)
    # route B keys. "step" (default): a key at every lag change — exact frames, speeds 100/50/200 %.
    # "ramp": a key per coincidence point with the averaged speed between them (kept for comparison;
    # it misplaces up to half the frames between two keys by one frame).
    if a.route == "ramp":
        remap = []
        for p in pts:
            seq_i, src_i = (p["mov_frame"], p["ref_frame"]) if retime_ref else (p["ref_frame"], p["mov_frame"])
            remap.append({"source_seconds": src_s(src_i), "sequence_seconds": seq_s(seq_i), "seq_frame": seq_i, "src_frame": src_i,
                          "ref_frame": p["ref_frame"], "mov_frame": p["mov_frame"]})
    else:
        remap = []
        for seq_i, src_i in step_keys(pairs):
            ref_i, mov_i = (src_i, seq_i) if retime_ref else (seq_i, src_i)
            remap.append({"source_seconds": src_s(src_i), "sequence_seconds": seq_s(seq_i), "seq_frame": seq_i, "src_frame": src_i,
                          "ref_frame": ref_i, "mov_frame": mov_i})
    # keep the host's constraints: both strictly increasing by ≥ 1 frame, speeds 10–1000 %
    kept = []
    for r in remap:
        if kept and (r["source_seconds"] - kept[-1]["source_seconds"] < 0.999 / fps
                     or r["sequence_seconds"] - kept[-1]["sequence_seconds"] < 0.999 / fps):
            continue
        kept.append(r)
    prev_src, prev_seq = first_src, a.clip_start
    for r in kept:
        ds_, dq = r["source_seconds"] - prev_src, r["sequence_seconds"] - prev_seq
        r["segment_speed_pct"] = round(100 * ds_ / dq, 2) if dq > 0 else None
        prev_src, prev_seq = r["source_seconds"], r["sequence_seconds"]
    # drop the first point when it is just «100 % from the clip start» (no key needed there)
    if kept and kept[0]["seq_frame"] == 0 and abs((kept[0]["segment_speed_pct"] or 100) - 100) < 1e-6 and len(kept) > 1:
        kept.pop(0)
        kept[0]["segment_speed_pct"] = round(100 * (kept[0]["source_seconds"] - first_src)
                                             / (kept[0]["sequence_seconds"] - a.clip_start), 2)
    speeds = [r["segment_speed_pct"] for r in kept if r["segment_speed_pct"] is not None]
    ok = all(10 <= s <= 1000 for s in speeds)
    # route A: cuts + slip per constant-offset piece of the retimed clip. slip_frames = source − sequence:
    # positive → the piece shows later media (in-point moves later by that many frames).
    cuts = []
    for pc in pieces_of(pairs):
        q0, q1 = pc["seq_frames"]
        cuts.append({"seq_frames": [q0, q1], "sequence_seconds": [seq_s(q0), seq_s(q1 + 1)],
                     "slip_frames": pc["offset_frames"], "slip_seconds": round(pc["offset_frames"] / fps, 6),
                     "repeat_frames": pc["repeat_frames"],
                     "ref_frames": [q0, q1] if not retime_ref else [q0 + pc["offset_frames"], q1 + pc["offset_frames"]]})
    # After Effects: Time Remap keyframes (comp time → source time) — the same step keys, incl. first/last
    ae = [{"time": r["sequence_seconds"], "value": r["source_seconds"]} for r in remap]
    hold = tm.get("hold")
    hold_plan = None
    trim = None
    if retime_ref and pairs:
        last_seq, last_src = pairs[-1]
        trim = {"why": "the reference layer's frozen tail is not needed: after its last matched frame the clip is cut",
                "sequence_seconds": seq_s(last_seq + 1), "last_source_frame": last_src,
                "premiere": "set the clip's out point / trim_clip_end at sequence_seconds (the moving layer keeps its length)"}
    elif hold:
        hold_plan = {"sequence_seconds_from": seq_s(hold["ref_from_frame"]),
                     "mov_frame": hold["mov_frame_to_hold"],
                     "source_seconds": src_s(hold["mov_frame_to_hold"]),
                     "premiere": "freeze_frame on the moving clip at that sequence time (or a last speed key to 0 % is not available — use freeze_frame)",
                     "after_effects": "Time Remap: hold keyframe at sequence_seconds_from with value source_seconds"}
    expected = [{"seq_frame": q, "src_frame": s} for q, s in pairs]
    out = {"version": VERSION, "fps": fps, "clip_start": a.clip_start, "clip_in": a.clip_in, "range_start": rs,
           "retime": a.retime, "route": a.route,
           "route_default": "cut_and_slip",
           "route_note": "Premiere: route A (cut_and_slip) is frame-exact; route B (time_remap_ui_points, step keys) is exact "
                         "inside runs and lands one frame per lag change on a half frame (the host picks a neighbour); "
                         "ramp keys (one per coincidence point) are not frame-exact — do not use them for sync",
           "remap_points": kept, "remap_speeds_ok": ok, "trim": trim,
           "time_remap_ui_points": [{"source_seconds": r["source_seconds"], "sequence_seconds": r["sequence_seconds"]} for r in kept],
           "cut_and_slip": cuts, "ae_time_remap_keys": ae, "hold": hold_plan,
           "expected_mapping": expected,
           "summary": tm.get("summary"),
           "table": [f"seq {r['seq_frame']:3d} → src {r['src_frame']:3d}  (ref {r['ref_frame']:3d} / mov {r['mov_frame']:3d})  "
                     f"seq {r['sequence_seconds']:.3f}s  src {r['source_seconds']:.3f}s  speed {r['segment_speed_pct']}" for r in kept],
           "cut_table": [f"piece {k}: seq {c['seq_frames'][0]:3d}–{c['seq_frames'][1]:3d}  {c['sequence_seconds'][0]:.3f}–{c['sequence_seconds'][1]:.3f}s  "
                         f"slip {c['slip_frames']:+d} fr" + (f"  (+{c['repeat_frames']} repeated)" if c["repeat_frames"] else "")
                         for k, c in enumerate(cuts)]}
    save_json(a.out, out)
    print(json.dumps({"route": a.route, "keys": len(kept), "speeds_pct": speeds, "speeds_ok": ok, "cuts": len(cuts),
                      "hold": hold_plan, "trim": trim and trim["sequence_seconds"], "file": a.out}))


# ----------------------------------------------------------------------------- global-fit

def pieces_from(a: argparse.Namespace, tm: Optional[dict], nt: int) -> List[Tuple[int, int]]:
    if a.pieces:
        out = []
        for part in a.pieces.split(","):
            s, e = part.split("-")
            out.append((int(s), int(e)))
        return out
    if tm:
        return [tuple(r["frames"]) for r in tm["runs"]]
    return [(0, nt - 1)]


def cmd_global_fit(a: argparse.Namespace) -> None:
    seq = tuple(int(v) for v in a.seq_size.split(",")) if a.seq_size else None
    ref = Layer(a.ref, a.ds, Placement.parse(getattr(a, "ref_place", None), seq), seq=seq)
    mov = Layer(a.mov, a.ds, Placement.parse(a.mov_place, seq), seq=seq)
    tm = load_json(a.time) if a.time else None
    lag = tm["lag"] if tm else [a.lag] * len(ref)
    nt = min(len(ref), len(lag))
    boxes = load_json(a.boxes) if a.boxes else None
    seq_wh = seq or (int(ref.W * a.ds), int(ref.H * a.ds))
    base = None
    if a.mov_motion:
        v = [float(x) for x in a.mov_motion.split(",")]
        base = {"scale_w": v[0], "scale_h": v[1] if len(v) > 1 else v[0], "pos": [v[2], v[3]] if len(v) > 3 else [0.5, 0.5],
                "rot": v[4] if len(v) > 4 else 0.0}
    start = load_json(a.geom)["delta"] if a.geom else None
    rows: Dict[int, dict] = {}
    for t in range(0, nt, a.step):
        m = t + lag[t]
        if not (0 <= m < len(mov)):
            continue
        tt, p, res = fit_frame(ref, mov, t, m, start, a.tile, a.step_px, a.max_shift / a.ds)
        if len(tt) < 12:
            print(f"frame {t}: only {len(tt)} tiles, skipped", file=sys.stderr)
            continue
        d = params_to_delta(p, a.ds)
        if start:
            d = compose_deltas(start, d)
        row = {"t": t, "mov_frame": m, "delta": d, "resid_px": round(float(np.median(res)) * a.ds, 2),
               "resid_p90_px": round(pct(res, 90) * a.ds, 2), "tiles": int(len(tt)),
               "raw_shift_px": [round(float(np.median(tt[:, 2])) * a.ds, 1), round(float(np.median(tt[:, 3])) * a.ds, 1)]}
        if boxes:
            rn = norm(ref.gray(t), 6)
            mg = mov.gray(m)
            before = box_offsets(rn, norm(apply_delta(mg, start, a.ds) if start else mg, 6), boxes, a.ds)
            after = box_offsets(rn, norm(apply_delta(mg, d, a.ds), 6), boxes, a.ds)
            row["boxes_before"] = {k: [v["dx"], v["dy"], v["ncc"]] for k, v in before.items()}
            row["boxes_after"] = {k: [v["dx"], v["dy"], v["ncc"]] for k, v in after.items()}
        rows[t] = row
        if a.verbose:
            print(json.dumps(row), file=sys.stderr)
    if not rows:
        raise SystemExit("global-fit: no frame gave enough tiles")
    pieces_out = []
    for (s, e) in pieces_from(a, tm, nt):
        ts = [t for t in sorted(rows) if s <= t <= e]
        if not ts:
            continue
        arr = np.array([delta_to_params(rows[t]["delta"], 1.0) for t in ts])  # full-px units
        sm = smooth_121(arr) if len(arr) >= 3 else arr
        rng = sm.max(0) - sm.min(0)
        # movement within the piece: scale %, rotation deg, translation px (relative to frame size)
        moves = {"scale_w_pct": round(100 * rng[0], 3), "scale_h_pct": round(100 * rng[1], 3), "rot_deg": round(math.degrees(rng[2]), 3),
                 "tx_pct_of_width": round(100 * rng[3] / seq_wh[0], 3), "ty_pct_of_height": round(100 * rng[4] / seq_wh[1], 3)}
        keys_needed = max(moves["scale_w_pct"], moves["scale_h_pct"], moves["tx_pct_of_width"], moves["ty_pct_of_height"]) > a.key_threshold \
            or moves["rot_deg"] > a.key_threshold
        med = np.median(sm, 0)
        const = {"scale_w": round(100 * (1 + med[0]), 4), "scale_h": round(100 * (1 + med[1]), 4), "rot": round(math.degrees(med[2]), 4),
                 "tx": round(float(med[3]), 2), "ty": round(float(med[4]), 2)}
        piece = {"frames": [s, e], "sampled": ts, "mode": "keys" if keys_needed else "constant", "movement": moves,
                 "delta": const, "resid_px_median": round(float(np.median([rows[t]["resid_px"] for t in ts])), 2),
                 "resid_px_p90": round(float(np.max([rows[t]["resid_p90_px"] for t in ts])), 2)}
        if base:
            piece["motion"] = compose_motion(base, const, seq_wh)
        if keys_needed:
            keys = []
            for i, t in enumerate(ts):
                dk = {"scale_w": round(100 * (1 + sm[i][0]), 4), "scale_h": round(100 * (1 + sm[i][1]), 4),
                      "rot": round(math.degrees(sm[i][2]), 4), "tx": round(float(sm[i][3]), 2), "ty": round(float(sm[i][4]), 2)}
                k = {"t": t, "delta": dk}
                if base:
                    k["motion"] = compose_motion(base, dk, seq_wh)
                keys.append(k)
            piece["keys"] = keys
        pieces_out.append(piece)
    # per-person summary (R10 check): residual after the fit per box over sampled frames
    person_check = None
    if boxes:
        agg: Dict[str, List[float]] = {}
        for r in rows.values():
            for k, v in r.get("boxes_after", {}).items():
                if v[2] > 0.35:
                    agg.setdefault(k, []).append(math.hypot(v[0], v[1]))
        person_check = {k: {"median_px": round(float(np.median(v)), 1), "p90_px": round(pct(v, 90), 1), "n": len(v)} for k, v in agg.items()}
        worst = max((v["median_px"] for v in person_check.values()), default=0)
        best = min((v["median_px"] for v in person_check.values()), default=0)
        person_check["_verdict"] = ("ok" if worst <= a.target_px else
                                    "R10: some people coincide and others do not — phase is right, width/position wrong; re-fit on the doubling people, do not accept the whole-frame number"
                                    if best <= a.target_px else "all people off — check time sync first (R9)")
    out = {"version": VERSION, "ds": a.ds, "seq_size": list(seq_wh), "base_motion": base, "key_threshold_pct": a.key_threshold,
           "pieces": pieces_out, "per_frame": [rows[t] for t in sorted(rows)], "person_check": person_check,
           "summary": {"resid_px_median": round(float(np.median([r["resid_px"] for r in rows.values()])), 2),
                       "resid_px_p90": round(pct([r["resid_px"] for r in rows.values()], 90), 2),
                       "pieces_with_keys": sum(1 for p in pieces_out if p["mode"] == "keys"), "pieces": len(pieces_out)}}
    os.makedirs(a.out, exist_ok=True)
    save_json(os.path.join(a.out, "geom.json"), out)
    print(json.dumps({"pieces": [{"frames": p["frames"], "mode": p["mode"], "delta": p["delta"], "resid": p["resid_px_median"]} for p in pieces_out],
                      "summary": out["summary"], "person_check": person_check, "file": os.path.join(a.out, "geom.json")}))


# ----------------------------------------------------------------------------- exposure

def agreement_mask(ref_rgb: np.ndarray, mov_rgb: np.ndarray, ref_a: np.ndarray, mov_a: np.ndarray, thr: float) -> np.ndarray:
    a = norm(255 * ref_rgb.mean(2), 3)
    b = norm(255 * mov_rgb.mean(2), 3)
    c = cv2.GaussianBlur(a * b, (0, 0), 6)
    m = (c > thr) & (ref_a > 0.99) & (mov_a > 0.99)
    m[:8] = m[-8:] = False
    m[:, :8] = m[:, -8:] = False
    return cv2.erode(m.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)


def levels_from_linear(a_: float, b_: float) -> Dict[str, float]:
    """Levels (input black/white, output black/white, 0..255, gamma 1) reproducing y = a·x + b."""
    y255 = 255 * a_ + b_
    in_b, out_b = (-b_ / a_, 0.0) if b_ < 0 else (0.0, b_)
    in_w, out_w = ((255 - b_) / a_, 255.0) if y255 > 255 else (255.0, y255)
    return {"input_black": round(in_b, 2), "input_white": round(in_w, 2), "output_black": round(out_b, 2),
            "output_white": round(out_w, 2), "gamma": 1.0}


def cmd_exposure(a: argparse.Namespace) -> None:
    seq = tuple(int(v) for v in a.seq_size.split(",")) if a.seq_size else None
    ref = Layer(a.ref, a.ds, Placement.parse(getattr(a, "ref_place", None), seq), seq=seq)
    mov = Layer(a.mov, a.ds, Placement.parse(a.mov_place, seq), seq=seq)
    tm = load_json(a.time) if a.time else None
    lag = tm["lag"] if tm else [a.lag] * len(ref)
    geom = load_json(a.geom) if a.geom else None
    nt = min(len(ref), len(lag))
    frames = parse_frames_arg(a.frames, nt, a.every)
    X, Y, F = [], [], []
    per_frame = {}
    for t in frames:
        m = t + lag[t]
        if not (0 <= m < len(mov)):
            continue
        _, rr, ra = ref.get(t)
        _, mr, ma = mov.get(m)
        if geom:
            d = piece_delta_at(geom, t)
            mr = apply_delta(mr, d, a.ds)
            ma = apply_delta(ma, d, a.ds)
        msk = agreement_mask(rr, mr, ra, ma, a.agree)
        n = int(msk.sum())
        per_frame[t] = {"pairs": n, "frac": round(float(msk.mean()), 4)}
        if n < a.min_pairs:
            per_frame[t]["skipped"] = "too few agreeing pixels"
            continue
        rb = cv2.GaussianBlur(rr, (0, 0), 1.5).reshape(-1, 3)
        mb = cv2.GaussianBlur(mr, (0, 0), 1.5).reshape(-1, 3)
        idx = np.flatnonzero(msk.ravel())
        rng = np.random.default_rng(t)
        idx = rng.choice(idx, min(len(idx), a.samples), replace=False)
        if a.apply_to == "ref":   # the reference layer gets the Levels: fit ref → mov
            rb, mb = mb, rb
        X.append(mb[idx] * 255)
        Y.append(rb[idx] * 255)
        F.append(np.full(len(idx), t))
    if not X:
        raise SystemExit("exposure: no frame with enough agreeing pixels — align geometry first, or lower --agree")
    X = np.concatenate(X)
    Y = np.concatenate(Y)
    F = np.concatenate(F)
    coefs = []
    for ch in range(3):
        P = np.stack([X[:, ch], np.ones(len(X))], 1)
        w = np.ones(len(X))
        cf = np.array([1.0, 0.0])
        for _ in range(6):
            cf = np.linalg.lstsq(P * w[:, None], Y[:, ch] * w, rcond=None)[0]
            r = np.abs(Y[:, ch] - P @ cf)
            s = np.median(r) * 1.5 + 1e-3
            w = 1 / np.maximum(1, r / s)
        coefs.append(cf)
    coefs = np.array(coefs)
    Yhat = np.clip(X * coefs[:, 0] + coefs[:, 1], 0, 255)
    e0 = np.median(np.abs(X - Y), 0)
    e1 = np.median(np.abs(Yhat - Y), 0)
    bias0 = (X - Y).mean(0)
    bias1 = (Yhat - Y).mean(0)
    flicker = {}
    for t in frames:
        s = F == t
        if s.any():
            flicker[t] = {"bias_before": [round(float(v), 2) for v in (X[s] - Y[s]).mean(0)],
                          "bias_after": [round(float(v), 2) for v in (Yhat[s] - Y[s]).mean(0)]}
    channels = ["R", "G", "B"]
    levels = {channels[i]: levels_from_linear(float(coefs[i, 0]), float(coefs[i, 1])) for i in range(3)}
    # a single RGB Levels when the channels agree within 1 level (simpler to type, one container)
    same = all(abs(coefs[i, 0] - coefs[0, 0]) < 0.004 and abs(coefs[i, 1] - coefs[0, 1]) < 1 for i in range(3))
    out = {"version": VERSION, "apply_to": a.apply_to,
           "direction": "moving layer → reference (apply on the moving clip)" if a.apply_to == "mov" else "reference → moving layer (apply on the reference clip)",
           "linear": {channels[i]: {"gain": round(float(coefs[i, 0]), 5), "offset": round(float(coefs[i, 1]), 3)} for i in range(3)},
           "levels_per_channel": levels, "levels_rgb_single": levels_from_linear(float(coefs[:, 0].mean()), float(coefs[:, 1].mean())) if same else None,
           "pairs_total": int(len(X)), "frames": {int(k): v for k, v in per_frame.items()},
           "error_8bit": {"median_abs_before": [round(float(v), 2) for v in e0], "median_abs_after": [round(float(v), 2) for v in e1],
                          "bias_before": [round(float(v), 2) for v in bias0], "bias_after": [round(float(v), 2) for v in bias1]},
           "flicker_per_frame": flicker,
           "accept": bool(np.all(np.abs(bias1) <= 1.0) and np.all(e1 <= max(2.0, e0.min())))}
    save_json(a.out, out)
    print(json.dumps({"linear": out["linear"], "levels": levels, "error": out["error_8bit"], "accept": out["accept"], "file": a.out}))


def piece_delta_at(geom: dict, t: int) -> Dict[str, float]:
    """Delta for frame t from geom.json: the piece's constant, or linear interpolation between keys."""
    for p in geom["pieces"]:
        s, e = p["frames"]
        if s <= t <= e:
            if p["mode"] == "constant" or "keys" not in p:
                return p["delta"]
            keys = p["keys"]
            if t <= keys[0]["t"]:
                return keys[0]["delta"]
            if t >= keys[-1]["t"]:
                return keys[-1]["delta"]
            for k0, k1 in zip(keys, keys[1:]):
                if k0["t"] <= t <= k1["t"]:
                    f = (t - k0["t"]) / max(1, k1["t"] - k0["t"])
                    return {k: k0["delta"][k] + f * (k1["delta"][k] - k0["delta"][k]) for k in k0["delta"]}
    # outside every piece: nearest piece's constant
    nearest = min(geom["pieces"], key=lambda p: min(abs(t - p["frames"][0]), abs(t - p["frames"][1])))
    if nearest.get("keys"):
        return nearest["keys"][0]["delta"] if t < nearest["frames"][0] else nearest["keys"][-1]["delta"]
    return nearest["delta"]


def apply_levels(rgb01: np.ndarray, lv: dict) -> np.ndarray:
    out = rgb01.copy()
    for i, ch in enumerate(("R", "G", "B")):
        L = lv["levels_per_channel"][ch]
        x = rgb01[..., i] * 255
        y = (np.clip((x - L["input_black"]) / max(1e-6, L["input_white"] - L["input_black"]), 0, 1) ** (1 / L.get("gamma", 1.0))) \
            * (L["output_white"] - L["output_black"]) + L["output_black"]
        out[..., i] = np.clip(y / 255, 0, 1)
    return out


# ----------------------------------------------------------------------------- verify

def cmd_verify(a: argparse.Namespace) -> None:
    seq = tuple(int(v) for v in a.seq_size.split(",")) if a.seq_size else None
    ref = Layer(a.ref, a.ds, Placement.parse(getattr(a, "ref_place", None), seq), seq=seq)
    mov = Layer(a.mov, a.ds, Placement.parse(a.mov_place, seq), seq=seq)
    tm = load_json(a.time) if a.time else None
    lag = tm["lag"] if tm else [a.lag] * len(ref)
    geom = load_json(a.geom) if a.geom else None
    boxes = load_json(a.boxes) if a.boxes else None
    nt = min(len(ref), len(lag))
    frames = parse_frames_arg(a.frames, nt, a.every)
    win = cv2.createHanningWindow((ref.W, ref.H), cv2.CV_32F)
    rows = []
    for t in frames:
        m = t + lag[t]
        if not (0 <= m < len(mov)):
            continue
        rg, rr, ra = ref.get(t)
        rn = norm(rg, 6)
        row: Dict[str, object] = {"t": t, "mov_frame": m}

        def placed(mi: int):
            g, rgb, al = mov.get(mi)
            if geom:
                d = piece_delta_at(geom, t)
                g, rgb, al = apply_delta(g, d, a.ds), apply_delta(rgb, d, a.ds), apply_delta(al, d, a.ds)
            return g, rgb, al

        mg, mr, ma = placed(m)
        valid = valid_mask([ra, ma])
        # geometry: remaining local displacement
        tt = tiles(rn, norm(mg, 6), valid, max_shift=a.max_shift / a.ds)
        if len(tt):
            disp = np.hypot(tt[:, 2], tt[:, 3]) * a.ds
            row["geom"] = {"tiles": int(len(tt)), "median_px": round(float(np.median(disp)), 2), "p90_px": round(pct(disp, 90), 2),
                           "mean_vector_px": [round(float(np.median(tt[:, 2])) * a.ds, 2), round(float(np.median(tt[:, 3])) * a.ds, 2)]}
        if boxes:
            row["boxes"] = {k: [v["dx"], v["dy"], v["ncc"]] for k, v in box_offsets(rn, norm(mg, 6), boxes, a.ds).items()}
        # time: does the chosen moving frame beat its neighbours ±2 (T8)?
        if a.time or a.check_time:
            w = motion_weight(mov, m, valid)
            sc = {}
            for dlt in (-2, -1, 0, 1, 2):
                k = m + dlt
                if 0 <= k < len(mov):
                    sc[dlt] = round(wncc(norm(rg, 3), norm(placed(k)[0], 3), w, win, a.max_shift / a.ds)[0], 4)
            best = max(sc, key=lambda d: sc[d])
            tie = abs(sc[best] - sc[0]) <= 0.001
            row["time"] = {"scores": sc, "best_delta": best, "wins": bool(best == 0 or tie), "tie": bool(tie and best != 0)}
        # colour on agreeing pixels
        msk = agreement_mask(rr, mr, ra, ma, a.agree)
        if msk.sum() >= 500:
            d = (mr[msk] - rr[msk]) * 255
            row["colour"] = {"pairs": int(msk.sum()), "bias_rgb": [round(float(v), 2) for v in d.mean(0)],
                             "median_abs_rgb": [round(float(v), 2) for v in np.median(np.abs(d), 0)]}
        rows.append(row)
        if a.verbose:
            print(json.dumps(row), file=sys.stderr)
    geom_med = [r["geom"]["median_px"] for r in rows if "geom" in r]
    time_rows = [r for r in rows if "time" in r]
    col = [r["colour"]["bias_rgb"] for r in rows if "colour" in r]
    summary = {"frames": len(rows),
               "geom_median_px": round(float(np.median(geom_med)), 2) if geom_med else None,
               "geom_p90_px": round(pct(geom_med, 90), 2) if geom_med else None,
               "geom_worst_frame": int(rows[int(np.argmax(geom_med))]["t"]) if geom_med else None,
               "time_frames_won": sum(1 for r in time_rows if r["time"]["wins"]), "time_frames_checked": len(time_rows),
               "time_lost_frames": [r["t"] for r in time_rows if not r["time"]["wins"]],
               "colour_bias_rgb_mean": [round(float(v), 2) for v in np.mean(col, 0)] if col else None}
    if boxes:
        agg: Dict[str, List[float]] = {}
        for r in rows:
            for k, v in r.get("boxes", {}).items():
                if v[2] > 0.35:
                    agg.setdefault(k, []).append(math.hypot(v[0], v[1]))
        summary["boxes"] = {k: {"median_px": round(float(np.median(v)), 1), "p90_px": round(pct(v, 90), 1)} for k, v in agg.items()}
    out = {"version": VERSION, "ds": a.ds, "summary": summary, "frames": rows,
           "accept": {"geometry": bool(summary["geom_p90_px"] is not None and summary["geom_p90_px"] <= a.target_px),
                      "time": bool(summary["time_frames_checked"] and not summary["time_lost_frames"]),
                      "colour": bool(col and np.all(np.abs(np.mean(col, 0)) <= 1.0))}}
    save_json(a.report, out)
    print(json.dumps({"summary": summary, "accept": out["accept"], "file": a.report}))


# ----------------------------------------------------------------------------- render

def cmd_render(a: argparse.Namespace) -> None:
    files = list_frames(a.mov)
    geom = load_json(a.geom) if a.geom else None
    tm = load_json(a.time) if a.time else None
    lv = load_json(a.levels) if a.levels else None
    nt = a.count or (len(tm["lag"]) if tm else len(files))
    os.makedirs(a.out, exist_ok=True)
    written = 0
    edges = []
    for t in range(nt):
        m = t + (tm["lag"][t] if tm else 0)
        if tm and tm.get("hold") and tm["hold"]["ref_from_frame"] is not None and t >= tm["hold"]["ref_from_frame"]:
            m = tm["hold"]["mov_frame_to_hold"]
        m = min(max(m, 0), len(files) - 1)
        im = cv2.imread(files[m], cv2.IMREAD_UNCHANGED)
        if im.ndim == 2:
            im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
        if im.shape[2] == 3:
            im = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)
            im[..., 3] = 65535 if im.dtype == np.uint16 else 255
        H, W = im.shape[:2]
        if geom:
            d = piece_delta_at(geom, t)
            im = cv2.warpAffine(im, delta_matrix(d, W, H, 1.0), (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        if lv:
            maxv = 65535.0 if im.dtype == np.uint16 else 255.0
            rgb = im[..., :3][..., ::-1].astype(np.float32) / maxv
            rgb = apply_levels(rgb, lv)
            im[..., :3] = (rgb[..., ::-1] * maxv).round().astype(im.dtype)
        alpha = im[..., 3]
        cols = np.where(alpha.max(0) > 0)[0]
        rws = np.where(alpha.max(1) > 0)[0]
        if len(cols) and (cols[0] > 0 or cols[-1] < W - 1 or rws[0] > 0 or rws[-1] < H - 1):
            edges.append({"t": t, "transparent_px": [int(cols[0]), int(W - 1 - cols[-1]), int(rws[0]), int(H - 1 - rws[-1])]})
        cv2.imwrite(os.path.join(a.out, f"{a.prefix}{t:05d}.png"), im)
        written += 1
    info = {"frames": written, "out": a.out, "transparent_edges_lrtb": edges[:10], "frames_with_transparent_edges": len(edges)}
    if a.encode:
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(a.fps), "-i", os.path.join(a.out, f"{a.prefix}%05d.png"),
               "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", a.encode]
        subprocess.run(cmd, check=True)
        info["encoded"] = a.encode
    print(json.dumps(info))


# ----------------------------------------------------------------------------- mask-measure

def read_alpha(path: str) -> np.ndarray:
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot read {path}")
    maxv = 65535.0 if im.dtype == np.uint16 else 255.0
    if im.ndim == 3 and im.shape[2] == 4:
        return im[..., 3].astype(np.float32) / maxv
    if im.ndim == 3:
        return im[..., 0].astype(np.float32) / maxv
    return im.astype(np.float32) / maxv


def contour_distances(m0: np.ndarray, m: np.ndarray) -> np.ndarray:
    """Signed distance (px) from the 50 % contour of m to the 50 % contour of m0; positive = inside m0."""
    inside = cv2.distanceTransform((m0 > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    outside = cv2.distanceTransform((m0 <= 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    # pixel-count distances → edge distances: the 50 % edge of m0 lies half a pixel outside its last
    # pixel, and the contour pixel of m is half a pixel inside its own edge
    sd = inside - outside - 1.0
    cont, _ = cv2.findContours((m > 0.5).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    pts = np.concatenate([c.reshape(-1, 2) for c in cont]) if cont else np.zeros((0, 2), int)
    if not len(pts):
        return np.zeros(0)
    return sd[pts[:, 1], pts[:, 0]]


def cmd_mask_measure(a: argparse.Namespace) -> None:
    m0 = read_alpha(a.mask0) if a.mask0 else None
    m = read_alpha(a.mask)
    rep: Dict[str, object] = {"version": VERSION, "area_pct": round(100 * float((m > 0.5).mean()), 3)}
    soft = (m > 0.1) & (m < 0.9)
    cont, _ = cv2.findContours((m > 0.5).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    perim = sum(len(c) for c in cont)
    rep["transition_px"] = round(float(soft.sum()) / max(1, perim), 2)
    n, _, st, _ = cv2.connectedComponentsWithStats((m > 0.5).astype(np.uint8), 8)
    rep["regions_gt2000px"] = int(sum(1 for i in range(1, n) if st[i, 4] > 2000))
    if m0 is not None:
        d = contour_distances(m0, m)
        rep["inset_px"] = {"median": round(float(np.median(d)), 2), "p10": round(pct(d, 10), 2), "p90": round(pct(d, 90), 2)} if len(d) else None
        d98 = contour_distances(m0, (m >= 0.98).astype(np.float32))
        rep["opaque_from_px"] = round(float(np.median(d98)), 2) if len(d98) else None
        rep["area_change_pct"] = round(100 * float((m > 0.5).mean() - (m0 > 0.5).mean()), 3)
    if a.mask_prev:
        mp = read_alpha(a.mask_prev)
        d = contour_distances(mp, m)
        rep["jitter_vs_prev_px"] = {"median_abs": round(float(np.median(np.abs(d))), 2), "std": round(float(np.std(d)), 2)} if len(d) else None
        drop = (mp > 0.5).mean() - (m > 0.5).mean()
        rep["area_drop_vs_prev_pct"] = round(100 * float(drop), 2)
        rep["lost_subject"] = bool(drop > 0.3 * max(1e-6, (mp > 0.5).mean()))
    save_json(a.report, rep)
    print(json.dumps(rep))


# ----------------------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    P = argparse.ArgumentParser(prog="conform.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    P.add_argument("--version", action="version", version=VERSION)
    sub = P.add_subparsers(dest="cmd", required=True)

    def common(p, mov=True):
        p.add_argument("--ref", required=True, help="folder of reference-layer frames (sequence coordinates)")
        if mov:
            p.add_argument("--mov", required=True, help="folder of moving-layer frames")
            p.add_argument("--mov-place", help="placement of raw moving media in the sequence: 'scale=161;pos=0.503,0.540;rot=0' (omit for timeline exports)")
        p.add_argument("--ref-place", help="same for raw reference media")
        p.add_argument("--seq-size", help="sequence W,H in px when the frames are raw media (default: frame size)")
        p.add_argument("--ds", type=float, default=4, help="analysis downscale (default 4)")
        p.add_argument("--max-shift", type=float, default=48, help="largest translation to consider, full px (default 48)")
        p.add_argument("--verbose", action="store_true")

    p = sub.add_parser("frames", help="ffmpeg → PNG frames")
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--start", type=float)
    p.add_argument("--end", type=float)
    p.add_argument("--every", type=int)
    p.add_argument("--fps", type=float)
    p.add_argument("--bits", type=int, choices=(8, 16), default=8)
    p.add_argument("--alpha", action="store_true", help="keep alpha (rgba / rgba64be)")
    p.add_argument("--prefix", default="f_")
    p.set_defaults(func=cmd_frames)

    p = sub.add_parser("coarse-fit", help="uniform scale + shift on a few frames (Stage T2 / G0)")
    common(p)
    p.add_argument("--out", required=True)
    p.add_argument("--frames", help="frames to use, e.g. 0,10,20 or 0-5 (default 5 spread frames)")
    p.add_argument("--lag", type=int, default=0, help="moving frame = ref frame + lag while measuring")
    p.add_argument("--tile", type=int, default=48)
    p.add_argument("--step", type=int, default=32)
    p.add_argument("--uniform", action="store_true", help="force uniform scale, no rotation")
    p.set_defaults(func=cmd_coarse_fit)

    p = sub.add_parser("time-match", help="which moving frame matches each reference frame (Stage T3–T6)")
    common(p)
    p.add_argument("--out", required=True)
    p.add_argument("--geom", help="coarse.json from coarse-fit (recommended: a 1.4 %% scale error cost 1–2 frames)")
    p.add_argument("--lag-min", type=int, default=-6)
    p.add_argument("--lag-max", type=int, default=12)
    p.add_argument("--count", type=int, help="reference frames to match (default all)")
    p.add_argument("--pen", type=float, default=0.008, help="DP penalty per lag change (default 0.008)")
    p.add_argument("--sigma", type=float, default=3.0, help="high-pass sigma of the normalisation")
    p.add_argument("--min-run", type=int, default=3, help="frames a lag must hold to give a coincidence point")
    p.add_argument("--min-margin", type=float, default=0.01)
    p.add_argument("--freeze-thr", type=float, default=0.95)
    p.add_argument("--no-motion-weight", action="store_true")
    p.set_defaults(func=cmd_time_match)

    p = sub.add_parser("time-plan", help="speed keyframes / cuts from time.json (Stage T7)")
    p.add_argument("--time", required=True)
    p.add_argument("--fps", type=float, required=True)
    p.add_argument("--clip-start", type=float, required=True, help="sequence time (s) where the moving clip starts")
    p.add_argument("--clip-in", type=float, default=0.0, help="media time (s) of the moving clip's first frame")
    p.add_argument("--range-start", type=float, help="sequence time (s) of reference frame 0 (default clip-start)")
    p.add_argument("--mov-first-frame", type=int, default=0, help="media frame index of moving frame 0 relative to clip-in")
    p.add_argument("--route", choices=("step", "ramp"), default="step",
                   help="speed keys: step (default — a key at every lag change, frame-exact 100/50/200 %%) or ramp (one key per coincidence point, averaged speeds; not frame-exact)")
    p.add_argument("--retime", choices=("mov", "ref"), default="mov",
                   help="which clip gets the speed keys: mov (default — the moving layer follows the reference) or ref (the reference layer, e.g. the generation, is slowed onto the plate's time; clip-start/clip-in then describe that clip, the frozen tail is trimmed)")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_time_plan)

    p = sub.add_parser("global-fit", help="affine per frame → Motion constants or keys per piece (Stage G0)")
    common(p)
    p.add_argument("--out", required=True)
    p.add_argument("--time", help="time.json (moving frame = t + lag[t]; pieces = constant-lag runs)")
    p.add_argument("--geom", help="coarse.json: starting placement of the moving layer (needed when the offset exceeds a tile); the result includes it")
    p.add_argument("--lag", type=int, default=0)
    p.add_argument("--pieces", help="explicit pieces a-b,c-d (default from time.json or the whole range)")
    p.add_argument("--step", type=int, default=1, help="sample every step-th frame")
    p.add_argument("--tile", type=int, default=48)
    p.add_argument("--step-px", type=int, default=32)
    p.add_argument("--mov-motion", help="current Motion of the moving clip 'scale_w,scale_h,pos_x,pos_y[,rot]' to compose absolute values")
    p.add_argument("--boxes", help="json {name:[x0,x1,y0,y1]} normalised person boxes for the per-person check (R10)")
    p.add_argument("--key-threshold", type=float, default=0.2, help="movement (%% / deg) within a piece above which keys are written")
    p.add_argument("--target-px", type=float, default=2.0)
    p.set_defaults(func=cmd_global_fit)

    p = sub.add_parser("exposure", help="per-channel Levels of the moving layer towards the reference (Stage E)")
    common(p)
    p.add_argument("--out", required=True)
    p.add_argument("--time")
    p.add_argument("--lag", type=int, default=0)
    p.add_argument("--geom", help="geom.json to place the moving frames before measuring")
    p.add_argument("--frames")
    p.add_argument("--every", type=int, default=3)
    p.add_argument("--agree", type=float, default=0.55)
    p.add_argument("--min-pairs", type=int, default=3000)
    p.add_argument("--samples", type=int, default=25000)
    p.add_argument("--apply-to", choices=("mov", "ref"), default="mov", help="which clip gets the Levels (the lower one in a background replacement)")
    p.set_defaults(func=cmd_exposure)

    p = sub.add_parser("verify", help="time / geometry / colour residuals on the real result")
    common(p)
    p.add_argument("--report", required=True)
    p.add_argument("--time")
    p.add_argument("--lag", type=int, default=0)
    p.add_argument("--geom")
    p.add_argument("--boxes")
    p.add_argument("--frames")
    p.add_argument("--every", type=int, default=1)
    p.add_argument("--agree", type=float, default=0.55)
    p.add_argument("--target-px", type=float, default=2.0)
    p.add_argument("--check-time", action="store_true")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("render", help="retimed + warped (+ Levels) frames of the moving layer, optional ProRes 4444")
    p.add_argument("--mov", required=True, help="full-resolution moving frames in sequence coordinates")
    p.add_argument("--out", required=True)
    p.add_argument("--geom")
    p.add_argument("--time")
    p.add_argument("--levels")
    p.add_argument("--count", type=int)
    p.add_argument("--encode", help="output .mov (ProRes 4444 with alpha)")
    p.add_argument("--fps", type=float, default=24)
    p.add_argument("--prefix", default="c_")
    p.set_defaults(func=cmd_render)

    p = sub.add_parser("mask-measure", help="inset / transition / jitter of an exported mask alpha")
    p.add_argument("--mask", required=True)
    p.add_argument("--mask0", help="the same mask exported at expansion 0 / feather 0")
    p.add_argument("--mask-prev", help="the mask on the previous frame (jitter, lost subject)")
    p.add_argument("--report", required=True)
    p.set_defaults(func=cmd_mask_measure)
    return P


def main(argv: Optional[Sequence[str]] = None) -> None:
    a = build_parser().parse_args(argv)
    a.func(a)


if __name__ == "__main__":
    main()
