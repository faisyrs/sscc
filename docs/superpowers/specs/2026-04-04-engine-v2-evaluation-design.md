# SSCC Engine v2 -- Evaluation Model Redesign

**Date:** 2026-04-04
**Scope:** Replace event-trigger-priority evaluation with sequence-driven
rule loop, `is`/`on` conditions, player-ordered rule resolution

---

## 1. What This Includes

1. **New evaluation model** -- sequences of events, rule loop with
   re-evaluation after each rule fires, player chooses rule order
2. **Scope-as-state** -- event names are state flags; `is(X)` and
   `on(X)` conditions replace trigger-based rule matching
3. **`set`/`unset` effects** -- first-class flag manipulation with
   `expiresOn` support
4. **`sequence` effect** -- rules can invoke named sub-sequences
5. **Remove priority, trigger, emit, addChoice, conflict resolution**

## What This Does NOT Include

- UX optimizations (auto-resolve single-rule steps, skip no-op
  sub-sequences)
- Pack migration (existing packs will need rewriting)
- CLI changes (the CLI renders whatever the engine produces)

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
    - rounds
    - endOfGame

  rounds:
    repeat:
      count: { path: "$.totalRounds" }
      body:
        - round

  round:
    forEach:
      over: { kind: "player", from: "$.players" }
      body:
        - turn

  turn:
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
state they need (`when`) and what they do (`effect`).

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

### Existing conditions (unchanged)

All existing predicate types remain:

- `all`, `any`, `not` -- composition
- `pathEquals`, `pathAtLeast`, `pathAtLeastPath`, `pathMissing`,
  `pathIn` -- state queries
- `hasStatus`, `missingStatus` -- unit status checks
- `selector` -- glossary selector evaluation
- `counterAtLeast`, `counterEquals` -- numeric comparisons
- `resourceAtLeast` -- resource checks
- `tagPresent` -- keyword checks
- `poolContainsPattern`, `diePoolCount` -- dice pool queries

---

## 4. The Rule Loop

At each event (step 2 of event processing), the engine runs:

```text
ruleLoop(state):
  1. Find all rules whose `when` matches current state
     - Filter out rules the active player cannot afford (check costs)
  2. If no rules match: return (event processing moves to step 3)
  3. Present matching rules to active player
  4. Player picks one
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

**`set`** -- Set a flag in state. Supports optional `expiresOn`.

```json
{ "set": "insaneBraveryUsed" }
{ "set": "commandRerollUsed", "expiresOn": "endOfPhase" }
{ "set": "advanced_move", "expiresOn": "endOfTurn" }
```

When the named event fires (step 1), all flags with a matching
`expiresOn` are cleared before the rule loop runs.

**`unset`** -- Remove a flag from state.

```json
{ "unset": "commandRerollUsed" }
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

### Removed effects

- **`emit`** -- replaced by `sequence`
- **`addChoice`** -- every rule is implicitly a choice
- **`consumeUsage`** -- replaced by `set` with flag checks
- **`resetUsage`** -- replaced by `expiresOn` or explicit `unset`

### Unchanged effects

All other effects remain as-is:

- `setValue`, `modifyCounter` -- state manipulation
- `applyStatus`, `removeStatus` -- unit statuses (these may converge
  with `set`/`unset` in future, but for now remain separate as they
  target specific units)
- `award`, `spendResource` -- resource transactions
- `roll`, `rerollDie`, `rerollPool`, `spendDice` -- dice operations
- `computePoolSum` -- pool arithmetic
- `addProhibition`, `removeProhibition` -- eligibility gating
- `ensureExists`, `mergeInto` -- state initialization
- `setSeed` -- RNG control
- `appendLogNote` -- logging

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

Every rule is a choice. The player picks from all matching rules.

### `consumeUsage` / `resetUsage`

Replaced by `set`/`unset` flags with `expiresOn`.

### Rule scope (`scope: global/player/entity`)

