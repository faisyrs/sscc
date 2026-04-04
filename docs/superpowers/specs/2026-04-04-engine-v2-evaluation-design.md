# SSCC Engine v2 -- Evaluation Model Redesign

**Date:** 2026-04-04
**Scope:** Replace event-trigger-priority evaluation with sequence-driven
rule loop, `is`/`on` conditions, player-ordered rule resolution, unified
state model, derived state with lazy modifiers, manual conditions

---

## 1. What This Includes

1. **New evaluation model** -- sequences of events, rule loop with
   re-evaluation after each rule fires, player chooses rule order
2. **Scope-as-state** -- event names are state flags; `is(X)` and
   `on(X)` conditions replace trigger-based rule matching
3. **Unified state model** -- statuses collapse into `set`/`unset`;
   one flag system for everything
4. **`set`/`unset` effects** -- first-class flag manipulation with
   `expiresOn` support
5. **`sequence` effect** -- rules can invoke named sub-sequences
6. **`test` effect** -- inline roll-and-compare within rules
7. **Derived state** -- computed values (e.g., CurrentLeadership)
   defined as base + modifiers with optional clamp
8. **`manual` condition** -- player-answered conditions for spatial
   and subjective game state the engine cannot evaluate
9. **Rules vs choices** -- distinct declarations; rules describe game
   mechanics, choices are player decisions presented for ordering
10. **Edit State action** -- always-available player action for
    gentleman's-agreement corrections
11. **Remove priority, trigger, emit, addChoice, conflict resolution,
    applyStatus, removeStatus**

## What This Does NOT Include

- UX optimizations (auto-resolve single-rule steps, skip no-op
  sub-sequences, batch manual condition prompts)
- Pack migration (existing packs will need rewriting)
- CLI changes (the CLI renders whatever the engine produces)
- Rewind-and-replay of past manual decisions (future UX feature;
  design does not preclude it)
- Spatial/geometry engine (manual conditions handle this)

---

## 2. Core Concepts

### Sequence

An ordered list of event names. The timeline is the top-level sequence.
Packs define named sub-sequences that rules can invoke via the
`sequence` effect.

```yaml
timeline:
  - game

subSequences:
  game:
    - startOfGame
    - battleRound
    - battleRound
    - battleRound
    - battleRound
    - battleRound
    - endOfGame

  battleRound:
    - attackerTurn
    - defenderTurn

  attackerTurn:
    - commandPhase
    - movementPhase
    - shootingPhase
    - chargePhase
    - fightPhase
    - endOfTurn

  defenderTurn:
    - commandPhase
    - movementPhase
    - shootingPhase
    - chargePhase
    - fightPhase
    - endOfTurn

  commandPhase:
    - commandPhase
    - endOfPhase

  movementPhase:
    - movementPhase
    - endOfPhase

  shootingPhase:
    - shootingPhase
    - endOfPhase

  chargePhase:
    - chargePhase
    - endOfPhase

  fightPhase:
    - fightPhase
    - endOfPhase
```

Processing a sequence means processing each event in order.
`attackerTurn` and `defenderTurn` each have a mandatory `on` rule
that sets `$.turnPlayer` to the appropriate player:

```json
{
  "id": "CORE.AttackerTurn.SetPlayer",
  "when": { "on": "attackerTurn" },
  "label": "Set active player (attacker)",
  "effect": [
    { "setValue": { "path": "$.turnPlayer", "value": { "path": "$.attacker" } } }
  ]
}
```

The attacker/defender assignment is determined by a roll-off at
`startOfGame` and stored in `$.attacker` / `$.defender`. These
turn-entry rules are auto-resolved (single mandatory rule).

There are no loop constructs in the sequence DSL (`forEach` and
`repeat` are removed). The only looping in the engine is the rule
loop itself, which re-evaluates rules until all have been handled.

### Event

A named moment in the game. Processing an event has three steps:

1. **Set the event name in state** (`commandPhase` becomes true).
   Expire any flags whose `expiresOn` matches this event name.
2. **Run the rule loop** (see below).
3. **Remove the event name from state** (`commandPhase` becomes false).

Events are state. During step 2, `is("commandPhase")` is true. If a
rule enters a sub-sequence during step 2, child events are set/unset
within the parent's lifetime -- so `is("commandPhase")` remains true
throughout the entire command phase sub-sequence.

### Rule

