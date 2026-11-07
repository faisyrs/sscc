"""Grunge style: riveted, worn metal plates, parchment panels, hazard-striped
ends and heavy italic display type. On the full-size print the outline has
the token's 1-inch notches cut into it.

Every surface texture is generated from a seed made of the detachment id and
the element's name, so builds repeat exactly.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

from .. import artfit, content
from .. import text as tx
from .. import textures as tex
from ..geometry import INCH, NOTCH_BASE, NOTCH_DEPTH, SIZES, Size
from ..model import Detachment
from ..scene import Bitmap, Circle, Picture, Poly, Rect, Scene, Stroke, Text

BODY = {"regular": "barlow-body", "bold": "barlow-body-bold", "ability": "barlow-body-bold"}
LABEL = tx.face("barlow-label")
LABEL_SEMI = tx.face("barlow-label-semi")
DISPLAY = tx.face("barlow-display")
BODY_LEADING = 1.13

C = {
    "ink": "#17130f",
    "ability": "#9b1b14",
    "steel_edge": "#1a1612",
    "steel_hi": "#a69a84",
    "seam": "#0f0d0b",
    "rivet": ("#1d1916", "#7b7264", "#d6cdb9"),
    "yellow": (240, 196, 28),
    "red": (158, 31, 23),
    "badge": (150, 26, 20),
    "light_metal": (196, 190, 178),
    "title_text": "#f2ebdf",
    "title_outline": "#140f0c",
    "title_shadow": "#2a0c08",
    "cream": "#fbf3e2",
    "ribbon": {"your": (31, 79, 143), "opponent": (140, 29, 24), "either": (47, 107, 58)},
    "bolt": "#f0c419",
    "splat": "#a3170f",
    "guide": "#00b7ff",
}
MIN_BODY = 1.5  # mm; Barlow is narrower than DejaVu, so it needs a slightly larger minimum
MIN_LABEL = 1.8


def _hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(rgb)


# ---- shapes -----------------------------------------------------------------


def chamfer(x, y, w, h, c):
    c = min(c, w / 2, h / 2)
    return ((x + c, y), (x + w - c, y), (x + w, y + c), (x + w, y + h - c), (x + w - c, y + h), (x + c, y + h), (x, y + h - c), (x, y + c))


def banner(x, y, w, h):
    """A ribbon with V-cut ends."""
    k = h * 0.35
    return ((x, y), (x + w, y), (x + w - k, y + h / 2), (x + w, y + h), (x, y + h), (x + k, y + h / 2))


def silhouette(size: Size, c: float):
    """The outer outline. On the full size the long edges get the token's notches."""
    W, H = size.width, size.height
    stations = [i * INCH for i in range(1, 8)] if size.notched else []
    top = [(c, 0.0)]
    for x in stations:
        top += [(x - NOTCH_BASE / 2, 0.0), (x, NOTCH_DEPTH), (x + NOTCH_BASE / 2, 0.0)]
    top += [(W - c, 0.0), (W, c), (W, H - c), (W - c, H)]
    bottom = []
    for x in reversed(stations):
        bottom += [(x + NOTCH_BASE / 2, H), (x, H - NOTCH_DEPTH), (x - NOTCH_BASE / 2, H)]
    return tuple(top + bottom + [(c, H), (0.0, H - c), (0.0, c)])


def _bitmap(key, x, y, w, h, polys, gen, holes=()):
    """A texture generated at print resolution and masked to the given polygons (in mm), minus any holes."""

    def make(wp, hp):
        sx, sy = wp / w, hp / h
        to_px = lambda polys_: [[((px - x) * sx, (py - y) * sy) for px, py in poly] for poly in polys_]
        return tex.masked(gen(wp, hp), to_px(polys), holes_px=to_px(holes))

    return Bitmap(x, y, w, h, key, make)


# ---- components -------------------------------------------------------------


