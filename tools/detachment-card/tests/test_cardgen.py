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

from cardgen import build, content, layout, model, render, text  # noqa: E402

SOURCE = ROOT / "detachments/orks-kult-of-speed/detachment.json"
BULLY = ROOT / "detachments/orks-bully-boyz/detachment.json"
WRECKAS = ROOT / "detachments/orks-wreckas/detachment.json"
COMPLETE = (SOURCE, BULLY, WRECKAS)


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
        self.assertIn("within 3\"", next(s for s in d.stratagems if s.id == "delicious-eating-squigs").effect)

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
            "$.background_art.crop": lambda d: d["background_art"].update(crop=[0, 0, 1.5, 1]),
            "$.hero_art": lambda d: d.pop("background_art"),
            "$.theme.title_plate": lambda d: d.update(theme={"title_plate": [300, 0, 0]}),
            "$.background_focus": lambda d: d.update(background_focus="top"),
            "$.theme.accent": lambda d: d.update(theme={"accent": "#ffffff"}),
            "$.detachment_rule.parts": lambda d: d["detachment_rule"].update(
                parts=[p for p in d["detachment_rule"]["parts"] if p["display_context"] != "in_play"]
            ),
            "$.stratagems[2].phase": lambda d: d["stratagems"][2].update(phase=["movement", "movement"]),
            "$.stratagems[0].upgrade.extra_cp": lambda d: d["stratagems"][0].update(upgrade={"extra_cp": 0, "text": "x"}),
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
                        self.assertEqual(got(f"{s.id}.body"), norm(content.body_text(s)))

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
        assert "faction_icon" not in data
        icon = {"file": "art/dakka.png"}
        with_icon = layout.build(parse({**data, "faction_icon": icon}), layout.SIZES["full"], "setup", "grunge")
        without = layout.build(parse(data), layout.SIZES["full"], "setup", "grunge")
        count = lambda sc: len([p for p in sc.layers["graphics"] if isinstance(p, layout.Picture)])
        self.assertEqual(count(with_icon) - count(without), 1)

    def test_background_art_fills_the_card_on_its_own_layer(self):
        sc = layout.build(model.load(SOURCE), layout.SIZES["full"], "setup", "grunge")
        bg = sc.layers["background"]
        self.assertEqual(len(bg), 1)
        self.assertEqual((bg[0].x, bg[0].y, bg[0].w, bg[0].h), (0, 0, sc.width, sc.height))


