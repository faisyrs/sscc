"""Procedural, seeded raster textures: worn metal, parchment, chipped paint
and hazard stripes. Every function takes a seed and returns the same pixels
for the same arguments on every run.
"""
from __future__ import annotations

import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def seed_of(*parts) -> int:
    return zlib.crc32(":".join(str(p) for p in parts).encode())


def _noise(w, h, cell, rng) -> np.ndarray:
    """Smooth value noise in [0, 1] with features about `cell` pixels across."""
    gw, gh = max(2, int(w / cell) + 2), max(2, int(h / cell) + 2)
    grid = (rng.random((gh, gw)) * 255).astype(np.uint8)
    im = Image.fromarray(grid, "L").resize((w, h), Image.Resampling.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def fbm(w, h, rng, cells=(160, 60, 20, 6), weights=(0.45, 0.3, 0.17, 0.08)) -> np.ndarray:
    out = np.zeros((h, w), np.float32)
    for c, wt in zip(cells, weights):
        out += _noise(w, h, c, rng) * wt
    return out / sum(weights)


def _edge_falloff(w, h, px) -> np.ndarray:
    """0 at the edge rising to 1 at `px` pixels in."""
    y = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None]
    x = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :]
    d = np.minimum(x, y).astype(np.float32)
    return np.clip(d / max(px, 1), 0, 1)


def _rgb(arr) -> Image.Image:
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def _scratches(im: Image.Image, rng, n, colors, max_len, width=1):
    d = ImageDraw.Draw(im)
    w, h = im.size
    for _ in range(n):
        x, y = rng.random() * w, rng.random() * h
        ang = rng.normal(0, 0.5) + (rng.random() < 0.5) * np.pi / 2 * rng.random()
        ln = rng.random() * max_len
        c = colors[int(rng.random() * len(colors))]
        d.line([(x, y), (x + np.cos(ang) * ln, y + np.sin(ang) * ln)], fill=c, width=width)


def metal(w, h, seed, base=(86, 80, 72)) -> Image.Image:
    """Dark worn plate: mottled steel with rust patches, scratches and dark edges."""
    rng = np.random.default_rng(seed)
    n = fbm(w, h, rng)
    arr = np.stack([n] * 3, -1) * 70 - 35 + np.array(base, np.float32)
    rust = np.clip((fbm(w, h, rng, (90, 30, 10), (0.5, 0.35, 0.15)) - 0.58) * 4, 0, 1)[..., None]
    arr = arr * (1 - rust * 0.8) + np.array([118, 62, 28], np.float32) * rust * 0.8
    grain = rng.normal(0, 7, (h, w, 1)).astype(np.float32)
    arr += grain
    im = _rgb(arr)
    _scratches(im, rng, int(w * h / 900), [(150, 142, 128), (40, 36, 32), (120, 112, 100)], max(w, h) / 25)
    im = im.filter(ImageFilter.GaussianBlur(0.4))
    arr = np.asarray(im, np.float32) * (0.55 + 0.45 * _edge_falloff(w, h, min(w, h) * 0.08)[..., None])
    return _rgb(arr)


def parchment(w, h, seed) -> Image.Image:
    """Stained cream paper with burnt edges."""
    rng = np.random.default_rng(seed)
    n = fbm(w, h, rng, (220, 80, 25, 6), (0.4, 0.3, 0.2, 0.1))
    base = np.array([236, 224, 196], np.float32)
    arr = base * (0.86 + 0.2 * n[..., None])
    stains = np.clip((fbm(w, h, rng, (120, 40), (0.7, 0.3)) - 0.6) * 3, 0, 1)[..., None]
    arr = arr * (1 - stains * 0.22) + np.array([150, 112, 60], np.float32) * stains * 0.22
    edge = _edge_falloff(w, h, min(w, h) * 0.18)
    burn = (1 - edge) ** 2 * (0.6 + 0.4 * _noise(w, h, 30, rng))
    arr = arr * (1 - burn[..., None] * 0.55) + np.array([96, 62, 30], np.float32) * burn[..., None] * 0.55
    arr += rng.normal(0, 5, (h, w, 1)).astype(np.float32)
    return _rgb(arr)


