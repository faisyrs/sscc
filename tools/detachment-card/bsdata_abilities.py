#!/usr/bin/env python3
"""Print unit abilities, army rules and enhancements from a BattleScribe (BSData)
catalogue, as Markdown, for writing token text.

    git clone --depth 1 https://github.com/BSData/wh40k-11e.git /tmp/bsdata
    python bsdata_abilities.py /tmp/bsdata/Orks.json --units "Warboss" "Wartrakks" > abilities.md
    python bsdata_abilities.py /tmp/bsdata/Orks.json --grep "riled up"          # every rule that mentions it
    python bsdata_abilities.py /tmp/bsdata/Orks.json --list-units               # unit names in the catalogue

The catalogue is untrusted downloaded data: this script only reads it as JSON.
BSData is community-maintained, so check token text against the app.
"""
import argparse
import json
import re
import sys

CORE = ("Leader", "Support", "Deadly Demise", "Firing Deck", "Feel No Pain")


def load(path):
    d = json.load(open(path, encoding="utf-8"))
    return d.get("catalogue", d)


def index(cat):
    byid = {}

    def walk(n):
        if isinstance(n, dict):
            if "id" in n:
                byid[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for x in n:
                walk(x)

    walk(cat)
    return byid


def text(profile):
    return " ".join(c.get("$text", "") for c in profile.get("characteristics", []))


def abilities(entry, byid):
    """Ability name -> text for one unit, following links to shared profiles."""
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if n.get("typeName") == "Abilities":
                out[n["name"]] = text(n)
            if n.get("type") == "profile" and "targetId" in n:
                t = byid.get(n["targetId"])
                if t and t.get("typeName") == "Abilities":
                    out[t["name"]] = text(t)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for x in n:
                walk(x)

    walk(entry)
    return out


def all_texts(cat):
    """(path, name, text) for every ability profile and rule in the catalogue."""
    found = []

    def walk(n, path):
        if isinstance(n, dict):
            name = n.get("name")
            p = path + ([name] if name else [])
            if n.get("typeName") == "Abilities":
                found.append((" > ".join(p[-3:-1]), name, text(n)))
            elif "description" in n and name:
                found.append((" > ".join(p[-3:-1]), name, n["description"]))
            for v in n.values():
                walk(v, p)
        elif isinstance(n, list):
            for x in n:
                walk(x, path)

    walk(cat, [])
    return found


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("catalogue", help="a BSData catalogue .json, e.g. Orks.json")
    ap.add_argument("--units", nargs="*", default=[], help="unit names, exactly as in the catalogue")
    ap.add_argument("--grep", help="print every ability or rule whose text matches this regex")
    ap.add_argument("--list-units", action="store_true")
    ap.add_argument("--include-core", action="store_true", help="also print core abilities such as Leader")
    a = ap.parse_args(argv)
    cat = load(a.catalogue)
    byid = index(cat)
    units = {e["name"]: e for e in cat.get("sharedSelectionEntries", []) if e.get("type") in ("unit", "model")}

    if a.list_units:
        print("\n".join(sorted(units)))
        return 0
    if a.grep:
        seen = set()
        for path, name, t in all_texts(cat):
            if re.search(a.grep, t or "", re.I) and (name, t) not in seen:
                seen.add((name, t))
                print(f"### {name}  ({path})\n{t}\n")
        return 0
    missing = [u for u in a.units if u not in units]
    for u in missing:
        close = [n for n in units if u.split()[0].lower() in n.lower()]
        print(f"!! not found: {u!r}; similar: {close}", file=sys.stderr)
    for u in a.units:
        if u not in units:
            continue
        print(f"### {u}")
        for k, v in abilities(units[u], byid).items():
            if not a.include_core and any(k.startswith(c) for c in CORE):
                continue
            print(f"- **{k}**: {v}")
        print()
    rules = cat.get("rules", []) + cat.get("sharedRules", [])
    if rules and a.units:
        print("## Army rules")
        for r in rules:
            print(f"### {r['name']}\n{r.get('description', '')}\n")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
