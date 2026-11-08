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

from . import artfit
from . import text as tx
from . import textures as tex
from .scene import ArcText, Circle, Picture, Poly, Rect, Scene, Stroke, Text
from .styles.grunge import BODY, BODY_LEADING, C, DISPLAY, LABEL, _bitmap, chamfer

# Printed token diameter, mm.
SIZES = {"large": 40.0, "small": 32.0, "marker": 25.0}
# The coloured band shows whose turn the effect is triggered in, using the
# stratagem ribbon colours on the cards. The words on the band say the same thing,
# so the meaning doesn't rely on colour alone.
TURNS = {"your": "YOUR TURN", "opponent": "ENEMY TURN", "either": "ANY TURN"}
# Brighter, more saturated versions of the card ribbon colours, for the thin turn stripe.
STRIPE = {"your": (16, 108, 240), "opponent": (228, 28, 28), "either": (22, 178, 60)}
# The outer border shows what the effect does.
THEMES = ("defensive", "offensive", "misc")  # armour plates, flames, gear teeth
SIDES = ("front", "back")
MIN_TEXT = 1.3  # mm; tokens are read close up, so they allow slightly smaller text than the cards


class TokenError(ValueError):
    pass


@dataclass(frozen=True)
class Token:
    id: str
    size: str
    turn: str
    theme: str
    count: int
    icon: str
    title: str
    effect: tuple
    back_title: str
    back: tuple
    source: str
    keywords: tuple = field(default=())
    via: str = ""  # front: the name of the ability that gave this state
    art: object = None  # front: optional illustration (model.Art) shown in place of the vector icon

    @property
    def sticker_d(self):
        return SIZES[self.size]


def _art(file, where, base):
    from .model import SourceError
    from .model import _art as model_art

    try:
        return model_art({"file": file}, where, base)
    except SourceError as e:
        raise TokenError(str(e)) from e