A condition-effect pair. No trigger, no priority. Rules declare what
state they need (`when`) and what they do (`effect`). All rules are
"things that happen" -- they fire in the rule loop when conditions match
and the player selects them.

```json
{
  "id": "CORE.Command.GainCP",
  "when": { "on": "commandPhase" },
  "label": "Gain 1 CP",
  "effect": [
    { "award": { "target": { "path": "$.turnPlayer" }, "resource": "cp", "amount": 1 } }
  ]
}
```

Optional fields on rules:

- **`label`** -- human-readable description (displayed to player)
- **`costs`** -- resource costs (e.g., `{ "cp": 1 }`); engine checks
  affordability and deducts on selection
- **`provenance`** -- source reference metadata (not used by engine)

### Choice

A decision the player makes as part of a rule's execution. Rules
describe game mechanics; choices are how the player interacts with
them. When multiple rules match in the rule loop, the player picks
which to resolve (ordering). This is distinct from a rule's internal
choices (e.g., "pick a unit to test").

Rules get *presented as* choices for ordering purposes, but the
declaration is different. A rule has `when`/`effect`. A choice within
a rule's execution is a selection from a set (unit picker, target
picker, etc.).

Optional abilities (stratagems, reactive abilities) use the
`playerChoice` condition to indicate which player is offered the
option and that they may decline:

```json
{
  "id": "STRAT.InsaneBravery",
  "when": {
    "all": [
      { "is": "commandPhase" },
      { "playerChoice": { "player": "$.turnPlayer" } },
      { "selector": { "object": "unit", "where": { ... } } }
    ]
  }
}
```

Rules without `playerChoice` are mandatory -- they must fire. The
`playerChoice` condition also specifies *who* gets the option, which
is critical for opponent-turn reactions (e.g., Overwatch is offered
to `$.opponent`, not `$.turnPlayer`).

### Object

An object is a named collection of related state at a path. The
engine has no built-in knowledge of game-specific concepts like
"unit" or "model" -- object types are defined by the pack:

```yaml
objects:
  player: "$.players"
  unit: "$.players.*.units"
  model: "$.players.*.units.*.models"
```

Selectors use object types to find matching entities. A selector
can be defined in the glossary (for reuse) or inline in a rule:

```json
{ "object": "unit", "where": { "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } } } }
```

The engine resolves object path patterns against state to enumerate
all instances, then applies `where` filters.

### Macro

A named shorthand that expands to pure engine primitives at pack
load time. Macros are defined by the pack and expanded by the
loader -- the engine never sees them.

```yaml
macros:
  roll:
    params: [poolPath, count, sides]
    expands:
      repeat: "{count}"
      as: "i"
      effects:
        - set: "{poolPath}.dice.{i}.value"
          value: { random: { min: 1, max: "{sides}" } }
        - set: "{poolPath}.dice.{i}.sides"
          value: "{sides}"
```

`repeat` must resolve to a static integer >= 0 at load time. Macros
handle compile-time sugar for verbose-but-fixed patterns (e.g., dice
rolling). Dynamic iteration ("for each model in this unit") is
handled by the rule loop -- a rule whose selector matches each
entity fires repeatedly until no more match.

Built-in dice effects (`roll`, `rerollDie`, `computePoolSum`, etc.)
become a standard macro library that ships with the engine, not
special-cased engine code.

---

## 3. Conditions

### `is(X)`

True when `X` exists in state. Matches for as long as the flag is set.

```json
{ "is": "commandPhase" }
```

Used for: rules that are available throughout a scope (stratagems,
reactive abilities).

### `on(X)`

True when `X` was just added to state -- the transition from false to
true. Matches once per event entry. After the first rule-loop
iteration at a given event, `on` conditions for that event no longer
match.

```json
{ "on": "commandPhase" }
```

Used for: rules that fire once when an event starts (CP gain, status
grants, cleanup).

Implementation: `on(X)` matches if X was set during this event's
step 1 AND the rule has not yet fired during this event. The engine
tracks which rules have fired at each event. `on` rules fire at most
once per event. `is` rules can fire multiple times (if their
conditions re-match after state changes).

### `manual(prompt)`

A condition the engine cannot evaluate. The engine presents the prompt
string to the player, who answers yes or no. Used for spatial
conditions (proximity, line of sight, cover) and any subjective game
state.

```json
{ "manual": "Is this unit within 12\" of a Dread Aura model?" }
```