class Kit:
    """Draws the style's parts into a scene. Seeds come from the detachment id and each part's key."""

    def __init__(self, scene: Scene, d: Detachment, size: Size):
        self.s, self.d, self.size = scene, d, size
        # Where panel surfaces go. Over background art they move to the borders
        # layer, so the background layer holds only the art.
        self.surface = "background"

    def seed(self, key):
        return tex.seed_of(self.d.id, self.size.name, key)

    def rivet(self, cx, cy, r=0.5):
        dark, mid, hi = C["rivet"]
        self.s.add("borders", Circle(cx, cy, r, dark), Circle(cx, cy, r * 0.74, mid), Circle(cx - r * 0.22, cy - r * 0.22, r * 0.26, hi))

    def frame(self, pts, sw=0.9):
        self.s.add("borders", Poly(pts, stroke=C["steel_edge"], sw=sw))

    def panel(self, key, x, y, w, h, c=1.6, rivets=True):
        pts = chamfer(x, y, w, h, c)
        seed = self.seed(key)
        self.s.add(self.surface, _bitmap(f"{self.d.id}/{key}", x, y, w, h, [pts], lambda wp, hp: tex.parchment(wp, hp, seed)))
        self.frame(pts)
        self.s.add("borders", Poly(chamfer(x + 0.65, y + 0.65, w - 1.3, h - 1.3, c * 0.7), stroke=C["steel_hi"], sw=0.2, opacity=0.7))
        if rivets:
            for rx in (x + 1.45, x + w - 1.45):
                for ry in (y + 1.45, y + h - 1.45):
                    self.rivet(rx, ry, 0.42)

    def plate(self, key, x, y, w, h, rgb, c=0.8, chip=0.12, pts=None, sw=0.35):
        pts = pts or chamfer(x, y, w, h, c)
        seed = self.seed(key)
        self.s.add("borders", _bitmap(f"{self.d.id}/{key}", x, y, w, h, [pts], lambda wp, hp: tex.painted(wp, hp, seed, rgb, chip)))
        self.s.add("borders", Poly(pts, stroke=C["steel_edge"], sw=sw))

    def picture(self, art, x, y, w, h):
        self.s.add("graphics", Picture(x, y, w, h, art))
        if not art.transparent:  # cut-out art sits straight on the panel, without a frame
            self.s.add("borders", Poly(chamfer(x, y, w, h, 0.01), stroke=C["steel_edge"], sw=0.45))

    def bolt(self, key, x, y, w, h):
        """A lightning bolt over a paint splat, the rule's icon."""
        rng = random.Random(f"{self.d.id}:{key}")
        cx, cy, r = x + w * 0.45, y + h * 0.42, min(w, h) * 0.36
        splat = []
        for i in range(22):
            a = i / 22 * 6.2832
            rr = r * (0.55 + rng.random() * 0.6 if i % 2 else 0.5 + rng.random() * 0.25)
            splat.append((cx + rr * math.cos(a), cy + rr * math.sin(a) * 0.8))
        self.s.add("graphics", Poly(tuple(splat), fill=C["splat"], opacity=0.9))
        for _ in range(5):
            dx, dy = (rng.random() - 0.5) * w, (rng.random() - 0.5) * h * 0.8
            self.s.add("graphics", Circle(cx + dx, cy + dy, r * (0.05 + rng.random() * 0.08), C["splat"]))
        pts = ((0.62, 0.0), (0.16, 0.58), (0.44, 0.58), (0.24, 1.0), (0.88, 0.38), (0.58, 0.38), (0.80, 0.0))
        self.s.add("graphics", Poly(tuple((x + px * w, y + py * h) for px, py in pts), fill=C["bolt"], stroke=C["ink"], sw=0.35))

    def checker(self, x, y, w, h, rows=2):
        sq = h / rows
        cols = int(w // sq)
        self.s.add("graphics", Rect(x, y, cols * sq, h, "#f4efe4"))
        for r in range(rows):
            for col in range(cols):
                if (r + col) % 2 == 0:
                    self.s.add("graphics", Rect(x + col * sq, y + r * sq, sq, sq, "#141210"))

    # ---- text ----

    def label(self, x, y_mid, line, size, color, anchor, block, fc=LABEL, **kw):
        """One line whose capitals are centred on y_mid."""
        base = y_mid + tx.cap_height(fc["regular"]) * size / 2
        self.s.add("text", Text(x, base, line, size, color, anchor, block, face=fc, **kw))
        self.s.fits[block] = size

    def block(self, x, top, fit: tx.Fit, block, align="start", fc=BODY, leading=BODY_LEADING, width=0.0):
        y = top + tx.ascent(fc["regular"]) * fit.size
        for line in fit.lines:
            lx = x + width / 2 if align == "middle" else x
            self.s.add("text", Text(lx, y, line, fit.size, C["ink"], align, block, face=fc, colors={"ability": C["ability"]}))
            y += fit.size * leading
        self.s.fits[block] = fit.size

    def scuff(self, key, x0, y0, x1, y1, color, n=34):
        """Thin scratches over display type, in the colour of the plate behind it."""
        rng = random.Random(f"{self.d.id}:{key}")
        for _ in range(n):
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            ln = rng.uniform(0.4, 2.2)
            dy = rng.uniform(-0.35, 0.35)
            self.s.add("text", Stroke(x, y, x + ln, y + dy, color, rng.uniform(0.06, 0.14), 0.9))


# ---- the two sides ----------------------------------------------------------


def _metrics(size: Size):
    full = size.notched
    end = 4.6 if full else 3.2  # hazard-striped ends
    band = 3.0 if full else 2.2  # metal band along the long edges
    cx, cy = end + 1.0, band
    return end, band, cx, cy, size.width - 2 * cx, size.height - 2 * cy


def _chrome(k: Kit, side: str):
    s, d, size = k.s, k.d, k.size
    W, H = size.width, size.height
    end, band, *_ = _metrics(size)
    c = 2.2 if size.notched else 1.6
    sil = silhouette(size, c)
    seed = k.seed("plate")
    if side == "setup" and d.background_art:
        # The art fills the whole card on the background layer. The metal shows only as a
        # frame around it, on the borders layer.
        art = d.background_art
        s.add(
            "background",
            _bitmap(f"{d.id}/{size.name}/background-art", 0, 0, W, H, [sil],
                    lambda wp, hp: artfit.fit(art.path, art.crop, art.transparent, wp, hp)),
        )
        window = ((end, band), (W - end, band), (W - end, H - band), (end, H - band))
        s.add("borders", _bitmap(f"{d.id}/{size.name}/frame", 0, 0, W, H, [sil], lambda wp, hp: tex.metal(wp, hp, seed), holes=[window]))
        s.add("borders", Poly(window, stroke=C["steel_edge"], sw=0.5))
        k.surface = "borders"
    else:
        s.add("background", _bitmap(f"{d.id}/{size.name}/plate", 0, 0, W, H, [sil], lambda wp, hp: tex.metal(wp, hp, seed)))
    pitch = 3.2
    for name, x0 in (("left", 0.0), ("right", W - end)):
        if name == "left":
            zone = ((c, 0), (end, 0), (end, H), (c, H), (0, H - c), (0, c))
        else:
            zone = ((W - end, 0), (W - c, 0), (W, c), (W, H - c), (W - c, H), (W - end, H))
        zs = k.seed(f"hazard-{name}")
        s.add(
            "borders",
            _bitmap(f"{d.id}/{size.name}/hazard-{name}", x0, 0, end, H, [zone], lambda wp, hp, zs=zs: tex.hazard(wp, hp, zs, wp / end * pitch)),
        )
        edge = end if name == "left" else W - end
        s.add("borders", Stroke(edge, 0, edge, H, C["seam"], 0.45))
    # Seams across the edge bands at each inch, so the band reads as a row of plates and marks the inches.
    offset = (SIZES["full"].width - W) / 2
    for i in range(1, 8):
        x = i * INCH - offset
        for y0, y1 in ((0, band), (H - band, H)):
            s.add("borders", Stroke(x, y0, x, y1, C["seam"], 0.35), Stroke(x + 0.3, y0, x + 0.3, y1, C["steel_hi"], 0.12, 0.6))
    for i in range(8):
        x = (i + 0.5) * INCH - offset
        if end + 1 < x < W - end - 1:
            for y in (band / 2, H - band / 2):
                k.rivet(x, y, 0.42 if size.notched else 0.34)
    s.add("borders", Poly(sil, stroke=C["steel_edge"], sw=0.6))
    # Guides (a hidden layer): trim line, safe area, and the token's 1-inch notch stations.
    s.add("guides", Poly(sil, stroke=C["guide"], sw=0.2))
    _, _, cx, cy, cw, ch = _metrics(size)
    s.add("guides", Rect(cx, cy, cw, ch, stroke=C["guide"], sw=0.15, dash="0.5 0.5"))
    for i in range(1, 8):
        x = i * INCH - offset
        s.add("guides", Stroke(x, 0, x, 1.7, C["guide"], 0.2), Stroke(x, H - 1.7, x, H, C["guide"], 0.2))


def _setup(k: Kit):
    d = k.d
    _, _, cx, cy, cw, ch = _metrics(k.size)
    gap = 1.4

    art_w = cw * 0.335
    k.picture(d.hero_art, cx, cy, art_w, ch)
    for rx in (cx + 1.2, cx + art_w - 1.2):
        for ry in (cy + 1.2, cy + ch - 1.2):
            k.rivet(rx, ry, 0.42)
    rx = cx + art_w + gap
    rw = cx + cw - rx
    th = ch * 0.42

    # Top row: title plate, faction plate, faction icon.
    icon_w = th if d.faction_icon else 0.0
    title_w = (rw - icon_w - (gap if icon_w else 0)) * 0.56
    k.plate("title", rx, cy, title_w, th, C["red"], c=1.2, chip=0.16, sw=0.6)
    for px_ in (rx + 1.3, rx + title_w - 1.3):
        for py_ in (cy + 1.3, cy + th - 1.3):
            k.rivet(px_, py_, 0.42)
    title = tx.plain(d.name.upper())
    tsize = tx.fit_line(title, title_w - 6, th * 0.62, 3.0, "name", DISPLAY)
    k.label(
        rx + title_w / 2, cy + th / 2, title, tsize, C["title_text"], "middle", "name", DISPLAY,
        outline=C["title_outline"], outline_w=0.55, shadow=C["title_shadow"], shadow_dx=0.4, shadow_dy=0.45,
    )
    tw_ = tx.line_width(title, tsize, DISPLAY)
    cap = tx.cap_height(DISPLAY["regular"]) * tsize
    k.scuff("title", rx + title_w / 2 - tw_ / 2, cy + th / 2 - cap / 2, rx + title_w / 2 + tw_ / 2, cy + th / 2 + cap / 2, _hex(C["red"]))

    ix = rx + title_w + gap
    iw = rx + rw - icon_w - (gap if icon_w else 0) - ix
    k.plate("info", ix, cy, iw, th, C["light_metal"], c=1.2, chip=0.08, sw=0.6)
    for px_ in (ix + 1.3, ix + iw - 1.3):
        for py_ in (cy + 1.3, cy + th - 1.3):
            k.rivet(px_, py_, 0.38)
    l1 = tx.plain(f"{d.faction.upper()}  •  DETACHMENT ({d.detachment_points} DP)")
    l2 = tx.plain(f"FORCE DISPOSITION: {d.disposition.upper()}")
    s1 = tx.fit_line(l1, iw - 5, th * 0.3, MIN_LABEL, "faction_points", LABEL)
    s2 = tx.fit_line(l2, iw - 5, s1 * 0.78, MIN_LABEL, "disposition", LABEL)
    k.label(ix + iw / 2, cy + th * 0.36, l1, s1, C["ink"], "middle", "faction_points")
    k.label(ix + iw / 2, cy + th * 0.70, l2, s2, C["ink"], "middle", "disposition")
    if d.faction_icon:
        fx = rx + rw - icon_w
        k.picture(d.faction_icon, fx, cy, icon_w, th)

    # Bottom row: detachment rule name and the setup-only rule.
    by = cy + th + gap + 1.2  # room for the tabs that sit across the panels' top edges
    bh = cy + ch - by
    tab_h = 4.0
    if d.setup_text:
        _rule_and_setup_panels(k, rx, by, rw, bh, tab_h, gap)
    else:
        _rule_panel_wide(k, rx, by, rw, bh, tab_h)


def _rule_name_block(k: Kit, x, y, w, h, tab_h):
    """Bolt icon and the rule's name, centred in the space below the tab."""
    d = k.d
    icon = h * 0.62
    k.bolt("rule-bolt", x + 2.0, y + (h - icon) / 2 + 1.0, icon * 0.8, icon)
    name = tx.plain(d.rule_name.upper())
    nx = x + 2.0 + icon * 0.8 + 1.2
    nw = x + w - 2.5 - nx
    nsize = tx.fit_line(name, nw, h * 0.36, 2.5, "rule_name", DISPLAY)
    k.label(nx + nw / 2, y + tab_h * 0.4 + (h - tab_h * 0.4) / 2, name, nsize, C["ink"], "middle", "rule_name", DISPLAY)


def _centred_text(k: Kit, x, top, w, bottom, text_, block):
    """Text centred in a box. Text with several paragraphs, such as a bulleted
    list, is left-aligned instead, so the bullets line up."""
    box_w, box_h = w - 6, bottom - top
    paras = content.paragraphs(text_, k.d.keywords)
    fit = tx.fit_block(paras, box_w, box_h, 4.4, MIN_BODY, block, BODY, BODY_LEADING)
    used = tx.block_height(len(fit.lines), fit.size, BODY, BODY_LEADING)
    k.block(x + 3, top + (box_h - used) / 2, fit, block, "middle" if len(paras) == 1 else "start", width=box_w)


def _rule_and_setup_panels(k: Kit, rx, by, rw, bh, tab_h, gap):
    """The rule's name on the left; the setup-only rule on the right."""
    rule_w = rw * 0.47
    k.panel("rule", rx, by, rule_w, bh)
    _tab(k, "rule-tab", rx + rule_w / 2, by, "DETACHMENT RULE", tab_h, rule_w * 0.62)
    _rule_name_block(k, rx, by, rule_w, bh, tab_h)
    sx = rx + rule_w + gap
    sw_ = rx + rw - sx
    k.panel("setup", sx, by, sw_, bh)
    tab_w = sw_ * 0.4
    _tab(k, "setup-tab", sx + sw_ * 0.36, by, "SETUP ONLY", tab_h, tab_w)
    k.checker(sx + sw_ * 0.36 + tab_w / 2 + 1.5, by - tab_h * 0.32, sw_ * 0.3, tab_h * 0.64)
    _centred_text(k, sx, by + tab_h * 0.75, sw_, by + bh - 1.8, k.d.setup_text, "setup_text")


def _rule_panel_wide(k: Kit, rx, by, rw, bh, tab_h):
    """No setup-only rule: one panel with the rule's name and its full text."""
    k.panel("rule", rx, by, rw, bh)
    _tab(k, "rule-tab", rx + rw * 0.25, by, "DETACHMENT RULE", tab_h, rw * 0.3)
    k.checker(rx + rw * 0.4 + 1.5, by - tab_h * 0.32, rw * 0.2, tab_h * 0.64)
    name_w = rw * 0.47
    _rule_name_block(k, rx, by, name_w, bh, tab_h)
    dx = rx + name_w
    k.s.add("borders", Stroke(dx, by + tab_h * 0.9, dx, by + bh - 2.0, C["steel_edge"], 0.4))
    _centred_text(k, dx, by + tab_h * 0.75, rw - name_w, by + bh - 1.8, k.d.in_play_text, "rule_text")


def _setup_over_background(k: Kit):
    """Setup side over full-card art. The title and faction plates make a left
    column and the rule panels a right column. The middle stays open, because
    that's where the art's main figure usually is."""
    d = k.d
    _, _, cx, cy, cw, ch = _metrics(k.size)
    gap = 1.4
    col = cw * 0.32

    # Left column: title plate, then the faction plate (and icon, if any).
    th = ch * 0.5
    k.plate("title", cx, cy, col, th, C["red"], c=1.2, chip=0.16, sw=0.6)
    for px_ in (cx + 1.3, cx + col - 1.3):
        for py_ in (cy + 1.3, cy + th - 1.3):
            k.rivet(px_, py_, 0.42)
    title = tx.plain(d.name.upper())
    tsize = tx.fit_line(title, col - 6, th * 0.62, 3.0, "name", DISPLAY)
    k.label(
        cx + col / 2, cy + th / 2, title, tsize, C["title_text"], "middle", "name", DISPLAY,
        outline=C["title_outline"], outline_w=0.55, shadow=C["title_shadow"], shadow_dx=0.4, shadow_dy=0.45,
    )
    tw_ = tx.line_width(title, tsize, DISPLAY)
    cap = tx.cap_height(DISPLAY["regular"]) * tsize
    k.scuff("title", cx + col / 2 - tw_ / 2, cy + th / 2 - cap / 2, cx + col / 2 + tw_ / 2, cy + th / 2 + cap / 2, _hex(C["red"]))

    iy = cy + th + gap
    ih = cy + ch - iy
    icon_w = ih if d.faction_icon else 0.0
    iw = col - icon_w - (gap if icon_w else 0)
    k.plate("info", cx, iy, iw, ih, C["light_metal"], c=1.2, chip=0.08, sw=0.6)
    for px_ in (cx + 1.3, cx + iw - 1.3):
        for py_ in (iy + 1.3, iy + ih - 1.3):
            k.rivet(px_, py_, 0.38)
    l1 = tx.plain(f"{d.faction.upper()}  •  DETACHMENT ({d.detachment_points} DP)")
    l2 = tx.plain(f"FORCE DISPOSITION: {d.disposition.upper()}")
    s1 = tx.fit_line(l1, iw - 5, ih * 0.3, MIN_LABEL, "faction_points", LABEL)
    s2 = tx.fit_line(l2, iw - 5, s1 * 0.8, MIN_LABEL, "disposition", LABEL)
    k.label(cx + iw / 2, iy + ih * 0.36, l1, s1, C["ink"], "middle", "faction_points")
    k.label(cx + iw / 2, iy + ih * 0.70, l2, s2, C["ink"], "middle", "disposition")
    if d.faction_icon:
        k.picture(d.faction_icon, cx + iw + gap, iy, icon_w, ih)

    # Right column: the rule's name, then the setup-only rule if there is one.
    rx = cx + cw - col
    tab_h = 4.0
    top = cy + tab_h * 0.32
    if d.setup_text:
        nh = (ch - tab_h * 0.32) * 0.44
        k.panel("rule", rx, top, col, nh)
        _tab(k, "rule-tab", rx + col / 2, top, "DETACHMENT RULE", tab_h, col * 0.62)
        _rule_name_block(k, rx, top, col, nh, tab_h)
        sy = top + nh + gap + tab_h * 0.32
        sh = cy + ch - sy
        k.panel("setup", rx, sy, col, sh)
        _tab(k, "setup-tab", rx + col * 0.36, sy, "SETUP ONLY", tab_h, col * 0.45)
        k.checker(rx + col * 0.36 + col * 0.225 + 1.5, sy - tab_h * 0.32, col * 0.28, tab_h * 0.64)
        _centred_text(k, rx, sy + tab_h * 0.75, col, sy + sh - 1.8, d.setup_text, "setup_text")
    else:
        ph = cy + ch - top
        k.panel("rule", rx, top, col, ph)
        _tab(k, "rule-tab", rx + col / 2, top, "DETACHMENT RULE", tab_h, col * 0.62)
        name_h = ph * 0.46
        _rule_name_block(k, rx, top, col, name_h, tab_h)
        k.s.add("borders", Stroke(rx + 3, top + name_h + 0.4, rx + col - 3, top + name_h + 0.4, C["steel_edge"], 0.35))
        _centred_text(k, rx, top + name_h + 1.2, col, top + ph - 1.8, d.in_play_text, "rule_text")


def _tab(k: Kit, key, x_mid, y_edge, label, h, w):
    """A yellow label plate straddling a panel's top edge."""
    y = y_edge - h * 0.32
    k.plate(key, x_mid - w / 2, y, w, h, C["yellow"], c=0.6)
    line = tx.plain(label)
    size = tx.fit_line(line, w - 3, h * 0.66, MIN_LABEL, key, LABEL)
    k.label(x_mid, y + h / 2, line, size, C["ink"], "middle", key)


def _min_width(paragraphs, size, max_lines, hi):
    """Narrowest width (to 0.05 mm) at which the text wraps to max_lines lines or fewer."""
    lo = 1.0
    if not _fits_lines(paragraphs, size, hi, max_lines):
        return None
    while hi - lo > 0.05:
        mid = (lo + hi) / 2
        if _fits_lines(paragraphs, size, mid, max_lines):
            hi = mid
        else:
            lo = mid
    return hi


def _fits_lines(paragraphs, size, w, max_lines):
    try:
        return len(tx.wrap(paragraphs, size, w, BODY)) <= max_lines
    except tx.LayoutError:
        return False


def _has_widow(fit, w):
    return len(fit.lines) > 1 and tx.line_width(fit.lines[-1], fit.size, BODY) < 0.3 * w


def _balance_columns(parts, avail, box_h):
    """Split the strip's width between the rule's parts so their line counts
    match. Take the largest size, then the fewest lines per column. Each
    column gets the narrowest width that holds its part in that many lines,
    plus an equal share of what is left over. If that extra width leaves a
    one-word last line, the columns keep their narrowest widths instead."""
    for size in tx.size_steps(2.6, MIN_BODY):
        max_lines = int((box_h / size - tx.ascent(BODY["regular"]) - tx.descent(BODY["regular"])) / BODY_LEADING) + 1
        for n in range(1, max_lines + 1):
            mins = [_min_width(p, size, n, avail) for p in parts]
            if None in mins or sum(mins) > avail:
                continue
            slack = (avail - sum(mins)) / len(parts)
            for widths in ([m + slack for m in mins], mins):
                fits = [tx.Fit(size, tx.wrap(p, size, w, BODY)) for p, w in zip(parts, widths)]
                if not any(_has_widow(f, w) for f, w in zip(fits, widths)):
                    break
            return fits, [m + slack for m in mins]
    raise tx.LayoutError(f"in_play_text: the in-play rule does not fit the upper strip even at {MIN_BODY} mm")


def _in_play(k: Kit):
    d = k.d
    _, _, cx, cy, cw, ch = _metrics(k.size)
    gap = 1.4
    kw = d.keywords

    # Upper strip: rule name plate, then the in-play rule, one column per part.
    sh = ch * 0.30
    k.panel("strip", cx, cy, cw, sh)
    icon = sh * 0.78
    k.bolt("strip-bolt", cx + 2.0, cy + (sh - icon) / 2, icon * 0.8, icon)
    name = tx.plain(d.rule_name.upper())
    nsize = tx.fit_line(name, cw * 0.28, sh * 0.42, 2.0, "rule_name", DISPLAY)
    ph_ = sh * 0.6
    px_ = cx + 2.0 + icon * 0.7
    pw_ = tx.line_width(name, nsize, DISPLAY) + 5
    k.plate("strip-name", px_, cy + (sh - ph_) / 2, pw_, ph_, C["yellow"], c=1.0, sw=0.5)
    k.label(px_ + pw_ / 2, cy + sh / 2, name, nsize, C["ink"], "middle", "rule_name", DISPLAY)

    parts = [content.paragraphs(p, kw) for p in d.in_play_parts]
    col_x0, col_x1 = px_ + pw_ + 3.0, cx + cw - 3.0
    col_gap = 3.0
    avail = col_x1 - col_x0 - col_gap * (len(parts) - 1)
    fits, widths = _balance_columns(parts, avail, sh - 2.6)
    x = col_x0
    for i, (fit, w) in enumerate(zip(fits, widths)):
        used = tx.block_height(len(fit.lines), fit.size, BODY, BODY_LEADING)
        k.block(x, cy + (sh - used) / 2, fit, "in_play_text")
        x += w + col_gap
        if i < len(fits) - 1:
            dx = x - col_gap / 2
            k.s.add("borders", Stroke(dx, cy + 2.2, dx, cy + sh - 2.2, C["steel_edge"], 0.4))

    # Lower row: one panel per stratagem, in phase order.
    py = cy + sh + gap
    ph = ch - sh - gap
    plan = _plan_panels(d, cx, cw, ph, gap)
    for i, (s, body, nm, rib) in enumerate(zip(d.stratagems, plan.bodies, plan.names, plan.ribbons)):
        x, pw, art_w = plan.xs[i], plan.widths[i], plan.art_ws[i]
        tw = pw - art_w - 4.0
        t0 = x + 1.0 + art_w + 1.6
        k.panel(f"strat-{s.id}", x, py, pw, ph)
        k.picture(s.art, x + 1.0, py + 1.0, art_w, ph - 2.0)
        hy = py + 1.1
        k.plate(f"strat-{s.id}-name", t0, hy, tw - plan.cp_w - 0.6, HEAD_H, C["yellow"], c=0.6)
        k.label(t0 + 1.2, hy + HEAD_H / 2, nm, plan.name_size, C["ink"], "start", f"{s.id}.name")
        bx = t0 + tw - plan.cp_w
        k.plate(f"strat-{s.id}-cp", bx, hy, plan.cp_w, HEAD_H, C["badge"], c=0.6, chip=0.1)
        cp = tx.plain(content.cp_label(s))
        cp_size = tx.fit_line(cp, plan.cp_w - 1.6, HEAD_H * 0.72, MIN_LABEL, f"{s.id}.cp", LABEL)
        k.label(bx + plan.cp_w / 2, hy + HEAD_H / 2, cp, cp_size, C["cream"], "middle", f"{s.id}.cp")
        ry = hy + HEAD_H + 0.6
        rx_, rw_ = t0 + 0.6, tw - 1.2
        k.plate(f"strat-{s.id}-ribbon", rx_, ry, rw_, RIB_H, C["ribbon"][s.turn], pts=banner(rx_, ry, rw_, RIB_H), chip=0.06, sw=0.25)
        k.label(rx_ + rw_ / 2, ry + RIB_H / 2, rib, plan.rib_size, "#ffffff", "middle", f"{s.id}.phase", LABEL_SEMI)
        fit = tx.Fit(plan.body_size, tx.wrap(body, plan.body_size, tw, BODY))
        k.block(t0, py + BODY_TOP, fit, f"{s.id}.body")


HEAD_H, RIB_H = 4.4, 3.0
BODY_TOP = 1.1 + HEAD_H + 0.6 + RIB_H + 0.9  # from the panel's top edge to the top of the body text
ART_FRACTIONS = (0.33, 0.31, 0.26, 0.21)  # art width as a share of an equal panel's width, largest first
WIDTH_EXPONENTS = (0.0, 0.5, 1.0)  # 0 = equal panels; 1 = panel width in proportion to body length


@dataclass
class PanelPlan:
    xs: list
    widths: list
    art_ws: list
    body_size: float
    name_size: float
    rib_size: float
    cp_w: float
    bodies: list
    names: list
    ribbons: list


def _plan_panels(d: Detachment, cx, cw, ph, gap) -> PanelPlan:
    """Choose panel widths and art size for the stratagem row.

    Every combination of ART_FRACTIONS and WIDTH_EXPONENTS is tried. The plan
    with the largest common body size wins, compared in 0.1 mm bands. Within a
    band, the earlier candidate wins: larger art first, then equal panels
    before unequal ones. So the art stays as big as possible unless shrinking
    it makes the text noticeably bigger. The order is fixed, so the choice is
    deterministic. At 0.33 of an equal share, portrait art (about 5:7) fills
    the full height of the slot."""
    kw = d.keywords
    n = len(d.stratagems)
    bodies = [content.body(s, kw) for s in d.stratagems]
    names = [tx.plain(s.name.upper()) for s in d.stratagems]
    ribbons = [tx.plain(content.phase_label(s)) for s in d.stratagems]
    cp_w = 9.6 if any(s.upgrade for s in d.stratagems) else 7.4
    body_h = ph - BODY_TOP - 1.4
    lengths = [sum(tx.line_width(w, 1.0, BODY) for para in b for w in para) for b in bodies]
    avail = cw - gap * (n - 1)
    best, best_band, last_error = None, -1, None
    def panel_widths(exp):
        weights = [l**exp for l in lengths]
        widths = [avail * w / sum(weights) for w in weights]
        lo = avail / n * 0.7  # no panel narrower than 70% of an equal share
        if min(widths) < lo:
            short = sum(lo - w for w in widths if w < lo)
            rest = sum(w for w in widths if w >= lo)
            widths = [lo if w < lo else w - short * w / rest for w in widths]
        return widths

    for frac in ART_FRACTIONS:
        for exp in WIDTH_EXPONENTS:
            widths = panel_widths(exp)
            # Every panel gets the same art width, so the pictures match even when the panels don't.
            art_ws = [min(avail / n * frac, ph - 2.0)] * n
            tws = [w - a - 4.0 for w, a in zip(widths, art_ws)]
            try:
                size = min(
                    tx.fit_block(b, tw, body_h, 2.4, MIN_BODY, f"stratagem {s.id}", BODY, BODY_LEADING).size
                    for b, tw, s in zip(bodies, tws, d.stratagems)
                )
            except tx.LayoutError as e:
                last_error = e
                continue
            band = int(size / 0.1 + 1e-9)
            if band > best_band:
                best_band, best = band, (widths, art_ws, tws, size)
    if best is None:
        raise last_error
    widths, art_ws, tws, size = best
    xs, x = [], cx
    for w in widths:
        xs.append(x)
        x += w + gap
    name_size = min(
        tx.fit_line(l, tw - cp_w - 2.6, HEAD_H * 0.72, MIN_LABEL, f"{s.id}.name", LABEL) for l, tw, s in zip(names, tws, d.stratagems)
    )
    rib_size = min(
        tx.fit_line(l, tw - 4.5, RIB_H * 0.7, MIN_LABEL, f"{s.id}.phase", LABEL_SEMI) for l, tw, s in zip(ribbons, tws, d.stratagems)
    )
    return PanelPlan(xs, widths, art_ws, size, name_size, rib_size, cp_w, bodies, names, ribbons)


def safe_area(size: Size):
    _, _, cx, cy, cw, ch = _metrics(size)
    return (cx, cy, cx + cw, cy + ch)


def build(d: Detachment, size: Size, side: str) -> Scene:
    scene = Scene(size.width, size.height)
    k = Kit(scene, d, size)
    _chrome(k, side)
    if side == "in_play":
        _in_play(k)
    elif d.background_art:
        _setup_over_background(k)
    else:
        _setup(k)
    return scene
