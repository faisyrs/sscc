# SSCC Engine -- Evaluation Model

**State, Sequence, Condition, Choice** -- a game-agnostic rules engine.

---

## 1. Overview

The SSCC engine evaluates game rules through a simple loop:

1. Walk a sequence of named events.
2. At each event, find all rules whose conditions match the current
   state.
3. The player resolves one rule at a time, choosing order when
   multiple match.
4. After each rule fires, re-evaluate from scratch.
5. When no more rules match, advance to the next event.

Everything in the engine reduces to **state** (a JSON tree),
**sequences** (ordered lists of event names), **conditions**
(predicates over state), and **choices** (player decisions).

### Pack

A pack describes a game. It contains:

- **Sequences** -- the game timeline and named sub-sequences
- **Rules** -- condition-effect pairs that define game mechanics

And optional conveniences:

- **Objects** -- named mappings from game concepts to state paths
- **Macros** -- shorthand that expands to primitives at load time

---

## 2. Core Concepts

### State

A single JSON tree that holds all game data. Every fact about the
game -- player resources, unit stats, flags, dice results, phase
markers -- lives in this tree. There is no separate "status" system
or "event parameter" system. State is the single source of truth.

State is read via JSONPath expressions (e.g., `$.turnPlayer`,
`$.players.p1.units.u2.BaseLeadership`). The `$` prefix denotes the
root of the state tree.

### Object

An object is a named collection of related state at a path. The
engine has no built-in knowledge of game-specific concepts -- object
types are defined by the pack:

```yaml
objects:
  player: "$.players"
  unit: "$.players.*.units"
  model: "$.players.*.units.*.models"
```

A "unit" is not a special engine concept -- it is whatever lives
under the `$.players.*.units` path pattern. A die in a dice pool,
a model in a unit, and a player in the game are all objects.

### Sequence

An ordered list of event names. The timeline is the top-level
sequence. Packs define named sub-sequences that rules can invoke.

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

Processing a sequence means processing each event in order. There
are no loop constructs in the sequence definition. The only looping
in the engine is the rule loop itself.

### Event

A named moment in the game. Processing an event has three steps:

1. **Set the event name in state** (`commandPhase` becomes true).
   Expire any flags whose `expiresOn` matches this event name.
2. **Run the rule loop** (see section 4).
3. **Remove the event name from state** (`commandPhase` becomes
   false).

Events are state. During step 2, `is("commandPhase")` is true. If
a rule enters a sub-sequence during step 2, child events are
set/unset within the parent's lifetime -- so `is("commandPhase")`
remains true throughout the entire command phase sub-sequence.

### Rule

A condition-effect pair. Rules declare what state they need (`when`)
and what they do (`effect`). All rules are "things that happen" --
they fire in the rule loop when conditions match.

```json
{
  "id": "CORE.Command.GainCP",
  "when": { "on": "commandPhase" },
  "label": "Gain 1 CP",
  "effect": [
    { "set": "$.turnPlayer.cp", "value": { "add": 1 } }
  ]
}
```

Fields:

- **`id`** -- unique identifier
- **`when`** -- condition tree (see section 3)
- **`effect`** -- list of effects to execute (see section 5)
- **`label`** -- human-readable description (displayed to player)
- **`costs`** -- resource costs (e.g., `{ "cp": 1 }`); engine checks
  affordability and deducts on selection
- **`provenance`** -- source reference metadata (not used by engine)

Rules without a `playerChoice` condition are mandatory -- they must
fire. Rules with `playerChoice` are optional -- the specified player
may decline.

### Choice

A decision the player makes. Choices appear in two contexts:

1. **Rule ordering** -- when multiple rules match in the rule loop,
   the player picks which to resolve next.
2. **Within a rule** -- a rule's effect may require a selection from
   a set (e.g., "pick a unit to test", "pick a target").

Optional abilities (stratagems, reactive abilities) use the
`playerChoice` condition to indicate which player is offered the
option and that they may decline. The `player` field specifies who
gets the choice, which is critical for opponent-turn reactions
(e.g., Overwatch is offered to the opponent, not the active player).

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

A standard macro library ships with the engine for common dice
operations (roll, reroll, pool sum, etc.). These are not special
engine primitives -- they expand to `set`/`unset` on die objects.

---

## 3. Conditions

Conditions are predicates over state. A rule's `when` field contains
a condition tree that the engine evaluates to determine if the rule
matches.

### `is(X)`

