"""Classic style: the clean, flat layout from the first version of the generator."""
from __future__ import annotations

import random
from .. import content
from .. import text as tx
from ..geometry import INCH, SIZES, Size
from ..model import Detachment
from ..scene import Circle, Picture, Rect, Scene, Stroke, Text

THEME = {
    "plate": "#25211d",
    "scratches": ("#51483d", "#171a1c", "#706044"),
    "hazard": ("#111111", "#c99d27"),
    "frame": "#c9a66d",
    "rivet": "#c3a05b",
    "rivet_edge": "#111111",
    "parchment": "#e3d2aa",
    "parchment_edge": "#a36f29",
    "title_fill": "#6c1713",
    "title_edge": "#d4a43e",
    "title_text": "#f4d67a",
    "tab_fill": "#d9a320",
    "tab_edge": "#38280c",
    "strat_head": "#c99d2d",
    "strat_head_edge": "#2a1d13",
    "turn": {"your": "#236a95", "opponent": "#a02d2a", "either": "#397648"},
    "ink": "#181818",
    "bar_text": "#ffffff",
    "guide": "#00b7ff",
}

MIN_BODY = 1.4  # mm, about 4 pt: the smallest body text allowed
MIN_TITLE = 1.8


def _text_lines(scene, x, top, fit: tx.Fit, color, block):
    y = top + tx.ascent() * fit.size
    for line in fit.lines:
        scene.add("text", Text(x, y, line, fit.size, color, block=block))
        y += fit.size * tx.LEADING
    scene.fits[block] = fit.size


def _single(scene, x, y_mid, line, size, color, anchor, block):
    """One line, centred vertically on y_mid."""
    base = y_mid + (tx.ascent("dejavu-bold") - tx.descent("dejavu-bold")) * size / 2
    scene.add("text", Text(x, base, line, size, color, anchor, block))
    scene.fits[block] = size


