"""Lay out card faces on a printable sticker-paper PDF.

Each face is drawn at its exact physical size, using the 300 DPI pixels the
build wrote. Each face gets a bleed: its edge pixels are extended outward, so
a slightly-off cut never shows white paper. Crop marks in the gaps between
faces show the true trim line, and a small label under each face names it.
"""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .render import DPI

PAPERS = {"letter": (215.9, 279.4), "a4": (210.0, 297.0)}
BLEED = 1.5  # mm the artwork extends past the trim line
MARGIN = 10.0  # mm kept clear at the top and bottom of the page
SIDE_CLEAR = 3.0  # mm kept clear at the page sides; most printers can print this close
MARK_LEN, MARK_GAP = 4.0, 1.0  # crop mark length and its distance from the bleed edge
LABEL_H = 4.0  # mm reserved under each face for its label


@dataclass(frozen=True)
class Face:
    png: Path
    width: float  # trim size, mm
    height: float
    label: str


def _with_bleed(png: Path, bleed_mm: float) -> Image.Image:
    im = np.asarray(Image.open(png).convert("RGB"))
    pad = round(bleed_mm / 25.4 * DPI)
    return Image.fromarray(np.pad(im, ((pad, pad), (pad, pad), (0, 0)), mode="edge"))


def _crop_marks(c: canvas.Canvas, x: float, y: float, w: float, h: float, side_len: float):
    """Marks at each corner of the trim box, kept outside the bleed. Coordinates in mm, origin bottom-left.
    side_len is the length of the side arms, which is shortened when the page is narrow."""
    o = BLEED + MARK_GAP
    c.setLineWidth(0.25)
    c.setStrokeColorRGB(0, 0, 0)
    for cx, dx in ((x, -1), (x + w, 1)):
        for cy, dy in ((y, -1), (y + h, 1)):
            # horizontal mark, level with the trim edge, outside the bleed; left out when there's no room
            if side_len >= 1.0:
                c.line((cx + dx * o) * mm, cy * mm, (cx + dx * (o + side_len)) * mm, cy * mm)
            # vertical mark
            c.line(cx * mm, (cy + dy * o) * mm, cx * mm, (cy + dy * (o + MARK_LEN)) * mm)


