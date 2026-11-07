"""Fit source artwork into a slot at exact print pixels."""
from functools import lru_cache

from PIL import Image


@lru_cache(maxsize=64)
def fit(path, crop, transparent, w_px: int, h_px: int) -> Image.Image:
    """Crop the art to its crop box and resample it to exactly w_px x h_px.

    Opaque art is cover-fitted: it fills the slot, centred, and the overflow is
    trimmed. Art with a transparent background has its empty margin trimmed and
    is then contain-fitted: all of it is shown, centred, and it keeps its
    transparency."""
    with Image.open(path) as im:
        im = im.convert("RGBA")
        W, H = im.size
        l, t, r, b = crop[0] * W, crop[1] * H, crop[2] * W, crop[3] * H
        cw, ch = r - l, b - t
        target = w_px / h_px
        if transparent:
            # Trim the empty transparent margin so the art fills as much of the slot as it can.
            box = im.crop((round(l), round(t), round(r), round(b))).getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
            if box:
                l, t, r, b = round(l) + box[0], round(t) + box[1], round(l) + box[2], round(t) + box[3]
                cw, ch = r - l, b - t
            scale = min(w_px / cw, h_px / ch)
            fw, fh = max(1, round(cw * scale)), max(1, round(ch * scale))
            fitted = im.resize((fw, fh), Image.Resampling.LANCZOS, box=(l, t, r, b))
            out = Image.new("RGBA", (w_px, h_px), (0, 0, 0, 0))
            out.paste(fitted, ((w_px - fw) // 2, (h_px - fh) // 2))
        else:
            if cw / ch > target:  # too wide: trim the sides
                nw = ch * target
                l, r = l + (cw - nw) / 2, l + (cw + nw) / 2
            else:  # too tall: trim the top and bottom
                nh = cw / target
                t, b = t + (ch - nh) / 2, t + (ch + nh) / 2
            out = im.convert("RGB").resize((w_px, h_px), Image.Resampling.LANCZOS, box=(l, t, r, b))
        return out
