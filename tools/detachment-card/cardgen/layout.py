"""Choose a style and build the scene for one card face."""
from __future__ import annotations

from . import geometry  # noqa: F401
from .geometry import INCH, SIDES, SIZES, Size  # noqa: F401  (re-exported)
from .model import Detachment
from .scene import HIDDEN_LAYERS, LAYERS, Bitmap, Circle, Picture, Poly, Rect, Scene, Stroke, Text  # noqa: F401
from .styles import classic, grunge

STYLES = {"grunge": grunge, "classic": classic}
DEFAULT_STYLE = "grunge"


def build(d: Detachment, size: Size, side: str, style: str = DEFAULT_STYLE) -> Scene:
    if side not in SIDES:
        raise ValueError(f"side must be one of {SIDES}")
    if style not in STYLES:
        raise ValueError(f"style must be one of {tuple(STYLES)}")
    return STYLES[style].build(d, size, side)
