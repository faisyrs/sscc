# SSCC Engine Milestone 3 -- Design Spec

**Date:** 2026-04-03
**Scope:** Seeded RNG, dice state bundles, pool operations, pattern matching
**Branch:** milestone2

---

## 1. What Milestone 3 Includes

1. **Seeded RNG subsystem** -- deterministic, reproducible Mulberry32 PRNG
2. **Dice as state bundles** -- each die is a keyed object at a path, not an array element
3. **`roll` effect verb** -- creates die bundles with RNG values and configurable defaults
4. **`rerollDie` effect verb** -- rerolls a single die, marks it rerolled
5. **`rerollPool` effect verb** -- rerolls an entire pool (Favoured of Khorne)
6. **`spendDice` effect verb** -- marks selected dice as spent
7. **`poolContainsPattern` predicate** -- checks if unspent dice can form a pattern
8. **`diePoolCount` predicate** -- counts dice matching a filter condition
9. **Multi-die selection in choices** -- `selectionFrom` with `pick` for subset selection
10. **`setSeed` effect verb** -- reseeds the RNG (debugging/testing)
11. **Attack pipeline integration test** -- reproduce worked example from spec Section 13
12. **Blessings of Khorne integration test** -- dice pool, pattern selection, spending

## What Milestone 3 Does NOT Include

- `whyNot` API (Milestone 4)
- Snapshot/restore (Milestone 4)
- Full army pack (tests validate engine mechanics only)

---

## 2. Seeded RNG

### Algorithm: Mulberry32

A fast 32-bit PRNG with good statistical distribution. Pure TypeScript,
zero dependencies, ~10 lines of code.

```typescript
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### SeededRNG class

```typescript
class SeededRNG {
  private rng: () => number;
  private currentSeed: number;

  constructor(seed: number);
  nextInt(min: number, max: number): number;  // inclusive range
  reseed(seed: number): void;
  getSeed(): number;
}
```

### Seed lifecycle

1. Engine constructor accepts optional `{ seed?: number }`
2. If omitted, seed is generated from `Date.now()`
3. Seed is logged at initialization
4. Packs can reseed via `setSeed` effect (guarded by conditions)
5. Every reseed is logged

---

## 3. Dice as State Bundles

Dice are not arrays. Each die is a keyed state bundle under a pool path,
consistent with how SSCC stores all other entities (units, phases, etc.).

### State shape after rolling 4d6 at `$.currentAttack.hitRolls`

```text
$.currentAttack.hitRolls.count       = 4
$.currentAttack.hitRolls.d0.value    = 2
$.currentAttack.hitRolls.d0.rerolled = false
$.currentAttack.hitRolls.d1.value    = 6
$.currentAttack.hitRolls.d1.rerolled = false
$.currentAttack.hitRolls.d2.value    = 4
$.currentAttack.hitRolls.d2.rerolled = false
$.currentAttack.hitRolls.d3.value    = 1
$.currentAttack.hitRolls.d3.rerolled = false
```

### State shape for Blessings of Khorne (8d6 with spent tracking)

```text
$.blessingsRoll.count       = 8
$.blessingsRoll.d0.value    = 1
$.blessingsRoll.d0.rerolled = false
$.blessingsRoll.d0.spent    = false
$.blessingsRoll.d1.value    = 2
$.blessingsRoll.d1.rerolled = false
$.blessingsRoll.d1.spent    = false
...
$.blessingsRoll.d7.value    = 6
$.blessingsRoll.d7.rerolled = false
$.blessingsRoll.d7.spent    = false
```

### Why not arrays?

- Units aren't arrays. Phases aren't arrays. Dice shouldn't be either.
- Every existing predicate (`pathEquals`, `pathGreaterThan`, etc.) works
  on individual dice with no changes.
- No new types needed -- a die is just `{ value, rerolled, ... }` at a path.
- Metadata is just more paths on the bundle -- no parallel arrays, no sync risk.

### Accessing individual dice

```yaml
# Check die 3's value
- pathAtLeast:
    path: "$.currentAttack.hitRolls.d3.value"
    value: 3

