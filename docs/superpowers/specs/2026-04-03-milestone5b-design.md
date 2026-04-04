# SSCC Engine Milestone 5b -- Design Spec

**Date:** 2026-04-03
**Scope:** Command phase (battleshock + stratagems), minimal movement phase, datasheet layer

---

## 1. What Milestone 5b Includes

1. **Datasheet layer** -- new optional `datasheets.yaml` in packs; loader
   merges profiles/stats into units at load time
2. **Command phase -- battleshock** -- real battleshock tests (2D6 vs Ld)
   for below-half-strength units, with loop over pending units
3. **Command phase -- stratagems** -- Insane Bravery (pre-roll auto-pass)
   and Command Re-roll (post-roll single die reroll)
4. **Movement phase** -- carried from skeleton, gate Fall Back behind
   `in_engagement_range` status
5. **One new engine effect** -- `computePoolSum` for roll-and-check-total
   mechanics
6. **MS 5B test pack** -- exercises all new mechanics end-to-end

## What Milestone 5b Does NOT Include

- Attack resolution / shooting pipeline (Milestone 5C)
- Charge rolls / melee combat (Milestone 5D)
- Casualty-driven `below_half_strength` computation (5C/5D -- seeded
  manually in the test pack for now)
- Distance/position tracking
- Army list building or datasheet discovery

---

## 2. Datasheet Layer

### File format

New optional file `datasheets.yaml` in the pack directory:

```yaml
datasheets:
  intercessor_squad:
    name: "Intercessor Squad"
    keywords: [INFANTRY, IMPERIUM, ADEPTUS ASTARTES]
    stats:
      M: 6
      T: 4
      Sv: 3
      W: 2
      Ld: 6
      OC: 2
    profiles:
      ranged:
        id: wp_bolt_rifle
        name: "Bolt Rifle"
        A: 2
        BS: 3
        S: 4
        AP: -1
        D: 1
        keywords: [RAPID FIRE 1]
      melee:
        id: wp_close_combat
        name: "Close Combat Weapon"
        A: 3
        WS: 3
        S: 4
        AP: 0
        D: 1
        keywords: []

  ork_boyz:
    name: "Ork Boyz"
    keywords: [INFANTRY, ORK]
    stats:
      M: 6
      T: 5
      Sv: 5
      W: 1
      Ld: 7
      OC: 2
    profiles:
      ranged:
        id: wp_slugga
        name: "Slugga"
        A: 1
        BS: 5
        S: 4
        AP: 0
        D: 1
        keywords: [PISTOL]
      melee:
        id: wp_choppa
        name: "Choppa"
        A: 3
        WS: 3
        S: 4
        AP: -1
        D: 1
        keywords: []
```

### Initial state references

Units reference a datasheet by ID instead of inlining profiles:

```json
{
  "units": {
    "u1": {
      "id": "u1",
      "owner": "A",
      "datasheet": "intercessor_squad",
      "models": { "total": 5, "remaining": 5 },
      "statuses": {},
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    }
  }
}
```

### Loader behavior

1. Try to read `datasheets.yaml` (optional -- skip silently if not found)
2. Parse into a map of `datasheetId -> datasheet`
3. For each unit in `initialState.units` that has a `datasheet` field:
   - Look up the datasheet (validation error if not found)
   - Merge `name`, `keywords`, `stats`, `profiles` from the datasheet
     into the unit object
   - Unit-level fields take precedence on conflict (allows per-unit
     overrides)
4. Strip the `datasheet` field from the merged unit (resolved at load
   time, not needed at runtime)

### Validation

- Unit references a datasheet ID that does not exist: error
- Datasheet missing `name` or `stats`: error
- Datasheet `stats` missing `Ld`: warning (required for battleshock)

---

## 3. Command Phase -- Battleshock

### Event flow

