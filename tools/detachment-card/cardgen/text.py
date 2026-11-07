"""Text measurement, wrapping, fitting and outlining.

The fonts are bundled with the tool and the text is turned into outlines,
so the widths used to wrap a line are the same widths that get drawn. The
output never depends on which fonts the viewing machine has. Kerning is not
applied, so measurement and drawing use the same advance widths.

A run is (text, kind). kind is "regular", "bold" or "ability". A Face maps
each kind to a bundled font, so one style can draw keywords in a bold face
and weapon abilities in a different colour.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parent.parent / "fonts"
FONTS = {
    "dejavu": "DejaVuSansCondensed.ttf",
    "dejavu-bold": "DejaVuSansCondensed-Bold.ttf",
    "barlow-body": "BarlowSemiCondensed-Medium.ttf",
    "barlow-body-bold": "BarlowSemiCondensed-Bold.ttf",
    "barlow-label": "BarlowCondensed-Bold.ttf",
    "barlow-label-semi": "BarlowCondensed-SemiBold.ttf",
    "barlow-display": "BarlowCondensed-BlackItalic.ttf",
}
LEADING = 1.17  # line pitch as a multiple of font size

Face = dict  # kind -> font name
CLASSIC = {"regular": "dejavu", "bold": "dejavu-bold", "ability": "dejavu-bold"}


def face(font: str) -> Face:
    """A face that draws every kind in one font."""
    return {"regular": font, "bold": font, "ability": font}


class LayoutError(ValueError):
    """Text does not fit the box it was given."""


@lru_cache(maxsize=None)
def _font(name: str):
    f = TTFont(FONT_DIR / FONTS[name])
    return f, f.getBestCmap(), f.getGlyphSet(), f["hmtx"], f["head"].unitsPerEm


def ascent(font="dejavu") -> float:
    f, *_, upem = _font(font)
    return f["hhea"].ascent / upem


def descent(font="dejavu") -> float:
    f, *_, upem = _font(font)
    return -f["hhea"].descent / upem


def cap_height(font) -> float:
    f, *_, upem = _font(font)
    os2 = f["OS/2"]
    return getattr(os2, "sCapHeight", 0) / upem or ascent(font) * 0.75


def _glyph(ch: str, font: str) -> str:
    _, cmap, *_ = _font(font)
    name = cmap.get(ord(ch))
    if name is None:
        raise LayoutError(f"character {ch!r} (U+{ord(ch):04X}) is not in the bundled font {FONTS[font]}")
    return name


def width(s: str, size: float, font="dejavu") -> float:
    _, _, _, hmtx, upem = _font(font)
    return sum(hmtx[_glyph(c, font)][0] for c in s) * size / upem


def outline(s: str, x: float, y: float, size: float, font="dejavu", skew: float = 0.0) -> str:
    """SVG path data for s, drawn with its baseline at (x, y). skew slants the glyphs (tan of the angle)."""
    _, _, gs, hmtx, upem = _font(font)
    k = size / upem
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.3f}".rstrip("0").rstrip("."))
    for c in s:
        g = _glyph(c, font)
        gs[g].draw(TransformPen(pen, (k, 0, skew * k, -k, x, y)))
        x += hmtx[g][0] * k
    return pen.getCommands()


Run = tuple[str, str]
Line = list[Run]


def line_width(line: Line, size: float, fc: Face = CLASSIC) -> float:
    return sum(width(t, size, fc[k]) for t, k in line)


def line_text(line: Line) -> str:
    return "".join(t for t, _ in line)


def _kind_mask(text: str, keywords) -> list[str]:
    mask = ["regular"] * len(text)
    for kw in sorted(keywords, key=len, reverse=True):
        kind = "ability" if kw.startswith("[") else "bold"
        for m in re.finditer(r"(?<!\w)" + re.escape(kw) + r"(?!\w)", text):
            for i in range(m.start(), m.end()):
                if mask[i] == "regular":
                    mask[i] = kind
    return mask


def tokenize(text: str, keywords=(), bold_prefix: str = "") -> list[Line]:
    """Split text into words. Each word is a list of runs, because a keyword can
    end mid-word (for example 'FREEKS,'). Keywords in square brackets are
    'ability' runs; other keywords are 'bold'. bold_prefix is a bold lead-in
    such as 'WHEN:'."""
    words = [[(w, "bold")] for w in bold_prefix.split()] if bold_prefix else []
    mask = _kind_mask(text, keywords)
    for m in re.finditer(r"\S+", text):
        runs: Line = []
        for i in range(m.start(), m.end()):
            if runs and runs[-1][1] == mask[i]:
                runs[-1] = (runs[-1][0] + text[i], mask[i])
            else:
                runs.append((text[i], mask[i]))
        words.append(runs)
    return words


def plain(s: str, kind="bold") -> Line:
    return [(s, kind)]


def _join(words: list[Line]) -> Line:
    line: Line = []
    for i, word in enumerate(words):
        # A space between two runs of the same kind takes that kind, so a keyword such as SPEED FREEKS stays one run.
        kind = line[-1][1] if (i and line and line[-1][1] == word[0][1]) else "regular"
        for t, k in ([(" ", kind)] if i else []) + word:
            if line and line[-1][1] == k:
                line[-1] = (line[-1][0] + t, k)
            else:
                line.append((t, k))
    return line


def wrap(paragraphs: list[list[Line]], size: float, max_w: float, fc: Face = CLASSIC) -> list[Line]:
    """Greedy word wrap. Each paragraph starts a new line. Raises LayoutError
    if a single word is wider than max_w."""
    out: list[Line] = []
    for words in paragraphs:
        cur: list[Line] = []
        for word in words:
            if line_width(_join(cur + [word]), size, fc) <= max_w:
                cur.append(word)
                continue
            if not cur or line_width(word, size, fc) > max_w:
                raise LayoutError(f"word {line_text(word)!r} is wider than {max_w:.2f} mm at {size:.2f} mm")
            out.append(_join(cur))
            cur = [word]
        if cur:
            out.append(_join(cur))
    return out


def block_height(n_lines: int, size: float, fc: Face = CLASSIC, leading=LEADING) -> float:
    return (ascent(fc["regular"]) + (n_lines - 1) * leading + descent(fc["regular"])) * size


@dataclass(frozen=True)
class Fit:
    size: float
    lines: list[Line]


def size_steps(max_size: float, min_size: float, step: float = 0.02):
    n = round((max_size - min_size) / step)
    return [round(max_size - i * step, 4) for i in range(n + 1)]


def try_fit(paragraphs, box_w, box_h, size, fc: Face = CLASSIC, leading=LEADING):
    try:
        lines = wrap(paragraphs, size, box_w, fc)
    except LayoutError:
        return None
    return Fit(size, lines) if block_height(len(lines), size, fc, leading) <= box_h else None


def fit_block(paragraphs, box_w, box_h, max_size, min_size, what, fc: Face = CLASSIC, leading=LEADING) -> Fit:
    """Largest font size (in 0.02 mm steps) at which the paragraphs fit the box."""
    for size in size_steps(max_size, min_size):
        fit = try_fit(paragraphs, box_w, box_h, size, fc, leading)
        if fit:
            return fit
    raise LayoutError(
        f"{what}: does not fit {box_w:.1f} x {box_h:.1f} mm even at the minimum size of {min_size} mm. "
        "Shorten the text or lower the minimum size in the layout."
    )


def fit_line(line: Line, box_w: float, max_size: float, min_size: float, what: str, fc: Face = CLASSIC) -> float:
    """Largest size at which a single unwrapped line fits box_w."""
    for size in size_steps(max_size, min_size):
        if line_width(line, size, fc) <= box_w:
            return size
    raise LayoutError(f"{what}: {line_text(line)!r} does not fit {box_w:.1f} mm even at {min_size} mm")
