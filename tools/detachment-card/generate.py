#!/usr/bin/env python3
"""Generate layered detachment cards for the 2" x 8" measuring token.

    python generate.py detachments/orks-kult-of-speed/detachment.json
    python generate.py detachments/*/detachment.json --size full --no-psd
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cardgen import build, layout, model, text  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="+", help="detachment.json files")
    ap.add_argument("-o", "--out", default="output", help="output directory (default: output)")
    ap.add_argument("--size", choices=[*layout.SIZES, "all"], default="all")
    ap.add_argument("--side", choices=[*layout.SIDES, "all"], default="all")
    ap.add_argument("--style", choices=[*layout.STYLES, "all"], default=layout.DEFAULT_STYLE, help=f"card style (default: {layout.DEFAULT_STYLE})")
    ap.add_argument("--no-psd", action="store_true", help="skip the PSD files")
    ap.add_argument("--no-png", action="store_true", help="skip the flat PNG previews")
    a = ap.parse_args(argv)
    sizes = tuple(layout.SIZES) if a.size == "all" else (a.size,)
    sides = layout.SIDES if a.side == "all" else (a.side,)
    styles = tuple(layout.STYLES) if a.style == "all" else (a.style,)
    failed = 0
    for src in a.sources:
        for style in styles:
            try:
                r = build.build(src, a.out, sizes, sides, psd=not a.no_psd, png=not a.no_png, style=style)
            except (model.SourceError, text.LayoutError) as e:
                print(f"FAILED {src} ({style}): {e}", file=sys.stderr)
                failed += 1
                continue
            print(f"built {r['detachment']} ({style}): {len(r['outputs'])} card faces -> {Path(a.out) / r['detachment']}")
        if not failed and not r["source_verified"]:
            print(f"  warning: {src} is not marked verified_against_source", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