class OtherDetachments(unittest.TestCase):
    """Every complete source builds in every style and size, and its cards say exactly what the source says."""

    def test_every_source_matches_its_cards(self):
        for src in COMPLETE:
            d = model.load(src)
            for st in layout.STYLES:
                for z in layout.SIZES:
                    for side in layout.SIDES:
                        sc = layout.build(d, layout.SIZES[z], side, st)
                        drawn = {}
                        for p in sc.layers["text"]:
                            if isinstance(p, layout.Text):
                                drawn.setdefault(p.block, []).append(text.line_text(p.line))
                        got = lambda b: norm(" ".join(drawn.get(b, [])))
                        with self.subTest(source=d.id, style=st, size=z, side=side):
                            if side == "in_play":
                                self.assertEqual(got("in_play_text"), norm(d.in_play_text))
                                for s in d.stratagems:
                                    self.assertEqual(got(f"{s.id}.body"), norm(content.body_text(s)))
                                    self.assertEqual(got(f"{s.id}.cp"), content.cp_label(s))
                                    if st == "grunge":
                                        self.assertEqual(got(f"{s.id}.phase"), content.phase_label(s))
                            else:
                                block = "setup_text" if d.setup_text else "rule_text"
                                self.assertEqual(got(block), norm(d.setup_text or d.in_play_text))

    def test_bully_boyz_source_features(self):
        d = model.load(BULLY)
        by = {s.id: s for s in d.stratagems}
        self.assertEqual(d.setup_text, "")
        self.assertEqual(by["armed-to-da-teef"].phases, ("shooting", "fight"))
        self.assertEqual(content.phase_label(by["armed-to-da-teef"]), "SHOOTING OR FIGHT PHASE")
        self.assertEqual(content.cp_label(by["hulking-brutes"]), "1/2 CP")
        self.assertIn("OR (+1CP): Ranged attacks that target your unit have -1 to wound rolls.", content.body_text(by["hulking-brutes"]))
        self.assertEqual(by["armed-to-da-teef"].effect_paragraphs, ("Your unit’s attacks can:", "• Re-roll hit rolls of 1.", "• If your unit is riled up, re-roll hit rolls."))
        # Sorted by first phase; same-phase stratagems keep their source order.
        self.assertEqual([s.id for s in d.stratagems], ["hulking-brutes", "armed-to-da-teef", "too-arrogant-to-die"])
        self.assertFalse(by["hulking-brutes"].art.transparent)
        self.assertFalse(model.load(SOURCE).stratagems[0].art.transparent)

    def test_transparent_art_keeps_its_transparency(self):
        art = model._art({"file": "art/hulking-brutes-a.png"}, "$", BULLY.parent)
        self.assertTrue(art.transparent)
        from io import BytesIO
        from PIL import Image

        im = Image.open(BytesIO(render._prepared_png(art.path, art.crop, art.transparent, 200, 300)))
        self.assertEqual(im.mode, "RGBA")
        self.assertEqual(im.getpixel((0, 0))[3], 0)

    def test_theme_recolours_plates_but_not_phase_colours(self):
        from cardgen.styles import grunge

        plain = layout.build(model.load(SOURCE), layout.SIZES["full"], "in_play", "grunge")
        themed = layout.build(model.load(BULLY), layout.SIZES["full"], "in_play", "grunge")
        self.assertEqual(grunge.Kit(themed, model.load(BULLY), layout.SIZES["full"]).c["yellow"], (226, 221, 208))
        self.assertEqual(grunge.Kit(plain, model.load(SOURCE), layout.SIZES["full"]).c["yellow"], grunge.C["yellow"])
        self.assertEqual(grunge.Kit(themed, model.load(BULLY), layout.SIZES["full"]).c["ribbon"], grunge.C["ribbon"])

    def test_incomplete_source_refuses_to_build(self):
        data = json.loads(WRECKAS.read_text(encoding="utf-8"))
        data.pop("detachment_rule")
        with self.assertRaises(model.SourceError) as cm:
            model.parse(data, WRECKAS.parent)
        self.assertIn("$.detachment_rule", str(cm.exception))

    def test_bulleted_rule_keeps_its_bullets_on_their_own_lines(self):
        d = model.load(WRECKAS)
        sc = layout.build(d, layout.SIZES["full"], "in_play", "grunge")
        lines = [text.line_text(p.line) for p in sc.layers["text"] if isinstance(p, layout.Text) and p.block == "in_play_text"]
        self.assertTrue(lines[-2].startswith("• That unit is within range"))
        self.assertTrue(lines[-1].startswith("• The target of that attack"))


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


