"""Text measurement, wrapping, fitting and outlining.

The fonts are bundled with the tool and the text is turned into outlines,
so the widths used to wrap a line are the same widths that get drawn. The
output never depends on which fonts the viewing machine has. Kerning is not
applied, so measurement and drawing use the same advance widths.
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
FONT_FILES = {False: "DejaVuSansCondensed.ttf", True: "DejaVuSansCondensed-Bold.ttf"}
LEADING = 1.17  # line pitch as a multiple of font size


class LayoutError(ValueError):
    """Text does not fit the box it was given."""


@lru_cache(maxsize=None)
def _font(bold: bool):
    f = TTFont(FONT_DIR / FONT_FILES[bold])
    upem = f["head"].unitsPerEm
    return f, f.getBestCmap(), f.getGlyphSet(), f["hmtx"], upem


def ascent(bold=False) -> float:
    f, *_, upem = _font(bold)
    return f["hhea"].ascent / upem


def descent(bold=False) -> float:
    f, *_, upem = _font(bold)
    return -f["hhea"].descent / upem


def _glyph(ch: str, bold: bool) -> str:
    _, cmap, *_ = _font(bold)
    name = cmap.get(ord(ch))
    if name is None:
        raise LayoutError(f"character {ch!r} (U+{ord(ch):04X}) is not in the bundled font")
    return name


def width(s: str, size: float, bold=False) -> float:
    _, _, _, hmtx, upem = _font(bold)
    return sum(hmtx[_glyph(c, bold)][0] for c in s) * size / upem


def outline(s: str, x: float, y: float, size: float, bold=False) -> str:
    """SVG path data for s, drawn with its baseline at (x, y)."""
    _, _, gs, hmtx, upem = _font(bold)
    k = size / upem
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.3f}".rstrip("0").rstrip("."))
    for c in s:
        g = _glyph(c, bold)
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x, y)))
        x += hmtx[g][0] * k
    return pen.getCommands()


# A run is (text, bold). A line is a list of runs.
Run = tuple[str, bool]
Line = list[Run]


def line_width(line: Line, size: float) -> float:
    return sum(width(t, size, b) for t, b in line)


def line_text(line: Line) -> str:
    return "".join(t for t, _ in line)


def _bold_mask(text: str, keywords) -> list[bool]:
    mask = [False] * len(text)
    for kw in sorted(keywords, key=len, reverse=True):
        for m in re.finditer(r"(?<!\w)" + re.escape(kw) + r"(?!\w)", text):
            for i in range(m.start(), m.end()):
                mask[i] = True
    return mask


def tokenize(text: str, keywords=(), bold_prefix: str = "") -> list[list[Run]]:
    """Split text into words. Each word is a list of runs, because a keyword can
    end mid-word (for example 'FREEKS,'). bold_prefix is a bold lead-in such
    as 'WHEN:'."""
    words = []
    if bold_prefix:
        words.extend([[(w, True)] for w in bold_prefix.split()])
    mask = _bold_mask(text, keywords)
    for m in re.finditer(r"\S+", text):
        runs: list[Run] = []
        for i in range(m.start(), m.end()):
            if runs and runs[-1][1] == mask[i]:
                runs[-1] = (runs[-1][0] + text[i], mask[i])
            else:
                runs.append((text[i], mask[i]))
        words.append(runs)
    return words


def _join(words: list[list[Run]]) -> Line:
    line: Line = []
    for i, word in enumerate(words):
        # A space between two bold runs is bold too, so a keyword such as SPEED FREEKS stays one bold run.
        space = [(" ", bool(line) and line[-1][1] and word[0][1])] if i else []
        for t, b in space + word:
            if line and line[-1][1] == b:
                line[-1] = (line[-1][0] + t, b)
            else:
                line.append((t, b))
    return line


def wrap(paragraphs: list[list[list[Run]]], size: float, max_w: float) -> list[Line]:
    """Greedy word wrap. Each paragraph starts a new line. Raises LayoutError
    if a single word is wider than max_w."""
    out: list[Line] = []
    for words in paragraphs:
        cur: list[list[Run]] = []
        for word in words:
            trial = _join(cur + [word])
            if line_width(trial, size) <= max_w:
                cur.append(word)
                continue
            if not cur:
                raise LayoutError(f"word {line_text(_join([word]))!r} is wider than {max_w:.2f} mm at {size:.2f} mm")
            out.append(_join(cur))
            cur = [word]
            if line_width(_join(cur), size) > max_w:
                raise LayoutError(f"word {line_text(_join(cur))!r} is wider than {max_w:.2f} mm at {size:.2f} mm")
        if cur:
            out.append(_join(cur))
    return out


def block_height(n_lines: int, size: float) -> float:
    return (ascent() + (n_lines - 1) * LEADING + descent()) * size


@dataclass(frozen=True)
class Fit:
    size: float
    lines: list[Line]


def size_steps(max_size: float, min_size: float, step: float = 0.02):
    n = round((max_size - min_size) / step)
    return [round(max_size - i * step, 4) for i in range(n + 1)]


def fit_block(paragraphs, box_w: float, box_h: float, max_size: float, min_size: float, what: str) -> Fit:
    """Largest font size (in 0.02 mm steps) at which the paragraphs fit the box."""
    for size in size_steps(max_size, min_size):
        try:
            lines = wrap(paragraphs, size, box_w)
        except LayoutError:
            continue
        if block_height(len(lines), size) <= box_h:
            return Fit(size, lines)
    raise LayoutError(
        f"{what}: does not fit {box_w:.1f} x {box_h:.1f} mm even at the minimum size of {min_size} mm. "
        "Shorten the text or lower the minimum size in the layout."
    )


def fit_line(line: Line, box_w: float, max_size: float, min_size: float, what: str) -> float:
    """Largest size at which a single unwrapped line fits box_w."""
    for size in size_steps(max_size, min_size):
        if line_width(line, size) <= box_w:
            return size
    raise LayoutError(f"{what}: {line_text(line)!r} does not fit {box_w:.1f} mm even at {min_size} mm")