Removed. Scoping is handled by conditions. A rule that should only
apply to the active player's units includes the appropriate selector
or state check in `when`.

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
    "label": "Clear battleshocked from previous round",
    "effect": [
      { "removeStatus": { "target": { "selector": "units_battleshocked" }, "key": "battleshocked" } }
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
    "id": "CORE.Command.RunBattleshock",
    "when": { "on": "commandPhase" },
    "label": "Run battleshock tests",
    "effect": [
      { "sequence": "battleshockTest" }
    ]
  },
  {
    "id": "STRAT.InsaneBravery",
    "when": {
      "all": [
        { "is": "commandPhase" },
        { "not": { "is": "battleshockRoll" } },
        { "not": { "is": "insaneBraveryUsed" } },
        { "selector": { "id": "active_player_needs_battleshock" } }
      ]
    },
    "label": "Insane Bravery (auto-pass battleshock)",
    "costs": { "cp": 1 },
    "effect": [
      { "setValue": { "path": "$.battleshock.autoPass", "value": true } },
      { "set": "insaneBraveryUsed" }
    ]
  },
  {
    "id": "STRAT.CommandReroll",
    "when": {
      "all": [
        { "is": "battleshockRoll" },
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
    "id": "CORE.Battleshock.SelectUnit",
    "when": {
      "all": [
        { "is": "battleshockTest" },
        { "selector": { "id": "active_player_needs_battleshock" } }
      ]
    },
    "label": "Select unit for battleshock test",
    "effect": [
      { "setValue": { "path": "$.battleshock.currentUnitId", "valueFromChoice": "selectedUnitId" } }
    ]
  },
  {
    "id": "CORE.Battleshock.Roll",
    "when": { "on": "battleshockRoll" },
    "label": "Roll battleshock test",
    "effect": [
      { "roll": { "count": 2, "sides": 6, "storePath": "$.battleshock.rollResult" } }
    ]
  },
  {
    "id": "CORE.Battleshock.Resolve.AutoPass",
    "when": {
      "all": [
        { "on": "battleshockResolve" },
        { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } }
      ]
    },
    "label": "Battleshock auto-passed (Insane Bravery)",
    "effect": [
      { "appendLogNote": { "message": "Battleshock auto-passed" } },
      { "setValue": { "path": "$.battleshock.autoPass", "value": false } },
      { "removeStatus": { "target": { "path": "$.battleshock.currentUnitId" }, "key": "needs_battleshock_test" } }
    ]
  },
  {
    "id": "CORE.Battleshock.Resolve.Test",
    "when": {
      "all": [
        { "on": "battleshockResolve" },
        { "not": { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } } }
      ]
    },
    "label": "Resolve battleshock test",
    "effect": [
      { "computePoolSum": { "poolPath": "$.battleshock.rollResult", "targetPath": "$.battleshock.sum" } },
      { "removeStatus": { "target": { "path": "$.battleshock.currentUnitId" }, "key": "needs_battleshock_test" } }
    ]
  },
  {
    "id": "CORE.Battleshock.Resolve.Fail",
    "when": {
      "all": [
        { "is": "battleshockResolve" },
        { "not": { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } } },
        { "not": { "pathAtLeastPath": { "path": "$.battleshock.sum", "valuePath": "$.battleshock.targetLd" } } }
      ]
    },
    "label": "Battleshock failed -- unit is battleshocked",
    "effect": [
      { "applyStatus": { "target": { "path": "$.battleshock.currentUnitId" }, "key": "battleshocked" } }
    ]
  }
]
```

Battleshock sub-sequence:

```yaml
battleshockTest:
  - battleshockTest
  - battleshockRoll
  - battleshockResolve
