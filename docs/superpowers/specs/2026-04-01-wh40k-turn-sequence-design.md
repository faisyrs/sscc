# WH40K 10th Edition Single Player Turn Sequence -- Design Spec

**Date:** 2026-04-01
**Scope:** Skeleton turn (all 6 phases, core rules only, no stratagems/faction rules)
**Approach:** Single pack, subSequences per phase, choice-driven activation loops

---

## 0. Conceptual Model

Five primitives, precisely defined:

**State** -- the set of facts that are true right now. A unit has `can_move`.
Player A has 1 CP. The activation context holds unit `u3`.

**Event** -- a discrete point in time where evaluation happens. An event
carries no effects of its own -- it is a trigger for rule evaluation. An event
with no matching rules is a valid no-op (useful as an extension point).

**Sequence** -- an ordered set of events, nestable. The timeline is a set of
nested sequences: the game contains rounds, rounds contain turns, turns contain
phases. Each phase is a sequence of events.

**Rule** -- evaluated at every event. If conditions over current state are met,
performs an atomic state change. A rule's effects may include inserting new
events into the current sequence. Rules never insert events outside their
containing sequence.

**Choice** -- a state change that pauses the engine for player input. When a
choice is offered, the engine suspends advancement. When the player selects,
a `ChoiceSelected` event is inserted into the current sequence and evaluated.

### Cross-phase communication

Events are scoped to their containing sequence -- a rule-emitted event during
movement cannot leak into the shooting phase. Cross-phase communication is
always through state: a rule sets a state flag during one phase, and another
rule reads it during a later phase.

Example: `advanced_move` status is set during movement. A rule on
`ShootingPhaseStarted` reads it to add prohibitions. The status carries the
information; the events stay in their own sequences.

### Engine advancement

The engine does not advance to the next event in the sequence while:
- Unresolved choices exist for the current event
- Rule-emitted events are pending evaluation

When all choices have been selected/expired/cancelled, all emitted events have
been evaluated, and no new events or choices are produced, the engine advances
to the next event in the sequence.

---

## 1. Deliverables

Two categories of output:

### Design spec (this document)
Describes the schema, conventions, and rationale for how a WH40K 10th edition
single-player-turn pack is structured.

### Example data files
Actual pack files that conform to this spec:

```text
packs/wh40k-10e-core-turn/
  manifest.yaml
  timeline.yaml
  glossary.yaml
  rules.json
  initial_state.json
```

---

## 2. Timeline Structure

### 2.1 Outer game loop

The outermost timeline handles game start/end and the round/turn structure:

```text
StartOfGame
repeat(count: $.totalRounds, index: round)
  RoundStarted(round)
  forEach(players, bind: player)
    TurnStarted(player)
    subSequence: commandPhase(player)
    subSequence: movementPhase(player)
    subSequence: shootingPhase(player)
    subSequence: chargePhase(player)
    subSequence: fightPhase(player)
    subSequence: endPhase(player)
    TurnEnded(player)
  RoundEnded(round)
EndOfGame
```

### 2.2 Phase subSequences

Each phase is a named subSequence containing only its start and end events:

```text
commandPhase(player):
  CommandPhaseStarted(player)
  CommandPhaseEnded(player)

movementPhase(player):
  MovementPhaseStarted(player)
  MovementPhaseEnded(player)

shootingPhase(player):
  ShootingPhaseStarted(player)
  ShootingPhaseEnded(player)

chargePhase(player):
  ChargePhaseStarted(player)
  ChargePhaseEnded(player)

fightPhase(player):
  FightPhaseStarted(player)
  FightPhaseEnded(player)

endPhase(player):
  EndPhaseStarted(player)
  EndPhaseEnded(player)
```

All activation sequencing within a phase is driven by rules and choices, not by
timeline nodes. The timeline defines phase boundaries; rules define the
activation flow within phases.

---

## 3. Choice-Driven Activation Pattern

All phases with unit activations (Movement, Shooting, Charge, Fight) use the
same pattern. No `forEach` over units -- the loop is emergent from choices.

### 3.1 The pattern

```text
{Phase}Started(player)
  -> rule: any units with can_{action}? offer "pick a unit" choice
  -> ChoiceSelected: set $.activation.unitId, emit Unit{Action}Started
  -> Unit{Action}Started: offer phase-specific mutex choice
  -> ChoiceSelected: set $.activation.type, apply statuses, emit Unit{Action}Ended
  -> Unit{Action}Ended: remove can_{action} from unit, check remaining
      -> units remain with can_{action}? offer "pick a unit" again
      -> none remain? no choices added, engine advances to {Phase}Ended
```