Manual conditions are first-class, not a temporary workaround. The
tabletop game inherently has state the engine cannot track (model
positions, terrain, cover, custom conversions). Manual decisions are
logged in state history with the question and answer, enabling future
rewind-and-replay.

### `playerChoice(player)`

Marks a rule as optional -- the specified player may decline it.
Rules without `playerChoice` are mandatory and must fire.

```json
{ "playerChoice": { "player": "$.turnPlayer" } }
{ "playerChoice": { "player": "$.opponent" } }
```

Used for: stratagems, reactive abilities, and any optional action.
The `player` field specifies who is offered the choice, enabling
opponent-turn reactions (e.g., Overwatch).

### Existing conditions (unchanged)

All existing predicate types remain:

- `all`, `any`, `not` -- composition
- `pathEquals`, `pathAtLeast`, `pathAtLeastPath`, `pathMissing`,
  `pathIn` -- state queries
- `selector` -- object selector evaluation (named or inline)
- `counterAtLeast`, `counterEquals` -- numeric comparisons
- `resourceAtLeast` -- resource checks
- `tagPresent` -- keyword checks

Note: `hasStatus` and `missingStatus` are removed. Statuses are now
regular state flags -- use `is(X)` or `pathEquals` instead.

Note: `poolContainsPattern` and `diePoolCount` are removed. Dice
pools are now regular objects (die objects at a path). Use selectors
and `pathEquals` on die objects instead.

---

## 4. The Rule Loop

At each event (step 2 of event processing), the engine runs:

```text
ruleLoop(state):
  1. Find all matching items:
     - Mandatory rules: `when` matches, no `playerChoice` condition
     - Optional choices: `when` matches, has `playerChoice` condition
     - Filter out choices the player cannot afford (check costs)
     - For items with `manual` conditions, include as candidates
       (the player will be asked during selection)
  2. If nothing matches: return (event processing moves to step 3)
  3. If only one mandatory rule and no optional choices:
     - Auto-resolve it (no player interaction needed)
     - Go to step 5
  4. Present options to player:
     - If mandatory rules remain: show rules + choices + Edit State
       (no passing while mandatory rules remain)
     - If only optional choices remain: show choices + Pass + Edit State
     - If Edit State: player directly modifies state values, go to 1
     - If Pass: return
  5. Deduct costs if any
  6. Execute its effects (state changes, may enter sub-sequences)
  7. Go to 1
```

Key properties:

- **One rule fires at a time.** After each, the full rule set is
  re-evaluated from scratch against the new state.
- **Player orders everything.** When multiple rules match, the active
  player chooses which to resolve. This replaces priority numbers.
- **No conflict resolution needed.** Two rules targeting the same
  state cannot conflict because only one fires at a time. After one
  fires, the other may no longer match.
- **A step can fire zero rules.** If nothing matches, the event is a
  no-op and the sequence advances.
- **Loops are emergent.** A rule that matches repeatedly (e.g.,
  "select unit for battleshock" while units still need testing) fires
  each time the player picks it. When no more units need testing,
  the condition stops matching and the loop ends.
- **Edit State is always available.** The player can directly modify
  state at any point in the rule loop. This supports gentleman's-
  agreement corrections ("oops, that unit was in cover"). No rewind
  -- just patch the state and continue.
- **Manual decisions are logged.** Every manual condition prompt and
  the player's answer are recorded in state history, enabling future
  rewind-and-replay of past decisions.

### `on` vs `is` in the rule loop

`on(X)` matches if X was set during this event's step 1 AND the rule
has not yet fired during this event. `is(X)` matches whenever X is
true, regardless of how many times the rule has fired.

This means `on` rules can fire at most once per event. The player can
pick them at any point during the rule loop -- they remain available
until fired. `is` rules can fire repeatedly as long as their
conditions keep re-matching after state changes.
- Each rule tracks whether it has fired during the current event.
- `on` rules fire at most once per event. `is` rules can fire
  multiple times (if their conditions re-match after state changes).

---

## 5. Effects

### New effects

**`set`** -- Set a flag or value in state. Supports optional
`expiresOn`. Replaces both the old `set` flags and `applyStatus` --
unit statuses are now regular state entries.

