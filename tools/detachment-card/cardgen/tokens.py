"""Round state and tracker tokens, in the grunge style.

Each token has a front (name, icon, short effect) and a back (the rule text),
drawn as a circle with a riveted metal ring around a parchment face. Like the
cards, all text is fitted to its box, and the build fails if it doesn't fit.

The circle drawn is the token itself, at full size: glue the printed front and
back onto card stock and cut round them. hardware/token_disc.scad is an
optional 3D-printed disc with a pocket that fits these prints.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

from . import text as tx
from . import textures as tex
from .scene import Circle, Poly, Rect, Scene, Stroke, Text
from .styles.grunge import BODY, BODY_LEADING, C, DISPLAY, LABEL, _bitmap, chamfer

# Printed token diameter, mm.
SIZES = {"large": 40.0, "small": 32.0, "marker": 25.0}
RINGS = {
    "army": (240, 196, 28),
    "kult": (158, 31, 23),
    "bully": (226, 221, 208),
    "wreckas": (28, 58, 112),
    "enemy": None,  # hazard stripes: the token goes on an enemy unit
}
SIDES = ("front", "back")
MIN_TEXT = 1.3  # mm; tokens are read close up, so they allow slightly smaller text than the cards


class TokenError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    id: str
    size: str
    ring: str
    count: int
    icon: str
    title: str
    effect: tuple
    back_title: str
    back: tuple
    source: str
    keywords: tuple = field(default=())

    @property
    def sticker_d(self):
        return SIZES[self.size]


def load(path) -> list[Token]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    kws = tuple(data.get("keywords", []))
    out, seen = [], set()
    for i, t in enumerate(data["tokens"]):
        where = f"$.tokens[{i}]"
        for key in ("id", "size", "ring", "count", "icon", "front", "back"):
            if key not in t:
                raise TokenError(f"{where}.{key}: required field is missing")
        if t["id"] in seen:
            raise TokenError(f"{where}.id: duplicate id {t['id']!r}")
        seen.add(t["id"])
        if t["size"] not in SIZES:
            raise TokenError(f"{where}.size: must be one of {tuple(SIZES)}")
        if t["ring"] not in RINGS:
            raise TokenError(f"{where}.ring: must be one of {tuple(RINGS)}")
        if t["icon"] not in ICONS:
            raise TokenError(f"{where}.icon: unknown icon {t['icon']!r}; known: {sorted(ICONS)}")
        if not isinstance(t["count"], int) or t["count"] < 1:
            raise TokenError(f"{where}.count: must be a positive integer")
        out.append(
            Token(
                t["id"], t["size"], t["ring"], t["count"], t["icon"],
                t["front"]["title"], tuple(t["front"]["effect"]),
                t["back"]["title"], tuple(t["back"]["paragraphs"]),
                t.get("source", ""), kws,
            )
        )
    return out


# ---- geometry ------------------------------------------------------------------


def circle_pts(cx, cy, r, n=180):
    return tuple((cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n))


def chord(r, dy):
    """Width of the circle of radius r at distance dy from its centre."""
    return 2 * math.sqrt(max(r * r - dy * dy, 0.0))


# ---- icons ---------------------------------------------------------------------
# Each icon draws into a box of side s centred on (cx, cy), on the graphics layer.

INK = C["ink"]
BONE = "#efe6cf"
BRASS = "#c9962e"
RED = "#a3170f"
YELLOW = "#f0c419"


def _poly(sc, pts, fill, stroke=INK, sw=0.3):
    sc.add("graphics", Poly(tuple(pts), fill=fill, stroke=stroke, sw=sw))


def _scaled(cx, cy, s, pts):
    return [(cx + (x - 0.5) * s, cy + (y - 0.5) * s) for x, y in pts]


def icon_burst(sc, cx, cy, s, label="!"):
    n, ro, ri = 14, s * 0.5, s * 0.33
    pts = [(cx + (ro if i % 2 == 0 else ri) * math.cos(math.pi * i / n - math.pi / 2),
            cy + (ro if i % 2 == 0 else ri) * math.sin(math.pi * i / n - math.pi / 2)) for i in range(2 * n)]
    _poly(sc, pts, YELLOW)
    _poly(sc, [(x + (cx - x) * 0.25, y + (cy - y) * 0.25) for x, y in pts], RED, stroke="none")
    line = tx.plain(label)
    size = tx.fit_line(line, s * 0.5, s * 0.42, 1.0, "icon", DISPLAY)
    sc.add("graphics", Text(cx, cy + tx.cap_height(DISPLAY["regular"]) * size / 2, line, size, BONE, "middle", "", face=DISPLAY))


def icon_burst2(sc, cx, cy, s):
    icon_burst(sc, cx, cy, s, "!!")


def icon_chevrons(sc, cx, cy, s):
    for k in range(3):
        x0 = cx - s * 0.45 + k * s * 0.3
        pts = [(x0, cy - s * 0.35), (x0 + s * 0.18, cy - s * 0.35), (x0 + s * 0.4, cy), (x0 + s * 0.18, cy + s * 0.35),
               (x0, cy + s * 0.35), (x0 + s * 0.22, cy)]
        _poly(sc, pts, RED if k == 2 else YELLOW)


def icon_bolt(sc, cx, cy, s):
    for k in range(3):
        y = cy - s * 0.2 + k * s * 0.2
        sc.add("graphics", Stroke(cx - s * 0.5, y, cx - s * 0.18, y, INK, 0.35))
    pts = ((0.62, 0.0), (0.2, 0.56), (0.45, 0.56), (0.28, 1.0), (0.85, 0.4), (0.6, 0.4), (0.8, 0.0))
    _poly(sc, _scaled(cx + s * 0.08, cy, s, pts), YELLOW)


def icon_die(sc, cx, cy, s):
    h = s * 0.8
    sc.add("graphics", Rect(cx - h / 2, cy - h / 2, h, h, BONE, INK, 0.35, rx=h * 0.15))
    for px, py in ((0.25, 0.25), (0.5, 0.5), (0.75, 0.75)):
        sc.add("graphics", Circle(cx - h / 2 + px * h, cy - h / 2 + py * h, h * 0.08, INK))
    sc.add("graphics", Stroke(cx - s * 0.5, cy + s * 0.45, cx + s * 0.5, cy - s * 0.45, RED, s * 0.09, 0.9))


def icon_crate(sc, cx, cy, s):
    h = s * 0.78
    x0, y0 = cx - h / 2, cy - h / 2
    sc.add("graphics", Rect(x0, y0, h, h, "#8a5a2b", INK, 0.35))
    sc.add("graphics", Rect(x0 + h * 0.08, y0 + h * 0.08, h * 0.84, h * 0.84, "none", "#5e3b1a", h * 0.05))
    sc.add("graphics", Stroke(x0 + h * 0.1, y0 + h * 0.1, x0 + h * 0.9, y0 + h * 0.9, "#5e3b1a", h * 0.1))
    sc.add("graphics", Stroke(x0 + h * 0.9, y0 + h * 0.1, x0 + h * 0.1, y0 + h * 0.9, "#5e3b1a", h * 0.1))
    # chain and hook above
    sc.add("graphics", Stroke(cx, y0 - s * 0.12, cx, y0, INK, 0.3))


def icon_shield(sc, cx, cy, s):
    pts = ((0.1, 0.05), (0.9, 0.05), (0.9, 0.5), (0.5, 0.98), (0.1, 0.5))
    _poly(sc, _scaled(cx, cy, s, pts), "#3a3a3a")
    _poly(sc, _scaled(cx, cy, s * 0.72, pts), BONE, stroke="none")
    # flattened bullet
    bx, by = cx, cy - s * 0.05
    _poly(sc, [(bx - s * 0.2, by), (bx - s * 0.05, by - s * 0.07), (bx + s * 0.05, by - s * 0.07), (bx + s * 0.2, by),
               (bx + s * 0.05, by + s * 0.07), (bx - s * 0.05, by + s * 0.07)], BRASS)


def icon_skull(sc, cx, cy, s):
    r = s * 0.36
    sc.add("graphics", Circle(cx, cy - s * 0.08, r, BONE, INK, 0.35))
    jaw = (cx - r * 0.62, cy + r * 0.35, r * 1.24, r * 0.75)
    sc.add("graphics", Rect(*jaw, BONE, INK, 0.35, rx=r * 0.15))
    sc.add("graphics", Rect(cx - r * 0.55, cy + r * 0.2, r * 1.1, r * 0.3, BONE))
    for dx in (-0.4, 0.4):
        sc.add("graphics", Circle(cx + dx * r, cy - s * 0.06, r * 0.27, INK))
    _poly(sc, [(cx, cy + r * 0.1), (cx - r * 0.12, cy + r * 0.32), (cx + r * 0.12, cy + r * 0.32)], INK, stroke="none")
    for k in range(1, 4):
        x = jaw[0] + jaw[2] * k / 4
        sc.add("graphics", Stroke(x, jaw[1] + jaw[3] * 0.25, x, jaw[1] + jaw[3], INK, 0.25))


def icon_crosshair(sc, cx, cy, s):
    r = s * 0.42
    sc.add("graphics", Circle(cx, cy, r, "none", RED, s * 0.08))
    sc.add("graphics", Circle(cx, cy, r * 0.4, "none", RED, s * 0.06))
    for a in range(4):
        ang = a * math.pi / 2
        sc.add("graphics", Stroke(cx + math.cos(ang) * r * 0.55, cy + math.sin(ang) * r * 0.55,
                                  cx + math.cos(ang) * r * 1.2, cy + math.sin(ang) * r * 1.2, INK, s * 0.07))
    sc.add("graphics", Poly(((cx - r * 0.2, cy - r * 0.9), (cx, cy - r * 0.3), (cx - r * 0.15, cy + r * 0.1), (cx + r * 0.1, cy + r * 0.8)),
                            stroke=INK, sw=s * 0.04, closed=False))


def icon_squig(sc, cx, cy, s):
    r = s * 0.42
    sc.add("graphics", Circle(cx, cy, r, "#c0392b", INK, 0.35))
    for dx in (-0.35, 0.35):
        sc.add("graphics", Circle(cx + dx * r, cy - r * 0.4, r * 0.2, YELLOW, INK, 0.2))
        sc.add("graphics", Circle(cx + dx * r, cy - r * 0.4, r * 0.08, INK))
    mouth = [(cx - r * 0.7, cy + r * 0.05)]
    for k in range(9):
        mouth.append((cx - r * 0.7 + r * 1.4 * (k + 0.5) / 9, cy + (r * 0.3 if k % 2 == 0 else r * 0.05)))
    mouth += [(cx + r * 0.7, cy + r * 0.05), (cx + r * 0.5, cy + r * 0.6), (cx - r * 0.5, cy + r * 0.6)]
    _poly(sc, mouth, BONE, sw=0.25)


def icon_arrow_down(sc, cx, cy, s):
    pts = ((0.35, 0.0), (0.65, 0.0), (0.65, 0.5), (0.88, 0.5), (0.5, 0.98), (0.12, 0.5), (0.35, 0.5))
    _poly(sc, _scaled(cx, cy, s * 0.95, pts), YELLOW)


def icon_flag(sc, cx, cy, s):
    px = cx - s * 0.3
    sc.add("graphics", Rect(px, cy - s * 0.48, s * 0.06, s * 0.88, "#5e3b1a", INK, 0.2))
    fx, fy, fw, fh = px + s * 0.06, cy - s * 0.46, s * 0.6, s * 0.4
    sc.add("graphics", Rect(fx, fy, fw, fh, BONE, INK, 0.3))
    n = 4
    for i in range(n):
        for j in range(3):
            if (i + j) % 2 == 0:
                sc.add("graphics", Rect(fx + fw * i / n, fy + fh * j / 3, fw / n, fh / 3, INK))
    _poly(sc, [(cx - s * 0.48, cy + s * 0.48), (cx + s * 0.4, cy + s * 0.48), (cx + s * 0.3, cy + s * 0.36), (cx - s * 0.38, cy + s * 0.36)], "#7a7468")


def icon_bullet(sc, cx, cy, s, n=1):
    for k in range(n):
        x = cx + (k - (n - 1) / 2) * s * 0.34
        w, h = s * 0.26, s * 0.85
        sc.add("graphics", Rect(x - w / 2, cy - h * 0.15, w, h * 0.62, BRASS, INK, 0.3))
        _poly(sc, [(x - w / 2, cy - h * 0.15), (x - w / 2 + w * 0.15, cy - h * 0.42), (x, cy - h * 0.5),
                   (x + w / 2 - w * 0.15, cy - h * 0.42), (x + w / 2, cy - h * 0.15)], "#9a9a9a")
        sc.add("graphics", Rect(x - w / 2, cy + h * 0.38, w, h * 0.08, "#8a6a20", INK, 0.2))


def icon_bullet2(sc, cx, cy, s):
    icon_bullet(sc, cx, cy, s, 2)


def icon_bomb(sc, cx, cy, s):
    r = s * 0.36
    sc.add("graphics", Circle(cx - s * 0.05, cy + s * 0.1, r, "#2b2b2b", INK, 0.3))
    sc.add("graphics", Circle(cx - s * 0.17, cy - s * 0.02, r * 0.18, "#6b6b6b"))
    sc.add("graphics", Poly(((cx + r * 0.5, cy - r * 0.55), (cx + s * 0.25, cy - s * 0.35), (cx + s * 0.35, cy - s * 0.42)),
                            stroke="#8a5a2b", sw=s * 0.05, closed=False))
    icon_spark(sc, cx + s * 0.38, cy - s * 0.42, s * 0.22)


def icon_spark(sc, cx, cy, r):
    pts = [(cx + (r if i % 2 == 0 else r * 0.4) * math.cos(math.pi * i / 5), cy + (r if i % 2 == 0 else r * 0.4) * math.sin(math.pi * i / 5)) for i in range(10)]
    _poly(sc, pts, YELLOW, stroke=RED, sw=0.15)


def icon_rocket(sc, cx, cy, s):
    body = ((0.5, 0.0), (0.64, 0.18), (0.64, 0.7), (0.36, 0.7), (0.36, 0.18))
    _poly(sc, _scaled(cx, cy, s, body), "#8a8a8a")
    _poly(sc, _scaled(cx, cy, s, ((0.36, 0.45), (0.22, 0.72), (0.36, 0.7))), RED)
    _poly(sc, _scaled(cx, cy, s, ((0.64, 0.45), (0.78, 0.72), (0.64, 0.7))), RED)
    _poly(sc, _scaled(cx, cy, s, ((0.4, 0.72), (0.6, 0.72), (0.5, 1.0))), YELLOW, stroke=RED)
    sc.add("graphics", Circle(cx, cy - s * 0.18, s * 0.06, "#5aa0d8", INK, 0.2))


def icon_cross(sc, cx, cy, s):
    sc.add("graphics", Circle(cx, cy, s * 0.46, BONE, INK, 0.35))
    a, b = s * 0.12, s * 0.33
    _poly(sc, [(cx - a, cy - b), (cx + a, cy - b), (cx + a, cy - a), (cx + b, cy - a), (cx + b, cy + a), (cx + a, cy + a),
               (cx + a, cy + b), (cx - a, cy + b), (cx - a, cy + a), (cx - b, cy + a), (cx - b, cy - a), (cx - a, cy - a)], RED)


ICONS = {
    "burst": icon_burst, "burst2": icon_burst2, "chevrons": icon_chevrons, "bolt": icon_bolt, "die": icon_die,
    "crate": icon_crate, "shield": icon_shield, "skull": icon_skull, "crosshair": icon_crosshair, "squig": icon_squig,
    "arrow-down": icon_arrow_down, "flag": icon_flag, "bullet": icon_bullet, "bullet2": icon_bullet2, "bomb": icon_bomb,
    "rocket": icon_rocket, "cross": icon_cross,
}


# ---- layout --------------------------------------------------------------------


def _seed(t, key):
    return tex.seed_of("token", t.id, key)


def build(t: Token, side: str, bleed: float = 0.0) -> Scene:
    """One face of a token. The scene is the sticker plus `bleed` mm all round;
    the cut line is the circle of the sticker's diameter, on the guides layer."""
    R = t.sticker_d / 2
    W = 2 * (R + bleed)
    c = R + bleed
    sc = Scene(W, W)
    ring_w = max(1.6, 0.12 * R)
    band_w = max(0.7, 0.05 * R)
    face_r = R - ring_w - band_w

    # Metal ring (extended into the bleed) and the coloured band inside it, on the background layer.
    outer = circle_pts(c, c, R + bleed)
    sc.add("background", _bitmap(f"token/{t.id}/{side}/{bleed}/ring", 0, 0, W, W, [outer],
                                 lambda wp, hp, s=_seed(t, "ring"): tex.metal(wp, hp, s), holes=[circle_pts(c, c, R - ring_w)]))
    band_outer, band_inner = circle_pts(c, c, R - ring_w), circle_pts(c, c, face_r)
    colour = RINGS[t.ring]
    gen = (lambda wp, hp, s=_seed(t, "band"): tex.hazard(wp, hp, s, wp / W * 1.6)) if colour is None else \
          (lambda wp, hp, s=_seed(t, "band"), col=colour: tex.painted(wp, hp, s, col, 0.08))
    sc.add("background", _bitmap(f"token/{t.id}/{side}/{bleed}/band", 0, 0, W, W, [band_outer], gen, holes=[band_inner]))
    sc.add("background", _bitmap(f"token/{t.id}/{side}/{bleed}/face", c - face_r, c - face_r, 2 * face_r, 2 * face_r,
                                 [circle_pts(c, c, face_r)], lambda wp, hp, s=_seed(t, "face"): tex.parchment(wp, hp, s)))
    sc.add("borders", Circle(c, c, face_r, "none", INK, 0.35))
    sc.add("borders", Circle(c, c, R - ring_w, "none", INK, 0.3))
    n_rivets = 8 if t.size != "marker" else 6
    for i in range(n_rivets):
        a = 2 * math.pi * (i + 0.5) / n_rivets
        rr = R - ring_w / 2
        x, y = c + rr * math.cos(a), c + rr * math.sin(a)
        r = min(0.45, ring_w * 0.22)
        sc.add("borders", Circle(x, y, r, "#1d1916"), Circle(x, y, r * 0.74, "#7b7264"), Circle(x - r * 0.22, y - r * 0.22, r * 0.26, "#d6cdb9"))
    # Cut line, on the hidden guides layer.
    sc.add("guides", Circle(c, c, R, "none", C["guide"], 0.15))

    (_front if side == "front" else _back)(sc, t, c, face_r)
    return sc


