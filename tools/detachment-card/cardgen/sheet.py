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