```json
{ "set": "insaneBraveryUsed" }
{ "set": "commandRerollUsed", "expiresOn": "endOfPhase" }
{ "set": "$.units.u2.battleshocked", "value": true }
{ "set": "$.units.u2.CurrentLeadership.modifier.dreadAura", "value": 1 }
```

When the named event fires (step 1), all flags with a matching
`expiresOn` are cleared before the rule loop runs.

**`unset`** -- Remove a flag or value from state. Replaces
`removeStatus`.

```json
{ "unset": "commandRerollUsed" }
{ "unset": "$.units.u2.battleshocked" }
```

**`sequence`** -- Enter a named sub-sequence. The engine processes
each event in the sub-sequence (set name, rule loop, unset name)
before returning to the current rule loop.

```json
{ "sequence": ["battleshockRoll", "battleshockResolve"] }
```

Or reference a named sub-sequence from the pack:

```json
{ "sequence": "battleshockTest" }
```

**`test`** -- Compare a value against a target and branch on the
result. The value can come from a new roll, an existing dice pool,
or a state path. The target can be a derived state, a literal, or
a state path.

Roll new dice and compare:

```json
{
  "test": {
    "roll": { "count": 2, "sides": 6 },
    "compare": "gte",
    "target": { "derived": "CurrentLeadership", "unit": { "path": "$.selectedUnit" } },
    "pass": [
      { "set": "$.selectedUnit.not-battleshocked", "value": true }
    ],
    "fail": [
      { "set": "$.selectedUnit.battleshocked", "value": true }
    ]
  }
}
```

Use an existing pool (already rolled):

```json
{
  "test": {
    "usePool": "$.battleshock.rollResult",
    "compare": "gte",
    "target": { "derived": "CurrentLeadership", "unit": { "path": "$.battleshock.selectedUnit" } },
    "pass": [ ... ],
    "fail": [ ... ]
  }
}
```

When the target references a derived state (see section 5a), the
engine evaluates it at test time, including prompting for any
`manual` conditions on contributing modifier rules.

### Removed effects

- **`emit`** -- replaced by `sequence`
- **`addChoice`** -- rules are presented as choices for ordering;
  choices within rules are a separate concept (unit picker, etc.)
- **`consumeUsage`** -- replaced by `set` with flag checks
- **`resetUsage`** -- replaced by `expiresOn` or explicit `unset`
- **`applyStatus`** -- replaced by `set` on unit state path
- **`removeStatus`** -- replaced by `unset` on unit state path

### Replaced by macros

The following effects become a standard macro library shipped with
the engine. They expand to pure primitives (`set`/`unset` on die
objects) at pack load time:

- `roll`, `rerollDie`, `rerollPool`, `spendDice` -- dice operations
- `computePoolSum` -- pool arithmetic (becomes derived state)

### Unchanged effects

All other effects remain as-is:

- `setValue`, `modifyCounter` -- state manipulation
- `award`, `spendResource` -- resource transactions
- `addProhibition`, `removeProhibition` -- eligibility gating
- `ensureExists`, `mergeInto` -- state initialization
- `setSeed` -- RNG control
- `appendLogNote` -- logging

---

## 5a. Derived State

Some values are not stored directly -- they are computed on demand
from a base value plus any active modifiers. This replaces the need
for a modifier stack or eager recomputation.

### Definition

Derived state is defined in the pack alongside sub-sequences:

```yaml
derivedState:
  CurrentLeadership:
    base: { path: "$.selectedUnit.BaseLeadership" }
    modifiers: { match: "$.selectedUnit.CurrentLeadership.modifier*" }
    aggregate: sum
    clamp:
      min: { offset: -1 }   # no more than -1 from base
      max: { offset: +1 }   # no more than +1 from base

  CurrentMove:
    base: { path: "$.selectedUnit.BaseMove" }
    modifiers: { match: "$.selectedUnit.CurrentMove.modifier*" }
    aggregate: sum
    # no clamp -- Move can be modified freely

  CurrentToHit:
    base: { path: "$.selectedUnit.BaseToHit" }
    modifiers: { match: "$.selectedUnit.CurrentToHit.modifier*" }
    aggregate: sum
    clamp:
      min: { offset: -1 }
      max: { offset: +1 }
```

### Evaluation

When the engine needs a derived value (e.g., during a `test` effect),
it:

1. Reads the base value from state
2. Glob-matches all modifier state entries (e.g.,
   `$.units.u2.CurrentLeadership.modifier*` matches
   `modifier.dreadAura`, `modifier.inspiringPresence`, etc.)
