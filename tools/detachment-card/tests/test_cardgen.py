"""Run with:  python -m unittest discover -s tests   (from tools/detachment-card)"""
import copy
import hashlib
import json
import re
import shutil
import sys
import tempfile
import unittest
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from psd_tools import PSDImage  # noqa: E402

from cardgen import build, layout, model, render, text  # noqa: E402

SOURCE = ROOT / "detachments/orks-kult-of-speed/detachment.json"


def raw():
    return json.loads(SOURCE.read_text(encoding="utf-8"))


def parse(data):
    return model.parse(data, SOURCE.parent)


def norm(s):
    return " ".join(s.split())


class SourceValidation(unittest.TestCase):
    def test_loads(self):
        d = model.load(SOURCE)
        self.assertEqual(d.detachment_points, 1)
        self.assertIn("within 3”", next(s for s in d.stratagems if s.id == "delicious-eating-squigs").effect)

    def test_phase_order_with_stable_ties(self):
        d = model.load(SOURCE)
        self.assertEqual([s.id for s in d.stratagems], ["delicious-eating-squigs", "dakkastorm", "speediest-freeks"])

    def test_rejects_bad_input(self):
        cases = {
            "schema_version": lambda d: d.update(schema_version="1.0.0"),
            "$.name": lambda d: d.pop("name"),
            "$.stratagems[0].phase": lambda d: d["stratagems"][0].update(phase="deployment"),
            "$.stratagems[0].turn": lambda d: d["stratagems"][0].update(turn="mine"),
            "$.stratagems[0].cp": lambda d: d["stratagems"][0].update(cp="1"),
            "$.stratagems[1].id": lambda d: d["stratagems"][1].update(id=d["stratagems"][0]["id"]),
            "$.stratagems[0].art.file": lambda d: d["stratagems"][0]["art"].update(file="art/missing.png"),
            "$.hero_art.crop": lambda d: d["hero_art"].update(crop=[0, 0, 1.5, 1]),
            "$.detachment_rule.parts": lambda d: d["detachment_rule"].update(
                parts=[p for p in d["detachment_rule"]["parts"] if p["display_context"] != "setup"]
            ),
            "$.detachment_rule.setup_headline": lambda d: d["detachment_rule"].pop("setup_headline"),
        }
        for where, mutate in cases.items():
            with self.subTest(where):
                data = raw()
                mutate(data)
                with self.assertRaises(model.SourceError) as cm:
                    parse(data)
                self.assertIn(where, str(cm.exception))


class Layout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = model.load(SOURCE)
        cls.scenes = {
            (st, z, s): layout.build(cls.d, layout.SIZES[z], s, st)
            for st in layout.STYLES
            for z in layout.SIZES
            for s in layout.SIDES
        }

    def lines(self, scene, block):
        return [p for p in scene.layers["text"] if isinstance(p, layout.Text) and p.block == block]

    def test_rendered_text_is_the_source_text(self):
        """Joining the drawn lines back together must give the source wording exactly, with no words dropped or changed."""
        d = self.d
        for (st, z, side), sc in self.scenes.items():
            with self.subTest(style=st, size=z, side=side):
                got = lambda b: norm(" ".join(text.line_text(t.line) for t in self.lines(sc, b)))
                if side == "setup":
                    self.assertEqual(got("name"), d.name.upper())
                    self.assertEqual(got("setup_text"), norm(d.setup_text))
                    if st == "classic":
                        self.assertEqual(got("setup_headline"), d.setup_headline.upper())
                        self.assertEqual(got("detachment_points"), f"{d.detachment_points} DP")
                    else:
                        self.assertEqual(got("rule_name"), d.rule_name.upper())
                        self.assertIn(f"({d.detachment_points} DP)", got("faction_points"))
                        self.assertIn(d.disposition.upper(), got("disposition"))
                else:
                    self.assertEqual(got("rule_name"), d.rule_name.upper())
                    self.assertEqual(got("in_play_text"), norm(d.in_play_text))
                    for s in d.stratagems:
                        self.assertEqual(got(f"{s.id}.name"), s.name.upper())
                        self.assertEqual(got(f"{s.id}.cp"), f"{s.cp} CP")
                        self.assertEqual(got(f"{s.id}.body"), norm(f"WHEN: {s.when} TARGET: {s.target} EFFECT: {s.effect}"))

    def test_stratagem_panels_follow_phase_order(self):
        for st in layout.STYLES:
            sc = self.scenes[(st, "full", "in_play")]
            xs = [self.lines(sc, f"{s.id}.name")[0].x for s in self.d.stratagems]
            self.assertEqual(xs, sorted(xs))

    def test_text_and_art_inside_the_safe_area(self):
        for (st, z, side), sc in self.scenes.items():
            x0, y0, x1, y1 = layout.STYLES[st].safe_area(layout.SIZES[z])
            for layer in ("graphics", "text"):
                for p in sc.layers[layer]:
                    if isinstance(p, layout.Text):
                        box = (p.left(), p.y - text.ascent(p.face["regular"]) * p.size, p.left() + p.width(), p.y + text.descent(p.face["regular"]) * p.size)
                    elif isinstance(p, layout.Picture):
                        box = (p.x, p.y, p.x + p.w, p.y + p.h)
                    else:
                        continue
                    with self.subTest(style=st, size=z, side=side, block=getattr(p, "block", "")):
                        self.assertGreaterEqual(box[0], x0 - 1e-6)
                        self.assertGreaterEqual(box[1], y0 - 1e-6)
                        self.assertLessEqual(box[2], x1 + 1e-6)
                        self.assertLessEqual(box[3], y1 + 1e-6)

    def test_keywords_are_marked(self):
        for st in layout.STYLES:
            sc = self.scenes[(st, "full", "in_play")]
            runs = [(t, k) for p in self.lines(sc, "in_play_text") for t, k in p.line]
            self.assertTrue(any("SPEED FREEKS" in t and k == "bold" for t, k in runs))
            self.assertTrue(any("[ASSAULT]" in t and k == "ability" for t, k in runs))

    def test_grunge_outline_has_the_token_notches_on_full_size_only(self):
        from cardgen.styles import grunge

        full = grunge.silhouette(layout.SIZES["full"], 2.2)
        sticker = grunge.silhouette(layout.SIZES["sticker"], 1.6)
        tips = [(x, y) for x, y in full if y in (layout.geometry.NOTCH_DEPTH, layout.SIZES["full"].height - layout.geometry.NOTCH_DEPTH)]
        self.assertEqual(sorted({round(x, 3) for x, _ in tips}), [round(i * layout.INCH, 3) for i in range(1, 8)])
        self.assertEqual(len(tips), 14)
        self.assertEqual(len(sticker), 8)

    def test_text_that_cannot_fit_fails_loudly(self):
        data = raw()
        data["stratagems"][0]["effect"] = "Lorem ipsum dolor sit amet. " * 40
        for st in layout.STYLES:
            with self.subTest(style=st), self.assertRaises(text.LayoutError) as cm:
                layout.build(parse(data), layout.SIZES["full"], "in_play", st)
            self.assertIn("dakkastorm", str(cm.exception))

    def test_missing_glyph_fails_loudly(self):
        data = raw()
        data["stratagems"][0]["effect"] = "Roll a die 漢."
        for st in layout.STYLES:
            with self.subTest(style=st), self.assertRaises(text.LayoutError):
                layout.build(parse(data), layout.SIZES["full"], "in_play", st)

    def test_layout_supports_other_stratagem_counts(self):
        data = raw()
        extra = copy.deepcopy(data["stratagems"][0])
        extra.update(id="extra", name="Extra", phase="fight", effect="Short.")
        data["stratagems"].append(extra)
        for st in layout.STYLES:
            sc = layout.build(parse(data), layout.SIZES["full"], "in_play", st)
            self.assertEqual(len([p for p in sc.layers["graphics"] if isinstance(p, layout.Picture)]), 4)

    def test_faction_icon_is_optional(self):
        data = raw()
        data.pop("faction_icon")
        sc = layout.build(parse(data), layout.SIZES["full"], "setup", "grunge")
        self.assertEqual(len([p for p in sc.layers["graphics"] if isinstance(p, layout.Picture)]), 1)


class Outputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.r1 = {st: build.build(SOURCE, cls.tmp / "a", sizes=("full",), style=st) for st in layout.STYLES}
        cls.r2 = {st: build.build(SOURCE, cls.tmp / "b", sizes=("full",), style=st) for st in layout.STYLES}
        cls.dir = cls.tmp / "a" / "orks-kult-of-speed"

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def test_builds_are_byte_identical(self):
        for st in layout.STYLES:
            for stem, out in self.r1[st]["outputs"].items():
                for kind, f in out["files"].items():
                    with self.subTest(stem=stem, kind=kind):
                        self.assertEqual(f["sha256"], self.r2[st]["outputs"][stem]["files"][kind]["sha256"])

    def test_psd_layers(self):
        for st in layout.STYLES:
            for side in layout.SIDES:
                with self.subTest(style=st, side=side):
                    psd = PSDImage.open(self.dir / f"orks-kult-of-speed_{st}_{side}_full.psd")
                    self.assertEqual(psd.size, (2400, 600))
                    self.assertEqual([l.name for l in psd], list(layout.LAYERS))
                    self.assertEqual([l.visible for l in psd], [n not in layout.HIDDEN_LAYERS for n in layout.LAYERS])
                    self.assertEqual(psd.image_resources.get_data(1005).horizontal >> 16, 300)

    def test_layers_hold_only_their_own_content(self):
        for st in layout.STYLES:
            psd = PSDImage.open(self.dir / f"orks-kult-of-speed_{st}_in_play_full.psd")
            layers = {l.name: l.topil().convert("RGBA") for l in psd}
            bg = layers["background"].getchannel("A")
            self.assertEqual(bg.getpixel((bg.width // 2, bg.height // 2)), 255)
            if st == "grunge":  # the notch at the 4-inch station is cut out of the plate
                self.assertEqual(bg.getpixel((bg.width // 2, 2)), 0)
            for name in ("borders", "graphics", "text"):
                alpha = layers[name].getchannel("A")
                covered = sum(1 for a in alpha.getdata() if a) / (alpha.width * alpha.height)
                with self.subTest(style=st, layer=name):
                    self.assertGreater(covered, 0.005)
                    self.assertLess(covered, 0.6)

    def test_svg_has_named_layers_and_text_titles(self):
        for st in layout.STYLES:
            svg = (self.dir / f"orks-kult-of-speed_{st}_in_play_full.svg").read_text(encoding="utf-8")
            self.assertEqual(re.findall(r'inkscape:label="([^"]+)"', svg), list(layout.LAYERS))
            self.assertNotIn("<text", svg)  # text is drawn as outlines, so it never depends on installed fonts
            titles = unescape(" ".join(re.findall(r"<title>([^<]*)</title>", svg)))
            self.assertIn("ADRENALINE JUNKIES", titles)

    def test_report_records_hashes(self):
        for st in layout.STYLES:
            rep = json.loads((self.dir / f"build_report_{st}.json").read_text(encoding="utf-8"))
            for out in rep["outputs"].values():
                for f in out["files"].values():
                    self.assertEqual(f["sha256"], hashlib.sha256((self.dir / f["name"]).read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
