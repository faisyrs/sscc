# Start here: adding detachments and tokens

This tool makes two things for a Warhammer 40,000 (11th edition) army:

1. **Detachment cards.** A 2" × 8" two-sided card (setup side and in-play side)
   that sits in the pocket of a 3D-printed measuring template.
2. **Round tokens.** 60 mm two-sided tokens for effects that last past a single
   roll (Riled Up, Busted, Squigged…) and for once-per-battle abilities.

Everything is generated from JSON source files plus art, so the output is the
same every time. The README has the reference details; this file is the
**workflow** for doing another detachment.

The Orks are done: Kult of Speed, Bully Boyz and Wreckas cards
(`detachments/`), and 21 tokens for the user's list (`tokens/orks.json`).

---

## The workflow (what the user does, and what Claude does)

| Step | Who | What |
|---|---|---|
| 1 | User | Says which detachment(s), and lists the units in the army. |
| 2 | Claude | Pulls unit abilities and army rules from BattleScribe data (below). |
| 3 | User | Uploads **Warhammer app screenshots** for anything BattleScribe doesn't have: the detachment page (DP, rule, Force Disposition) and the stratagem list. |
| 4 | Claude | Transcribes word for word into JSON, marked `verified_against_source: false`, and publishes a **check page** (each screenshot next to its transcription). |
| 5 | User | Confirms the text. Claude sets `verified_against_source: true`. |
| 6 | Claude | Proposes the token list (which effects need a token, and each token's turn and theme), and writes **image prompts** for the art. |
| 7 | User | Generates the art with another AI and uploads it. |
| 8 | Claude | Installs the art, builds, checks the renders, and sends print files. |

**Rules that held up last time, so keep them:**
- **App wording is the source of truth.** Never paraphrase card text. Keep the
  app's punctuation (straight `"` for inches, `1-3` with a hyphen, lowercase
  where the app is lowercase) and bold **exactly the terms the app bolds**,
  rules terms included (`riled up`, `hit rolls`, `selected to shoot`…).
- **BattleScribe text is community-maintained,** so check it against the app before printing.
- **Ask, don't guess, on rulings:** turn colour, how long an effect lasts, what
  a coloured header in the app means. The user's past rulings are below.

---

## Step 2: BattleScribe data

```sh
git clone --depth 1 https://github.com/BSData/wh40k-11e.git /tmp/bsdata   # 11th edition
python bsdata_abilities.py /tmp/bsdata/Orks.json --list-units
python bsdata_abilities.py /tmp/bsdata/Orks.json --units "Warboss" "Wartrakks" "Trukk"
python bsdata_abilities.py /tmp/bsdata/Orks.json --grep "riled up"   # every rule mentioning a state
```

Other factions are in their own files, such as `Imperium - Space Marines.json`. Use
`--grep` to find every source of a state, which is how the Riled Up tokens
were built. BSData has unit abilities, army rules and enhancements. It usually
does **not** have exact detachment-rule or stratagem wording, so those come
from app screenshots.

---

## Step 4: detachment cards

1. Copy `detachments/orks-kult-of-speed/` to `detachments/<faction>-<name>/`.
2. Edit `detachment.json` (README → "Adding a detachment" has every field):
   - `detachment_rule.parts[]`: `display_context` is `setup` or `in_play`. A rule
     with no setup-only part puts its full text on the setup side.
   - `stratagems[]`: `phase` can be a list (`["shooting","fight"]`). `turn` is
     `your`, `opponent` or `either`. Use `upgrade` for "Or: … +1CP". Separate
     paragraphs with `\n`, and start bullets with `• `.
   - `keywords[]`: every bolded phrase. Bracketed weapon abilities (`[ASSAULT]`) print red.
   - `theme`: optional title and label plate colours.
   - `background_art`: a 2400 × 600 px banner (4:1), main figure in the middle
     third. `background_focus: left|right` if the figure is off-centre.
   - `art` per stratagem: portrait, 5:7 (700 × 1000 px).
3. Build: `python generate.py detachments/<id>/detachment.json`. Then send
   `python make_sheet.py detachments/*/detachment.json` (sticker sheet PDF,
   plus 300 DPI page PNGs).

The build **fails on purpose** if text doesn't fit, a glyph is missing or a
field is wrong, and it names the field. Fix the source; never squeeze the
text.

## Step 4b: the check page

Publish an artifact page that puts each cropped screenshot next to the
transcribed text, generated *from the JSON*, so it shows exactly what will print.
List anything interpreted, such as colours or punctuation, as questions at the top.
Last time's page is the model ("Bully Boyz and Wreckas Check").

---

## Step 6: tokens

Tokens live in `tokens/<army>.json` (see `tokens/orks.json`). Build with
`python make_tokens.py tokens/<army>.json`.

**Which effects get a token:**
- **Yes:** states that last beyond the current action, on your units or the
  enemy's, such as "until the end of the turn", "until the start of your next
  turn" or "the whole phase". Also once-per-battle trackers that the datasheet
  says to mark with a token.