3. Aggregates them (sum, min, max -- `sum` is default)
4. Applies clamp if defined (relative to base)
5. Returns the effective value

Modifiers are regular state -- they get `set` and `unset` by rules
using the normal effect system. Their lifecycle is managed by
`expiresOn`, explicit `unset`, or the rule loop. The derived state
definition just tells the engine how to combine them.

### Modifier rules

Rules that set modifiers fire in the rule loop like any other rule.
For modifiers with spatial conditions (auras, proximity), the rule
uses a `manual` condition. The engine evaluates these eagerly -- when
state changes that could affect applicability (unit moved, unit
destroyed), rules with relevant `manual` conditions are re-presented
to the player.

```json
{
  "id": "AURA.DreadAura.LeadershipPenalty",
  "when": {
    "all": [
      { "on": "unitMoved" },
      { "manual": "Is this unit within 12\" of a Dread Aura model?" }
    ]
  },
  "label": "Dread Aura: +1 Leadership penalty",
  "effect": [
    { "set": "$.targetUnit.CurrentLeadership.modifier.dreadAura", "value": 1 }
  ]
}
```

### Clamp semantics

`clamp.min` and `clamp.max` use `offset` to express limits relative
to the base value. If BaseLeadership is 7 and clamp is `{min: -1,
max: +1}`, the effective range is 6--8 regardless of how many
modifiers are active.

This models Warhammer's characteristic modification limits: most
stats cap at +1/-1 from base, while Move and some others are
unclamped. The cap is defined per stat in the pack, not per rule.

---

## 6. Removed Concepts

### Trigger (`trigger: { event: "X" }`)

Replaced by `on(X)` and `is(X)` conditions in `when`.

### Priority (`precedence: { priority: N }`)

Replaced by player ordering. When multiple rules match, the active
player picks which fires first.

### Conflict resolution (`strategy: stack/override/patch`)

No longer needed. Only one rule fires at a time. Re-evaluation after
each rule prevents conflicting effects.

### Conflict domains

Removed. No batched effect execution means no domain conflicts.

### `emit` effect

Replaced by `sequence` effect. Rules invoke sub-sequences explicitly.

### `addChoice` effect

Rules are presented for ordering; optional choices use `playerChoice`
condition. The player picks from matching rules and choices.

### `consumeUsage` / `resetUsage`

Replaced by `set`/`unset` flags with `expiresOn`.

### `applyStatus` / `removeStatus`

Replaced by `set`/`unset` on unit state paths. Statuses are now
regular state flags -- `$.units.u2.battleshocked` instead of a
separate status system. `is("$.units.u2.battleshocked")` or
`pathEquals` replaces `hasStatus`/`missingStatus`.

### Rule scope (`scope: global/player/entity`)

Removed. Scoping is handled by conditions. A rule that should only
apply to the active player's units includes the appropriate selector
or state check in `when`.

### `forEach` / `repeat` sequence constructs

Removed. Sequences are explicit lists of events. The only looping is
the rule loop itself. Game structure (5 battle rounds, attacker then
defender) is expressed directly in the sequence definitions.

---

## 7. Rule Format

### Before (v1)

```json
{
  "id": "CORE.Command.CP.Award.1",
  "scope": "global",
  "trigger": { "event": "CommandPointsAwarded" },
  "when": { "all": [] },
  "effect": [
    { "award": { "target": { "path": "$.turnPlayer" }, "resource": "cp", "amount": 1 } }
  ],
  "precedence": { "priority": 10, "strategy": "stack" },
  "provenance": { "source": "Core Rules", "page": 8 }
}
```

### After (v2)

```json
{
  "id": "CORE.Command.GainCP",
  "when": { "on": "commandPhase" },
  "label": "Gain 1 CP",
  "effect": [
    { "award": { "target": { "path": "$.turnPlayer" }, "resource": "cp", "amount": 1 } }
  ],
  "provenance": { "source": "Core Rules", "page": 8 }
}
```

---

## 8. Example: Command Phase Walkthrough

### Pack structure

Timeline sub-sequence:

```yaml
commandPhase:
  - commandPhase
  - endOfPhase
```

Rules:

```json
[
  {
    "id": "CORE.Command.ClearBattleshock",
    "when": { "on": "commandPhase" },
    "label": "Clear battleshock state from previous round",
    "effect": [
      { "unset": { "key": "battleshocked", "target": { "object": "unit", "where": {
          "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } }
      } } } },
      { "unset": { "key": "not-battleshocked", "target": { "object": "unit", "where": {
          "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } }
      } } } }
    ]
  },
  {
    "id": "CORE.Command.GainCP",
    "when": { "on": "commandPhase" },
    "label": "Gain 1 CP",
    "effect": [
      { "award": { "target": { "path": "$.turnPlayer" }, "resource": "cp", "amount": 1 } }
    ]
  },
  {
    "id": "CORE.Command.BattleshockEligible",
    "when": {
      "all": [
        { "is": "commandPhase" },
        { "selector": { "object": "unit", "where": {
            "all": [
              { "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } } },
              { "not": { "is": "$entity.battleshocked" } },
              { "not": { "is": "$entity.not-battleshocked" } }
            ]
        } } }
      ]
    },
    "label": "Battleshock test (select unit)",
    "effect": [
      { "setValue": { "path": "$.battleshock.selectedUnit", "valueFromChoice": "selectedUnitId" } },
      { "sequence": "battleshockTest" }
    ]
  },
  {
    "id": "STRAT.InsaneBravery",
    "when": {
      "all": [
        { "is": "commandPhase" },
        { "playerChoice": { "player": "$.turnPlayer" } },
        { "not": { "is": "insaneBraveryUsed" } },
        { "selector": { "object": "unit", "where": {
            "all": [
              { "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } } },
              { "not": { "is": "$entity.battleshocked" } },
              { "not": { "is": "$entity.not-battleshocked" } }
            ]
        } } }
      ]
    },
    "label": "Insane Bravery (auto-pass battleshock for one unit)",
    "costs": { "cp": 1 },
    "effect": [
      { "setValue": { "path": "$.battleshock.selectedUnit", "valueFromChoice": "selectedUnitId" } },
      { "set": "$.battleshock.selectedUnit.not-battleshocked", "value": true },
      { "set": "insaneBraveryUsed" }
    ]
  }
]
```

Battleshock test sub-sequence:

```yaml
battleshockTest:
  - battleshockRoll
  - battleshockCompare
```

```json
[
  {
    "id": "CORE.Battleshock.Roll",
    "when": { "on": "battleshockRoll" },
    "label": "Roll battleshock test",
    "effect": [
      { "roll": { "count": 2, "sides": 6, "storePath": "$.battleshock.rollResult" } }
    ]
  },
  {
    "id": "STRAT.CommandReroll",
    "when": {
      "all": [
        { "is": "battleshockRoll" },
        { "playerChoice": { "player": "$.turnPlayer" } },
        { "not": { "is": "commandRerollUsed" } }
      ]
    },
    "label": "Command Re-roll (reroll 1 die)",
    "costs": { "cp": 1 },
    "effect": [
      { "rerollDie": { "poolPath": "$.battleshock.rollResult", "dieIndex": { "pick": 1 } } },
      { "set": "commandRerollUsed", "expiresOn": "endOfPhase" }
    ]
  },
  {
    "id": "CORE.Battleshock.Compare",
    "when": { "on": "battleshockCompare" },
    "label": "Resolve battleshock test",
    "effect": [
      {
        "test": {
          "roll": { "usePool": "$.battleshock.rollResult" },
          "compare": "gte",
          "target": { "derived": "CurrentLeadership", "unit": { "path": "$.battleshock.selectedUnit" } },
          "pass": [
            { "set": "$.battleshock.selectedUnit.not-battleshocked", "value": true }
          ],
          "fail": [
            { "set": "$.battleshock.selectedUnit.battleshocked", "value": true }
          ]
        }
      }
    ]
  }
]
```

### Walkthrough

**Step: `commandPhase` enters**

State: `commandPhase = true`

Rule loop iteration 1 -- matching rules:
- `CORE.Command.ClearBattleshock` (on commandPhase) -- matches
- `CORE.Command.GainCP` (on commandPhase) -- matches
- `CORE.Command.BattleshockEligible` (is commandPhase, untested
  units exist) -- matches
- `STRAT.InsaneBravery` (is commandPhase, untested units exist) --
  matches

Player sees: [ClearBattleshock, GainCP, BattleshockEligible,
InsaneBravery, Edit State]
(No Pass -- mandatory rules remain)