```text
CommandPhaseStarted
  -> clear previous round's battleshocked statuses (existing rule)
  -> identify units with below_half_strength status
  -> write their IDs to $.battleshock.pendingUnits
  -> emit BattleshockTestBegin

BattleshockTestBegin
  -> if pendingUnits is empty, emit CommandPointsAwarded and stop
  -> pop next unit, set $.battleshock.currentUnitId
  -> offer Insane Bravery (1 CP, once per battle, before roll)
  -> after stratagem window: emit BattleshockTestRoll

BattleshockTestRoll
  -> roll 2D6 to $.battleshock.rollResult
  -> offer Command Re-roll (1 CP, pick 1 die, once per phase)
  -> after stratagem window: emit BattleshockTestResolve

BattleshockTestResolve
  -> if $.battleshock.autoPass is true: log pass, clear autoPass
  -> else: computePoolSum -> $.battleshock.sum, compare to unit Ld
     -> sum >= Ld: pass (log it)
     -> sum < Ld: apply battleshocked status
  -> clean up battleshock scratch state
  -> if pendingUnits remain: emit BattleshockTestBegin (loop)
  -> else: emit CommandPointsAwarded
```

### Below-half-strength detection

For MS 5B, `below_half_strength` is a status set manually in the test
pack's initial state. Units that start with this status enter the
battleshock loop.

In MS 5C/5D, rules that apply casualties will also apply or remove
this status based on `models.remaining` vs `models.total`.

### Battleshock test resolution

The test is: roll 2D6, if the sum is **less than** the unit's Leadership
characteristic (Ld), the test is failed and the unit becomes
battleshocked.

Sum >= Ld: pass. Sum < Ld: fail.

### Scratch state

```json
{
  "battleshock": {
    "pendingUnits": [],
    "pendingIndex": 0,
    "currentUnitId": null,
    "rollResult": null,
    "sum": null,
    "autoPass": false
  }
}
```

Cleaned up after each unit's test resolves. Fully reset at
`CommandPhaseStarted`.

---

## 4. Command Phase -- Stratagems

### Insane Bravery (1 CP, once per battle)

- **Trigger:** `BattleshockTestBegin` (before the roll)
- **When:** always offered (player decides blind)
- **Cost:** 1 CP
- **Usage:** `consumeUsage` with key `insane_bravery` (never reset --
  once per battle)
- **Effect:** Set `$.battleshock.autoPass = true`
- **Result:** The resolve rule sees autoPass and skips the Ld check

The player must commit CP before seeing the dice. This is the intended
risk/reward design from 10th edition.

### Command Re-roll (1 CP, once per phase)

- **Trigger:** `BattleshockTestRoll` (after dice are visible)
- **When:** `$.battleshock.autoPass` is false (no point rerolling if
  auto-passing)
- **Cost:** 1 CP
- **Usage:** `consumeUsage` with key `command_reroll_phase` (reset at
  each `CommandPhaseStarted`)
- **Pick:** 1 die from `$.battleshock.rollResult`
- **Effect:** `rerollDie` on the selected die index
- **Result:** Die gets new value; player can then pass or the resolve
  rule fires with updated pool

### Usage reset

A rule at `CommandPhaseStarted` resets `command_reroll_phase` usage so
the stratagem is available once per command phase.

---

## 5. Movement Phase

### Existing skeleton

The `wh40k-10e-core-turn` pack already implements the full movement
activation loop:

1. Grant `can_move` to all active player units
2. Offer unit selection (from units with `can_move`)
3. On selection: set `$.activation.unitId`, emit `UnitMovementStarted`
4. Offer movement type choices (Normal, Advance, Fall Back, Stationary)
5. On type selection: apply status, emit `UnitMovementEnded`
6. Remove `can_move` from activated unit
7. If eligible units remain, re-offer unit selection; else advance

### MS 5B modification

**Fall Back gating:** Add `hasStatus: in_engagement_range` predicate to
the Fall Back choice offer. Since MS 5B has no melee, this status will
never be present, so Fall Back won't appear -- which is correct. MS 5D
will set `in_engagement_range` when units are in melee.

### Movement statuses (all expire on TurnEnded)

| Movement Type | Status Applied | Downstream Effect |
|---|---|---|
| Remain Stationary | `remained_stationary` | 5C: Heavy weapons +1 to hit |
| Normal Move | (none) | Baseline -- no modifiers |
| Advance | `advanced_move` | Prohibits shooting (non-Assault) and charging |
| Fall Back | `fell_back` | Prohibits shooting and charging |

### Shooting/charge prohibitions (existing skeleton rules)