def load(path) -> list[Token]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    kws = tuple(data.get("keywords", []))
    out, seen = [], set()
    for i, t in enumerate(data["tokens"]):
        where = f"$.tokens[{i}]"
        for key in ("id", "size", "turn", "theme", "count", "icon", "front", "back"):
            if key not in t:
                raise TokenError(f"{where}.{key}: required field is missing")
        if t["id"] in seen:
            raise TokenError(f"{where}.id: duplicate id {t['id']!r}")
        seen.add(t["id"])
        if t["size"] not in SIZES:
            raise TokenError(f"{where}.size: must be one of {tuple(SIZES)}")
        if t["turn"] not in TURNS:
            raise TokenError(f"{where}.turn: must be one of {tuple(TURNS)}")
        if t["theme"] not in THEMES:
            raise TokenError(f"{where}.theme: must be one of {THEMES}")
        if t["icon"] not in ICONS:
            raise TokenError(f"{where}.icon: unknown icon {t['icon']!r}; known: {sorted(ICONS)}")
        if not isinstance(t["count"], int) or t["count"] < 1:
            raise TokenError(f"{where}.count: must be a positive integer")
        out.append(
            Token(
                t["id"], t["size"], t["turn"], t["theme"], t["count"], t["icon"],
                t["front"]["title"], tuple(t["front"]["effect"]),
                t["back"]["title"], tuple(t["back"]["paragraphs"]),
                t.get("source", ""), kws, t["front"].get("via", ""),
                _art(t["front"]["art"], f"{where}.front.art", Path(path).resolve().parent) if "art" in t["front"] else None,
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


@dataclass(frozen=True)
class Rings:
    c: float  # centre
    R: float  # token radius (the cut line)
    border_in: float  # inner radius of the themed border
    face: float  # radius of the parchment face (inner edge of the turn band)

    @property
    def band_mid(self):
        return (self.border_in + self.face) / 2

    @property
    def band_w(self):
        return self.border_in - self.face


def rings(t: Token, bleed: float) -> Rings:
    R = t.sticker_d / 2
    border = max(1.3, 0.09 * R)
    band = max(0.9, 0.06 * R)  # a thin stripe in the turn colour, with no text
    return Rings(R + bleed, R, R - border, R - border - band)


def _border(sc, t, side, g: Rings, bleed):
    """The outermost ring, extended into the bleed, themed by what the effect does."""
    c, W = g.c, sc.width
    outer, hole = circle_pts(c, c, g.R + bleed), circle_pts(c, c, g.border_in)
    key = f"token/{t.id}/{side}/{bleed}/border"
    if t.theme == "offensive":
        sc.add("background", _bitmap(key, 0, 0, W, W, [outer], lambda wp, hp, s=_seed(t, "fire"): tex.fire(wp, hp, s), holes=[hole]))
        # Flame tongues licking inward over the edge of the band.
        n = 22 if t.size != "marker" else 16
        for i in range(n):
            a0 = 2 * math.pi * i / n
            a1 = a0 + 2 * math.pi / n
            am = (a0 + a1) / 2
            tip = g.border_in - g.band_w * (0.18 if i % 2 else 0.1)
            pts = ((c + g.border_in * math.sin(a0), c - g.border_in * math.cos(a0)),
                   (c + tip * math.sin(am), c - tip * math.cos(am)),
                   (c + g.border_in * math.sin(a1), c - g.border_in * math.cos(a1)))
            sc.add("borders", Poly(pts, fill="#f0a020" if i % 2 else "#d0461a"))
    elif t.theme == "defensive":
        sc.add("background", _bitmap(key, 0, 0, W, W, [outer], lambda wp, hp, s=_seed(t, "armour"): tex.metal(wp, hp, s, (150, 146, 136)), holes=[hole]))
        n = 8
        for i in range(n):  # seams between armour plates, each plate riveted at both ends
            a = 2 * math.pi * i / n
            sc.add("borders", Stroke(c + g.border_in * math.sin(a), c - g.border_in * math.cos(a),
                                     c + (g.R + bleed) * math.sin(a), c - (g.R + bleed) * math.cos(a), INK, 0.3))
            for da in (0.12, 2 * math.pi / n - 0.12):
                rr = (g.R + g.border_in) / 2
                x, y = c + rr * math.sin(a + da), c - rr * math.cos(a + da)
                r = min(0.4, (g.R - g.border_in) * 0.24)
                sc.add("borders", Circle(x, y, r, "#1d1916"), Circle(x, y, r * 0.74, "#8b8274"), Circle(x - r * 0.2, y - r * 0.2, r * 0.26, "#e2d9c4"))
    else:
        sc.add("background", _bitmap(key, 0, 0, W, W, [outer], lambda wp, hp, s=_seed(t, "gear"): tex.metal(wp, hp, s, (70, 66, 60)), holes=[hole]))
        n = 18 if t.size != "marker" else 14
        r0, r1 = g.border_in + (g.R - g.border_in) * 0.15, g.R + bleed
        for i in range(n):  # gear teeth
            a = 2 * math.pi * i / n
            w0, w1 = math.pi / n * 0.62, math.pi / n * 0.42
            pts = [(c + r0 * math.sin(a - w0), c - r0 * math.cos(a - w0)), (c + r1 * math.sin(a - w1), c - r1 * math.cos(a - w1)),
                   (c + r1 * math.sin(a + w1), c - r1 * math.cos(a + w1)), (c + r0 * math.sin(a + w0), c - r0 * math.cos(a + w0))]
            sc.add("borders", Poly(tuple(pts), fill="#a39b8c", stroke=INK, sw=0.2))
        sc.add("borders", Circle(c, c, r0, "none", INK, 0.25))
    sc.add("borders", Circle(c, c, g.border_in, "none", INK, 0.35))


ART_CUT = 0.3  # the divider under a front illustration, as a fraction of the face radius below the centre
ART_SCALE, ART_LIFT = 1.15, 0.15  # the illustration is enlarged and raised, so more of its lower scene shows above the cut
TITLE_ON_ART = dict(color=BONE, outline=INK, outline_w=0.3, halo=((INK, 1.3, 0.25), (INK, 0.8, 0.45)))


def _art_window(sc, t, g: Rings, bleed):
    """The illustration filling the face above a horizontal divider."""
    c, r = g.c, g.face
    cut = c + ART_CUT * r
    th0 = math.acos(-ART_CUT)
    n = 120
    window = tuple((c + r * math.sin(-th0 + 2 * th0 * i / n), c - r * math.cos(-th0 + 2 * th0 * i / n)) for i in range(n + 1))
    R = r * ART_SCALE
    x, y = c - R, c - ART_LIFT * r - R
    art = t.art
    sc.add("graphics", _bitmap(f"token/{t.id}/front/{bleed}/art", x, y, 2 * R, 2 * R, [window],
                               lambda wp, hp: artfit.fit(art.path, art.crop, art.transparent, wp, hp)))
    hw = chord(r, cut - c) / 2
    sc.add("borders", Stroke(c - hw, cut, c + hw, cut, INK, 0.6), Stroke(c - hw, cut + 0.45, c + hw, cut + 0.45, BRASS, 0.25))


def _band(sc, t, side, g: Rings, bleed, title):
    """The turn-coloured stripe, then the parchment face with the title curved along its top."""
    c, W = g.c, sc.width
    # A clean, saturated stripe: it is thin, so it needs strong colour to read at a glance.
    from PIL import Image

    colour = STRIPE[t.turn]
    sc.add("background", _bitmap(f"token/{t.id}/{side}/{bleed}/band", 0, 0, W, W, [circle_pts(c, c, g.border_in)],
                                 lambda wp, hp, col=colour: Image.new("RGB", (wp, hp), col),
                                 holes=[circle_pts(c, c, g.face)]))
    sc.add("background", _bitmap(f"token/{t.id}/{side}/{bleed}/face", c - g.face, c - g.face, 2 * g.face, 2 * g.face,
                                 [circle_pts(c, c, g.face)], lambda wp, hp, s=_seed(t, "face"): tex.parchment(wp, hp, s)))
    sc.add("borders", Circle(c, c, g.face, "none", INK, 0.35))
    on_art = side == "front" and t.art is not None
    if on_art:
        _art_window(sc, t, g, bleed)
    _arc_label(sc, g, title, DISPLAY, math.radians(150), "title" if side == "front" else "back_title", t.id,
               **(TITLE_ON_ART if on_art else {}))
    sc.add("guides", Circle(c, c, g.R, "none", C["guide"], 0.15))  # the cut line, on the hidden guides layer


TITLE_H = 0.2  # height of the title ring inside the face, as a fraction of the face radius
TITLE_GAP = 0.04
INNER = 1 - TITLE_H - TITLE_GAP - 0.02  # text that could meet the title's curved ends stays inside this fraction


def _arc_label(sc, g: Rings, text_, face, max_angle, block, tid, color=INK, outline="", outline_w=0.0, halo=()):
    """The title, curved along the top of the face just inside the stripe, sized to its ring and the allowed arc."""
    line = tx.plain(text_)
    cap = tx.cap_height(face["regular"])
    outer = g.face * (1 - TITLE_GAP)
    for size in tx.size_steps(g.face * TITLE_H / cap, 1.0):
        r = outer - cap * size  # baseline radius; the capitals reach out to `outer`
        if tx.line_width(line, size, face) / r <= max_angle:
            break
    else:
        raise tx.LayoutError(f"{tid}.{block}: {text_!r} does not fit along the top of the token")
    sc.add("text", ArcText(g.c, g.c, r, 0.0, line, size, color, face, False, block, outline=outline, outline_w=outline_w, halo=halo))
    sc.fits[block] = size


def build(t: Token, side: str, bleed: float = 0.0) -> Scene:
    """One face of a token. The scene is the token plus `bleed` mm all round;
    the cut line is the circle of the token's diameter, on the guides layer."""
    g = rings(t, bleed)
    W = 2 * g.c
    sc = Scene(W, W)
    _border(sc, t, side, g, bleed)
    _band(sc, t, side, g, bleed, t.title if side == "front" else t.back_title)
    (_front if side == "front" else _back)(sc, t, g.c, g.face)
    return sc


def _picture(sc, t, cx, cy, s):
    """The token's illustration if it has one, otherwise its vector icon, in an s x s box."""
    if t.art is None:
        ICONS[t.icon](sc, cx, cy, s)
        return
    sc.add("graphics", Picture(cx - s / 2, cy - s / 2, s, s, t.art))


LABEL_FACE = {"regular": "barlow-label", "bold": "barlow-label", "ability": "barlow-label"}


def _front(sc, t, c, r):
    """Picture (illustration or vector icon) under the curved title, then the
    source of the effect in red (if any), then the short effect."""
    if t.art is not None:  # drawn by _art_window, above the divider
        top = c + r * (ART_CUT + 0.06)
    else:
        _picture(sc, t, c, c - r * 0.25, r * 0.88)
        top = c + r * 0.3
    if t.via:
        line = tx.plain(t.via)
        h = r * 0.19
        w = chord(r, top + h - c) - 0.8
        size = tx.fit_line(line, w, h / tx.cap_height(LABEL_FACE["regular"]) * 0.85, MIN_TEXT, f"{t.id}.via", LABEL_FACE)
        sc.add("text", Text(c, top + h / 2 + tx.cap_height(LABEL_FACE["regular"]) * size / 2, line, size, RED, "middle", "via", face=LABEL_FACE))
        sc.fits["via"] = size
        top += h + r * 0.03
    bottom = c + r * 0.94
    paras = [tx.tokenize(e, t.keywords) for e in t.effect]
    fit = fit_in_circle(paras, c, r, top, bottom, r * 0.26, MIN_TEXT, LABEL_FACE, 1.05, f"{t.id}.effect", pad=0.3)
    y = top + tx.ascent(LABEL_FACE["regular"]) * fit.size
    for line in fit.lines:
        sc.add("text", Text(c, y, line, fit.size, INK, "middle", "effect", face=LABEL_FACE, colors={"ability": RED}))
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
    r = r * INNER
    top, bottom = c - r * 0.97, c + r * 0.97
    paras = [tx.tokenize(p, t.keywords) for p in t.back]
    fit = fit_in_circle(paras, c, r, top, bottom, r * 0.2, MIN_TEXT, BODY, BODY_LEADING, f"{t.id}.back", pad=0.3)
    # Centre the block vertically by starting lower when there's room, re-wrapping for the new start.
    used = tx.block_height(len(fit.lines), fit.size, BODY, BODY_LEADING)
    start = top + (bottom - top - used) / 2
    lines = _shaped_wrap(paras, fit.size, BODY, BODY_LEADING, c, r, start, 0.3)
    if lines is None or tx.block_height(len(lines), fit.size, BODY, BODY_LEADING) > bottom - start:
        start, lines = top, fit.lines
    y = start + tx.ascent(BODY["regular"]) * fit.size
    for line in lines:
        sc.add("text", Text(c, y, line, fit.size, INK, "middle", "back", face=BODY, colors={"ability": RED}))
        y += fit.size * BODY_LEADING
    sc.fits["back"] = fit.size
