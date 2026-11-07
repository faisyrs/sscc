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
        cls.scenes = {(z, s): layout.build(cls.d, layout.SIZES[z], s) for z in layout.SIZES for s in layout.SIDES}

    def lines(self, scene, block):
        return [p for p in scene.layers["text"] if p.block == block]

    def test_rendered_text_is_the_source_text(self):
        """Joining the drawn lines back together must give the source wording exactly, with no words dropped or changed."""
        d = self.d
        for (z, side), sc in self.scenes.items():
            with self.subTest(size=z, side=side):
                got = lambda b: norm(" ".join(text.line_text(t.line) for t in self.lines(sc, b)))
                if side == "setup":
                    self.assertEqual(got("name"), d.name.upper())
                    self.assertEqual(got("setup_text"), norm(d.setup_text))
                    self.assertEqual(got("setup_headline"), d.setup_headline.upper())
                    self.assertEqual(got("detachment_points"), f"{d.detachment_points} DP")
                else:
                    self.assertEqual(got("rule_name"), d.rule_name.upper())
                    self.assertEqual(got("in_play_text"), norm(d.in_play_text))
                    for s in d.stratagems:
                        self.assertEqual(got(f"{s.id}.name"), s.name.upper())
                        self.assertEqual(got(f"{s.id}.cp"), f"{s.cp} CP")
                        self.assertEqual(got(f"{s.id}.body"), norm(f"WHEN: {s.when} TARGET: {s.target} EFFECT: {s.effect}"))

    def test_stratagem_panels_follow_phase_order(self):
        sc = self.scenes[("full", "in_play")]
        xs = [self.lines(sc, f"{s.id}.name")[0].x for s in self.d.stratagems]
        self.assertEqual(xs, sorted(xs))

    def test_everything_inside_the_safe_area(self):
        for (z, side), sc in self.scenes.items():
            m = layout.SIZES[z].margin
            for layer in ("graphics", "text"):
                for p in sc.layers[layer]:
                    with self.subTest(size=z, side=side, layer=layer):
                        if isinstance(p, layout.Text):
                            w = text.line_width(p.line, p.size)
                            x0 = p.x - {"start": 0, "middle": w / 2, "end": w}[p.anchor]
                            box = (x0, p.y - text.ascent() * p.size, x0 + w, p.y + text.descent() * p.size)
                        else:
                            box = (p.x, p.y, p.x + p.w, p.y + p.h)
                        self.assertGreaterEqual(box[0], m - 1e-6)
                        self.assertGreaterEqual(box[1], m - 1e-6)
                        self.assertLessEqual(box[2], sc.width - m + 1e-6)
                        self.assertLessEqual(box[3], sc.height - m + 1e-6)

    def test_keywords_are_bold(self):
        sc = self.scenes[("full", "in_play")]
        bold = {t for p in self.lines(sc, "in_play_text") for t, b in p.line if b}
        self.assertTrue(any("SPEED FREEKS" in t for t in bold))
        self.assertTrue(any("[ASSAULT]" in t for t in bold))

    def test_text_that_cannot_fit_fails_loudly(self):
        data = raw()
        data["stratagems"][0]["effect"] = "Lorem ipsum dolor sit amet. " * 40
        with self.assertRaises(text.LayoutError) as cm:
            layout.build(parse(data), layout.SIZES["full"], "in_play")
        self.assertIn("dakkastorm", str(cm.exception))

    def test_missing_glyph_fails_loudly(self):
        data = raw()
        data["stratagems"][0]["effect"] = "Roll a die 漢."
        with self.assertRaises(text.LayoutError):
            layout.build(parse(data), layout.SIZES["full"], "in_play")

    def test_layout_supports_other_stratagem_counts(self):
        data = raw()
        extra = copy.deepcopy(data["stratagems"][0])
        extra.update(id="extra", name="Extra", phase="fight", effect="Short.")
        data["stratagems"].append(extra)
        sc = layout.build(parse(data), layout.SIZES["full"], "in_play")
        self.assertEqual(len([p for p in sc.layers["graphics"]]), 4)


class Outputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.r1 = build.build(SOURCE, cls.tmp / "a", sizes=("full",))
        cls.r2 = build.build(SOURCE, cls.tmp / "b", sizes=("full",))
        cls.dir = cls.tmp / "a" / "orks-kult-of-speed"

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def test_builds_are_byte_identical(self):
        for stem, out in self.r1["outputs"].items():
            for kind, f in out["files"].items():
                with self.subTest(stem=stem, kind=kind):
                    self.assertEqual(f["sha256"], self.r2["outputs"][stem]["files"][kind]["sha256"])

    def test_psd_layers(self):
        for side in layout.SIDES:
            with self.subTest(side=side):
                psd = PSDImage.open(self.dir / f"orks-kult-of-speed_{side}_full.psd")
                self.assertEqual(psd.size, (2400, 600))
                self.assertEqual([l.name for l in psd], list(layout.LAYERS))
                self.assertEqual([l.visible for l in psd], [n not in layout.HIDDEN_LAYERS for n in layout.LAYERS])
                self.assertEqual(psd.image_resources.get_data(1005).horizontal >> 16, 300)

    def test_layers_hold_only_their_own_content(self):
        psd = PSDImage.open(self.dir / "orks-kult-of-speed_in_play_full.psd")
        layers = {l.name: l.topil().convert("RGBA") for l in psd}
        # The background is opaque everywhere; the layers above it are mostly transparent.
        self.assertEqual(layers["background"].getchannel("A").getextrema(), (255, 255))
        for name in ("borders", "graphics", "text"):
            alpha = layers[name].getchannel("A")
            covered = sum(1 for a in alpha.getdata() if a) / (alpha.width * alpha.height)
            with self.subTest(layer=name):
                self.assertGreater(covered, 0.005)
                self.assertLess(covered, 0.5)

    def test_svg_has_named_layers_and_text_titles(self):
        svg = (self.dir / "orks-kult-of-speed_in_play_full.svg").read_text(encoding="utf-8")
        self.assertEqual(re.findall(r'inkscape:label="([^"]+)"', svg), list(layout.LAYERS))
        self.assertNotIn("<text", svg)  # text is drawn as outlines, so it never depends on installed fonts
        titles = unescape(" ".join(re.findall(r"<path[^>]*><title>([^<]*)</title>", svg)))
        self.assertIn("ADRENALINE JUNKIES", titles)

    def test_report_records_hashes(self):
        rep = json.loads((self.dir / "build_report.json").read_text(encoding="utf-8"))
        for out in rep["outputs"].values():
            for f in out["files"].values():
                self.assertEqual(f["sha256"], hashlib.sha256((self.dir / f["name"]).read_bytes()).hexdigest())


if __name__ == "__main__":
    unittest.main()
