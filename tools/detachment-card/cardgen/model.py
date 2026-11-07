"""Load and validate a detachment source file.

Every error names the JSON path that is wrong, so a bad source file fails the
build before anything is drawn.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA_VERSION = "2.0"
PHASES = ("command", "movement", "shooting", "charge", "fight", "any")
TURNS = ("your", "opponent", "either")
CONTEXTS = ("setup", "in_play")


class SourceError(ValueError):
    """The detachment source file is invalid."""


@dataclass(frozen=True)
class Art:
    path: Path
    # Fractions of the source image to keep: left, top, right, bottom.
    crop: tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0)


@dataclass(frozen=True)
class Stratagem:
    id: str
    name: str
    cp: int
    phase: str
    turn: str
    when: str
    target: str
    effect: str
    art: Art


@dataclass(frozen=True)
class Detachment:
    id: str
    faction: str
    name: str
    detachment_points: int
    disposition: str
    rule_name: str
    setup_headline: str
    setup_text: str
    in_play_text: str
    hero_art: Art
    stratagems: tuple[Stratagem, ...]  # already in display order
    keywords: tuple[str, ...] = ()
    in_play_parts: tuple[str, ...] = ()
    faction_icon: Art | None = None
    source: dict = field(default_factory=dict)
    source_dir: Path = Path(".")


def _req(obj: dict, key: str, typ, where: str):
    if not isinstance(obj, dict):
        raise SourceError(f"{where}: expected an object")
    if key not in obj:
        raise SourceError(f"{where}.{key}: required field is missing")
    val = obj[key]
    if typ is int and isinstance(val, bool):
        raise SourceError(f"{where}.{key}: expected an integer")
    if not isinstance(val, typ):
        raise SourceError(f"{where}.{key}: expected {typ.__name__}, got {type(val).__name__}")
    if typ is str and not val.strip():
        raise SourceError(f"{where}.{key}: must not be empty")
    return val


def _art(obj, where: str, base: Path) -> Art:
    file = _req(obj, "file", str, where)
    path = (base / file).resolve()
    if not path.is_file():
        raise SourceError(f"{where}.file: image not found: {path}")
    crop = obj.get("crop", [0.0, 0.0, 1.0, 1.0])
    if (
        not isinstance(crop, list)
        or len(crop) != 4
        or not all(isinstance(c, (int, float)) and 0 <= c <= 1 for c in crop)
        or crop[0] >= crop[2]
        or crop[1] >= crop[3]
    ):
        raise SourceError(f"{where}.crop: expected [left, top, right, bottom] fractions between 0 and 1")
    return Art(path, tuple(float(c) for c in crop))


def display_order(stratagems):
    """Phase order first; source order breaks ties (sort is stable)."""
    return sorted(stratagems, key=lambda s: PHASES.index(s.phase))


def parse(data: dict, base: Path) -> Detachment:
    if data.get("schema_version") != SCHEMA_VERSION:
        raise SourceError(f"schema_version: expected {SCHEMA_VERSION!r}, got {data.get('schema_version')!r}")
    w = "$"
    rule = _req(data, "detachment_rule", dict, w)
    parts = _req(rule, "parts", list, "$.detachment_rule")
    texts = {c: [] for c in CONTEXTS}
    for i, p in enumerate(parts):
        pw = f"$.detachment_rule.parts[{i}]"
        ctx = _req(p, "display_context", str, pw)
        if ctx not in CONTEXTS:
            raise SourceError(f"{pw}.display_context: must be one of {CONTEXTS}, got {ctx!r}")
        texts[ctx].append(_req(p, "text", str, pw).strip())
    for ctx in CONTEXTS:
        if not texts[ctx]:
            raise SourceError(f"$.detachment_rule.parts: needs at least one {ctx!r} part")

    raw = _req(data, "stratagems", list, w)
    if not raw:
        raise SourceError("$.stratagems: needs at least one stratagem")
    strats, seen = [], set()
    for i, s in enumerate(raw):
        sw = f"$.stratagems[{i}]"
        sid = _req(s, "id", str, sw)
        if sid in seen:
            raise SourceError(f"{sw}.id: duplicate id {sid!r}")
        seen.add(sid)
        phase = _req(s, "phase", str, sw)
        if phase not in PHASES:
            raise SourceError(f"{sw}.phase: must be one of {PHASES}, got {phase!r}")
        turn = _req(s, "turn", str, sw)
        if turn not in TURNS:
            raise SourceError(f"{sw}.turn: must be one of {TURNS}, got {turn!r}")
        cp = _req(s, "cp", int, sw)
        if cp < 0:
            raise SourceError(f"{sw}.cp: must be >= 0")
        strats.append(
            Stratagem(
                id=sid,
                name=_req(s, "name", str, sw),
                cp=cp,
                phase=phase,
                turn=turn,
                when=_req(s, "when", str, sw),
                target=_req(s, "target", str, sw),
                effect=_req(s, "effect", str, sw),
                art=_art(_req(s, "art", dict, sw), f"{sw}.art", base),
            )
        )

    keywords = data.get("keywords", [])
    if not isinstance(keywords, list) or not all(isinstance(k, str) and k.strip() for k in keywords):
        raise SourceError("$.keywords: expected a list of non-empty strings")

    dp = _req(data, "detachment_points", int, w)
    if dp < 0:
        raise SourceError("$.detachment_points: must be >= 0")

    return Detachment(
        id=_req(data, "id", str, w),
        faction=_req(data, "faction", str, w),
        name=_req(data, "name", str, w),
        detachment_points=dp,
        disposition=_req(data, "disposition", str, w),
        rule_name=_req(rule, "name", str, "$.detachment_rule"),
        setup_headline=_req(rule, "setup_headline", str, "$.detachment_rule"),
        setup_text=" ".join(texts["setup"]),
        in_play_text=" ".join(texts["in_play"]),
        hero_art=_art(_req(data, "hero_art", dict, w), "$.hero_art", base),
        stratagems=tuple(display_order(strats)),
        keywords=tuple(keywords),
        in_play_parts=tuple(texts["in_play"]),
        faction_icon=_art(data["faction_icon"], "$.faction_icon", base) if "faction_icon" in data else None,
        source=data.get("source", {}),
        source_dir=base,
    )


def load(path: str | Path) -> Detachment:
    path = Path(path).resolve()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SourceError(f"{path}: invalid JSON: {e}") from e
    return parse(data, path.parent)