def painted(w, h, seed, color, chip=0.12) -> Image.Image:
    """A painted plate with chips worn through to metal and some grime."""
    rng = np.random.default_rng(seed)
    paint = np.array(color, np.float32) * (0.82 + 0.3 * fbm(w, h, rng, (80, 25, 8), (0.5, 0.3, 0.2)))[..., None]
    steel = np.asarray(metal(w, h, seed + 1, (120, 112, 100)), np.float32)
    worn = fbm(w, h, rng, (40, 12, 4), (0.5, 0.3, 0.2))
    edge = _edge_falloff(w, h, min(w, h) * 0.35)
    chips = np.clip((worn - (1 - chip) + (1 - edge) * chip * 1.6) * 12, 0, 1)[..., None]
    arr = paint * (1 - chips) + steel * chips
    arr *= 0.72 + 0.28 * edge[..., None]
    arr += rng.normal(0, 6, (h, w, 1)).astype(np.float32)
    im = _rgb(arr)
    _scratches(im, rng, int(w * h / 2500), [tuple(int(c * 0.55) for c in color), (200, 190, 170)], max(w, h) / 30)
    return im


def hazard(w, h, seed, px_pitch, colors=((236, 190, 28), (24, 22, 20))) -> Image.Image:
    """Diagonal hazard stripes with worn paint."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    band = (((xx + yy) / px_pitch) % 1.0) < 0.5
    arr = np.where(band[..., None], np.array(colors[0], np.float32), np.array(colors[1], np.float32))
    arr *= (0.8 + 0.3 * fbm(w, h, rng, (60, 18, 5), (0.5, 0.3, 0.2)))[..., None]
    steel = np.asarray(metal(w, h, seed + 7), np.float32)
    worn = np.clip((fbm(w, h, rng, (30, 9, 3), (0.5, 0.3, 0.2)) - 0.68) * 10, 0, 1)[..., None]
    arr = arr * (1 - worn) + steel * worn
    return _rgb(arr)


def masked(im: Image.Image, polys_px, ss=4, holes_px=()) -> Image.Image:
    """Give im an antialiased alpha mask made of the given polygons (pixel
    coordinates), with the holes_px polygons cut out."""
    w, h = im.size
    mask = Image.new("L", (w * ss, h * ss), 0)
    d = ImageDraw.Draw(mask)
    for poly in polys_px:
        d.polygon([(x * ss, y * ss) for x, y in poly], fill=255)
    for poly in holes_px:
        d.polygon([(x * ss, y * ss) for x, y in poly], fill=0)
    out = im.convert("RGBA")
    out.putalpha(mask.resize((w, h), Image.Resampling.LANCZOS))
    return out


def fire(w, h, seed) -> Image.Image:
    """Flames: noise mapped through a dark red, orange and yellow gradient, with soot."""
    rng = np.random.default_rng(seed)
    n = fbm(w, h, rng, (40, 14, 5), (0.5, 0.3, 0.2))
    n = np.clip((n - n.min()) / max(np.ptp(n), 1e-6), 0, 1)
    stops = np.array([[40, 8, 4], [150, 25, 8], [235, 100, 15], [255, 200, 40], [255, 245, 170]], np.float32)
    pos = n * (len(stops) - 1)
    i = np.clip(pos.astype(int), 0, len(stops) - 2)
    f = (pos - i)[..., None]
    arr = stops[i] * (1 - f) + stops[i + 1] * f
    soot = np.clip((fbm(w, h, rng, (25, 8), (0.6, 0.4)) - 0.62) * 5, 0, 1)[..., None]
    arr = arr * (1 - soot * 0.7)
    return _rgb(arr)
