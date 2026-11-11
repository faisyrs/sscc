# SSCC Engine Rebuild — Design Spec

**Date:** 2026-04-04
**Status:** Draft
**Replaces:** All existing engine/, cli/, packs/, spec/ code

## Overview

Clean slate rebuild of the SSCC engine. The new engine description in
`docs/sscc-engine-evaluation-model.md` is the source of truth. The existing
implementation diverges fundamentally (priority-based conflict resolution vs
player-ordered rule loop, 16+ effect verbs vs 6 primitives, complex choice
lifecycle vs emergent choices). Modifying the existing code would be harder
than starting fresh.

### Decisions

- **Approach:** Delete spec/, engine/, cli/, packs/. Rebuild from scratch.
- **Spec/ requirements:** Deferred until engine concepts stabilize through
  implementation. The docs/ spec is the interim source of truth.
- **Toolchain:** TypeScript, Vitest, js-yaml (unchanged).
- **Backwards compatibility:** Not desired. This is greenfield.

---

## File Format

Two file types, both YAML under the hood:

| Extension | Purpose | CLI position |
|-----------|---------|--------------|
| `.rules`  | Pack content (sequences, rules, templates, macros, objects, derived) | Argument 1 (entry point) |
| `.army`   | Game configuration (includes, template instantiations) | Arguments 2+ |

### CLI Invocation

```
sscc core.rules army1.army army2.army [--seed N]
```

- Argument 1: pack entry point (core rules, timeline, includes)
- Arguments 2+: one army file per player
- `--seed`: optional RNG seed for deterministic replay

---

## .rules File Format

A `.rules` file is a YAML document. Top-level keys are parsed according to
these rules, applied in order:

1. **Reserved keys** — handled specially by the loader:
   - `include` — list of `.rules` file paths to load
   - `objects` — object type to state path mappings
   - `macros` — macro definitions (expand to effect primitives at load time)
   - `derived` — derived state definitions (base + modifiers + clamping)
2. **Everything else** — classified by value structure:
   - **List** — sequence definition
   - **Mapping with `when` key** — rule definition
   - **Mapping with `template` key** — template definition

Any `.rules` file can contain any mix of these. The loader merges all
definitions from all loaded files into a single pack.

### Sequences

A sequence is a named, ordered list of steps.

```yaml
game:
  - startOfGame
  - battleRound:
      repeat: 5
  - endOfGame

battleRound:
  - { sequence: attackerTurn }
  - { sequence: defenderTurn }

attackerTurn:
  - { sequence: commandPhase }
  - { sequence: movementPhase }
  - { sequence: shootingPhase }
  - { sequence: chargePhase }
  - { sequence: fightPhase }
  - endOfTurn

commandPhase:
  - event

movementPhase:
  - event

shootingPhase:
  - event

chargePhase:
  - event

fightPhase:
  - event

endOfTurn:
  - event

startOfGame:
  - event

endOfGame:
  - event
```

Step types:
- **Bare string** — reference to another named sequence (resolved across all
  loaded files)
- **`{ sequence: X }`** — explicit reference to named sequence X
- **`X: { repeat: N }`** — run sequence X N times
- **`event`** — leaf node; the rule loop fires here using the sequence's name
  as the event name

Resolution: bare strings and `{ sequence: X }` both resolve by looking up X
in the merged set of all sequence definitions. Both forms are equivalent —
`{ sequence: X }` is available for readability when the intent might not be
obvious to a human reader. Anything referenced but not defined is a
load-time error.

### Rules

A rule is a named mapping with `when` and `effect` keys.

```yaml
CORE.Command.GainCP:
  when:
    on: commandPhase
  effect:
    - set: { path: "$.turnPlayer.cp", modify: 1 }
  label: "Gain 1 CP"
```

Rule fields:
- **`when`** (required) — condition tree (see Conditions below)
- **`effect`** (required) — list of effects (see Effects below)
- **`label`** (optional) — human-readable description for UI
- **`choice`** (optional) — which player may choose to activate this rule
  (e.g., `turnPlayer`). Absence means mandatory.
- **`cost`** (optional) — list of resource costs deducted before firing:
  ```yaml
  cost:
    - path: "$.turnPlayer.cp"
      amount: 1
  ```
- **`provenance`** (optional) — source tracking (e.g., which datasheet or
  detachment this rule comes from)

### Conditions

Conditions are composable predicates on the game state.