Player picks `ClearBattleshock`.
Effect: clear all battleshock/not-battleshocked flags.

Re-evaluate -- matching rules:
- `CORE.Command.GainCP` (on, hasn't fired) -- matches
- `CORE.Command.BattleshockEligible` -- matches
- `STRAT.InsaneBravery` -- matches

Player picks `InsaneBravery`. Costs: 1 CP deducted.
Player selects unit u2.
Effect: u2.not-battleshocked = true, insaneBraveryUsed set.

Re-evaluate -- matching rules:
- `CORE.Command.GainCP` -- matches
- `CORE.Command.BattleshockEligible` (u3 still untested) -- matches

Player picks `BattleshockEligible`. Selects unit u3.
Effect: enter sub-sequence `battleshockTest` for u3.

**Sub-step: `battleshockRoll` enters**

State: `commandPhase = true`, `battleshockRoll = true`

Rule loop:
- `CORE.Battleshock.Roll` (on battleshockRoll) -- matches

Auto-resolved (single mandatory rule, no choices).
Effect: roll 2D6 -> [3, 5] stored.

Re-evaluate:
- `STRAT.CommandReroll` (is battleshockRoll, playerChoice,
  not used) -- matches

Only optional choices remain. Player sees: [CommandReroll, Pass,
Edit State]. Player passes (declines stratagem).

**Sub-step: `battleshockRoll` exits, `battleshockCompare` enters**

State: `commandPhase = true`, `battleshockCompare = true`

Rule loop:
- `CORE.Battleshock.Compare` (on battleshockCompare) -- matches

Auto-resolved (single mandatory rule). Engine evaluates `test`:
- Roll sum: 3 + 5 = 8
- Target: CurrentLeadership for u3 = BaseLeadership(7) +
  modifiers(none) = 7, clamped to range 6--8
- 8 >= 7: pass

Effect: u3.not-battleshocked = true.

**Sub-step: `battleshockCompare` exits**

Sub-sequence `battleshockTest` done. Back to `commandPhase` rule loop.

Re-evaluate:
- `CORE.Command.GainCP` -- matches (hasn't fired)
- `CORE.Command.BattleshockEligible` -- no more untested units,
  does not match

Player picks `GainCP`.
Effect: +1 CP.

Re-evaluate -- no more rules match. Step ends.

**Step: `endOfPhase` enters**

State: `endOfPhase = true`

Expiry: `commandRerollUsed` cleared (expiresOn: endOfPhase).

Rule loop -- no rules match. Step ends.

**Step: `endOfPhase` exits, `commandPhase` exits**

Sequence advances to `movementPhase`.

---

## 9. Engine Changes Summary

### New in engine

| Component | Change |
|---|---|
| Unified state | Statuses collapsed into `set`/`unset`; one flag system |
| Scope state | Flag-based state: `set`/`unset`/`is`/`on` |
| Rule loop | Re-evaluate all rules after each fires; player picks order; auto-resolve single mandatory rules |
| `sequence` effect | Rules can invoke sub-sequences inline |
| `test` effect | Compare value (roll, pool, or path) against target with pass/fail branches |
| Derived state | Computed values: base + modifier glob + aggregate + clamp |
| `manual` condition | Player-answered conditions for spatial/subjective state |
| `playerChoice` condition | Marks rules as optional; specifies which player is offered the choice |
| Pack-defined objects | Object types defined by pack (`objects:` mapping), not hardcoded |
| Inline selectors | Selectors usable directly in rules, not just via glossary |
| Macros | Pack-defined shorthand expanding to primitives at load time |
| Edit State action | Player can directly modify state at any rule loop step |
| Expiry on flags | `expiresOn` for `set` flags, cleared at event entry |
| Decision history | Manual decisions logged with question + answer |

### Removed from engine

| Component | Replacement |
|---|---|
| `trigger: { event }` | `on(X)` / `is(X)` conditions |
| `precedence.priority` | Player ordering |
| `precedence.strategy` | Re-evaluation (one rule at a time) |
| Conflict resolution | Not needed |
| `emit` effect | `sequence` effect |
| `addChoice` effect | Rules presented for ordering; `playerChoice` for optional |
| `consumeUsage` / `resetUsage` | `set` / `unset` with `expiresOn` |
| `applyStatus` / `removeStatus` | `set` / `unset` on object state paths |
| `hasStatus` / `missingStatus` | `is(X)` / `pathEquals` |
| `poolContainsPattern` / `diePoolCount` | Selectors on die objects |
| `scope` field on rules | Conditions handle scoping |
| `forEach` / `repeat` in sequences | Explicit event lists; rule loop handles iteration |
| Hardcoded entity kinds | Pack-defined `objects:` mapping |
| `rulesByEvent` index | All rules evaluated each loop (index by `is`/`on` keys for performance) |

### Unchanged

| Component | Notes |
|---|---|
| State (get/set/JSONPath) | Unchanged |
| Effects (setValue, roll, award, etc.) | Unchanged |
| RNG (SeededRNG) | Unchanged |
| Undo (snapshot/restore) | Needs adaptation for new rule loop + decision history |
| Loader (loadPack) | Updated for new rule + timeline + derived state format |
| CLI | Needs updated choice display (show matching rules + Edit State) |
| Datasheet layer | Unchanged |
| Glossary / selectors | Unchanged |

---

## 10. Open Questions

### Event parameters and active player

**Resolved:** Events are just names in state -- no parameters.
`attackerTurn` and `defenderTurn` each have a mandatory `on` rule
that sets `$.turnPlayer` to the appropriate player. All `eventParam`
references become `{ "path": "$.turnPlayer" }` or equivalent.
Selectors use `valueFromPath` instead of `valueFromEventParam`.

### Undo semantics

**Resolved:** Snapshot state before each rule fires, restore on undo.
Manual decision answers are state, so restoring a snapshot naturally
discards them and the player gets re-asked.

### Performance

**Resolved:** Index rules by `is`/`on` keys they reference. Only
evaluate rules whose keys match currently-true flags. Analogous to
the current `rulesByEvent` index.

### Player pass semantics

**Resolved:** Rules must be evaluated -- the player cannot pass on
rules. Pass only applies to optional choices (stratagems, optional
abilities). The rule vs choice distinction handles this: rules fire
(player picks order), choices may be optional or mandatory ("choose
from this list").

### Edit State scope

**Resolved:** Any state. The player is trusted. UX will later provide
helper functionality (e.g., browse state by unit context) so the
player doesn't need to know raw variable paths.

### Derived state evaluation context

**Resolved:** Context binding via push/pop. Before evaluating derived
state, the engine sets a context variable (e.g., `$.context.targetUnit`)
to the relevant unit, evaluates modifier rules against that context,
then restores the previous value. This is the same mechanism used by
turn-entry rules that set `$.turnPlayer` -- a convenience wrapper so
rule authors write `$.targetUnit.BaseLeadership` without accommodating
every possible evaluation context.

---

## 11. Files Changed / Created

| File | Action |
|---|---|
| `engine/src/engine/index.ts` | Rewrite: new rule loop, scope stack, Edit State |
| `engine/src/rules/index.ts` | Rewrite: remove evaluate(), add ruleLoop() |
| `engine/src/rules/predicates.ts` | Modify: add `is`, `on`, `manual`, `playerChoice` predicates; remove `hasStatus`, `missingStatus`, `poolContainsPattern`, `diePoolCount`; support inline selectors with `object` |
| `engine/src/rules/effects.ts` | Modify: add `set`, `unset`, `sequence`, `test`; remove `emit`, `addChoice`, `consumeUsage`, `resetUsage`, `applyStatus`, `removeStatus` |
| `engine/src/rules/conflicts.ts` | Delete |
| `engine/src/rules/derived.ts` | Create: derived state definitions, evaluation, clamp |
| `engine/src/types/rules.ts` | Rewrite: new Rule type, new Effect/Predicate unions |
| `engine/src/types/pack.ts` | Modify: update LoadedPack, add derivedState, objects, macros; remove rulesByEvent |
| `engine/src/types/state.ts` | Modify: add ManualDecision history type |
| `engine/src/sequencer/index.ts` | Simplify: walk flat event lists |
| `engine/src/choices/index.ts` | Simplify or remove (rules replace choices) |
| `engine/src/loader/macros.ts` | Create: macro expansion at load time |
| `engine/src/loader/rules.ts` | Update for new rule format |
| `engine/src/loader/validation.ts` | Update for new rule + derived state + object + macro format |
| `packs/wh40k-10e-ms5b/` | Rewrite rules + timeline + derived state for v2 |
| `engine/tests/` | Rewrite affected tests |