True when `X` exists in state. Matches for as long as the flag is
set.

```json
{ "is": "commandPhase" }
```

Used for: rules that are available throughout a scope (stratagems,
reactive abilities).

### `on(X)`

True when `X` was just added to state -- the transition from false
to true. Matches once per event entry.

```json
{ "on": "commandPhase" }
```

Used for: rules that fire once when an event starts (CP gain,
cleanup).

Implementation: `on(X)` matches if X was set during the current
event's step 1 AND the rule has not yet fired during this event.
The engine tracks which rules have fired at each event. `on` rules
fire at most once per event. `is` rules can fire multiple times
(if their conditions re-match after state changes).

### `manual(prompt)`

A condition the engine cannot evaluate. The engine presents the
prompt string to the player, who answers yes or no. Used for spatial
conditions (proximity, line of sight, cover) and any subjective game
state.

```json
{ "manual": "Is this unit within 12\" of a Dread Aura model?" }
```

Manual conditions are first-class. The tabletop game inherently has
state the engine cannot track (model positions, terrain, cover,
custom conversions). Manual decisions are logged in state history
with the question and answer.

### `playerChoice(player)`

Marks a rule as optional -- the specified player may decline it.
Rules without `playerChoice` are mandatory and must fire.

```json
{ "playerChoice": { "player": "$.turnPlayer" } }
{ "playerChoice": { "player": "$.opponent" } }
```

Used for: stratagems, reactive abilities, and any optional action.
The `player` field specifies who is offered the choice, enabling
opponent-turn reactions.

### Composition

- **`all`** -- logical AND; all children must be true
- **`any`** -- logical OR; at least one child must be true
- **`not`** -- logical NOT; child must be false

### State queries

- **`pathEquals`** -- value at path equals expected value
- **`pathAtLeast`** -- numeric value at path >= threshold
- **`pathAtLeastPath`** -- numeric value at path >= value at another
  path
- **`pathMissing`** -- path does not exist in state
- **`pathIn`** -- value at path is in a set of values

### Selectors

- **`selector`** -- evaluate a named or inline selector; true if at
  least one object matches

Selectors find objects matching criteria. They can be defined in the
pack's glossary (for reuse) or inline in a rule:

```json
{ "selector": { "object": "unit", "where": {
    "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } }
} } }
```

Named selector (defined in glossary, referenced by ID):

```json
{ "selector": { "id": "active_player_untested_units" } }
```

Within a selector's `where` clause, `$entity` refers to the object
being evaluated.

### `tagPresent`

Check for a keyword on an object.

```json
{ "tagPresent": { "target": { "path": "$.selectedUnit" }, "tag": "INFANTRY" } }
```

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

### Key properties

- **One rule fires at a time.** After each, the full rule set is
  re-evaluated from scratch against the new state.
- **Player orders everything.** When multiple rules match, the active
  player chooses which to resolve.
- **No conflict resolution needed.** Two rules targeting the same
  state cannot conflict because only one fires at a time. After one
  fires, the other may no longer match.
- **A step can fire zero rules.** If nothing matches, the event is a
  no-op and the sequence advances.
- **Loops are emergent.** A rule that matches repeatedly (e.g.,
  "select unit for battleshock" while units still need testing) fires
  each time the player picks it. When no more units need testing,
  the condition stops matching and the loop ends.
- **Auto-resolve.** When exactly one mandatory rule matches and no
  optional choices are available, the engine fires it without player
  interaction.
- **Mandatory rules cannot be skipped.** The player can only pass
  when no mandatory rules remain.

### `on` vs `is` in the rule loop

`on(X)` matches if X was set during this event's step 1 AND the rule
has not yet fired during this event. `is(X)` matches whenever X is
true, regardless of how many times the rule has fired.

`on` rules fire at most once per event. `is` rules can fire
repeatedly as long as their conditions keep re-matching after state
changes. Each rule tracks whether it has fired during the current
event.

---

## 5. Effects

Effects are state changes produced by a rule. A rule's `effect`
field is a list of effects executed in order.

### `set`

Set a flag, value, or modify a numeric value in state. The single
effect for all state writes. Supports optional `expiresOn`.

Set a flag (boolean true):

```json
{ "set": "insaneBraveryUsed" }
{ "set": "commandRerollUsed", "expiresOn": "endOfPhase" }
```

Set a value:

```json
{ "set": "$.players.p1.units.u2.battleshocked", "value": true }
{ "set": "$.turnPlayer", "value": { "path": "$.attacker" } }
{ "set": "$.battleshock.selectedUnit", "valueFromChoice": "selectedUnitId" }
```

Modify a numeric value:

```json
{ "set": "$.turnPlayer.cp", "value": { "add": 1 } }
{ "set": "$.turnPlayer.cp", "value": { "add": -1 } }
```

When an event fires (step 1), all flags with a matching `expiresOn`
are cleared before the rule loop runs.

### `unset`

Remove a flag or value from state.

Simple path:

```json
{ "unset": "commandRerollUsed" }
```

Targeted by selector (bulk unset):

```json
{ "unset": { "key": "battleshocked", "target": { "object": "unit", "where": {
    "pathEquals": { "path": "$entity.owner", "value": { "path": "$.turnPlayer" } }
} } } }
```

### `sequence`

Enter a named sub-sequence. The engine processes each event in the
sub-sequence (set name, rule loop, unset name) before returning to
the current rule loop.

```json
{ "sequence": "battleshockTest" }
```

Or an inline list of events:

```json
{ "sequence": ["battleshockRoll", "battleshockCompare"] }
```

### `test`

Compare a value against a target and branch on the result. The value
can come from a new roll, an existing dice pool, or a state path.
The target can be a derived state definition, a literal, or a state
path.

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

When the target references a derived state definition (see section
6), the engine evaluates it at test time, including prompting for
any `manual` conditions on contributing modifier rules.

### `setSeed`

Set the RNG seed (for deterministic replay).

### `appendLogNote`

Add a message to the game log.

---

## 6. Derived State

Some values are not stored directly -- they are computed on demand
from a base value plus active modifiers. Derived state definitions
are defined in the pack and referenced by rules (e.g., in `test`
targets).

### Definition

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
```

### Evaluation

When the engine needs a derived value (e.g., during a `test`
effect), it:

1. Reads the base value from state
2. Glob-matches all modifier state entries (e.g.,
   `$.players.p1.units.u2.CurrentLeadership.modifier*` matches
   `modifier.dreadAura`, `modifier.inspiringPresence`, etc.)
3. Aggregates them (sum, min, max -- `sum` is default)
4. Applies clamp if defined (relative to base)
5. Returns the effective value

Modifiers are regular state -- they get `set` and `unset` by rules
using the normal effect system. Their lifecycle is managed by
`expiresOn`, explicit `unset`, or the rule loop. The derived state
definition tells the engine how to combine them.

### Context binding

Before evaluating derived state, the engine sets a context variable
(e.g., `$.context.targetUnit`) to the relevant object, evaluates
modifiers against that context, then restores the previous value.
This lets rule authors write `$.targetUnit.BaseLeadership` without
accommodating every possible evaluation context.

### Clamp semantics

`clamp.min` and `clamp.max` use `offset` to express limits relative
to the base value. If BaseLeadership is 7 and clamp is
`{min: -1, max: +1}`, the effective range is 6--8 regardless of
how many modifiers are active.

The cap is defined per stat in the pack, not per rule.

### Modifier rules

Rules that set modifiers fire in the rule loop like any other rule.
For modifiers with spatial conditions (auras, proximity), the rule
uses a `manual` condition:

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

The modifier persists as state until a subsequent state change
triggers the rule again, at which point the player is re-asked.

---

## 7. Edit State

The player can directly modify any state at any point in the rule
loop. This supports gentleman's-agreement corrections ("oops, that
unit was in cover", "we forgot to give him that CP").

Edit State is always presented as an option alongside matching rules
and choices. It does not rewind -- it patches state and play
continues from the current point.

UX will provide helper functionality (e.g., browse state by object
context) so the player does not need to know raw variable paths.

---

## 8. Undo

The engine snapshots state before each rule fires. Undo restores the
snapshot from before the last rule, reverting to the previous state.

Manual decision answers are state, so restoring a snapshot naturally
discards them and the player gets re-asked.

---

## 9. Example: Command Phase Walkthrough

### Pack structure

Turn-entry rules:

```json
[
  {
    "id": "CORE.AttackerTurn.SetPlayer",
    "when": { "on": "attackerTurn" },
    "label": "Set active player (attacker)",
    "effect": [
      { "set": "$.turnPlayer", "value": { "path": "$.attacker" } },
      { "set": "$.opponent", "value": { "path": "$.defender" } }
    ]
  },
  {
    "id": "CORE.DefenderTurn.SetPlayer",
    "when": { "on": "defenderTurn" },
    "label": "Set active player (defender)",
    "effect": [
      { "set": "$.turnPlayer", "value": { "path": "$.defender" } },
      { "set": "$.opponent", "value": { "path": "$.attacker" } }
    ]
  }
]
```

Command phase rules:

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
      { "set": "$.turnPlayer.cp", "value": { "add": 1 } }
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
      { "set": "$.battleshock.selectedUnit", "valueFromChoice": "selectedUnitId" },
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
      { "set": "$.battleshock.selectedUnit", "valueFromChoice": "selectedUnitId" },
      { "set": "$.battleshock.selectedUnit.not-battleshocked", "value": true },
      { "set": "insaneBraveryUsed" }
    ]
  }
]
```