**Event triggers:**
- `on: X` — true once when event X is first entered (transition)
- `is: X` — true as long as event X is the current event (level)

**Composition:**
- `all: [conditions]` — AND
- `any: [conditions]` — OR
- `not: condition` — NOT

**State queries:**
- `pathEquals: { path, value }` — state path equals value
- `pathAtLeast: { path, value }` — numeric comparison
- `pathAtLeastPath: { path, otherPath }` — compare two state paths
- `pathMissing: path` — state path does not exist
- `pathIn: { path, values }` — state path value is in list

**Object queries:**
- `selector: { type, where, bind }` — find objects matching criteria
- `tagPresent: { tag, on }` — check keyword on object

**Player input:**
- `manual: prompt` — player-answerable yes/no for spatial/subjective state

### Effects

Six primitive effect types (per the engine spec):

- **`set`** — set a value, flag, or modify a numeric value
  ```yaml
  - set: { path: "$.turnPlayer.cp", value: 5 }       # set to value
  - set: { path: "$.turnPlayer.cp", modify: 1 }       # increment
  - set: { path: "$.unit.flag", value: true, expiresOn: endOfTurn }
  ```
- **`unset`** — remove a value or flag
  ```yaml
  - unset: { path: "$.unit.battleshocked" }
  - unset: { selector: { type: unit, where: [...] }, path: "battleshocked" }
  ```
- **`sequence`** — enter a named sub-sequence
  ```yaml
  - sequence: battleshockTest
  ```
- **`test`** — compare values and branch
  ```yaml
  - test:
      pool: "$.battleshock.pool"
      against: { derived: CurrentLeadership }
      pass:
        - set: { path: "$.unit.not-battleshocked", value: true }
      fail:
        - set: { path: "$.unit.battleshocked", value: true }
  ```
- **`setSeed`** — set RNG seed for deterministic replay
- **`appendLogNote`** — add a message to the game log

### Templates

A template is a named mapping with a `template` key.

```yaml
boyz:
  template: unit
  params: [owner, id]
  state:
    path: "$.players.{owner}.units.{id}"
    value:
      name: "Boyz"
      models: 10
      stats: { M: 6, T: 5, Sv: 5, W: 1, Ld: 7, OC: 2 }
      keywords: [INFANTRY, MOB, BATTLELINE, ORK]
```

Template fields:
- **`template`** — the object type this template creates (must match an
  `objects` definition)
- **`params`** — list of parameter names, substituted into the state block
  via `{paramName}` syntax
- **`state`** — the state subtree to create:
  - `path` — where in the state tree (with parameter placeholders)
  - `value` — the initial values

Templates can also include rules specific to this unit type (abilities,
weapon profiles, etc.) alongside the template definition in the same file.

### Objects

Object type to state path pattern mappings. Used by selectors to enumerate
objects of a given type.

```yaml
objects:
  player: "$.players"
  unit: "$.players.*.units"
  model: "$.players.*.units.*.models"
  die: "$.pools.*.dice"
```

### Macros

Named shorthand that expands to effect primitives at pack load time.

```yaml
macros:
  roll:
    params: [poolPath, count, sides]
    expands:
      - set: { path: "{poolPath}.dice.{i}.value", value: { random: "{sides}" } }
      - set: { path: "{poolPath}.dice.{i}.sides", value: "{sides}" }
    loop: { var: i, count: "{count}" }

  rerollDie:
    params: [poolPath, dieIndex]
    expands:
      - set:
          path: "{poolPath}.dice.{dieIndex}.value"
          value: { random: "{poolPath}.dice.{dieIndex}.sides" }
      - set: { path: "{poolPath}.dice.{dieIndex}.rerolled", value: true }
```

### Derived State

Computed values: base value + active modifiers with optional clamping.

```yaml
derived:
  CurrentLeadership:
    base: "$.selectedUnit.Leadership"
    modifiers: "$.selectedUnit.CurrentLeadership.modifier*"
    aggregation: sum
    clamp: { range: 1, relative_to: base }

  CurrentMove:
    base: "$.selectedUnit.Move"
    modifiers: "$.selectedUnit.CurrentMove.modifier*"
    aggregation: sum
```

### Include

A list of `.rules` file paths to load. Paths are relative to the file
containing the include directive.

```yaml
include:
  - rules/turn-entry.rules
  - rules/command-phase.rules
  - rules/battleshock.rules
```