def per_page(face_h: float, paper: str) -> int:
    """How many faces fit down one page, each with its bleed, crop marks and label."""
    _, page_h = PAPERS[paper]
    slot = face_h + 2 * (BLEED + MARK_GAP + MARK_LEN) + LABEL_H
    return int((page_h - 2 * MARGIN) // slot)


def write(pages: list[list[Face]], out: str | Path, paper: str = "letter", title: str = "") -> None:
    """One page per list of faces. Faces are centred across the page and spread evenly down it."""
    pw, ph = PAPERS[paper]
    c = canvas.Canvas(str(out), pagesize=(pw * mm, ph * mm))
    c.setTitle(title or "Detachment card stickers")
    c.setCreator("tools/detachment-card")
    for n, faces in enumerate(pages, 1):
        if not faces:
            continue
        for f in faces:
            if (pw - f.width) / 2 - BLEED < SIDE_CLEAR:
                raise ValueError(f"{f.label}: {f.width} mm is too wide for {paper} paper")
        slot = max(f.height for f in faces) + 2 * (BLEED + MARK_GAP + MARK_LEN) + LABEL_H
        if slot * len(faces) > ph - 2 * MARGIN:
            raise ValueError(f"page {n}: {len(faces)} faces do not fit on {paper} paper; at most {per_page(faces[0].height, paper)}")
        gap = (ph - 2 * MARGIN - slot * len(faces)) / len(faces)
        top = ph - MARGIN - gap / 2
        for f in faces:
            x = (pw - f.width) / 2
            y = top - (BLEED + MARK_GAP + MARK_LEN) - f.height  # bottom of the trim box
            buf = io.BytesIO()
            _with_bleed(f.png, BLEED).save(buf, "PNG")
            buf.seek(0)
            c.drawImage(ImageReader(buf), (x - BLEED) * mm, (y - BLEED) * mm, (f.width + 2 * BLEED) * mm, (f.height + 2 * BLEED) * mm)
            _crop_marks(c, x, y, f.width, f.height, min(MARK_LEN, x - BLEED - MARK_GAP - SIDE_CLEAR))
            c.setFont("Helvetica", 6.5)
            c.setFillColorRGB(0.35, 0.35, 0.35)
            c.drawString(x * mm, (y - BLEED - MARK_GAP - MARK_LEN - 1.0) * mm, f.label)
            top -= slot + gap
        c.setFont("Helvetica", 6.5)
        c.setFillColorRGB(0.35, 0.35, 0.35)
        c.drawRightString((pw - MARGIN) * mm, (MARGIN / 2) * mm, f"Print at 100% (actual size), not 'fit to page'. Page {n} of {len(pages)}")
        c.showPage()
    c.save()


@dataclass(frozen=True)
class Disc:
    png: Path  # RGBA, already including the bleed
    diameter: float  # cut diameter, mm
    bleed: float
    label: str


DISC_TICK_GAP, DISC_TICK_LEN = 0.5, 1.5  # mm; short, so three 60 mm tokens fit across a Letter page


def _ticks(c: canvas.Canvas, cx: float, cy: float, r: float, bleed: float = BLEED):
    """Four short marks pointing at the cut circle from outside the bleed. Coordinates in mm."""
    o = bleed + DISC_TICK_GAP
    c.setLineWidth(0.25)
    c.setStrokeColorRGB(0, 0, 0)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        c.line((cx + dx * (r + o)) * mm, (cy + dy * (r + o)) * mm, (cx + dx * (r + o + DISC_TICK_LEN)) * mm, (cy + dy * (r + o + DISC_TICK_LEN)) * mm)


def _registration(c: canvas.Canvas, pw: float, ph: float):
    """Crosshair targets near the four corners. The set is symmetric left to right,
    so the targets on a front page and its mirrored back page coincide."""
    c.setLineWidth(0.25)
    c.setStrokeColorRGB(0, 0, 0)
    for x in (SIDE_CLEAR + 3.0, pw - SIDE_CLEAR - 3.0):
        for y in (MARGIN / 2 + 1.0, ph - MARGIN / 2 - 1.0):
            c.circle(x * mm, y * mm, 1.6 * mm)
            c.line((x - 2.6) * mm, y * mm, (x + 2.6) * mm, y * mm)
            c.line(x * mm, (y - 2.6) * mm, x * mm, (y + 2.6) * mm)


def write_duplex(pairs: list[tuple[Disc, Disc]], out: str | Path, paper: str = "letter", title: str = "") -> int:
    """Fronts and backs on facing pages: page 1 front, page 1 back, page 2 front, and so on.

    Each back is placed at the mirror-image position of its front (x -> page
    width - x). So when the front page is glued to one side of a card and the back
    page to the other side, with the registration targets lined up, every back sits
    behind its front. It also matches two-sided printing with long-edge flip.
    Cut ticks and labels are on the fronts only. Returns the number of sheets."""
    pw, ph = PAPERS[paper]
    tick = DISC_TICK_GAP + DISC_TICK_LEN
    # Lay out positions once, then draw both sides from the same positions.
    placed, sheets = [], [[]]
    x0, x1 = SIDE_CLEAR + 2.0, pw - SIDE_CLEAR - 2.0
    y_top, x, row_h = ph - MARGIN - 3.0, x0, 0.0
    for front, back in pairs:
        reach = max(front.bleed + tick, back.bleed)  # radius beyond the cut line that this cell needs
        cell = front.diameter + 2 * reach + 1.0
        if x + cell > x1 + 1e-6:
            x, y_top, row_h = x0, y_top - row_h, 0.0
        if y_top - (cell + 3.0) < MARGIN + 3.0:
            sheets.append([])
            x, y_top, row_h = x0, ph - MARGIN - 3.0, 0.0
        sheets[-1].append((x + cell / 2, y_top - cell / 2, cell, front, back))
        x += cell
        row_h = max(row_h, cell + 3.0)

    c = canvas.Canvas(str(out), pagesize=(pw * mm, ph * mm))
    c.setTitle(title or "Token stickers, fronts and backs")
    c.setCreator("tools/detachment-card")
    n = len(sheets)
    for i, sheet_items in enumerate(sheets, 1):
        for side in ("front", "back"):
            for cx, cy, cell, front, back in sheet_items:
                d = front if side == "front" else back
                if side == "back":
                    cx = pw - cx
                size = d.diameter + 2 * d.bleed
                c.drawImage(ImageReader(str(d.png)), (cx - size / 2) * mm, (cy - size / 2) * mm, size * mm, size * mm, mask="auto")
                if side == "front":
                    _ticks(c, cx, cy, d.diameter / 2, d.bleed)
                    c.setFont("Helvetica", 5)
                    c.setFillColorRGB(0.4, 0.4, 0.4)
                    c.drawCentredString(cx * mm, (cy - cell / 2 - 1.2) * mm, d.label)
            _registration(c, pw, ph)
            c.setFont("Helvetica", 6.5)
            c.setFillColorRGB(0.35, 0.35, 0.35)
            what = ("FRONT: glue to the front of the card" if side == "front"
                    else f"BACK: glue to the back of the card, lined up with sheet {i} FRONT")
            c.drawCentredString(pw / 2 * mm, (MARGIN / 2) * mm, f"Sheet {i} of {n}, {what}. Print at 100% (actual size).")
            c.showPage()
    c.save()
    return n


def pdf_to_pngs(pdf: str | Path, dpi: int = 300) -> list[Path]:
    """Rasterize each page of the PDF to a PNG at `dpi` (Letter at 300 DPI is 2550 x 3300 px).
    Needs poppler's pdftoppm. Returns the PNG paths, or [] if pdftoppm isn't installed."""
    import shutil
    import subprocess

    from PIL import Image

    if not shutil.which("pdftoppm"):
        return []
    pdf = Path(pdf)
    prefix = pdf.with_suffix("")
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", str(pdf), str(prefix) + "_page"], check=True)
    pages = sorted(pdf.parent.glob(prefix.name + "_page-*.png"))
    for p in pages:  # record the DPI so the image opens at its printed size
        with Image.open(p) as im:
            im.load()
            im.save(p, dpi=(dpi, dpi))
    return pages