# Check if die 3 has been rerolled
- pathEquals:
    path: "$.currentAttack.hitRolls.d3.rerolled"
    value: false
```

### Iterating over dice

The sequencer's existing `forEach` handles iteration:

```yaml
- forEach:
    collection: "$.currentAttack.hitRolls"
    keyPattern: "d{i}"
    count: { path: "$.currentAttack.hitRolls.count" }
    as: "currentDie"
    sequence:
      - event: EvaluateDie
        params:
          diePath: "$.currentAttack.hitRolls.d{i}"
```

---

## 4. Roll Effect Verb

### Schema

```json
{ "roll": {
    "count": 4,
    "sides": 6,
    "storePath": "$.currentAttack.hitRolls",
    "defaults": { "rerolled": false }
}}
```

- `count` -- literal number or `{ "path": "$.some.path" }` resolved from state
- `sides` -- literal number, default 6
- `storePath` -- state path where die bundles are created
- `defaults` -- optional object merged into each die bundle alongside `value`.
  If omitted, each die is `{ value, rerolled: false }`.

### Behavior

1. Resolve `count` (literal or from state path)
2. Write `count` to `{storePath}.count`
3. For each die `i` in `0..count-1`:
   a. Generate random integer in range `[1, sides]` using the engine's RNG
   b. Write `{ value, rerolled: false, ...defaults }` to `{storePath}.d{i}`
4. Log: `"roll: {count}d{sides} -> [v0, v1, ...] at {storePath}"`

### Examples

```yaml
# Attack roll: 4d6, default metadata
- roll:
    count: 4
    sides: 6
    storePath: "$.currentAttack.hitRolls"

# Blessings of Khorne: 8d6, needs spent tracking
- roll:
    count: 8
    sides: 6
    storePath: "$.blessingsRoll"
    defaults: { rerolled: false, spent: false }
```

### Conflict domain

`(storePath)` -- same as `setValue`. Stackability: singleton.

---

## 5. RerollDie Effect Verb

### Schema

```json
{ "rerollDie": {
    "poolPath": "$.currentAttack.hitRolls",
    "dieIndex": 3,
    "sides": 6
}}
```

- `poolPath` -- state path to the die pool
- `dieIndex` -- literal number or `{ "path": "$.some.path" }` resolved from state
- `sides` -- literal number, default 6

### Behavior

1. Read the die bundle at `{poolPath}.d{dieIndex}`
2. If `rerolled === true`, throw error (no die may be rerolled more than once)
3. Generate one new random integer in range `[1, sides]` using the engine's RNG
4. Set `value` to new value and `rerolled` to `true`, preserving all other fields
5. Log: `"reroll: die[{dieIndex}] {oldValue} -> {newValue} at {poolPath}"`

### Conflict domain

`(poolPath, dieIndex)` -- two rerolls targeting the same die conflict.
Different dice in the same pool do not conflict.

---

## 6. RerollPool Effect Verb

Rerolls an entire pool. Used by Favoured of Khorne ("discard entire roll
and make a new Blessings of Khorne roll").

### Schema

```json
{ "rerollPool": {
    "poolPath": "$.blessingsRoll",
    "sides": 6
}}
```

### Behavior

1. Read `count` from `{poolPath}.count`
2. For each die `i` in `0..count-1`:
   a. Generate new random integer in range `[1, sides]`
   b. Reset die to `{ value: newValue, rerolled: false, ...originalDefaults }`
3. Log: `"rerollPool: {count}d{sides} -> [v0, v1, ...] at {poolPath}"`

Note: Per Favoured of Khorne rules, a full pool reroll does NOT count as
a per-die re-roll. Each die's `rerolled` flag is reset to `false`, so
individual die reroll abilities (e.g. Icon of Khorne) can still be used.

### Conflict domain

`(poolPath)` -- singleton per pool.

---

## 7. SpendDice Effect Verb

Marks a set of dice as spent. Used by Blessings of Khorne to consume
dice that were allocated to activate a blessing.

### Schema

```json
{ "spendDice": {
    "poolPath": "$.blessingsRoll",
    "dieIndices": [5, 6]
}}
```

- `poolPath` -- state path to the die pool
- `dieIndices` -- literal array of indices, or `{ "fromChoice": "selectedDice" }`
  resolved from the player's multi-die selection

### Behavior

1. For each index in `dieIndices`:
   a. Read die bundle at `{poolPath}.d{index}`
   b. If `spent === true`, throw error (die already spent)
   c. Set `spent` to `true`, preserving all other fields
2. Log: `"spendDice: [{indices}] at {poolPath}"`

### Conflict domain

`(poolPath, dieIndices sorted)` -- spending the same set conflicts.

---

## 8. SetSeed Effect Verb

### Schema

```json
{ "setSeed": { "seed": 42 } }
```

### Behavior

1. Call `rng.reseed(seed)`
2. Log: `"RNG reseeded to {seed}"`

### Conflict domain

`"setSeed"` -- singleton. Only one reseed per event evaluation.

---

## 9. PoolContainsPattern Predicate

Checks whether a die pool contains unspent/unfiltered dice that can form
a specific pattern. Used to gate choices -- don't offer "Warp Blades" if
no valid double 5+ or triple exists.

### Schema

```json
{ "poolContainsPattern": {
    "pool": "$.blessingsRoll",
    "filter": { "spent": false },
    "pattern": { "kind": "double", "minValue": 5 }
}}
```

### Pattern kinds

- `{ "kind": "double" }` -- any two dice with matching values
- `{ "kind": "double", "minValue": N }` -- two matching dice, both >= N
- `{ "kind": "triple" }` -- any three dice with matching values
- `{ "kind": "triple", "minValue": N }` -- three matching dice, both >= N

### Compound patterns (OR)

Some blessings require "DOUBLE 4+ OR ANY TRIPLE". Use `any` composition:

```yaml
conditions:
  - any:
    - poolContainsPattern:
        pool: "$.blessingsRoll"
        filter: { spent: false }
        pattern: { kind: "double", minValue: 4 }
    - poolContainsPattern:
        pool: "$.blessingsRoll"
        filter: { spent: false }
        pattern: { kind: "triple" }
