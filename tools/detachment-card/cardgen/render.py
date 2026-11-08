"""Write a Scene out as a layered SVG, a layered PSD and a flat PNG preview.

The raster layers are rendered from the same SVG markup as the vector file,
one layer at a time, so the PSD and the SVG always match.
"""
from __future__ import annotations

import base64
import io
from functools import lru_cache
from html import escape

import cairosvg
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer

from . import artfit
from . import text as tx
from .scene import HIDDEN_LAYERS, LAYERS, ArcText, Bitmap, Circle, Picture, Poly, Rect, Scene, Stroke, Text

DPI = 300


def _n(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def px(mm: float) -> int:
    return round(mm / 25.4 * DPI)


@lru_cache(maxsize=None)
def _prepared_png(path, crop, transparent, w_px: int, h_px: int) -> bytes:
    """The art fitted to the slot at exact print pixels (see artfit.fit), as PNG.
    The PNG is embedded in the SVG, so no viewer has to scale it."""
    buf = io.BytesIO()
    artfit.fit(path, crop, transparent, w_px, h_px).save(buf, "PNG", optimize=False, compress_level=6)
    return buf.getvalue()


_BITMAPS: dict = {}


def _bitmap_png(key, w_px, h_px, make) -> bytes:
    k = (key, w_px, h_px)
    if k not in _BITMAPS:
        buf = io.BytesIO()
        make(w_px, h_px).save(buf, "PNG", optimize=False, compress_level=6)
        _BITMAPS[k] = buf.getvalue()
    return _BITMAPS[k]


def _text_paths(p: Text, dx=0.0, dy=0.0) -> list[tuple[str, str]]:
    """(kind, path data) for each run of the line."""
    x = p.left() + dx
    out = []
    for run, kind in p.line:
        font = p.face[kind]
        out.append((kind, tx.outline(run, x, p.y + dy, p.size, font, p.skew)))
        x += tx.width(run, p.size, font)
    return out


def _text(p: Text) -> str:
    """A line of text as outlines. The <title> keeps the wording searchable and
    readable in editors; the paths are what gets drawn."""
    parts = []
    if p.shadow:
        d = " ".join(c for _, c in _text_paths(p, p.shadow_dx, p.shadow_dy) if c)
        parts.append(f'<path fill="{p.shadow}" stroke="{p.shadow}" stroke-width="{_n(p.outline_w)}" stroke-linejoin="round" d="{d}"/>')
    runs = _text_paths(p)
    if p.outline:
        d = " ".join(c for _, c in runs if c)
        parts.append(f'<path fill="{p.outline}" stroke="{p.outline}" stroke-width="{_n(p.outline_w * 2)}" stroke-linejoin="round" d="{d}"/>')
    for kind, d in runs:
        if d:
            parts.append(f'<path fill="{p.colors.get(kind, p.color)}" d="{d}"/>')
    return f'<g data-block="{escape(p.block)}"><title>{escape(tx.line_text(p.line))}</title>{"".join(parts)}</g>'


def _element(p) -> str:
    if isinstance(p, Rect):
        extra = f' stroke-dasharray="{p.dash}"' if p.dash else ""
        op = f' opacity="{_n(p.opacity)}"' if p.opacity != 1 else ""
        return (
            f'<rect x="{_n(p.x)}" y="{_n(p.y)}" width="{_n(p.w)}" height="{_n(p.h)}" rx="{_n(p.rx)}" '
            f'fill="{p.fill}" stroke="{p.stroke}" stroke-width="{_n(p.sw)}"{extra}{op}/>'
        )
    if isinstance(p, Circle):
        return f'<circle cx="{_n(p.cx)}" cy="{_n(p.cy)}" r="{_n(p.r)}" fill="{p.fill}" stroke="{p.stroke}" stroke-width="{_n(p.sw)}"/>'
    if isinstance(p, Stroke):
        return (
            f'<line x1="{_n(p.x1)}" y1="{_n(p.y1)}" x2="{_n(p.x2)}" y2="{_n(p.y2)}" stroke="{p.color}" '
            f'stroke-width="{_n(p.sw)}" opacity="{_n(p.opacity)}"/>'
        )
    if isinstance(p, Picture):
        data = _prepared_png(p.art.path, p.art.crop, p.art.transparent, px(p.w), px(p.h))
        b64 = base64.b64encode(data).decode()
        return (
            f'<image x="{_n(p.x)}" y="{_n(p.y)}" width="{_n(p.w)}" height="{_n(p.h)}" '
            f'preserveAspectRatio="none" xlink:href="data:image/png;base64,{b64}"><title>{escape(p.art.path.name)}</title></image>'
        )
    if isinstance(p, Poly):
        pts = " ".join(f"{_n(x)},{_n(y)}" for x, y in p.points)
        tag = "polygon" if p.closed else "polyline"
        op = f' opacity="{_n(p.opacity)}"' if p.opacity != 1 else ""
        return f'<{tag} points="{pts}" fill="{p.fill}" stroke="{p.stroke}" stroke-width="{_n(p.sw)}" stroke-linejoin="round"{op}/>'
    if isinstance(p, Bitmap):
        w_px, h_px = px(p.w), px(p.h)
        b64 = base64.b64encode(_bitmap_png(p.key, w_px, h_px, p.make)).decode()
        return (
            f'<image x="{_n(p.x)}" y="{_n(p.y)}" width="{_n(p.w)}" height="{_n(p.h)}" '
            f'preserveAspectRatio="none" xlink:href="data:image/png;base64,{b64}"/>'
        )
    if isinstance(p, Text):
        return _text(p)
    if isinstance(p, ArcText):
        runs = tx.arc_outline(p.line, p.size, p.face, p.cx, p.cy, p.radius, p.centre, p.bottom)
        parts = []
        for colour, w, op in p.halo:
            d = " ".join(c for _, c in runs if c)
            parts.append(f'<path fill="{colour}" fill-opacity="{_n(op)}" stroke="{colour}" stroke-opacity="{_n(op)}" '
                         f'stroke-width="{_n(w * 2)}" stroke-linejoin="round" d="{d}"/>')
        if p.outline:
            d = " ".join(c for _, c in runs if c)
            parts.append(f'<path fill="{p.outline}" stroke="{p.outline}" stroke-width="{_n(p.outline_w * 2)}" stroke-linejoin="round" d="{d}"/>')
        parts += [f'<path fill="{p.color}" d="{d}"/>' for _, d in runs if d]
        return f'<g data-block="{escape(p.block)}"><title>{escape(tx.line_text(p.line))}</title>{"".join(parts)}</g>'
    raise TypeError(p)


def _layer_group(scene: Scene, name: str, force_visible=False) -> str:
    hidden = name in HIDDEN_LAYERS and not force_visible
    style = ' style="display:none"' if hidden else ""
    body = "".join(_element(p) for p in scene.layers[name])
    return f'<g id="layer-{name}" inkscape:groupmode="layer" inkscape:label="{name}"{style}>{body}</g>'


def _svg(scene: Scene, layers, force_visible=False) -> str:
    groups = "".join(_layer_group(scene, n, force_visible) for n in layers)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" '
        f'width="{_n(scene.width)}mm" height="{_n(scene.height)}mm" viewBox="0 0 {_n(scene.width)} {_n(scene.height)}">'
        f"{groups}</svg>\n"
    )