Battleshock test sub-sequence and rules:

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
    ],
    "_note": "roll is a macro -- expands to set on die objects at load time"
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
    ],
    "_note": "rerollDie is a macro -- expands to set on die object at load time"
  },
  {
    "id": "CORE.Battleshock.Compare",
    "when": { "on": "battleshockCompare" },
    "label": "Resolve battleshock test",
    "effect": [
      {
        "test": {
          "usePool": "$.battleshock.rollResult",
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

**Step: `attackerTurn` enters**

State: `attackerTurn = true`

Rule loop: `CORE.AttackerTurn.SetPlayer` matches (on attackerTurn).
Auto-resolved (single mandatory rule).
Effect: `$.turnPlayer` = `$.attacker`, `$.opponent` = `$.defender`.

**Step: `commandPhase` enters**

State: `commandPhase = true`

Rule loop iteration 1 -- matching:
- `CORE.Command.ClearBattleshock` (on, mandatory) -- matches
- `CORE.Command.GainCP` (on, mandatory) -- matches
- `CORE.Command.BattleshockEligible` (is, mandatory) -- matches
- `STRAT.InsaneBravery` (is, playerChoice) -- matches

Player sees: [ClearBattleshock, GainCP, BattleshockEligible,
InsaneBravery, Edit State]
(No Pass -- mandatory rules remain)

Player picks `ClearBattleshock`.
Effect: clear all battleshock/not-battleshocked flags for turn
player's units.

Re-evaluate:
- `CORE.Command.GainCP` (on, hasn't fired) -- matches
- `CORE.Command.BattleshockEligible` -- matches
- `STRAT.InsaneBravery` -- matches

Player picks `InsaneBravery`. Costs: 1 CP deducted.
Player selects unit u2.
Effect: u2.not-battleshocked = true, insaneBraveryUsed set.

Re-evaluate:
- `CORE.Command.GainCP` -- matches
- `CORE.Command.BattleshockEligible` (u3 still untested) -- matches

Player picks `BattleshockEligible`. Selects unit u3.
Effect: enter sub-sequence `battleshockTest` for u3.

**Sub-step: `battleshockRoll` enters**

State: `commandPhase = true`, `battleshockRoll = true`

`CORE.Battleshock.Roll` matches (on, mandatory).
Auto-resolved.
Effect: roll 2D6 -> [3, 5] stored.

Re-evaluate:
- `STRAT.CommandReroll` (is, playerChoice, not used) -- matches

Only optional choices remain.
Player sees: [CommandReroll, Pass, Edit State].
Player passes.

**Sub-step: `battleshockCompare` enters**

State: `commandPhase = true`, `battleshockCompare = true`

`CORE.Battleshock.Compare` matches (on, mandatory).
Auto-resolved. Engine evaluates `test`:
- Roll sum: 3 + 5 = 8
- Target: CurrentLeadership for u3 = BaseLeadership(7) +
  modifiers(none) = 7, clamped to range 6--8
- 8 >= 7: pass

Effect: u3.not-battleshocked = true.

**Back in `commandPhase` rule loop**

Re-evaluate:
- `CORE.Command.GainCP` -- matches (hasn't fired)
- No more untested units

Auto-resolved (single mandatory rule).
Effect: +1 CP.

Re-evaluate -- nothing matches. Step ends.

**Step: `endOfPhase` enters**

State: `endOfPhase = true`

Expiry: `commandRerollUsed` cleared (expiresOn: endOfPhase).

Rule loop -- nothing matches. Step ends.

Sequence advances to `movementPhase`.

---

## 10. Performance

Rules are indexed by the `is`/`on` keys they reference. At each rule
loop iteration, only rules whose keys match currently-true flags are
evaluated.