### 3.2 Activation context (convention, not engine feature)

A single reusable state object, overwritten each activation:

```json
{
  "activation": {
    "unitId": null,
    "type": null
  }
}
```

- `unitId` -- set by the "pick a unit" choice at the start of each activation
- `type` -- set by the phase-specific mutex choice (move type, charge target, etc.)
- Read by all downstream rules via `$.activation.unitId` and `$.activation.type`
- Overwritten at next activation; cleared at phase end

This is purely a pack convention -- rules writing to and reading from agreed-upon
state paths. No special engine support is required. Other packs could use a
different context structure.

### 3.3 Unit selection choice

On `{Phase}Started` and again on each `Unit{Action}Ended` (when eligible units
remain), rules offer one `addChoice` per eligible unit. Each choice is a
separate `addChoice` effect with a unique ID -- they are individual choices, not
one choice with multiple options. The player selects exactly one; all others
expire when the selection resolves.

The choice ID convention: `select_unit_{unitId}`

When selected, the action rule:
1. Sets `$.activation.unitId`
2. Emits `Unit{Action}Started`

### 3.4 Mutex option choice

On `Unit{Action}Started`, rules offer mutually exclusive choices for the
phase-specific decision. Each choice has conditions gating availability.

When selected, the action rule:
1. Sets `$.activation.type`
2. Applies any resulting statuses (e.g., `advanced_move`)
3. Emits `Unit{Action}Ended`

### 3.5 Rule-emitted events

The following events are emitted by rules (via the `emit` effect), not by the
timeline. They are valid trigger targets for other rules. The engine validates
them at load time by collecting all event IDs from both the timeline and rule
`emit` effects.

| Event | Emitted by | Purpose |
|---|---|---|
| `UnitMovementStarted` | select-unit action rule | Begin movement activation |
| `UnitMovementEnded` | move-type action rule | End movement activation |
| `UnitShootingStarted` | select-unit action rule | Begin shooting activation |
| `UnitShootingEnded` | shooting action rule | End shooting activation |
| `UnitChargeStarted` | select-unit action rule | Begin charge activation |
| `UnitChargeEnded` | charge action rule | End charge activation |
| `UnitFightStarted` | select-unit action rule | Begin fight activation |
| `UnitFightEnded` | fight action rule | End fight activation |
| `BattleshockTestStarted` | battleshock loop rule | Begin a battleshock test |
| `BattleshockTestEnded` | battleshock resolution rule | End a battleshock test |
| `CommandPointsAwarded` | CP rule | CP gain event |
| `ChargeTargetDeclared` | charge action rule | Charge target declared |
| `ChargeRollMade` | charge roll rule | Charge distance rolled |
| `ChargeMoveCompleted` | charge resolution rule | Charge move resolved |

---

## 4. Status-Based Eligibility

### 4.1 Grant/consume pattern

Each phase follows:

1. **Grant** -- on `{Phase}Started`, a rule applies `can_{action}` status to all
   qualifying active-player units
2. **Consume** -- on `Unit{Action}Ended`, a rule removes `can_{action}` from the
   activated unit (`$.activation.unitId`)
3. **Re-offer** -- a rule on `Unit{Action}Ended` checks if any units still have
   `can_{action}` and, if so, offers the "pick a unit" choice again
4. **Safety cleanup** -- on `TurnEnded`, if any `can_{action}` statuses remain,
   log a warning and remove them

| Phase | Status | Grant event | Consume event |
|---|---|---|---|
| Movement | `can_move` | `MovementPhaseStarted` | `UnitMovementEnded` |
| Shooting | `can_shoot` | `ShootingPhaseStarted` | `UnitShootingEnded` |
| Charge | `can_charge` | `ChargePhaseStarted` | `UnitChargeEnded` |
| Fight | `can_fight` | `FightPhaseStarted` | `UnitFightEnded` |

### 4.2 Prohibitions compose with eligibility

A unit may have `can_shoot` but also a prohibition `shoot: advanced_move`. The
status says "you are in the activation pool." The prohibition says "this
specific option is blocked." Choice rules check both -- a unit with a
prohibition on all shooting options would still appear in the "pick a unit" list
but would have no valid move-type choices, or the unit-selection rule could
filter it out by checking for unblocked options.