def _banner(sc, t, side, c, y, h, w, text_, block, face=DISPLAY):
    x = c - w / 2
    col = (240, 196, 28) if t.ring in ("army", "enemy", "kult") else ((226, 221, 208) if t.ring == "bully" else (240, 196, 28))
    seed = _seed(t, f"{side}-banner")
    pts = chamfer(x, y, w, h, h * 0.25)
    sc.add("borders", _bitmap(f"token/{t.id}/{side}/{c}/banner", x, y, w, h, [pts], lambda wp, hp: tex.painted(wp, hp, seed, col, 0.06)))
    sc.add("borders", Poly(pts, stroke=INK, sw=0.3))
    line = tx.plain(text_)
    size = tx.fit_line(line, w - h * 0.6, h * 0.66, 1.2, f"{t.id}.{block}", face)
    sc.add("text", Text(c, y + h / 2 + tx.cap_height(face["regular"]) * size / 2, line, size, INK, "middle", block, face=face))
    sc.fits[block] = size


def _front(sc, t, c, r):
    # Title banner across the upper part of the face. It is wider than the face, like a nameplate.
    bh = r * 0.36
    by = c - r * 0.62
    _banner(sc, t, "front", c, by, bh, min(2 * r * 1.04, chord(r, r * 0.62) + r * 0.5), t.title, "title")
    # Icon in the middle.
    s = r * 0.62
    ICONS[t.icon](sc, c, c + r * 0.02, s)
    # Effect text below, centred, within the face's width at its lowest line.
    top, bottom = c + r * 0.38, c + r * 0.92
    paras = [tx.tokenize(e, t.keywords) for e in t.effect]
    face = {"regular": "barlow-label", "bold": "barlow-label", "ability": "barlow-label"}
    fit = fit_in_circle(paras, c, r, top, bottom, r * 0.2, MIN_TEXT, face, 1.05, f"{t.id}.effect")
    y = top + tx.ascent(face["regular"]) * fit.size
    for line in fit.lines:
        sc.add("text", Text(c, y, line, fit.size, INK, "middle", "effect", face=face, colors={"ability": RED}))
        y += fit.size * 1.05
    sc.fits["effect"] = fit.size