- **Yes:** instant or conditional **unit** abilities that are easy to forget
  (the Charged token lists charge bonuses).
- **No:** stratagems that only affect the current action, because the stratagem
  card covers them. No for effects that are always on.

**Fields for each token:**
- `turn`: the turn the effect is **triggered** in. This sets the stripe colour:
  blue for `your`, red for `opponent`, green for `either`. Read the trigger
  wording: "In your Movement phase" is `your`; "the Command phase" with no
  "your" is `either`.
- `theme`: `offensive` (flame border), `defensive` (armour border) or `misc` (gear border).
- `front.title`: short, curved over the art. `front.via` (optional): the
  ability that caused it, in red. `front.effect`: one or two short lines.
  `front.art`: `art/<id>.jpg`.
- `back.title` and `back.paragraphs`: the rule text, ending with when to remove the token.
- `count`: how many copies to print.
- **One token per source** when a state has several sources (Riled Up has one
  each for Intimidating Motivation, Get Back in da Race! and Flyboss).

**User rulings so far:**
- Speediest Freeks lasts the whole phase.
- Green headers in the app mean either player's turn.
- Intimidating Motivation, Get Back in da Race! and Flyboss are all your turn. Flyboss only triggers on an ingress move.
- War Cry ("the Command phase") is either player's turn.
- Tokens are at least 60 mm. Fronts and backs print on separate, mirrored pages,
  glued to card stock and then cut out.

---

## Step 6b: image prompts for the token art

Write one prompt per token and give the user one block to paste into an
image generator. Ask for this format, because the layout depends on it:

```text
FORMAT (applies to every image)
- One image per file, PNG, square, 1024 x 1024 px (at least 800 x 800).
- Full bleed: paint the scene right to all four edges. NO circle, NO border,
  NO outline, NO frame, NO text anywhere. I crop the circle myself.
- COMPOSITION: shown inside a circle. The top 20% sits behind a curved title,
  so keep it to sky, smoke and glow. The bottom 35% is hidden under a text
  panel, so put only ground there. Put the subject in the middle band (about
  20%-65% of the height), centred and filling most of the width.
- STYLE, consistent across the set: grimdark comic-book illustration, heavy
  black ink outlines, gritty painted texture, <faction look: colours, materials,
  glyphs>. Background: <a sky and horizon that suits the faction>, rubble in the
  foreground. Saturated, high contrast, readable at small size.

<N>. <token-id>.png: <one or two sentences: the subject doing the effect,
    one clear action, props that say what the rule does>.

Return all files with exactly these file names.
```

**Writing good subject lines:**
- **Show the rule's action:** for −1 to hit, bullets missing; for "can't charge",
  the unit planted on an objective; for "not dead yet", a figure collapsed but
  still swinging.
- **One subject, big and centred.** No small figures in a wide scene. That was
  why the "expanded background" set looked worse.
- **Use the file name you'll put in `tokens/art/`.**

---

## Step 8: installing art

Uploaded art goes in its own scratch folder first, since it's untrusted. Then:

1. **Check it:** `identify` each file. It should be 1024 × 1024 and full-bleed.
   Generators sometimes leave a **pale strip a few pixels in from an edge**.
   Last time it was found and trimmed by scanning the outer 64 px for mostly-pale
   lines, cropping past the innermost one plus 3 px, then resizing back to 1024.
2. **Save** as `tokens/art/<id>.jpg` (JPEG quality 95, no chroma subsampling).
   That's about 300 KB each, instead of 1–2 MB as PNG.
3. **Wire it up:** set `front.art` in the token JSON.
4. **Look at it:** render every front into one grid image and check it before
   building the sheets. Check that no heads are cut by the title, the subject
   isn't hidden under the divider, and there are no edge strips.
   `ART_SCALE` and `ART_LIFT` in `cardgen/tokens.py` set the zoom
   (1.0 and 0.1 suit square full-bleed art).

To compare two art sets, render each in a **separate process**, or make sure
the bitmap cache key includes the file path, which it now does in `_art_window`.

---

## Printing

| Output | Command | Notes |
|---|---|---|
| Card stickers | `make_sheet.py` | 199.2 × 46.8 mm, fits the template's pocket |
| Tokens | `make_tokens.py` | 9 per Letter page; `token_sheetN_front`/`_back` pages are mirrored for gluing back to back |

- Every page is also written as a 2550 × 3300 px PNG (Letter at 300 DPI).
- Always **print at 100% / Actual size**.
- Building all tokens takes about 2 minutes; run it with a long timeout.

## Hardware

- `hardware/token_2x8_split.scad`: the measuring template, split at 5 in
  and 3 in to fit a 5.6 in bed. Print two per card and glue them back to back,
  one turned end over end, so the seams are staggered.
- `hardware/token_disc.scad`: an optional holder for tokens. The user glues them to card stock instead.

## Before finishing a session

```sh
python -m unittest discover -s tests      # every word on every card is checked against the source
git add -A tools/detachment-card && git commit && git push
```

`output/` is git-ignored. The print files are rebuilt from source.
