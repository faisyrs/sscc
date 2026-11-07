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

## Sticker sheet

```sh
python make_sheet.py detachments/*/detachment.json              # US Letter
python make_sheet.py detachments/*/detachment.json --paper a4
```

Run this after `generate.py`. It writes `output/stickers_<style>_<size>_<paper>.pdf`, with the pocket-size stickers at 100% scale. Each sticker has a 1.5 mm bleed, made by extending its edge pixels, and crop marks at the trim line. Both sides of a detachment stay on the same page, with up to 4 stickers per page. On A4 the page is too narrow for side crop marks, so only the top and bottom marks are drawn. Print at actual size, not "fit to page".

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
- `effect` and rule `parts[].text`: separate paragraphs with `\n`. Start a bullet paragraph with `• `.
- `upgrade` (optional): `{ "extra_cp": 1, "text": "..." }` for the app's "Or: ... +1CP". The badge then reads `1/2 CP` and the body ends with `OR (+1CP): ...`.
- `detachment_rule.parts[]` with `display_context: "setup"` is optional. Without one, the setup side shows the rule's full text.
- Art with a transparent background is detected automatically. It is trimmed to its visible edges, fitted whole into its slot, and drawn without a frame.
- The grunge style tries a few panel widths and art sizes for the stratagem row and keeps the one that gives the largest text. All panels get the same art width. Larger art wins, then equal panels, unless the alternative makes the text noticeably bigger. Portrait art at about 5:7 (for example 700 × 1000 px) fills the art slot.
- A source missing a required field, such as `orks-wreckas` until its detachment page is transcribed, fails the build with the field's JSON path.
- `keywords[]`: exact phrases drawn in bold wherever they appear. Keywords in square brackets, such as `[ASSAULT]`, are weapon abilities; grunge draws them in red.
- `faction_icon` (optional): shown at the top right of the grunge setup side. Without it, the faction plate takes the space.
- `background_art`: a full-card picture behind the grunge setup side, with the panels laid over it. Use about 4:1, ideally 2400 × 600 px or larger. One third stays uncovered for the main figure. It's the middle third by default; set `"background_focus": "left"` or `"right"` to keep a different third open. Classic uses it as its side picture. You can give `hero_art` instead, for the older layout with the picture beside the panels.
- `theme` (optional, grunge only): `{ "title_plate": [r, g, b], "label_plate": [r, g, b], "label_ink": "#rrggbb" }` recolours the title plate, the label plates (tabs and name bars) and the text on them. The phase ribbons and CP badges keep their colours on every card.
- Keys starting with `_` (such as `_alternative`, a second art choice) are notes and are ignored by the generator.
- `hero_art` and `stratagems[].art`: `{ "file": "art/x.png", "crop": [left, top, right, bottom] }`. The crop is in fractions of the image and is optional. The art is then cover-fitted, centred, to its slot.

In the grunge in-play strip, each `in_play` part gets its own column. The
columns are sized so they wrap to the same number of lines.

- **Colours and geometry:** `cardgen/styles/grunge.py` and `cardgen/styles/classic.py`. Token sizes are in `cardgen/geometry.py`.
- **Adding a style:** add a module under `cardgen/styles/` with `build(d, size, side)` and `safe_area(size)`, then register it in `cardgen/layout.py`.

`hardware/token_2x8.scad` is the OpenSCAD model of the token itself. It is not part of the card build. The sticker pocket is 46.8 × 199.2 mm and 1 mm deep, with a rim rounded to 0.5 mm (`recess`, `rim_r`). The decorative notches at each inch are 1 mm deep, which leaves a 1 mm wall between each notch and the pocket.

`hardware/token_2x8_split.scad` is the same token split into two dovetailed pieces, for printers with a bed smaller than 203 mm. By default it splits at 5 in, giving a 5 in piece and a 3 in piece. Both fit on one 105.6 × 132 mm plate, so a 5.6 in (142 mm) bed works:

```sh
openscad -D 'part="plate"' -o token_plate.stl hardware/token_2x8_split.scad   # both pieces on one plate
openscad -D 'part="a"' -o token_piece_a.stl hardware/token_2x8_split.scad     # or one piece at a time
```

For a two-sided token, print two and glue them back to back, pockets facing out, with one layer turned end over end. The seams then fall at 5 in on one layer and 3 in on the other, so each seam is backed by solid material. The finished token is 6 mm thick. `part="laminated"` shows the result.

- `split_in` (default 5) sets the inch station to split at.
- `clearance` (default 0.15 mm) sets the gap around each dovetail. Raise it if the pieces are too tight to push together.
- `double_sided=true` adds a sticker pocket on the bottom face too, for a single 3 mm layer carrying both stickers. You don't need it for the glued two-layer token.
