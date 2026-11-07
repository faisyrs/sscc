#!/usr/bin/env python3
"""Lay out built card faces on sticker-paper pages, as a PDF.

Run generate.py first. Then, for example:

    python make_sheet.py detachments/*/detachment.json
    python make_sheet.py detachments/*/detachment.json --paper a4 --size full

Each detachment's two sides stay on the same page. Pages are filled in the
order the sources are given.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cardgen import layout, model, sheet  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="+", help="detachment.json files")
    ap.add_argument("-o", "--out", default="output", help="the directory generate.py wrote to (default: output)")
    ap.add_argument("--size", choices=list(layout.SIZES), default="sticker", help="sticker (default, fits the token's pocket) or full")
    ap.add_argument("--style", choices=list(layout.STYLES), default=layout.DEFAULT_STYLE)
    ap.add_argument("--paper", choices=list(sheet.PAPERS), default="letter")
    ap.add_argument("--pdf", help="output PDF path (default: <out>/stickers_<style>_<size>_<paper>.pdf)")
    a = ap.parse_args(argv)

    size = layout.SIZES[a.size]
    room = sheet.per_page(size.height, a.paper)
    pages, page = [], []
    for src in a.sources:
        d = model.load(src)
        faces = []
        for side, label in (("setup", "setup side"), ("in_play", "in-play side")):
            png = Path(a.out) / d.id / f"{d.id}_{a.style}_{side}_{a.size}.png"
            if not png.is_file():
                print(f"missing {png}: run generate.py first", file=sys.stderr)
                return 1
            faces.append(sheet.Face(png, size.width, size.height, f"{d.name}: {label}  ({size.width:g} x {size.height:g} mm)"))
        if len(page) + len(faces) > room:
            pages.append(page)
            page = []
        page.extend(faces)
    pages.append(page)

    pdf = Path(a.pdf or Path(a.out) / f"stickers_{a.style}_{a.size}_{a.paper}.pdf")
    sheet.write(pages, pdf, a.paper)
    print(f"wrote {pdf}: {sum(map(len, pages))} stickers on {len(pages)} page(s), {room} per page max")
    return 0


if __name__ == "__main__":
    sys.exit(main())
