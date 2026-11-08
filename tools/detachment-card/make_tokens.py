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

FRONT_BLEED = 1.5  # mm
BACK_BLEED = 3.0  # mm; wider, so a back glued slightly off still covers the cut edge


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
                bled = tokens.build(t, side, FRONT_BLEED if side == "front" else BACK_BLEED)
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
    pairs = []
    for t in sorted(toks, key=lambda t: -t.sticker_d):
        png = {s: p for tt, s, p in discs if tt.id == t.id}
        for _ in range(t.count):
            pairs.append((sheet.Disc(png["front"], t.sticker_d, FRONT_BLEED, f"{t.id} ({t.sticker_d:g} mm)"),
                          sheet.Disc(png["back"], t.sticker_d, BACK_BLEED, "")))
    pdf = out / f"token_sheets_{a.paper}.pdf"
    n = sheet.write_duplex(pairs, pdf, a.paper)
    pngs = sheet.pdf_to_pngs(pdf)
    # Name the page images by sheet and side: the PDF alternates front, back.
    named = []
    for i, p in enumerate(pngs):
        target = p.with_name(f"token_sheet{i // 2 + 1}_{'front' if i % 2 == 0 else 'back'}_{a.paper}.png")
        p.replace(target)
        named.append(target.name)
    if named:
        print(f"wrote {len(named)} page PNG(s) at 300 DPI: {', '.join(named)}")
    print(f"built {len(toks)} tokens; wrote {pdf}: {len(pairs)} tokens on {n} sheet(s), each a front page and a back page")
    return 0


if __name__ == "__main__":
    sys.exit(main())