---

## .army File Format

An army file defines one player's force. It references rule files (faction,
detachment) and instantiates unit templates.

```yaml
include:
  - orks/ork-army.rules
  - orks/taktikal.rules

units:
  - template: boyz
    bind: { owner: player1, id: boyz_1 }
  - template: boyz
    bind: { owner: player1, id: boyz_2 }
  - template: warboss
    bind: { owner: player1, id: warboss_1 }
```

Army file keys:
- **`include`** — list of `.rules` files to load (faction rules, detachment
  rules, unit datasheets)
- **`units`** — list of template instantiations:
  - `template` — name of a template defined in the included rules files
  - `bind` — parameter bindings for the template

The loader processes army files after the core rules file. Template names in
`units` are resolved against the merged set of all templates from included
files.

### Player Identity

Players are identified by CLI argument position: the first `.army` file is
`player1`, the second is `player2`. The loader creates the player containers
in state (`$.players.player1`, `$.players.player2`) automatically before
expanding templates. The `owner` parameter in template bindings references
these IDs.

---

## Pack Directory Structure

Example layout for a Warhammer 40K game:

```text
core/
  core.rules              # timeline, core rules, objects, macros, derived
  rules/
    turn-entry.rules      # attacker/defender setup
    command-phase.rules   # CP gain, battleshock
    battleshock.rules     # battleshock sub-sequence and rules
    movement-phase.rules
    shooting-phase.rules
    charge-phase.rules
    fight-phase.rules
    stratagems.rules      # core stratagems (optional rules)

orks/
  ork-army.rules          # faction-wide rules and keywords
  taktikal.rules          # detachment stratagems and enhancements
  units/
    boyz.rules            # template + unit-specific abilities
    warboss.rules
    lootas.rules
    ...

space-marines/
  sm-army.rules
  gladius.rules
  units/
    intercessors.rules
    hellblasters.rules
    ...

games/
  my-orks.army            # player 1 army list
  their-marines.army      # player 2 army list
```

### Running a Game

```
sscc core/core.rules games/my-orks.army games/their-marines.army --seed 42
```

---

## Loader Pipeline

1. **Read core.rules** — parse top-level keys, classify each definition
2. **Follow includes** (depth-first) — load all referenced `.rules` files,
   merge definitions. Detect circular includes.
3. **Read army files** — parse includes and unit lists. Follow army includes
   to load faction/detachment/unit rules.
4. **Merge all definitions** — sequences, rules, templates, objects, macros,
   derived state from all files into a single pack. Duplicate IDs are a
   load-time error.
5. **Expand macros** — replace macro invocations in rules with their expanded
   effect primitives
6. **Expand templates** — process army unit lists, bind parameters, stamp
   template state into initial state tree
7. **Validate cross-references:**
   - All sequence references resolve to defined sequences
   - All `on`/`is` event names correspond to sequences marked with `- event`
   - All selector types match `objects` definitions
   - All derived state base paths exist in initial state
   - All template names in army files resolve to defined templates
8. **Index rules** by `on`/`is` keys for efficient matching at runtime
9. **Return loaded pack** or list of diagnostic errors

---

## Engine Core (Rule Loop)

Per the evaluation model spec, the rule loop at each event:

1. Find all matching rules (mandatory and optional/choice)
2. If nothing matches, return
3. If exactly one mandatory rule and no choices, auto-resolve it
4. Otherwise, present all options to the active player:
   - Mandatory rules (must all fire, player chooses order)
   - Optional rules (player may activate, costs deducted on activation)
   - Edit State (always available for corrections)
5. Player selects one option
6. Deduct costs (if any), execute effects
7. Go to step 1 (re-evaluate from scratch)

Key properties:
- One rule fires at a time
- Full re-evaluation after each rule fires
- Player orders everything
- No priority-based conflict resolution
- Loops are emergent (rules match repeatedly until conditions change)
- `on` conditions match once per event; `is` conditions match continuously

---

## Undo

The engine snapshots state before each rule fires. Undo restores the
previous snapshot. No partial undo — it's all-or-nothing per rule firing.

---

## What's Deferred

- **Patch/balance system** — no override mechanism for now
- **Formal requirements (spec/)** — rebuild after implementation stabilizes
- **Points checking** — army lists are unconstrained
- **Wargear/enhancement selection** — not in army file format yet
- **Network play / save/load** — not in scope