```

### Walkthrough

**Step: `commandPhase` enters**

State: `commandPhase = true`

Rule loop iteration 1 -- matching rules:
- `CORE.Command.ClearBattleshock` (on commandPhase) -- matches
- `CORE.Command.GainCP` (on commandPhase) -- matches
- `CORE.Command.RunBattleshock` (on commandPhase) -- matches
- `STRAT.InsaneBravery` (is commandPhase, needs_battleshock exists) -- matches

Player A sees 4 options, picks `RunBattleshock`.
Effect: enter sub-sequence `battleshockTest`.

**Sub-step: `battleshockTest` enters**

State: `commandPhase = true`, `battleshockTest = true`

Rule loop -- matching rules:
- `CORE.Battleshock.SelectUnit` (is battleshockTest, units need test) -- matches
- `STRAT.InsaneBravery` (is commandPhase, not battleshockRoll) -- matches

Player picks `InsaneBravery`. Costs: 1 CP deducted.
Effect: autoPass = true, insaneBraveryUsed set.

Re-evaluate -- matching rules:
- `CORE.Battleshock.SelectUnit` -- still matches

Player picks `SelectUnit`. Selects u2.
Effect: currentUnitId = u2.

Re-evaluate -- no more rules match at `battleshockTest`.
Advance to next event in sub-sequence.

**Sub-step: `battleshockRoll` enters**

State: `commandPhase = true`, `battleshockTest = true`,
`battleshockRoll = true`

Rule loop -- matching rules:
- `CORE.Battleshock.Roll` (on battleshockRoll) -- matches

Player picks it (only option).
Effect: roll 2D6 -> [3, 5] stored.

Re-evaluate -- matching rules:
- `STRAT.CommandReroll` (is battleshockRoll, not used) -- matches

Player passes (no rules picked -- but wait, the rule loop continues
until no rules match, and CommandReroll still matches).

Actually: the player must pick a rule or explicitly pass. When the
player passes, the step ends even if rules still match.

**Sub-step: `battleshockRoll` exits**

State: `battleshockRoll` removed.

**Sub-step: `battleshockResolve` enters**

State: `commandPhase = true`, `battleshockTest = true`,
`battleshockResolve = true`

Rule loop -- matching rules:
- `CORE.Battleshock.Resolve.AutoPass` (on battleshockResolve,
  autoPass = true) -- matches

Player picks it.
Effect: log pass, clear autoPass, remove needs_battleshock_test
from u2.

Re-evaluate -- no more rules match.

**Sub-step: `battleshockResolve` exits**

Sub-sequence `battleshockTest` is done. Back to `battleshockTest`
event's rule loop.

**Back in `battleshockTest`**

Re-evaluate -- matching rules:
- `CORE.Battleshock.SelectUnit` (units still needing test?) --
  if u4 also needs testing, this matches (but u4 belongs to player B,
  not the active player -- selector handles this)

No more matching rules. `battleshockTest` event's rule loop ends.

**Sub-step: `battleshockTest` exits**

Back to `commandPhase` rule loop.

Re-evaluate -- matching rules:
- `CORE.Command.ClearBattleshock` (on commandPhase) -- no longer
  matches (on-rules already had their chance)
- `CORE.Command.GainCP` (on commandPhase) -- still matches (hasn't
  fired yet, on-rules track per-rule)
- `CORE.Command.RunBattleshock` (on commandPhase) -- already fired

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
| Scope state | Flag-based state: `set`/`unset`/`is`/`on` |
| Rule loop | Re-evaluate all rules after each fires; player picks order |
| `sequence` effect | Rules can invoke sub-sequences inline |
| Expiry on flags | `expiresOn` for `set` flags, cleared at event entry |
| Player pass | Player can pass (end step) even if rules still match |

### Removed from engine

| Component | Replacement |
|---|---|
| `trigger: { event }` | `on(X)` / `is(X)` conditions |
| `precedence.priority` | Player ordering |
| `precedence.strategy` | Re-evaluation (one rule at a time) |
| Conflict resolution | Not needed |
| `emit` effect | `sequence` effect |
| `addChoice` effect | Every rule is a choice |
| `consumeUsage` / `resetUsage` | `set` / `unset` with `expiresOn` |
| `scope` field on rules | Conditions handle scoping |
| `rulesByEvent` index | All rules evaluated each loop (index by `is`/`on` keys for performance) |

### Unchanged

| Component | Notes |
|---|---|
| State (get/set/JSONPath) | Unchanged |
| Effects (setValue, roll, award, etc.) | Unchanged |
| Statuses (applyStatus, removeStatus) | Unchanged |
| RNG (SeededRNG) | Unchanged |
| Undo (snapshot/restore) | Needs adaptation for new rule loop |
| Loader (loadPack) | Updated for new rule + timeline format |
| CLI | Needs updated choice display (show matching rules) |
| Datasheet layer | Unchanged |
| Glossary / selectors | Unchanged |

---

## 10. Open Questions

### Event parameters and active player

In v1, events carried parameters (e.g., `player: "A"`). In v2, events
are just names in state -- they have no parameters. The active player
must be tracked in regular state instead.

The `forEach` construct in the timeline sets `$.turnPlayer` when
iterating over players. Rules that need the active player reference
`$.turnPlayer` via `pathEquals` or selectors, not `eventParam`.

This means `{ "eventParam": "player" }` references in effects
(e.g., `award.target`) need to change to `{ "path": "$.turnPlayer" }`
or equivalent. Selectors that use `valueFromEventParam` need to use
`valueFromPath` instead.

### Undo semantics

In v1, undo reverts to before a choice was applied. In v2, every rule
is a choice. Undo should revert to before the last rule fired. The
snapshot stack approach still works -- snapshot state before each rule
execution, restore on undo.

### Performance

Every rule is evaluated on every loop iteration. For packs with many
rules, this could be slow. Mitigation: index rules by the `is`/`on`
keys they reference, only evaluate rules that reference currently-true
flags. This is analogous to the current `rulesByEvent` index.

### Player pass semantics

When the player passes, the step ends even if rules still match. This
is necessary for optional rules (stratagems). But it means the player
could skip mandatory rules. For correctness-first, this is acceptable
-- the player is responsible for playing correctly. UX can later add
"mandatory" flags to prevent passing when mandatory rules remain.

---

## 11. Files Changed / Created

| File | Action |
|---|---|
| `engine/src/engine/index.ts` | Rewrite: new rule loop, scope stack |
| `engine/src/rules/index.ts` | Rewrite: remove evaluate(), add ruleLoop() |
| `engine/src/rules/predicates.ts` | Modify: add `is`, `on` predicates |
| `engine/src/rules/effects.ts` | Modify: add `set`, `unset`, `sequence`; remove `emit`, `addChoice`, `consumeUsage`, `resetUsage` |
| `engine/src/rules/conflicts.ts` | Delete |
| `engine/src/types/rules.ts` | Rewrite: new Rule type, new Effect/Predicate unions |
| `engine/src/types/pack.ts` | Modify: update LoadedPack, remove rulesByEvent |
| `engine/src/sequencer/index.ts` | Simplify: walk flat event lists |
| `engine/src/choices/index.ts` | Simplify or remove (rules replace choices) |
| `engine/src/loader/rules.ts` | Update for new rule format |
| `engine/src/loader/validation.ts` | Update for new rule format |
| `packs/wh40k-10e-ms5b/` | Rewrite rules + timeline for v2 |
| `engine/tests/` | Rewrite affected tests |