def _shaped_wrap(paras, size, face, leading, c, r, top, pad):
    """Greedy word wrap where each line may be as wide as the circle at that line's
    height (the narrower of its top and bottom edges). Returns lines and widths,
    or None if a word doesn't fit."""
    asc, desc = tx.ascent(face["regular"]) * size, tx.descent(face["regular"]) * size
    lines, widths = [], []

    def width_at(i):
        base = top + asc + i * size * leading
        return min(chord(r, base - asc - c), chord(r, base + desc - c)) - 2 * pad

    for words in paras:
        cur = []
        for word in words:
            w = width_at(len(lines))
            if tx.line_width(tx._join(cur + [word]), size, face) <= w:
                cur.append(word)
                continue
            if cur:
                lines.append(tx._join(cur))
                widths.append(w)
                cur = []
            # A word too long for this (narrow) line: leave the line blank and try the next one.
            while tx.line_width(word, size, face) > width_at(len(lines)):
                if width_at(len(lines)) >= 2 * r - 2 * pad - 1e-6 or len(lines) > 60:
                    return None
                lines.append([])
            cur = [word]
        if cur:
            lines.append(tx._join(cur))
    return lines


def fit_in_circle(paras, c, r, top, bottom, max_size, min_size, face, leading, what, pad=0.4):
    """Largest size at which the paragraphs, wrapped to the circle's shape, fit between top and bottom."""
    for size in tx.size_steps(max_size, min_size):
        lines = _shaped_wrap(paras, size, face, leading, c, r, top, pad)
        if lines is not None and tx.block_height(len(lines), size, face, leading) <= bottom - top:
            return tx.Fit(size, lines)
    raise tx.LayoutError(f"{what}: does not fit the token even at {min_size} mm. Shorten the text.")


def _back(sc, t, c, r):
    bh = r * 0.28
    by = c - r * 0.78
    _banner(sc, t, "back", c, by, bh, chord(r, r * 0.5) * 0.98, t.back_title, "back_title", LABEL)
    top, bottom = by + bh + r * 0.05, c + r * 0.93
    paras = [tx.tokenize(p, t.keywords) for p in t.back]
    fit = fit_in_circle(paras, c, r, top, bottom, r * 0.16, MIN_TEXT, BODY, BODY_LEADING, f"{t.id}.back")
    # Lines are wrapped for their position from the top, so the block starts at the top (no vertical centring).
    y = top + tx.ascent(BODY["regular"]) * fit.size
    for line in fit.lines:
        sc.add("text", Text(c, y, line, fit.size, INK, "middle", "back", face=BODY, colors={"ability": RED}))
        y += fit.size * BODY_LEADING
    sc.fits["back"] = fit.size