For the skeleton, the simpler approach: don't grant `can_shoot` to units that
have a total prohibition. The prohibition rules fire before the eligibility
grant rules (lower priority), and the grant rule's conditions exclude prohibited
units.

### 4.3 Status expiry: engine-managed vs rule-consumed

Two mechanisms for removing statuses:

**Engine-managed expiry (`expiresOn`):** Statuses like `advanced_move`,
`fell_back`, `remained_stationary`, `charged`, and `battleshocked` declare
`expiresOn` when applied. The engine removes them automatically when the named
event fires. Multiple rules can set the same status via different code paths
and the expiry is consistent regardless of origin. No cleanup rule needed.

**Rule-consumed:** Statuses like `can_move`, `can_shoot`, `can_charge`,
`can_fight` are removed by rules during the activation loop (on
`Unit{Action}Ended`). These do NOT use `expiresOn` because they should be
consumed one-by-one as units activate.

### 4.4 Safety cleanup with warnings

For rule-consumed statuses only. On `TurnEnded`:

```text
when: selector for units with can_{action} is non-empty
effect:
  - appendLogNote: "WARNING: units still had can_{action} at TurnEnded"
  - removeStatus: can_{action}
```

This is a safety net. In normal flow, all `can_{action}` statuses are consumed
during activation. A warning here indicates a logic error in the rules.
Engine-managed statuses with `expiresOn` do not need this pattern.

---

## 5. Phase Details

### 5.1 Command Phase

Two automatic actions, no player choices in skeleton:

**Battleshock tests:**
- On `CommandPhaseStarted`, a rule checks for active-player units below
  half-strength
- If any exist, it emits `BattleshockTestStarted` for the first one
- On `BattleshockTestStarted`: roll 2D6, store result, compare to Leadership
- On `BattleshockTestEnded`: apply or skip `battleshocked` status based on
  result; check for more units needing tests; if so, emit
  `BattleshockTestStarted` for the next unit
- When no more units need testing, no event is emitted, and the engine advances

**Command point gain:**
- On `BattleshockTestEnded` (when no more tests remain) or on
  `CommandPhaseStarted` (when no tests are needed), a rule emits
  `CommandPointsAwarded`
- On `CommandPointsAwarded`: `award` 1 CP to active player

**Zero battleshock units:** If no units need testing, the `CommandPhaseStarted`
rule skips straight to emitting `CommandPointsAwarded`. The CP award does not
depend on battleshock occurring.

Note: the battleshock loop follows the same choice-driven chaining pattern as
unit activations, but with no player choice -- the rule automatically iterates.
A future rules pack could add choices here (e.g., Insane Bravery stratagem).

### 5.2 Movement Phase

**Activation loop:**
- `MovementPhaseStarted` -> grant `can_move` to eligible active-player units
- Offer "pick a unit" choices (one per `can_move` unit)
- On selection: set `$.activation.unitId`, emit `UnitMovementStarted`

**Move-type mutex choice on `UnitMovementStarted`:**

| Choice ID | Label | Conditions |
|---|---|---|
| `move_normal` | Normal Move | default |
| `move_advance` | Advance | default |
| `move_fall_back` | Fall Back | unit within engagement range |
| `move_stationary` | Remain Stationary | default |

**On move-type selection:**
- Set `$.activation.type` to the chosen value
- Apply statuses as appropriate:
  - `move_advance` -> `applyStatus: advanced_move` (expires `TurnEnded`)
  - `move_fall_back` -> `applyStatus: fell_back` (expires `TurnEnded`)
  - `move_stationary` -> `applyStatus: remained_stationary` (expires `TurnEnded`)
  - `move_normal` -> no status
- Emit `UnitMovementEnded`

**On `UnitMovementEnded`:**
- Remove `can_move` from activated unit
- Check remaining `can_move` units; re-offer pick-a-unit if any remain

### 5.3 Shooting Phase

**Activation loop:**
- `ShootingPhaseStarted` -> grant `can_shoot` to eligible active-player units
  (excluding units with total shoot prohibitions from movement statuses)
- Same pick-a-unit pattern

**On `UnitShootingStarted`:**
- In skeleton: no target/weapon selection choices, no attack pipeline
- Hook points exist for future packs to add target selection and invoke attack
  resolution subSequences (hit/wound/save/damage from SSCC spec Section 12)