The skeleton already has `CORE.Shoot.Prohibit.Advanced.1`,
`CORE.Shoot.Prohibit.FellBack.1`, `CORE.Charge.Prohibit.Advanced.1`,
and `CORE.Charge.Prohibit.FellBack.1`. These fire at the respective
phase starts and add prohibitions. No changes needed.

---

## 6. Engine Changes

### New effect: computePoolSum

Added to `engine/src/rules/effects.ts`.

```typescript
// Rule effect format:
// { computePoolSum: { poolPath: "$.battleshock.rollResult", targetPath: "$.battleshock.sum" } }
```

Behavior:
1. Read all dice at `poolPath` (keys matching `d0`, `d1`, ...)
2. Sum their `value` fields (skip spent dice if `skipSpent: true` is set)
3. Write the integer sum to `targetPath`

This is generic -- usable for battleshock (2D6 vs Ld), charge distance
(2D6 vs range, in 5D), psychic tests, or any roll-and-check-total
mechanic.

### Datasheet merging in loader

Added to `engine/src/loader/index.ts`. See Section 2 for full
specification.

### No other engine changes

- No new predicates
- No new choice types or selector kinds
- No changes to the CLI
- No changes to the sequencer, RNG, or undo system

---

## 7. Rule Inventory

### Movement (from skeleton, 1 modification)

| Rule ID | Trigger | Change |
|---|---|---|
| `CORE.Move.Grant.1` | `MovementPhaseStarted` | existing |
| `CORE.Move.OfferSelect.1` | `MovementPhaseStarted` | existing |
| `CORE.Move.ReofferSelect.1` | `UnitMovementEnded` | existing |
| `CORE.Move.SelectAction.1` | `ChoiceSelected` | existing |
| `CORE.Move.OfferTypes.1` | `UnitMovementStarted` | **modify**: gate Fall Back behind `hasStatus: in_engagement_range` |
| `CORE.Move.TypeAction.Normal.1` | `ChoiceSelected` | existing |
| `CORE.Move.TypeAction.Advance.1` | `ChoiceSelected` | existing |
| `CORE.Move.TypeAction.FallBack.1` | `ChoiceSelected` | existing |
| `CORE.Move.TypeAction.Stationary.1` | `ChoiceSelected` | existing |
| `CORE.Move.Consume.1` | `UnitMovementEnded` | existing |

### Command -- Battleshock (new)

**Precedence ordering:** Rules sharing a trigger are ordered by
priority number (lower fires first). The engine pauses when choices are
offered, so higher-priority emits wait until the choice window closes.

**Iterating pendingUnits:** The engine has no array-pop effect. Instead,
use an index counter `$.battleshock.pendingIndex` (starts at 0). The
`SetCurrent` rule reads `pendingUnits[pendingIndex]` and increments the
index. The `Skip` rule checks if `pendingIndex >= pendingUnits.length`.

| Rule ID | Trigger | Pri | Purpose |
|---|---|---|---|
| `CORE.Command.ClearBattleshock.1` | `CommandPhaseStarted` | 5 | Remove previous round's battleshocked (existing) |
| `CORE.Command.ResetPhaseUsage.1` | `CommandPhaseStarted` | 6 | Reset command_reroll_phase usage |
| `CORE.Command.Battleshock.BuildPending.1` | `CommandPhaseStarted` | 10 | Find below_half_strength units, write to pendingUnits, reset pendingIndex to 0, emit BattleshockTestBegin |
| `CORE.Command.Battleshock.Skip.1` | `BattleshockTestBegin` | 5 | If pendingIndex >= pendingUnits length, emit CommandPointsAwarded (skips remaining rules at this event) |
| `CORE.Command.Battleshock.SetCurrent.1` | `BattleshockTestBegin` | 10 | Read pendingUnits[pendingIndex], set currentUnitId, increment pendingIndex |
| `CORE.Command.Battleshock.OfferInsaneBravery.1` | `BattleshockTestBegin` | 20 | Offer Insane Bravery (1 CP, once per battle) -- pauses engine |
| `CORE.Command.Battleshock.InsaneBraveryAction.1` | `ChoiceSelected` | 10 | Set autoPass = true |
| `CORE.Command.Battleshock.EmitRoll.1` | `BattleshockTestBegin` | 30 | Emit BattleshockTestRoll (fires after stratagem window) |
| `CORE.Command.Battleshock.Roll.1` | `BattleshockTestRoll` | 10 | Roll 2D6 to rollResult |
| `CORE.Command.Battleshock.OfferCommandReroll.1` | `BattleshockTestRoll` | 20 | Offer Command Re-roll (1 CP, pick 1 die) -- pauses engine |
| `CORE.Command.Battleshock.CommandRerollAction.1` | `ChoiceSelected` | 10 | Reroll selected die |
| `CORE.Command.Battleshock.EmitResolve.1` | `BattleshockTestRoll` | 30 | Emit BattleshockTestResolve |
| `CORE.Command.Battleshock.Resolve.1` | `BattleshockTestResolve` | 10 | computePoolSum, compare to Ld, apply battleshocked or pass |
| `CORE.Command.Battleshock.Next.1` | `BattleshockTestResolve` | 20 | If pendingIndex < pendingUnits length, emit BattleshockTestBegin; else emit CommandPointsAwarded |