def _chrome(scene: Scene, d: Detachment, size: Size):
    """Background plate, edge frame, hazard strips and rivets. The same on both sides."""
    W, H, m = size.width, size.height, size.margin
    scene.add("background", Rect(0, 0, W, H, THEME["plate"]))
    rng = random.Random(d.id)  # seeded with the detachment id, so the texture is the same on every build
    for i in range(360):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        scene.add(
            "background",
            Stroke(x, y, x + rng.uniform(0.5, 7.5), y - 0.07, THEME["scratches"][i % 3], 0.11, 0.62),
        )
    inset = 0.14 * m
    scene.add("borders", Rect(inset, inset, W - 2 * inset, H - 2 * inset, stroke=THEME["frame"], sw=0.7, rx=2))
    # Hazard strips run between the rivets and are centred, so both ends match.
    band_y, band_h = 0.28 * m, 0.38 * m
    pitch, stripe_w = 8.65, 4.2
    span = W - 4 * m
    n = int((span - stripe_w) // pitch) + 1
    x0 = (W - (n - 1) * pitch - stripe_w) / 2
    for i in range(n):
        x = x0 + i * pitch
        for y in (band_y, H - band_y - band_h):
            scene.add("borders", Rect(x, y, stripe_w, band_h, THEME["hazard"][i % 2]))
    rr = max(0.6, 0.2 * m)
    for cx in (0.6 * m, W - 0.6 * m):
        for cy in (0.6 * m, H - 0.6 * m):
            scene.add("borders", Circle(cx, cy, rr, THEME["rivet"], THEME["rivet_edge"], 0.3))
    # Guides (a hidden layer): trim line, safe area, and the token's 1-inch notch stations.
    scene.add("guides", Rect(0, 0, W, H, stroke=THEME["guide"], sw=0.2, dash="1 1"))
    scene.add("guides", Rect(m, m, W - 2 * m, H - 2 * m, stroke=THEME["guide"], sw=0.15, dash="0.5 0.5"))
    offset = (SIZES["full"].width - W) / 2  # the sticker is centred on the token
    for i in range(1, 8):
        x = i * INCH - offset
        scene.add("guides", Stroke(x, 0, x, 1.7, THEME["guide"], 0.2), Stroke(x, H - 1.7, x, H, THEME["guide"], 0.2))


def _panel(scene, x, y, w, h, fill, edge, sw, rx):
    """A panel's fill goes on the background layer and its outline on the borders layer."""
    scene.add("background", Rect(x, y, w, h, fill, rx=rx))
    scene.add("borders", Rect(x, y, w, h, stroke=edge, sw=sw, rx=rx))


def _setup(scene: Scene, d: Detachment, size: Size):
    m = size.margin
    cx, cy, cw, ch = m, m, size.width - 2 * m, size.height - 2 * m
    kw = d.keywords

    art_w = cw * 0.37
    scene.add("graphics", Picture(cx, cy, art_w, ch, d.hero_art or d.background_art))
    scene.add("borders", Rect(cx, cy, art_w, ch, stroke=THEME["parchment_edge"], sw=0.6))

    px, pw = cx + art_w + 2.0, cw - art_w - 2.0
    title_h = ch * 0.32
    scene.add("background", Rect(px, cy, pw, title_h, THEME["title_fill"], rx=1.5))
    scene.add("borders", Rect(px, cy, pw, title_h, stroke=THEME["title_edge"], sw=0.75, rx=1.5))
    title = [(d.name.upper(), "bold")]
    tsize = tx.fit_line(title, pw - 6, 6.4, MIN_TITLE, "name")
    _single(scene, px + pw / 2, cy + title_h / 2, title, tsize, THEME["title_text"], "middle", "name")

    iy = cy + title_h + 2.0
    ih = ch - title_h - 2.0
    _panel(scene, px, iy, pw, ih, THEME["parchment"], THEME["parchment_edge"], 0.8, 1.5)
    pad = 3.0
    inner_w = pw - 2 * pad
    dp = [(f"{d.detachment_points} DP", "bold")]
    dp_size = 3.7
    dp_w = tx.line_width(dp, dp_size)
    meta = [(f"{d.faction.upper()}  •  {d.disposition.upper()}", "bold")]
    meta_size = tx.fit_line(meta, inner_w - dp_w - 3, 3.1, MIN_BODY, "faction_disposition")
    row1 = iy + pad + 1.6
    _single(scene, px + pad, row1, meta, meta_size, THEME["ink"], "start", "faction_disposition")
    _single(scene, px + pw - pad, row1, dp, dp_size, THEME["ink"], "end", "detachment_points")

    # Without a setup-only rule, the setup side shows the rule's name and its full text.
    head = [((d.setup_headline or d.rule_name).upper(), "bold")]
    hsize = tx.fit_line(head, inner_w, 3.5, MIN_BODY, "setup_headline")
    row2 = row1 + 5.6
    _single(scene, px + pad, row2, head, hsize, THEME["ink"], "start", "setup_headline")

    body_top = row2 + 3.0
    body_h = iy + ih - pad + 0.8 - body_top
    block = "setup_text" if d.setup_text else "rule_text"
    fit = tx.fit_block(content.paragraphs(d.setup_text or d.in_play_text, kw), inner_w, body_h, 2.8, MIN_BODY, block)
    _text_lines(scene, px + pad, body_top, fit, THEME["ink"], block)


def _in_play(scene: Scene, d: Detachment, size: Size):
    m = size.margin
    cx, cy, cw, ch = m, m, size.width - 2 * m, size.height - 2 * m
    kw = d.keywords

    # Upper strip: the detachment rule.
    strip_h = ch * 0.306
    _panel(scene, cx, cy, cw, strip_h, THEME["parchment"], THEME["parchment_edge"], 0.7, 1.4)
    name = [(d.rule_name.upper(), "bold")]
    nsize = tx.fit_line(name, cw * 0.3 - 6, 3.65, MIN_TITLE, "rule_name")
    tab_w = tx.line_width(name, nsize) + 6
    tab = (cx + 1, cy + 1, tab_w, strip_h - 2)
    scene.add("background", Rect(*tab, THEME["tab_fill"], rx=0.8))
    scene.add("borders", Rect(*tab, stroke=THEME["tab_edge"], sw=0.5, rx=0.8))
    _single(scene, tab[0] + 3, cy + strip_h / 2, name, nsize, THEME["ink"], "start", "rule_name")
    rx_ = tab[0] + tab_w + 2.5
    rule_w = cx + cw - 2.5 - rx_
    fit = tx.fit_block(content.paragraphs(d.in_play_text, kw), rule_w, strip_h - 2.4, 2.4, MIN_BODY, "in_play_text")
    top = cy + (strip_h - tx.block_height(len(fit.lines), fit.size)) / 2
    _text_lines(scene, rx_, top, fit, THEME["ink"], "in_play_text")

    # Lower row: one panel per stratagem, in phase order.
    gap = 1.5
    n = len(d.stratagems)
    py = cy + strip_h + gap
    ph = ch - strip_h - gap
    pw = (cw - gap * (n - 1)) / n
    head_h, bar_h = 5.3, 3.1
    art_h = ph - head_h - bar_h - 2.4
    art_w = min(art_h * 0.79, pw * 0.3)

    bodies = [content.body(s, kw) for s in d.stratagems]
    body_w = pw - art_w - 3.4
    body_h = art_h + 0.6
    # Every stratagem body uses the same size, so the panels look alike: the largest size at which all of them fit.
    fits = [tx.fit_block(b, body_w, body_h, 1.95, MIN_BODY, f"stratagem {s.id}") for b, s in zip(bodies, d.stratagems)]
    common = min(f.size for f in fits)
    fits = [tx.Fit(common, tx.wrap(b, common, body_w)) for b in bodies]

    head_lines = [[(s.name.upper(), "bold")] for s in d.stratagems]
    head_size = min(tx.fit_line(l, pw - 4, 2.7, MIN_TITLE, f"stratagem {s.id} name") for l, s in zip(head_lines, d.stratagems))

    for i, (s, fit, hl) in enumerate(zip(d.stratagems, fits, head_lines)):
        x = cx + i * (pw + gap)
        _panel(scene, x, py, pw, ph, THEME["parchment"], THEME["parchment_edge"], 0.7, 1.2)
        hx, hw = x + 0.7, pw - 1.4
        scene.add("borders", Rect(hx, py + 0.7, hw, head_h, THEME["strat_head"], THEME["strat_head_edge"], 0.3, 0.7))
        scene.add("borders", Rect(hx, py + 0.7 + head_h + 0.2, hw, bar_h, THEME["turn"][s.turn]))
        _single(scene, hx + 1.3, py + 0.7 + head_h / 2, hl, head_size, THEME["ink"], "start", f"{s.id}.name")
        bar_mid = py + 0.9 + head_h + bar_h / 2
        label = [(content.phase_label(s), "bold")]
        cp = [(content.cp_label(s), "bold")]
        _single(scene, hx + 0.9, bar_mid, label, tx.fit_line(label, hw * 0.75, 2.25, MIN_BODY, f"{s.id}.phase"), THEME["bar_text"], "start", f"{s.id}.phase")
        _single(scene, hx + hw - 0.9, bar_mid, cp, 2.35, THEME["bar_text"], "end", f"{s.id}.cp")
        ay = py + 0.9 + head_h + bar_h + 0.9
        scene.add("graphics", Picture(x + 1.0, ay, art_w, art_h, s.art))
        _text_lines(scene, x + 1.0 + art_w + 1.4, ay - 0.3, fit, THEME["ink"], f"{s.id}.body")


def safe_area(size: Size):
    m = size.margin
    return (m, m, size.width - m, size.height - m)


def build(d: Detachment, size: Size, side: str) -> Scene:
    scene = Scene(size.width, size.height)
    _chrome(scene, d, size)
    (_setup if side == "setup" else _in_play)(scene, d, size)
    return scene