- Emit `UnitShootingEnded`

**On `UnitShootingEnded`:**
- Remove `can_shoot`, re-offer or advance

### 5.4 Charge Phase

**Activation loop:**
- `ChargePhaseStarted` -> grant `can_charge` to eligible active-player units
  (excluding units with charge prohibitions from movement statuses)
- Same pick-a-unit pattern

**On `UnitChargeStarted`:**
- Emit `ChargeTargetDeclared` (choice hook for target declaration in future pack)
- Emit `ChargeRollMade` -- rule rolls 2D6, stores charge distance
- Emit `ChargeMoveCompleted` -- rule determines success/failure:
  - Success: `applyStatus: charged`
  - Failure: no status
- Emit `UnitChargeEnded`

**On `UnitChargeEnded`:**
- Remove `can_charge`, re-offer or advance

### 5.5 Fight Phase

**Activation loop:**
- `FightPhaseStarted` -> grant `can_fight` to eligible units (units in
  engagement range or with `charged` status)
- Same pick-a-unit pattern

**On `UnitFightStarted`:**
- In skeleton: no melee target/weapon choices, no attack pipeline
- Hook points exist for future packs to invoke melee attack resolution
  subSequences
- Emit `UnitFightEnded`

**On `UnitFightEnded`:**
- Remove `can_fight`, re-offer or advance

### 5.6 End Phase

Minimal in skeleton:
- `EndPhaseStarted` -> hook points for objective scoring, ability triggers
- `EndPhaseEnded` -> no rules in skeleton

---

## 6. Glossary Schema

### 6.1 Statuses

**Phase eligibility (temporary, removed on activation or TurnEnded safety):**
- `can_move`
- `can_shoot`
- `can_charge`
- `can_fight`

**Movement results (expire on TurnEnded):**
- `advanced_move`
- `fell_back`
- `remained_stationary`

**Charge result (expires on TurnEnded):**
- `charged`

**Battleshock (expires on next CommandPhaseStarted):**
- `battleshocked`

### 6.2 Reason keys

```yaml
shoot:
  - advanced_move
  - fell_back
charge:
  - advanced_move
  - fell_back
```

### 6.3 Selectors

| Selector ID | Kind | Filter |
|---|---|---|
| `active_player_units` | unit | owner matches `$.turnPlayer` |
| `units_can_move` | unit | `hasStatus: can_move` |
| `units_can_shoot` | unit | `hasStatus: can_shoot` |
| `units_can_charge` | unit | `hasStatus: can_charge` |
| `units_can_fight` | unit | `hasStatus: can_fight` |
| `units_advanced` | unit | `hasStatus: advanced_move` |
| `units_fell_back` | unit | `hasStatus: fell_back` |
| `units_battleshocked` | unit | `hasStatus: battleshocked` |

---

## 7. Initial State Schema

```json
{
  "totalRounds": 5,
  "round": 1,
  "turnPlayer": null,
  "players": ["A", "B"],
  "resources": {
    "A": { "cp": 0 },
    "B": { "cp": 0 }
  },
  "activation": {
    "unitId": null,
    "type": null
  },
  "units": {},
  "usage": {},
  "windows": {},
  "statuses": {}
}
```

Unit entries follow the shape from SSCC spec Part III (id, owner, keywords,
statuses, abilities, profiles, stats, eligibility). No example units in the
skeleton initial state -- army list loading is out of scope.

---

## 8. Skeleton Rules Summary

### 8.1 Eligibility grant rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Move.Grant.1` | `MovementPhaseStarted` | `applyStatus: can_move` to active player units |
| `CORE.Shoot.Grant.1` | `ShootingPhaseStarted` | `applyStatus: can_shoot` to eligible units |
| `CORE.Charge.Grant.1` | `ChargePhaseStarted` | `applyStatus: can_charge` to eligible units |
| `CORE.Fight.Grant.1` | `FightPhaseStarted` | `applyStatus: can_fight` to eligible units |

### 8.2 Unit selection choice rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Move.OfferSelect.1` | `MovementPhaseStarted` | `addChoice` per `can_move` unit |
| `CORE.Move.ReofferSelect.1` | `UnitMovementEnded` | `addChoice` per remaining `can_move` unit |
| `CORE.Move.SelectAction.1` | `ChoiceSelected` (select_unit) | set `$.activation.unitId`, emit `UnitMovementStarted` |