class Tokens(unittest.TestCase):
    SRC = ROOT / "tokens/orks.json"

    @classmethod
    def setUpClass(cls):
        from cardgen import tokens

        cls.tk = tokens
        cls.toks = tokens.load(cls.SRC)

    def drawn(self, scene, block):
        from cardgen.scene import ArcText

        return norm(" ".join(text.line_text(p.line) for p in scene.layers["text"] if isinstance(p, (layout.Text, ArcText)) and p.block == block))

    def test_every_face_builds_and_keeps_its_wording(self):
        for t in self.toks:
            with self.subTest(token=t.id):
                front, back = self.tk.build(t, "front"), self.tk.build(t, "back")
                self.assertEqual(self.drawn(front, "title"), t.title)
                self.assertEqual(self.drawn(front, "effect"), norm(" ".join(t.effect)))
                self.assertEqual(self.drawn(back, "back_title"), t.back_title)
                self.assertEqual(self.drawn(back, "back"), norm(" ".join(t.back)))

    def test_text_stays_inside_the_face(self):
        import math

        for t in self.toks:
            for side in self.tk.SIDES:
                sc = self.tk.build(t, side)
                c, r = sc.width / 2, t.sticker_d / 2
                for p in sc.layers["text"]:
                    if not isinstance(p, layout.Text):
                        continue
                    x0, x1 = p.left(), p.left() + p.width()
                    top, bot = p.y - text.ascent(p.face["regular"]) * p.size, p.y + text.descent(p.face["regular"]) * p.size
                    for x, y in ((x0, top), (x1, top), (x0, bot), (x1, bot)):
                        with self.subTest(token=t.id, side=side, block=p.block):
                            self.assertLessEqual(math.hypot(x - c, y - c), r + 1e-6)

    def test_sizes_and_enemy_ring(self):
        by = {t.id: t for t in self.toks}
        self.assertTrue(all(t.sticker_d >= 60.0 for t in self.toks))
        by_turn = {turn: {t.id for t in self.toks if t.turn == turn} for turn in self.tk.TURNS}
        self.assertEqual(by_turn["opponent"], {"speediest", "brutes"})
        self.assertTrue({"riled-up-motivation", "riled-up-race", "riled-up-flyboss"} <= by_turn["your"])
        self.assertEqual({t.id for t in self.toks if t.theme == "misc"}, {"grab-it", "secured"})

    def test_curved_titles_stay_inside_the_stripe(self):
        from cardgen.scene import ArcText

        for t in self.toks:
            g = self.tk.rings(t, 0)
            for side in self.tk.SIDES:
                for p in self.tk.build(t, side).layers["text"]:
                    if isinstance(p, ArcText):
                        cap = text.cap_height(p.face["regular"]) * p.size
                        with self.subTest(token=t.id, side=side, block=p.block):
                            self.assertLessEqual(p.radius + cap, g.face + 1e-6)  # inside the face, clear of the stripe

    def test_riled_up_fronts_name_their_source(self):
        by = {t.id: t for t in self.toks}
        for tid, via in (("riled-up-motivation", "INTIMIDATING MOTIVATION"), ("riled-up-race", "GET BACK IN DA RACE!"), ("riled-up-flyboss", "FLYBOSS")):
            self.assertEqual(self.drawn(self.tk.build(by[tid], "front"), "via"), via)

    def test_duplex_backs_mirror_their_fronts(self):
        from cardgen import sheet

        tmp = Path(tempfile.mkdtemp())
        try:
            t = self.toks[0]
            png = tmp / "x.png"
            from PIL import Image

            Image.new("RGBA", (10, 10)).save(png)
            pairs = [(sheet.Disc(png, t.sticker_d, 1.5, "f"), sheet.Disc(png, t.sticker_d, 3.0, ""))] * 3
            calls = []
            orig = sheet.canvas.Canvas.drawImage
            sheet.canvas.Canvas.drawImage = lambda self, img, x, y, w, h, **k: calls.append((x + w / 2, y + h / 2))
            try:
                sheet.write_duplex(pairs, tmp / "d.pdf")
            finally:
                sheet.canvas.Canvas.drawImage = orig
            fronts, backs = calls[:3], calls[3:]
            pw = sheet.PAPERS["letter"][0] * sheet.mm
            for (fx, fy), (bx, by_) in zip(fronts, backs):
                self.assertAlmostEqual(fx, pw - bx, places=6)
                self.assertAlmostEqual(fy, by_, places=6)
        finally:
            shutil.rmtree(tmp)

    def test_bad_token_data_fails(self):
        data = json.loads(self.SRC.read_text(encoding="utf-8"))
        data["tokens"][0]["icon"] = "nope"
        tmp = Path(tempfile.mkdtemp()) / "t.json"
        tmp.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(self.tk.TokenError) as cm:
            self.tk.load(tmp)
        self.assertIn("$.tokens[0].icon", str(cm.exception))
        shutil.rmtree(tmp.parent)