```

### Behavior

1. Read all die bundles from `pool` (d0..d{count-1})
2. Filter to dice matching `filter` (all field values must match)
3. Among filtered dice, check if the pattern can be formed:
   - Group dice by value
   - For `double`: any group has >= 2 dice (with values >= minValue if set)
   - For `triple`: any group has >= 3 dice (with values >= minValue if set)
4. Return true/false

---

## 10. DiePoolCount Predicate

Counts dice in a pool matching a filter. Useful for "at least one
un-rerolled die exists" or "at least 3 unspent dice remain".

### Schema

```json
{ "diePoolCount": {
    "pool": "$.blessingsRoll",
    "filter": { "spent": false, "rerolled": false },
    "min": 1
}}
```

### Behavior

1. Read all die bundles from `pool`
2. Count dice where all `filter` fields match
3. Return `count >= min`

---

## 11. Multi-Die Selection in Choices

Extends `addChoice` to support selecting multiple dice from a pool.

### Schema change to addChoice

```json
{ "addChoice": {
    "id": "activate_warp_blades",
    "label": "Warp Blades (double 5+ or triple)",
    "actionRef": "doActivateWarpBlades",
    "selectionFrom": { "path": "$.blessingsRoll" },
    "selectionFilter": { "spent": false },
    "pick": 2,
    "costs": { "blessingsActivated": 1 }
}}
```

New fields on `addChoice`:

- `selectionFilter` -- optional filter object; only dice matching all
  fields are selectable
- `pick` -- number of dice the player must select (2 for double, 3 for triple)

### ChoiceInstance changes

```typescript
interface ChoiceInstance {
  // ... existing fields ...
  selectionFilter?: Record<string, unknown>;
  pick?: number;
  selectedArgs?: {
    selectedDice?: number[];  // die indices chosen by player
    // ... other args ...
  };
}
```

When the player makes a selection, `selectedArgs.selectedDice` contains
the chosen die indices (e.g. `[5, 6]` for dice d5 and d6).

### Validation at selection time

When the engine processes a multi-die selection:

1. Verify all selected indices are within `0..count-1`
2. Verify all selected dice match `selectionFilter`
3. Verify exactly `pick` dice were selected
4. Store indices in `selectedArgs.selectedDice`

Pattern validation (e.g. "these dice form a double 5+") is handled by
the rule's conditions on the `ChoiceSelected` event, using
`poolContainsPattern` or direct path checks. This keeps validation in
the rule layer, not baked into the choice system.

---

## 12. Engine Integration

### Constructor change

```typescript
constructor(pack: LoadedPack, options?: { seed?: number })
```

### Effect executor signature change

```typescript
function executeEffect(
  state: State,
  effect: Effect,
  event: GameEvent,
  sourceRuleId: string,
  glossary: Glossary,
  rng?: SeededRNG,
): EffectResult
```

The `rng` parameter is optional to avoid breaking existing callers
(unit tests that don't need RNG). Effects `roll`, `rerollDie`,
`rerollPool`, and `setSeed` throw if `rng` is not provided.

---

## 13. Worked Example: Attack Pipeline

Spec Section 13 — 4 attacks, WS 3+, Lethal Hits + Sustained 1.

Seed 668 produces die bundles:

```text
$.currentAttack.hitRolls.count       = 4
$.currentAttack.hitRolls.d0.value    = 2
$.currentAttack.hitRolls.d0.rerolled = false
$.currentAttack.hitRolls.d1.value    = 6
$.currentAttack.hitRolls.d1.rerolled = false
$.currentAttack.hitRolls.d2.value    = 4
$.currentAttack.hitRolls.d2.rerolled = false
$.currentAttack.hitRolls.d3.value    = 1
$.currentAttack.hitRolls.d3.rerolled = false
```

- d0 (2): miss
- d1 (6): crit -- Lethal Hits (+1 auto-wound) + Sustained 1 (+1 hit)
- d2 (4): hit
- d3 (1): miss
- Final: 2 hits to wound rolls, 1 auto-wound bypasses

---

## 14. Worked Example: Blessings of Khorne

Pool roll with spending and pattern matching.

### Setup

```yaml
# Roll
- roll:
    count: 8
    sides: 6
    storePath: "$.blessingsRoll"
    defaults: { rerolled: false, spent: false }