def layered_svg(scene: Scene) -> str:
    return _svg(scene, LAYERS)


def raster_layer(scene: Scene, name: str) -> Image.Image:
    svg = _svg(scene, [name], force_visible=True)
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=px(scene.width), output_height=px(scene.height))
    return Image.open(io.BytesIO(png)).convert("RGBA")


def rasterize(scene: Scene) -> dict[str, Image.Image]:
    return {name: raster_layer(scene, name) for name in LAYERS}


def composite(rasters: dict[str, Image.Image]) -> Image.Image:
    out = Image.new("RGBA", next(iter(rasters.values())).size, (0, 0, 0, 0))
    for name in LAYERS:
        if name not in HIDDEN_LAYERS:
            out = Image.alpha_composite(out, rasters[name])
    return out


def write_psd(rasters: dict[str, Image.Image], path) -> None:
    flat = composite(rasters)
    # RGBA mode stores each layer's alpha as real layer transparency. In RGB mode
    # psd-tools would turn the alpha into a layer mask instead.
    psd = PSDImage.new("RGBA", flat.size)
    for name in LAYERS:  # bottom to top
        layer = PixelLayer.frompil(rasters[name], psd, name)
        layer.visible = name not in HIDDEN_LAYERS
    _set_resolution(psd)
    psd.save(str(path))


def _set_resolution(psd) -> None:
    """Record 300 DPI so the file opens at its physical size."""
    from psd_tools.constants import Resource
    from psd_tools.psd import image_resources as ir

    # psd-tools spells the class "ResoulutionInfo"; accept either spelling.
    info_cls = getattr(ir, "ResolutionInfo", None) or getattr(ir, "ResoulutionInfo")
    fixed = DPI << 16  # 16.16 fixed point
    info = info_cls(horizontal=fixed, horizontal_unit=1, width_unit=1, vertical=fixed, vertical_unit=1, height_unit=1)
    psd.image_resources[Resource.RESOLUTION_INFO] = ir.ImageResource(key=Resource.RESOLUTION_INFO, data=info)


def write_png(rasters, path) -> None:
    composite(rasters).convert("RGB").save(str(path), "PNG", dpi=(DPI, DPI))
