#!/usr/bin/env python3
"""Build the round state and tracker tokens: layered SVG, PSD and PNG for each
face, plus a sticker-sheet PDF.

    python make_tokens.py                       # tokens/orks.json -> output/tokens/
    python make_tokens.py tokens/orks.json --paper a4 --no-psd

Each token's front and back sit next to each other on the sheet, repeated
`count` times, largest tokens first.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cardgen import render, sheet, text, tokens  # noqa: E402

SHEET_BLEED = 1.0  # mm


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", default="tokens/orks.json")
    ap.add_argument("-o", "--out", default="output/tokens")
    ap.add_argument("--paper", choices=list(sheet.PAPERS), default="letter")
    ap.add_argument("--no-psd", action="store_true")
    a = ap.parse_args(argv)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        toks = tokens.load(a.source)
    except tokens.TokenError as e:
        print(f"FAILED {a.source}: {e}", file=sys.stderr)
        return 1
    discs = []
    for t in sorted(toks, key=lambda t: -t.sticker_d):
        for side in tokens.SIDES:
            stem = out / f"{t.id}_{side}"
            try:
                scene = tokens.build(t, side)
                bled = tokens.build(t, side, SHEET_BLEED)
            except text.LayoutError as e:
                print(f"FAILED {t.id} {side}: {e}", file=sys.stderr)
                return 1
            stem.with_suffix(".svg").write_text(render.layered_svg(scene), encoding="utf-8")
            rasters = render.rasterize(scene)
            if not a.no_psd:
                render.write_psd(rasters, stem.with_suffix(".psd"))
            render.composite(rasters).save(stem.with_suffix(".png"), dpi=(render.DPI, render.DPI))  # keeps transparency
            sheet_png = out / f"_sheet_{t.id}_{side}.png"
            render.composite(render.rasterize(bled)).save(sheet_png, dpi=(render.DPI, render.DPI))
            discs.append((t, side, sheet_png))
    order = []
    for t in sorted(toks, key=lambda t: -t.sticker_d):
        for _ in range(t.count):
            for side in tokens.SIDES:
                png = next(p for tt, s, p in discs if tt.id == t.id and s == side)
                order.append(sheet.Disc(png, t.sticker_d, SHEET_BLEED, f"{t.id} {side} ({t.sticker_d:g} mm)"))
    pdf = out / f"token_stickers_{a.paper}.pdf"
    pages = sheet.write_discs(order, pdf, a.paper)
    pngs = sheet.pdf_to_pngs(pdf)
    if pngs:
        print(f"wrote {len(pngs)} page PNG(s) at 300 DPI: {', '.join(p.name for p in pngs)}")
    print(f"built {len(toks)} tokens ({len(toks) * 2} faces); wrote {pdf}: {len(order)} stickers on {pages} page(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