### Command -- CP (existing)

| Rule ID | Trigger | Change |
|---|---|---|
| `CORE.Command.CP.Award.1` | `CommandPointsAwarded` | existing |

### Shooting/Charge/Fight (skeleton pass-throughs, unchanged)

All existing skeleton rules carried forward for 5C/5D to flesh out.

### Cleanup (existing, unchanged)

All `CORE.Cleanup.Safety.*` and `CORE.Turn.*` rules unchanged.

### Glossary additions

**Statuses:**
- `below_half_strength` -- "Unit has lost more than half its models"

**Selectors:**
- `units_below_half_strength` -- units with `below_half_strength` status

---

## 8. Test Pack: wh40k-10e-ms5b

### Purpose

Exercises command phase (battleshock + stratagems) and movement phase
end-to-end in the CLI.

### Pack structure

```text
packs/wh40k-10e-ms5b/
  manifest.yaml
  datasheets.yaml
  initial_state.json
  timeline.yaml
  glossary.yaml
  rules.json
```

### Units

| Unit ID | Owner | Datasheet | Models (total/remaining) | Below Half? |
|---|---|---|---|---|
| u1 | A | intercessor_squad | 5 / 5 | No |
| u2 | A | hellblaster_squad | 5 / 2 | Yes |
| u3 | B | ork_boyz | 10 / 10 | No |
| u4 | B | lootas | 5 / 1 | Yes |

Units u2 and u4 start with `below_half_strength` status, triggering
battleshock tests. Units u1 and u3 do not.

### Initial state

- 2 players: A, B
- 0 CP each (gained during command phase)
- `$.battleshock` scratch state initialized
- All units reference datasheets

### Timeline

Reuses the `wh40k-10e-core-turn` timeline structure (5 rounds, forEach
player, all 6 phases as subSequences).

### What to exercise in playtesting

1. Command phase: battleshock tests fire for u2 and u4
2. Insane Bravery offered before roll (blind commitment)
3. Command Re-roll offered after roll (pick 1 die)
4. CP awarded after battleshock resolves
5. Movement phase: pick unit, pick movement type
6. Fall Back not offered (no units in engagement range)
7. Statuses applied correctly (remained_stationary, advanced_move)
8. Shooting/charge phases pass through (skeleton)

---

## 9. Files Changed / Created

| File | Action |
|---|---|
| `engine/src/rules/effects.ts` | Modify: add `computePoolSum` effect |
| `engine/src/types/rules.ts` | Modify: add `ComputePoolSum` to Effect union |
| `engine/src/loader/index.ts` | Modify: read + merge `datasheets.yaml` |
| `engine/src/loader/datasheets.ts` | Create: parse + validate datasheets |
| `packs/wh40k-10e-ms5b/manifest.yaml` | Create |
| `packs/wh40k-10e-ms5b/datasheets.yaml` | Create |
| `packs/wh40k-10e-ms5b/initial_state.json` | Create |
| `packs/wh40k-10e-ms5b/timeline.yaml` | Create |
| `packs/wh40k-10e-ms5b/glossary.yaml` | Create |
| `packs/wh40k-10e-ms5b/rules.json` | Create |