```

State with seed that produces `[1, 2, 2, 3, 4, 6, 6, 6]`:

```text
$.blessingsRoll.count       = 8
$.blessingsRoll.d0 = { value: 1, rerolled: false, spent: false }
$.blessingsRoll.d1 = { value: 2, rerolled: false, spent: false }
$.blessingsRoll.d2 = { value: 2, rerolled: false, spent: false }
$.blessingsRoll.d3 = { value: 3, rerolled: false, spent: false }
$.blessingsRoll.d4 = { value: 4, rerolled: false, spent: false }
$.blessingsRoll.d5 = { value: 6, rerolled: false, spent: false }
$.blessingsRoll.d6 = { value: 6, rerolled: false, spent: false }
$.blessingsRoll.d7 = { value: 6, rerolled: false, spent: false }
```

### Step 1: Offer blessings

Engine evaluates rules for `BlessingsOfKhorne` event. Available patterns
in unspent dice: double 2 (d1+d2), triple 6 (d5+d6+d7).

Eligible blessings (each checks `poolContainsPattern`):

| Blessing | Requires | Available? |
|---|---|---|
| Rage-Fuelled Invigoration | any double | yes (2s or 6s) |
| Wrathful Devotion | any double | yes |
| Martial Excellence | double 3+ | yes (6s) |
| Total Carnage | double 4+ or triple | yes (6s or triple 6) |
| Warp Blades | double 5+ or triple | yes (6s or triple 6) |
| Unbridled Bloodlust | double 6 or triple 4+ | yes (6s or triple 6) |

All 6 are offered as choices. Each has `usageNotConsumed` for
once-per-round and a counter check for max 2 activations.

### Step 2: Player activates Warp Blades

Player selects "Warp Blades", picks dice d5 + d6 (both 6s = double 6).

Rule effects:
```yaml
- spendDice:
    poolPath: "$.blessingsRoll"
    dieIndices: { fromChoice: "selectedDice" }  # [5, 6]
