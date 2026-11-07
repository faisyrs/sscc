"""Card wording built from the source: stratagem bodies, CP labels and phase
labels. Both styles use these, and the tests check them against the source text."""
from __future__ import annotations

from . import text as tx
from .model import Stratagem

PHASE_NAMES = {"command": "COMMAND", "movement": "MOVEMENT", "shooting": "SHOOTING", "charge": "CHARGE", "fight": "FIGHT", "any": "ANY"}


def body_parts(s: Stratagem) -> list[tuple[str, str]]:
    """(bold lead-in, text) for each paragraph of a stratagem's body."""
    parts = [("WHEN:", s.when), ("TARGET:", s.target)]
    parts += [("EFFECT:" if i == 0 else "", p) for i, p in enumerate(s.effect_paragraphs)]
    if s.upgrade:
        parts.append((f"OR (+{s.upgrade.extra_cp}CP):", s.upgrade.text))
    return parts


def body(s: Stratagem, keywords) -> list[tx.Line]:
    return [tx.tokenize(text, keywords, lead) for lead, text in body_parts(s)]


def body_text(s: Stratagem) -> str:
    return " ".join(f"{lead} {text}".strip() for lead, text in body_parts(s))


def cp_label(s: Stratagem) -> str:
    return f"{s.cp}/{s.cp + s.upgrade.extra_cp} CP" if s.upgrade else f"{s.cp} CP"


def phase_label(s: Stratagem) -> str:
    """For example MOVEMENT PHASE, OPPONENT’S SHOOTING PHASE, SHOOTING OR FIGHT PHASE.
    The ribbon colour shows whose turn it is; the WHEN line gives the detail."""
    names = " OR ".join(PHASE_NAMES[p] for p in s.phases)
    label = "ANY PHASE" if s.phases == ("any",) else f"{names} PHASE"
    return f"OPPONENT’S {label}" if s.turn == "opponent" else label


def paragraphs(text: str, keywords) -> list[tx.Line]:
    """A rule's text as wrap-ready paragraphs: one per line of the source, so bullets start new lines."""
    return [tx.tokenize(p.strip(), keywords) for p in text.split("\n") if p.strip()]