Same pattern repeated for Shooting, Charge, Fight.

### 8.3 Move-type mutex choice rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Move.OfferTypes.1` | `UnitMovementStarted` | `addChoice` for each move type |
| `CORE.Move.TypeAction.Normal.1` | `ChoiceSelected` (move_normal) | set type, emit `UnitMovementEnded` |
| `CORE.Move.TypeAction.Advance.1` | `ChoiceSelected` (move_advance) | set type, apply `advanced_move`, emit `UnitMovementEnded` |
| `CORE.Move.TypeAction.FallBack.1` | `ChoiceSelected` (move_fall_back) | set type, apply `fell_back`, emit `UnitMovementEnded` |
| `CORE.Move.TypeAction.Stationary.1` | `ChoiceSelected` (move_stationary) | set type, apply `remained_stationary`, emit `UnitMovementEnded` |

### 8.4 Prohibition rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Shoot.Prohibit.Advanced.1` | `ShootingPhaseStarted` | `addProhibition: shoot, advanced_move` |
| `CORE.Shoot.Prohibit.FellBack.1` | `ShootingPhaseStarted` | `addProhibition: shoot, fell_back` |
| `CORE.Charge.Prohibit.Advanced.1` | `ChargePhaseStarted` | `addProhibition: charge, advanced_move` |
| `CORE.Charge.Prohibit.FellBack.1` | `ChargePhaseStarted` | `addProhibition: charge, fell_back` |

### 8.5 Command phase rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Command.Battleshock.Check.1` | `CommandPhaseStarted` | identify units needing tests, emit `BattleshockTestStarted` for first |
| `CORE.Command.Battleshock.Roll.1` | `BattleshockTestStarted` | roll 2D6, store result |
| `CORE.Command.Battleshock.Resolve.1` | `BattleshockTestEnded` | apply `battleshocked` if failed; emit next test or `CommandPointsAwarded` |
| `CORE.Command.CP.Award.1` | `CommandPointsAwarded` | `award: cp, 1` to active player |

### 8.6 Charge phase rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Charge.Roll.1` | `UnitChargeStarted` | emit `ChargeTargetDeclared` |
| `CORE.Charge.Distance.1` | `ChargeTargetDeclared` | roll 2D6, store, emit `ChargeRollMade` |
| `CORE.Charge.Resolve.1` | `ChargeRollMade` | determine success, apply `charged` if success, emit `ChargeMoveCompleted` |
| `CORE.Charge.Complete.1` | `ChargeMoveCompleted` | emit `UnitChargeEnded` |

### 8.7 Cleanup rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Cleanup.Turn.1` | `TurnEnded` | remove `advanced_move`, `fell_back`, `remained_stationary`, `charged` |
| `CORE.Cleanup.Safety.Move.1` | `TurnEnded` | warn + remove remaining `can_move` |
| `CORE.Cleanup.Safety.Shoot.1` | `TurnEnded` | warn + remove remaining `can_shoot` |
| `CORE.Cleanup.Safety.Charge.1` | `TurnEnded` | warn + remove remaining `can_charge` |
| `CORE.Cleanup.Safety.Fight.1` | `TurnEnded` | warn + remove remaining `can_fight` |
| `CORE.Cleanup.Battleshock.1` | `CommandPhaseStarted` | remove `battleshocked` from previous round |

### 8.8 Eligibility consume rules

| Rule ID | Trigger | Effect |
|---|---|---|
| `CORE.Move.Consume.1` | `UnitMovementEnded` | `removeStatus: can_move` from `$.activation.unitId` |
| `CORE.Shoot.Consume.1` | `UnitShootingEnded` | `removeStatus: can_shoot` from `$.activation.unitId` |
| `CORE.Charge.Consume.1` | `UnitChargeEnded` | `removeStatus: can_charge` from `$.activation.unitId` |
| `CORE.Fight.Consume.1` | `UnitFightEnded` | `removeStatus: can_fight` from `$.activation.unitId` |

---

## 9. What the Skeleton Does NOT Include

- Attack resolution pipelines (hit/wound/save/damage subSequences)
- Reaction windows (Overwatch, Heroic Intervention)
- Stratagems
- Faction rules / patches
- Army list loading / unit data population
- Objective scoring
- Morale beyond battleshock

These are future scope (B and C level completeness).