- applyStatus:
    target: { selector: "allFriendlyUnits" }
    key: "blessingWarpBlades"
    expiresOn: "EndBattleRound"
- consumeUsage:
    scope: battleRound
    key: blessing_warp_blades
- modifyCounter:
    path: "$.blessingsActivated"
    delta: 1
```

After: d5.spent = true, d6.spent = true. Remaining unspent: d0-d4, d7.

### Step 3: Player activates Wrathful Devotion

Player picks d1 + d2 (both 2s = double).

After: d1.spent = true, d2.spent = true. Counter = 2.

Max 2 reached. Remaining dice (d0, d3, d4, d7) discarded.

### Step 4: Angron special case

If Angron's "Reborn in Blood" is active and the pool contained a triple 6,
the player could instead spend d5+d6+d7 on the resurrection. This is
modeled as a separate choice with `pick: 3` and a
`poolContainsPattern: { kind: "triple", minValue: 6 }` condition.

---

## 15. Rule Sketch: Command Reroll (Single Die)

Shows how `rerollDie` integrates with the choice system.

```yaml
# Offer reroll if any un-rerolled die exists
- id: commandReroll
  trigger: { event: ResolveHitRolls }
  when:
    all:
      - usageNotConsumed: { scope: turn, key: command_reroll }
      - resourceAtLeast:
          player: { eventParam: activePlayer }
          resource: cp
          amount: 1
      - diePoolCount:
          pool: "$.currentAttack.hitRolls"
          filter: { rerolled: false }
          min: 1
  effect:
    - addChoice:
        id: command_reroll
        label: "Command Re-roll (1 CP)"
        actionRef: doCommandReroll
        selectionFrom: { path: "$.currentAttack.hitRolls" }
        selectionFilter: { rerolled: false }
        pick: 1
        costs: { cp: 1 }

# Execute the reroll
- id: doCommandReroll
  trigger: { event: ChoiceSelected }
  when:
    pathEquals:
      path: "$.event.choiceId"
      value: "command_reroll"
  effect:
    - rerollDie:
        poolPath: "$.currentAttack.hitRolls"
        dieIndex: { fromChoice: "selectedDice.0" }
        sides: 6
    - consumeUsage: { scope: turn, key: command_reroll }
```

---

## 16. Files Changed

| File | Change |
|---|---|
| `engine/src/rng/index.ts` | New: SeededRNG class with Mulberry32 |
| `engine/src/types/rules.ts` | Add `roll`, `rerollDie`, `rerollPool`, `spendDice`, `setSeed` to Effect; add `poolContainsPattern`, `diePoolCount` to PredicateNode; add `selectionFilter`, `pick` to addChoice |
| `engine/src/types/choices.ts` | Add `selectionFilter`, `pick` to ChoiceInstance |
| `engine/src/rules/effects.ts` | Implement 5 new effect executors |
| `engine/src/rules/predicates.ts` | Implement `poolContainsPattern`, `diePoolCount` |
| `engine/src/rules/conflicts.ts` | Add conflict domains for new effects |
| `engine/src/engine/index.ts` | Accept seed config, create RNG, pass to effects, validate multi-die selection |
| `engine/src/index.ts` | Export SeededRNG |
| `engine/tests/unit/rng.test.ts` | Determinism, range, reseed tests |
| `engine/tests/unit/effects-roll.test.ts` | Roll creates state bundles with defaults |
| `engine/tests/unit/effects-reroll.test.ts` | RerollDie, RerollPool, double-reroll rejection |
| `engine/tests/unit/effects-spend.test.ts` | SpendDice, double-spend rejection |
| `engine/tests/unit/predicates-pool.test.ts` | poolContainsPattern, diePoolCount |
| `engine/tests/integration/attack-pipeline.test.ts` | Section 13 worked example |
| `engine/tests/integration/blessings.test.ts` | Blessings of Khorne pool + pattern + spend |
| `packs/attack-test/` | Minimal pack: hit resolution sub-sequence |
| `packs/blessings-test/` | Minimal pack: blessings pool flow |
