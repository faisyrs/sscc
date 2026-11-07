# Detachment card generator

Generates the rules card for the 2" × 8" combination measuring token from a
detachment source file, in one of two styles:

- `grunge` (default): riveted, worn metal plates, parchment panels, hazard-striped ends and heavy italic display type. On the full-size print the outline has the token's 1-inch notches cut into it.
- `classic`: the original flat layout.

Each card face is written as a **layered** file:

| Layer        | Contents                                                        |
|--------------|-----------------------------------------------------------------|
| `background` | metal plate and panel surfaces (parchment)                      |
| `borders`    | frames, rivets, hazard stripes, seams, and label plates (title, tabs, CP badges, phase ribbons) |
| `graphics`   | hero art, stratagem art, faction icon, rule icon, checker flag  |
| `text`       | every word on the card                                          |
| `guides`     | *hidden*: trim line, safe area, 1-inch notch stations           |

For every detachment it writes, per size (`full` 203.2 × 50.8 mm, `sticker`
199.2 × 46.8 mm for the token's 2 mm pocket) and per side (`setup`, `in_play`):

- `*.psd`: 300 DPI, one pixel layer per row above with real transparency, plus a merged image. Opens in Photoshop, GIMP, Affinity and Photopea.
- `*.svg`: vector, with the same layers as Inkscape layers. Physical size is in mm.
- `*.png`: flat 300 DPI preview.

Files are named `<id>_<style>_<side>_<size>`. Each style writes its own `build_report_<style>.json`.
- `build_report.json`: stratagem order, the font size chosen for each text block, and a SHA-256 for every file.

## Usage

```sh
pip install -r requirements.txt
python generate.py detachments/orks-kult-of-speed/detachment.json      # -> output/orks-kult-of-speed/
python generate.py detachments/*/detachment.json --size full --no-psd
python generate.py detachments/orks-kult-of-speed/detachment.json --style all    # grunge and classic
python -m unittest discover -s tests
```

## Why the output is predictable

- **The source file is the only input.** Names, rules text, keywords, the setup
  headline and which art goes with which stratagem all come from
  `detachment.json`. The code has no detachment-specific strings.
- **Fonts are bundled** (`fonts/`: DejaVu Sans Condensed for classic, Barlow for grunge, both freely licensed) and the text is drawn
  as outlines, so a line is drawn exactly as wide as it was measured, on any
  machine. Each outline keeps its wording in a `<title>`.
- **Text is fitted, never squeezed.** Each block takes the largest size, in
  0.02 mm steps, that fits its box. All stratagem bodies share one size. If
  text cannot fit at the minimum size (1.4 mm, about 4 pt), or uses a character
  the font doesn't have, the build **fails** and names the field. It never
  draws text that overflows its box.
- **Validation first.** A missing field, unknown phase or turn, duplicate id,
  missing image or bad crop stops the build with the JSON path of the problem.
- **Deterministic.** The textures (metal, parchment, chipped paint, hazard
  stripes) are generated from seeds made of the detachment id and each part's
  name. Two builds of
  the same source give byte-identical files, and a test checks this.
- **Tests check the wording.** The drawn lines are joined back together and
  compared with the source text, so a word that was dropped or changed fails
  the test.

## Adding a detachment

Copy `detachments/orks-kult-of-speed/` and edit `detachment.json`:

- `detachment_rule.parts[]`: each part has `display_context` `setup` (setup side) or `in_play` (top strip of the in-play side).
- `detachment_rule.setup_headline`: the one-line summary on the setup side.
- `stratagems[]`: `phase` is one of command, movement, shooting, charge, fight, any, or a list such as `["shooting", "fight"]`, which is sorted by its first phase. `turn` is one of your, opponent, either. Panels are sorted by phase, and stratagems in the same phase keep their file order. Any number of stratagems is laid out; the build fails if they don't fit.
- `effect`: separate paragraphs with `\n`. Start a bullet paragraph with `• `.
- `upgrade` (optional): `{ "extra_cp": 1, "text": "..." }` for the app's "Or: ... +1CP". The badge then reads `1/2 CP` and the body ends with `OR (+1CP): ...`.
- `detachment_rule.parts[]` with `display_context: "setup"` is optional. Without one, the setup side shows the rule's full text.
- Art with a transparent background is detected automatically. It is trimmed to its visible edges, fitted whole into its slot, and drawn without a frame.
- The grunge style tries a few panel widths and art sizes for the stratagem row and keeps the one that gives the largest text. Equal panels and large art are kept unless changing them makes the text noticeably bigger.
- A source missing a required field, such as `orks-wreckas` until its detachment page is transcribed, fails the build with the field's JSON path.
- `keywords[]`: exact phrases drawn in bold wherever they appear. Keywords in square brackets, such as `[ASSAULT]`, are weapon abilities; grunge draws them in red.
- `faction_icon` (optional): shown at the top right of the grunge setup side. Without it, the faction plate takes the space.
- `hero_art` and `stratagems[].art`: `{ "file": "art/x.png", "crop": [left, top, right, bottom] }`. The crop is in fractions of the image and is optional. The art is then cover-fitted, centred, to its slot.

In the grunge in-play strip, each `in_play` part gets its own column. The
columns are sized so they wrap to the same number of lines.

- **Colours and geometry:** `cardgen/styles/grunge.py` and `cardgen/styles/classic.py`. Token sizes are in `cardgen/geometry.py`.
- **Adding a style:** add a module under `cardgen/styles/` with `build(d, size, side)` and `safe_area(size)`, then register it in `cardgen/layout.py`.

`hardware/token_2x8.scad` is the OpenSCAD model of the token itself. It is not part of the card build.
