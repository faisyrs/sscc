"""Build every output for one detachment source file."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import layout, model, render


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(source: str | Path, out_dir: str | Path, sizes=("full", "sticker"), sides=layout.SIDES, psd=True, png=True, style=layout.DEFAULT_STYLE) -> dict:
    d = model.load(source)
    out = Path(out_dir) / d.id
    out.mkdir(parents=True, exist_ok=True)
    report = {
        "detachment": d.id,
        "source_file": Path(source).name,
        "style": style,
        "source_verified": bool(d.source.get("verified_against_source", False)),
        "stratagem_order": [s.id for s in d.stratagems],
        "layers": list(layout.LAYERS),
        "hidden_layers": list(layout.HIDDEN_LAYERS),
        "outputs": {},
    }
    for size_name in sizes:
        size = layout.SIZES[size_name]
        for side in sides:
            scene = layout.build(d, size, side, style)
            stem = f"{d.id}_{style}_{side}_{size_name}"
            files = {}
            svg_path = out / f"{stem}.svg"
            svg_path.write_text(render.layered_svg(scene), encoding="utf-8")
            files["svg"] = svg_path
            if psd or png:
                rasters = render.rasterize(scene)
                if psd:
                    files["psd"] = out / f"{stem}.psd"
                    render.write_psd(rasters, files["psd"])
                if png:
                    files["png"] = out / f"{stem}.png"
                    render.write_png(rasters, files["png"])
            report["outputs"][stem] = {
                "size_mm": [round(size.width, 3), round(size.height, 3)],
                "size_px": [render.px(size.width), render.px(size.height)],
                "font_sizes_mm": dict(sorted(scene.fits.items())),
                "files": {k: {"name": p.name, "sha256": _sha(p)} for k, p in files.items()},
            }
    (out / f"build_report_{style}.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report
