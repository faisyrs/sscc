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

from . import text as tx
from .layout import HIDDEN_LAYERS, LAYERS, Circle, Picture, Rect, Scene, Stroke, Text

DPI = 300


def _n(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def px(mm: float) -> int:
    return round(mm / 25.4 * DPI)


@lru_cache(maxsize=None)
def _prepared_png(path, crop, w_px: int, h_px: int) -> bytes:
    """Crop the art to its crop box, cover-fit it to the target aspect (centred),
    and resample it to the exact print pixels. The PNG is embedded in the SVG,
    so no viewer has to scale it."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        W, H = im.size
        l, t, r, b = crop[0] * W, crop[1] * H, crop[2] * W, crop[3] * H
        cw, ch = r - l, b - t
        target = w_px / h_px
        if cw / ch > target:  # too wide: trim the sides
            nw = ch * target
            l, r = l + (cw - nw) / 2, l + (cw + nw) / 2
        else:  # too tall: trim the top and bottom
            nh = cw / target
            t, b = t + (ch - nh) / 2, t + (ch + nh) / 2
        out = im.resize((w_px, h_px), Image.Resampling.LANCZOS, box=(l, t, r, b))
        buf = io.BytesIO()
        out.save(buf, "PNG", optimize=False, compress_level=6)
        return buf.getvalue()


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
        data = _prepared_png(p.art.path, p.art.crop, px(p.w), px(p.h))
        b64 = base64.b64encode(data).decode()
        return (
            f'<image x="{_n(p.x)}" y="{_n(p.y)}" width="{_n(p.w)}" height="{_n(p.h)}" '
            f'preserveAspectRatio="none" xlink:href="data:image/png;base64,{b64}"><title>{escape(p.art.path.name)}</title></image>'
        )
    if isinstance(p, Text):
        total = tx.line_width(p.line, p.size)
        x = p.x - {"start": 0, "middle": total / 2, "end": total}[p.anchor]
        d = []
        for run, bold in p.line:
            d.append(tx.outline(run, x, p.y, p.size, bold))
            x += tx.width(run, p.size, bold)
        # The <title> keeps the wording searchable and readable in editors; the path is what gets drawn.
        return (
            f'<path data-block="{escape(p.block)}" fill="{p.color}" d="{" ".join(c for c in d if c)}">'
            f"<title>{escape(tx.line_text(p.line))}</title></path>"
        )
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
