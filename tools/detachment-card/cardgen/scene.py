"""Drawing primitives and the Scene that holds them, one list per layer.

All units are millimetres with the origin at the top left.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from . import text as tx
from .model import Art

LAYERS = ("background", "borders", "graphics", "text", "guides")
HIDDEN_LAYERS = ("guides",)


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float
    fill: str = "none"
    stroke: str = "none"
    sw: float = 0.0
    rx: float = 0.0
    opacity: float = 1.0
    dash: str = ""


@dataclass(frozen=True)
class Circle:
    cx: float
    cy: float
    r: float
    fill: str
    stroke: str = "none"
    sw: float = 0.0


@dataclass(frozen=True)
class Stroke:
    x1: float
    y1: float
    x2: float
    y2: float
    color: str
    sw: float
    opacity: float = 1.0


@dataclass(frozen=True)
class Poly:
    points: tuple  # ((x, y), ...)
    fill: str = "none"
    stroke: str = "none"
    sw: float = 0.0
    opacity: float = 1.0
    closed: bool = True


@dataclass(frozen=True)
class Picture:
    """Artwork from the source file."""

    x: float
    y: float
    w: float
    h: float
    art: Art


@dataclass(frozen=True)
class Bitmap:
    """A generated raster, such as a texture. make(w_px, h_px) returns an RGBA
    PIL image. key must identify the image uniquely; it is the cache key."""

    x: float
    y: float
    w: float
    h: float
    key: str
    make: Callable = field(compare=False, hash=False, repr=False)


@dataclass(frozen=True)
class Text:
    x: float
    y: float  # baseline
    line: tx.Line
    size: float
    color: str
    anchor: str = "start"  # start | middle | end
    block: str = ""  # which source field this line came from
    face: dict = field(default_factory=lambda: dict(tx.CLASSIC), compare=False, hash=False)
    colors: dict = field(default_factory=dict, compare=False, hash=False)  # kind -> colour override
    skew: float = 0.0
    outline: str = ""  # colour of a stroke drawn behind the glyphs
    outline_w: float = 0.0
    shadow: str = ""  # colour of an offset drop shadow
    shadow_dx: float = 0.0
    shadow_dy: float = 0.0

    def width(self) -> float:
        return tx.line_width(self.line, self.size, self.face)

    def left(self) -> float:
        return self.x - {"start": 0, "middle": self.width() / 2, "end": self.width()}[self.anchor]


@dataclass
class Scene:
    width: float
    height: float
    layers: dict = field(default_factory=lambda: {k: [] for k in LAYERS})
    fits: dict = field(default_factory=dict)  # block -> chosen font size, for the build report

    def add(self, layer, *items):
        self.layers[layer].extend(items)


@dataclass(frozen=True)
class ArcText:
    """A line of text along a circle (see text.arc_outline)."""

    cx: float
    cy: float
    radius: float  # baseline radius
    centre: float  # angle of the middle of the line, radians, 0 = top, clockwise
    line: tx.Line
    size: float
    color: str
    face: dict = field(compare=False, hash=False)
    bottom: bool = False
    block: str = ""
    outline: str = ""
    outline_w: float = 0.0
