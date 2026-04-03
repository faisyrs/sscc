# WH40K 10e Core Turn Pack -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the five SSCC data pack files (`manifest.yaml`, `timeline.yaml`, `glossary.yaml`, `initial_state.json`, `rules.json`) that define a skeleton single-player-turn sequence for Warhammer 40,000 10th Edition.

**Architecture:** Single pack under `packs/wh40k-10e-core-turn/`. The timeline defines only phase boundaries (start/end events). All unit activation sequencing is driven by rules via the choice-driven activation pattern. Statuses track eligibility (`can_move`, etc.) and movement results (`advanced_move`, etc.) with engine-managed `expiresOn` where appropriate.

**Tech Stack:** YAML (timeline, glossary, manifest), JSON (rules, initial_state). No code -- data files only.

**Spec:** `docs/superpowers/specs/2026-04-01-wh40k-turn-sequence-design.md`

---

## File Map

All files live under `packs/wh40k-10e-core-turn/`:

| File | Responsibility |
|---|---|
| `manifest.yaml` | Pack metadata, engine version, no dependencies |
| `timeline.yaml` | Outer game loop + 6 phase subSequences (start/end events only) |
| `glossary.yaml` | Statuses, reason keys, selectors |
| `initial_state.json` | State schema with activation context, resources, empty units map |
| `rules.json` | All skeleton rules: eligibility, choices, prohibitions, command phase, charge, cleanup |

---

### Task 0: Write SSCC Conceptual Model spec

**Files:**
- Create: `docs/SSCC_CONCEPTUAL_MODEL.md`

Write the canonical specification for the SSCC conceptual model -- the five primitives and their relationships. This is a living document, updated as implementation reveals new constraints or refinements. It is distinct from the engine specification (which covers implementation details like node types and effect verbs) and from the pack design spec (which covers a specific game's data files).

- [ ] **Step 1: Write SSCC_CONCEPTUAL_MODEL.md**

```markdown
# SSCC Conceptual Model

*Living specification -- updated as discovered during implementation.*

---

## Primitives

The SSCC engine is built on five primitives:

### State

The set of facts that are true right now.

State is the complete, structured snapshot of the game at a point in time.
Examples: a unit has `can_move`. Player A has 1 CP. The activation context holds
unit `u3`.

State changes only through atomic effects produced by rules. There is no other
mechanism for state mutation.

### Event

A discrete point in time where evaluation happens.

An event carries no effects of its own -- it is a named trigger for rule
evaluation. An event with no matching rules is a valid no-op. This is useful as
an extension point: the skeleton emits events that no current rules match,
allowing future packs to hook behavior onto them without modifying the timeline.

Events are scoped to their containing sequence. A rule-emitted event during
movement cannot appear in the shooting phase. Cross-phase communication is
always through state.

### Sequence

An ordered set of events, nestable.

The timeline is a set of nested sequences: the game contains rounds, rounds
contain turns, turns contain phases. Each phase is a sequence of events.

Sequences are finite and enumerable at load time. The set of event IDs that can
appear in any sequence is known before the game starts -- both timeline-declared
events and rule-emitted events (collected from `emit` effects in the rule set).

### Rule

A conditional, atomic state change.

Rules are evaluated at every event. If a rule's conditions over current state
are met, it performs an atomic state change. A rule's effects may include
inserting new events into the current sequence.

Rules never insert events outside their containing sequence. A rule firing
during the movement phase sequence can emit events within that sequence, but
cannot emit events into the shooting phase sequence.

Key properties:
- **Conditional** -- a rule has a `when` clause: predicates over current state
- **Atomic** -- all effects of a rule apply as one indivisible state change
- **Ordered** -- rules are evaluated in priority order (ascending: low fires
  first, high fires last)
- **Composable** -- multiple rules can fire on the same event; conflict
  resolution determines how their effects combine

### Choice

A state change that pauses the engine for player input.

When a rule's effects include `addChoice`, the engine suspends timeline
advancement. The engine does not advance to the next event while unresolved
choices exist.

When a player selects a choice, the engine inserts a `ChoiceSelected` event
into the current sequence. Rules triggered by `ChoiceSelected` perform the
action associated with that choice.

This is the mechanism that drives activation loops: a rule offers a choice, the
player selects, the selection triggers rules that may offer another choice, and
so on until no new choices are produced -- at which point the engine advances.

---

## Engine Advancement

The engine advances to the next event in the current sequence when all of the
following are true:

1. All rules for the current event have been evaluated
2. All rule-emitted events have been evaluated
3. All choices have been selected, expired, or cancelled
4. No new events or choices were produced by the above

This is the only advancement mechanism. There is no explicit "next" command or
timer.

---

## Cross-Phase Communication

Events are scoped to their containing sequence. Cross-phase communication is
always through state:

1. A rule sets a state flag during one phase
2. Another rule reads that flag during a later phase

Example: `advanced_move` status is applied during the movement phase. During the
shooting phase, a rule on `ShootingPhaseStarted` reads this status and adds a
prohibition preventing the unit from shooting.

The status carries the information; the events stay in their own sequences.

---

## Status Expiry

Two mechanisms for removing statuses:

### Engine-managed expiry (`expiresOn`)

A status may declare `expiresOn: EventId` when applied. The engine removes it
automatically when that event fires. Multiple rules can set the same status via
different code paths; the expiry is consistent regardless of origin.

### Rule-consumed

A status with no `expiresOn` must be explicitly removed by a rule effect. This
is used for statuses that should be consumed one-by-one during gameplay (e.g.,
`can_move` removed as each unit activates).

---

## Changelog

| Date | Change |
|---|---|
| 2026-04-02 | Initial version, derived from design spec Section 0 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/SSCC_CONCEPTUAL_MODEL.md
git commit -m "feat: add SSCC Conceptual Model living spec"
```

---

### Task 1: Create manifest.yaml

**Files:**
- Create: `packs/wh40k-10e-core-turn/manifest.yaml`

- [ ] **Step 1: Create the pack directory**

```bash
mkdir -p packs/wh40k-10e-core-turn
```

- [ ] **Step 2: Write manifest.yaml**

```yaml
id: wh40k-10e-core-turn
name: "Warhammer 40,000 10th Edition - Core Turn Sequence"
version: 0.1.0
engine_version: "^0.2.0"
dependencies: []
```

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/manifest.yaml
git commit -m "feat: add wh40k-10e-core-turn manifest"
```

---

### Task 2: Create timeline.yaml

**Files:**
- Create: `packs/wh40k-10e-core-turn/timeline.yaml`

The timeline defines the outer game loop (StartOfGame, rounds, player turns, EndOfGame) and six phase subSequences. Each phase contains only its start and end events -- all activation logic lives in rules.

- [ ] **Step 1: Write timeline.yaml**

```yaml
timeline:
  - event: StartOfGame

  - repeat:
      count: { path: "$.totalRounds" }
      indexParam: round
      body:
        - event: RoundStarted
          params: [round]

        - forEach:
            over: { kind: "player", from: "$.players" }
            bindParam: player
            body:
              - event: TurnStarted
                params: [player]

              - subSequence: commandPhase
                params: [player]

              - subSequence: movementPhase
                params: [player]

              - subSequence: shootingPhase
                params: [player]

              - subSequence: chargePhase
                params: [player]

              - subSequence: fightPhase
                params: [player]

              - subSequence: endPhase
                params: [player]

              - event: TurnEnded
                params: [player]

        - event: RoundEnded
          params: [round]

  - event: EndOfGame

subSequences:
  commandPhase:
    params: [player]
    body:
      - event: CommandPhaseStarted
        params: [player]
      - event: CommandPhaseEnded
        params: [player]

  movementPhase:
    params: [player]
    body:
      - event: MovementPhaseStarted
        params: [player]
      - event: MovementPhaseEnded
        params: [player]

  shootingPhase:
    params: [player]
    body:
      - event: ShootingPhaseStarted
        params: [player]
      - event: ShootingPhaseEnded
        params: [player]

  chargePhase:
    params: [player]
    body:
      - event: ChargePhaseStarted
        params: [player]
      - event: ChargePhaseEnded
        params: [player]

  fightPhase:
    params: [player]
    body:
      - event: FightPhaseStarted
        params: [player]
      - event: FightPhaseEnded
        params: [player]

  endPhase:
    params: [player]
    body:
      - event: EndPhaseStarted
        params: [player]
      - event: EndPhaseEnded
        params: [player]
```

- [ ] **Step 2: Verify all event IDs are unique and consistently named**

Check: every event name follows `{Thing}{Started|Ended}` or `{Thing}` pattern. No duplicates.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/timeline.yaml
git commit -m "feat: add timeline with phase subSequences"
```

---

### Task 3: Create glossary.yaml

**Files:**
- Create: `packs/wh40k-10e-core-turn/glossary.yaml`

Defines all statuses, reason keys, and selectors referenced by the rules.

- [ ] **Step 1: Write glossary.yaml**

```yaml
keywords:
  - INFANTRY
  - VEHICLE
  - CHARACTER
  - MONSTER

statuses:
  # Phase eligibility -- rule-consumed during activation loops
  can_move:
    description: "Unit is eligible to activate in the Movement phase"
  can_shoot:
    description: "Unit is eligible to activate in the Shooting phase"
  can_charge:
    description: "Unit is eligible to activate in the Charge phase"
  can_fight:
    description: "Unit is eligible to activate in the Fight phase"

  # Movement results -- engine-managed expiry
  advanced_move:
    description: "Unit advanced this turn"
  fell_back:
    description: "Unit fell back this turn"
  remained_stationary:
    description: "Unit remained stationary this turn"

  # Charge result -- engine-managed expiry
  charged:
    description: "Unit successfully charged this turn"

  # Battleshock -- engine-managed expiry
  battleshocked:
    description: "Unit failed its Battleshock test"

reason_keys:
  shoot:
    - advanced_move
    - fell_back
  charge:
    - advanced_move
    - fell_back

selectors:
  active_player_units:
    kind: unit
    where:
      pathEquals:
        path: "$.turnPlayer"
        valueFromEventParam: player

  units_can_move:
    kind: unit
    where:
      hasStatus: can_move

  units_can_shoot:
    kind: unit
    where:
      hasStatus: can_shoot

  units_can_charge:
    kind: unit
    where:
      hasStatus: can_charge

  units_can_fight:
    kind: unit
    where:
      hasStatus: can_fight

  units_advanced:
    kind: unit
    where:
      hasStatus: advanced_move

  units_fell_back:
    kind: unit
    where:
      hasStatus: fell_back

  units_battleshocked:
    kind: unit
    where:
      hasStatus: battleshocked
```

- [ ] **Step 2: Verify every status and reason key referenced in the spec is present**

Cross-check against spec Section 6. Statuses: `can_move`, `can_shoot`, `can_charge`, `can_fight`, `advanced_move`, `fell_back`, `remained_stationary`, `charged`, `battleshocked`. Reason keys: `shoot: [advanced_move, fell_back]`, `charge: [advanced_move, fell_back]`. Selectors: 8 selectors per spec Section 6.3.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/glossary.yaml
git commit -m "feat: add glossary with statuses, reason keys, and selectors"
```

---

### Task 4: Create initial_state.json

**Files:**
- Create: `packs/wh40k-10e-core-turn/initial_state.json`

Defines the state schema contract. All `path` references in rules must resolve against this structure. Includes two example units for testing.

- [ ] **Step 1: Write initial_state.json**

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
  "units": {
    "u1": {
      "id": "u1",
      "owner": "A",
      "name": "Intercessor Squad",
      "keywords": ["INFANTRY"],
      "statuses": [],
      "abilities": [],
      "profiles": {
        "ranged": {
          "id": "wp_bolt_rifle",
          "name": "Bolt Rifle",
          "A": 2,
          "BS": 3,
          "S": 4,
          "AP": -1,
          "D": 1,
          "keywords": ["RAPID FIRE 1"]
        },
        "melee": {
          "id": "wp_close_combat",
          "name": "Close Combat Weapon",
          "A": 3,
          "WS": 3,
          "S": 4,
          "AP": 0,
          "D": 1,
          "keywords": []
        }
      },
      "stats": {
        "M": 6,
        "T": 4,
        "Sv": 3,
        "W": 2,
        "Ld": 6,
        "OC": 2
      },
      "models": {
        "total": 5,
        "remaining": 5
      },
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    },
    "u2": {
      "id": "u2",
      "owner": "B",
      "name": "Ork Boyz",
      "keywords": ["INFANTRY"],
      "statuses": [],
      "abilities": [],
      "profiles": {
        "ranged": {
          "id": "wp_slugga",
          "name": "Slugga",
          "A": 1,
          "BS": 5,
          "S": 4,
          "AP": 0,
          "D": 1,
          "keywords": ["PISTOL"]
        },
        "melee": {
          "id": "wp_choppa",
          "name": "Choppa",
          "A": 3,
          "WS": 3,
          "S": 4,
          "AP": -1,
          "D": 1,
          "keywords": []
        }
      },
      "stats": {
        "M": 6,
        "T": 5,
        "Sv": 5,
        "W": 1,
        "Ld": 7,
        "OC": 2
      },
      "models": {
        "total": 10,
        "remaining": 10
      },
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    }
  },
  "battleshock": {
    "pendingUnits": [],
    "currentUnitId": null,
    "rollResult": null
  },
  "charge": {
    "targetUnitId": null,
    "rollResult": null,
    "distance": null
  },
  "usage": {},
  "statuses": {}
}
```

- [ ] **Step 2: Verify all state paths referenced in the spec resolve**

Check that these paths exist:
- `$.totalRounds` -- yes (number)
- `$.players` -- yes (array)
- `$.turnPlayer` -- yes (string, nullable)
- `$.resources.A.cp` -- yes (number)
- `$.activation.unitId` -- yes (nullable)
- `$.activation.type` -- yes (nullable)
- `$.units` -- yes (object)
- `$.battleshock.pendingUnits` -- yes (array)
- `$.charge.rollResult` -- yes (nullable)

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/initial_state.json
git commit -m "feat: add initial state schema with example units"
```

---

### Task 5: Create rules.json -- Command Phase rules

**Files:**
- Create: `packs/wh40k-10e-core-turn/rules.json`

Start the rules file with the command phase rules: battleshock check, battleshock roll, battleshock resolve, CP award, and battleshock cleanup.

- [ ] **Step 1: Write rules.json with command phase rules**

```json
[
  {
    "id": "CORE.Command.Battleshock.Check.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "appendLogNote": { "message": "Checking for battleshock-eligible units" }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Identify units below half-strength and begin battleshock tests. In skeleton, emits CommandPointsAwarded directly." }
  },
  {
    "id": "CORE.Command.Battleshock.EmitCP.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "emit": { "eventId": "CommandPointsAwarded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 50, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "In skeleton, no battleshock iteration -- emit CP event directly. A future pack replaces this with battleshock loop logic." }
  },
  {
    "id": "CORE.Command.CP.Award.1",
    "scope": "player",
    "trigger": { "event": "CommandPointsAwarded" },
    "when": { "all": [] },
    "effect": [
      {
        "award": {
          "target": { "eventParam": "player" },
          "resource": "cp",
          "amount": 1
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 8, "note": "Active player gains 1 CP at start of Command phase" }
  },
  {
    "id": "CORE.Cleanup.Battleshock.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_battleshocked" } }
      ]
    },
    "effect": [
      {
        "removeStatus": {
          "target": { "selector": "units_battleshocked" },
          "key": "battleshocked"
        }
      }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Clear battleshocked from previous round at start of new Command phase" }
  }
]
```

- [ ] **Step 2: Validate rule structure**

Check each rule has: `id`, `scope`, `trigger`, `when`, `effect`, `precedence`, `provenance`. Check all event IDs match timeline or are in the rule-emitted events table.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/rules.json
git commit -m "feat: add command phase rules (CP award, battleshock cleanup)"
```

---

### Task 6: Add Movement Phase rules to rules.json

**Files:**
- Modify: `packs/wh40k-10e-core-turn/rules.json`

Add eligibility grant, unit selection choices, move-type mutex choices, status application, and eligibility consumption for the movement phase.

- [ ] **Step 1: Add movement phase rules**

Append the following rules to the JSON array in `rules.json` (before the closing `]`):

```json
  {
    "id": "CORE.Move.Grant.1",
    "scope": "global",
    "trigger": { "event": "MovementPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "applyStatus": {
          "target": { "selector": "active_player_units" },
          "key": "can_move"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Grant can_move to all active player units at start of Movement phase" }
  },
  {
    "id": "CORE.Move.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "MovementPhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_move" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_move",
          "label": "Select a unit to move",
          "actionRef": "CORE.Move.SelectAction.1",
          "selectionFrom": { "selector": "units_can_move" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection choice at start of movement phase" }
  },
  {
    "id": "CORE.Move.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_move" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_move",
          "label": "Select a unit to move",
          "actionRef": "CORE.Move.SelectAction.1",
          "selectionFrom": { "selector": "units_can_move" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer unit selection after each activation if eligible units remain" }
  },
  {
    "id": "CORE.Move.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_move" } }
      ]
    },
    "effect": [
      {
        "setValue": {
          "path": "$.activation.unitId",
          "valueFromEventParam": "selectedUnitId"
        }
      },
      {
        "emit": { "eventId": "UnitMovementStarted", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and emit UnitMovementStarted when a unit is selected" }
  },
  {
    "id": "CORE.Move.OfferTypes.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "addChoice": {
          "id": "move_normal",
          "label": "Normal Move",
          "actionRef": "CORE.Move.TypeAction.Normal.1"
        }
      },
      {
        "addChoice": {
          "id": "move_advance",
          "label": "Advance",
          "actionRef": "CORE.Move.TypeAction.Advance.1"
        }
      },
      {
        "addChoice": {
          "id": "move_fall_back",
          "label": "Fall Back",
          "actionRef": "CORE.Move.TypeAction.FallBack.1"
        }
      },
      {
        "addChoice": {
          "id": "move_stationary",
          "label": "Remain Stationary",
          "actionRef": "CORE.Move.TypeAction.Stationary.1"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer movement type choices. Fall Back conditions would be gated in a full implementation." }
  },
  {
    "id": "CORE.Move.TypeAction.Normal.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "move_normal" } }
      ]
    },
    "effect": [
      {
        "setValue": { "path": "$.activation.type", "value": "normal_move" }
      },
      {
        "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Normal move -- no status applied" }
  },
  {
    "id": "CORE.Move.TypeAction.Advance.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "move_advance" } }
      ]
    },
    "effect": [
      {
        "setValue": { "path": "$.activation.type", "value": "advance" }
      },
      {
        "applyStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "advanced_move",
          "expiresOn": "TurnEnded"
        }
      },
      {
        "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Advance -- apply advanced_move status, expires at TurnEnded" }
  },
  {
    "id": "CORE.Move.TypeAction.FallBack.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "move_fall_back" } }
      ]
    },
    "effect": [
      {
        "setValue": { "path": "$.activation.type", "value": "fall_back" }
      },
      {
        "applyStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "fell_back",
          "expiresOn": "TurnEnded"
        }
      },
      {
        "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Fall Back -- apply fell_back status, expires at TurnEnded" }
  },
  {
    "id": "CORE.Move.TypeAction.Stationary.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "move_stationary" } }
      ]
    },
    "effect": [
      {
        "setValue": { "path": "$.activation.type", "value": "remain_stationary" }
      },
      {
        "applyStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "remained_stationary",
          "expiresOn": "TurnEnded"
        }
      },
      {
        "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Remain Stationary -- apply remained_stationary status, expires at TurnEnded" }
  },
  {
    "id": "CORE.Move.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementEnded" },
    "when": { "all": [] },
    "effect": [
      {
        "removeStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "can_move"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_move from activated unit after movement completes" }
  }
```

- [ ] **Step 2: Verify all rule IDs are unique and all `actionRef` values point to valid rule IDs**

Cross-check: `CORE.Move.SelectAction.1` is referenced by `select_unit_to_move` choices. `CORE.Move.TypeAction.Normal.1`, `.Advance.1`, `.FallBack.1`, `.Stationary.1` are referenced by their respective `addChoice` effects.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/rules.json
git commit -m "feat: add movement phase rules (grant, select, move types, consume)"
```

---

### Task 7: Add Shooting Phase rules to rules.json

**Files:**
- Modify: `packs/wh40k-10e-core-turn/rules.json`

Shooting uses the same activation pattern as movement. In the skeleton, the shooting activation is a pass-through (no attack pipeline). Prohibition rules prevent units that advanced or fell back from shooting.

- [ ] **Step 1: Add prohibition and eligibility rules**

Append to the rules array:

```json
  {
    "id": "CORE.Shoot.Prohibit.Advanced.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_advanced" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "units_advanced" },
          "action": "shoot",
          "reason": "advanced_move"
        }
      }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that advanced cannot shoot" }
  },
  {
    "id": "CORE.Shoot.Prohibit.FellBack.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_fell_back" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "units_fell_back" },
          "action": "shoot",
          "reason": "fell_back"
        }
      }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that fell back cannot shoot" }
  },
  {
    "id": "CORE.Shoot.Grant.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "applyStatus": {
          "target": { "selector": "active_player_units" },
          "key": "can_shoot"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Grant can_shoot to active player units. Prohibition rules at priority 5 fire first, so prohibited units are excluded by the engine." }
  },
  {
    "id": "CORE.Shoot.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_shoot" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_shoot",
          "label": "Select a unit to shoot with",
          "actionRef": "CORE.Shoot.SelectAction.1",
          "selectionFrom": { "selector": "units_can_shoot" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection for shooting" }
  },
  {
    "id": "CORE.Shoot.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitShootingEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_shoot" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_shoot",
          "label": "Select a unit to shoot with",
          "actionRef": "CORE.Shoot.SelectAction.1",
          "selectionFrom": { "selector": "units_can_shoot" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer unit selection after each shooting activation" }
  },
  {
    "id": "CORE.Shoot.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_shoot" } }
      ]
    },
    "effect": [
      {
        "setValue": {
          "path": "$.activation.unitId",
          "valueFromEventParam": "selectedUnitId"
        }
      },
      {
        "setValue": { "path": "$.activation.type", "value": "shoot" }
      },
      {
        "emit": { "eventId": "UnitShootingStarted", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and begin shooting activation" }
  },
  {
    "id": "CORE.Shoot.PassThrough.1",
    "scope": "global",
    "trigger": { "event": "UnitShootingStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "appendLogNote": { "message": "Shooting activation -- attack pipeline not implemented in skeleton" }
      },
      {
        "emit": { "eventId": "UnitShootingEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton pass-through. Future packs add target selection and attack resolution here." }
  },
  {
    "id": "CORE.Shoot.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitShootingEnded" },
    "when": { "all": [] },
    "effect": [
      {
        "removeStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "can_shoot"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_shoot from activated unit" }
  }
```

- [ ] **Step 2: Verify prohibition priority (5) fires before grant priority (10)**

The spec says "prohibition rules fire before the eligibility grant rules (lower priority)." Priority 5 < 10, and the SSCC spec says low fires first. Correct.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/rules.json
git commit -m "feat: add shooting phase rules (prohibitions, grant, select, pass-through)"
```

---

### Task 8: Add Charge Phase rules to rules.json

**Files:**
- Modify: `packs/wh40k-10e-core-turn/rules.json`

Charge uses the same activation pattern plus a charge roll chain: `UnitChargeStarted` -> `ChargeTargetDeclared` -> `ChargeRollMade` -> `ChargeMoveCompleted` -> `UnitChargeEnded`.

- [ ] **Step 1: Add charge prohibition, eligibility, and activation rules**

Append to the rules array:

```json
  {
    "id": "CORE.Charge.Prohibit.Advanced.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_advanced" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "units_advanced" },
          "action": "charge",
          "reason": "advanced_move"
        }
      }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that advanced cannot charge" }
  },
  {
    "id": "CORE.Charge.Prohibit.FellBack.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_fell_back" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "units_fell_back" },
          "action": "charge",
          "reason": "fell_back"
        }
      }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that fell back cannot charge" }
  },
  {
    "id": "CORE.Charge.Grant.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "applyStatus": {
          "target": { "selector": "active_player_units" },
          "key": "can_charge"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Grant can_charge to active player units" }
  },
  {
    "id": "CORE.Charge.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_charge" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_charge",
          "label": "Select a unit to charge with",
          "actionRef": "CORE.Charge.SelectAction.1",
          "selectionFrom": { "selector": "units_can_charge" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection for charging" }
  },
  {
    "id": "CORE.Charge.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitChargeEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_charge" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_charge",
          "label": "Select a unit to charge with",
          "actionRef": "CORE.Charge.SelectAction.1",
          "selectionFrom": { "selector": "units_can_charge" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer charge unit selection after each activation" }
  },
  {
    "id": "CORE.Charge.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_charge" } }
      ]
    },
    "effect": [
      {
        "setValue": {
          "path": "$.activation.unitId",
          "valueFromEventParam": "selectedUnitId"
        }
      },
      {
        "setValue": { "path": "$.activation.type", "value": "charge" }
      },
      {
        "emit": { "eventId": "UnitChargeStarted", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and begin charge activation" }
  },
  {
    "id": "CORE.Charge.EmitTargetDeclared.1",
    "scope": "global",
    "trigger": { "event": "UnitChargeStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "emit": { "eventId": "ChargeTargetDeclared", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton: emit ChargeTargetDeclared. Future packs add target selection choice here." }
  },
  {
    "id": "CORE.Charge.Distance.1",
    "scope": "global",
    "trigger": { "event": "ChargeTargetDeclared" },
    "when": { "all": [] },
    "effect": [
      {
        "roll": {
          "count": 2,
          "sides": 6,
          "storePath": "$.charge.rollResult"
        }
      },
      {
        "emit": { "eventId": "ChargeRollMade", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 19, "note": "Roll 2D6 for charge distance" }
  },
  {
    "id": "CORE.Charge.Resolve.1",
    "scope": "global",
    "trigger": { "event": "ChargeRollMade" },
    "when": { "all": [] },
    "effect": [
      {
        "appendLogNote": { "message": "Charge resolution -- distance check not implemented in skeleton, assuming success" }
      },
      {
        "applyStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "charged",
          "expiresOn": "TurnEnded"
        }
      },
      {
        "emit": { "eventId": "ChargeMoveCompleted", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton assumes charge success. Full implementation compares roll to distance." }
  },
  {
    "id": "CORE.Charge.Complete.1",
    "scope": "global",
    "trigger": { "event": "ChargeMoveCompleted" },
    "when": { "all": [] },
    "effect": [
      {
        "emit": { "eventId": "UnitChargeEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Complete charge activation" }
  },
  {
    "id": "CORE.Charge.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitChargeEnded" },
    "when": { "all": [] },
    "effect": [
      {
        "removeStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "can_charge"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_charge from activated unit" }
  }
```

- [ ] **Step 2: Verify the charge event chain is complete**

Chain: `UnitChargeStarted` -> `ChargeTargetDeclared` -> `ChargeRollMade` -> `ChargeMoveCompleted` -> `UnitChargeEnded`. Each event is emitted by exactly one rule. All event IDs match the spec Section 3.5 table.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/rules.json
git commit -m "feat: add charge phase rules (prohibitions, grant, select, roll chain)"
```

---

### Task 9: Add Fight Phase rules to rules.json

**Files:**
- Modify: `packs/wh40k-10e-core-turn/rules.json`

Fight phase follows the same activation pattern. In the skeleton, the fight activation is a pass-through (no melee attack pipeline). Eligibility is units with `charged` status (skeleton simplification -- full implementation also checks engagement range).

- [ ] **Step 1: Add fight phase rules**

Append to the rules array:

```json
  {
    "id": "CORE.Fight.Grant.1",
    "scope": "global",
    "trigger": { "event": "FightPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "appendLogNote": { "message": "Granting can_fight to eligible units. Skeleton: units with charged status only." }
      }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Placeholder log. Full implementation grants can_fight to units in engagement range or with charged status." }
  },
  {
    "id": "CORE.Fight.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "FightPhaseStarted" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_fight" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_fight",
          "label": "Select a unit to fight with",
          "actionRef": "CORE.Fight.SelectAction.1",
          "selectionFrom": { "selector": "units_can_fight" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection for fighting" }
  },
  {
    "id": "CORE.Fight.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitFightEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_fight" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "select_unit_to_fight",
          "label": "Select a unit to fight with",
          "actionRef": "CORE.Fight.SelectAction.1",
          "selectionFrom": { "selector": "units_can_fight" }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer fight unit selection after each activation" }
  },
  {
    "id": "CORE.Fight.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_fight" } }
      ]
    },
    "effect": [
      {
        "setValue": {
          "path": "$.activation.unitId",
          "valueFromEventParam": "selectedUnitId"
        }
      },
      {
        "setValue": { "path": "$.activation.type", "value": "fight" }
      },
      {
        "emit": { "eventId": "UnitFightStarted", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and begin fight activation" }
  },
  {
    "id": "CORE.Fight.PassThrough.1",
    "scope": "global",
    "trigger": { "event": "UnitFightStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "appendLogNote": { "message": "Fight activation -- melee attack pipeline not implemented in skeleton" }
      },
      {
        "emit": { "eventId": "UnitFightEnded", "params": { "player": { "eventParam": "player" } } }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton pass-through. Future packs add melee target selection and attack resolution." }
  },
  {
    "id": "CORE.Fight.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitFightEnded" },
    "when": { "all": [] },
    "effect": [
      {
        "removeStatus": {
          "target": { "path": "$.activation.unitId" },
          "key": "can_fight"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_fight from activated unit" }
  }
```

- [ ] **Step 2: Verify fight grant rule**

Note: `CORE.Fight.Grant.1` is a placeholder log only. In the skeleton, `can_fight` is not actually granted because the eligibility logic (engagement range check) is out of scope. The fight phase will be a no-op unless a future pack grants `can_fight`. This is intentional -- the event hooks exist.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/rules.json
git commit -m "feat: add fight phase rules (grant placeholder, select, pass-through)"
```

---

### Task 10: Add Cleanup and Turn Management rules to rules.json

**Files:**
- Modify: `packs/wh40k-10e-core-turn/rules.json`

Add safety cleanup rules (warn + remove leftover `can_*` statuses) and the turn player setter.

- [ ] **Step 1: Add cleanup and turn management rules**

Append to the rules array:

```json
  {
    "id": "CORE.Turn.SetPlayer.1",
    "scope": "global",
    "trigger": { "event": "TurnStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "setValue": {
          "path": "$.turnPlayer",
          "valueFromEventParam": "player"
        }
      }
    ],
    "precedence": { "priority": 1, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set turnPlayer in state so selectors can identify active player units" }
  },
  {
    "id": "CORE.Turn.ClearActivation.1",
    "scope": "global",
    "trigger": { "event": "TurnStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "setValue": { "path": "$.activation.unitId", "value": null }
      },
      {
        "setValue": { "path": "$.activation.type", "value": null }
      }
    ],
    "precedence": { "priority": 2, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Clear activation context at start of each turn" }
  },
  {
    "id": "CORE.Cleanup.Safety.Move.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_move" } }
      ]
    },
    "effect": [
      {
        "appendLogNote": { "message": "WARNING: units still had can_move at TurnEnded -- expected empty" }
      },
      {
        "removeStatus": {
          "target": { "selector": "units_can_move" },
          "key": "can_move"
        }
      }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_move" }
  },
  {
    "id": "CORE.Cleanup.Safety.Shoot.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_shoot" } }
      ]
    },
    "effect": [
      {
        "appendLogNote": { "message": "WARNING: units still had can_shoot at TurnEnded -- expected empty" }
      },
      {
        "removeStatus": {
          "target": { "selector": "units_can_shoot" },
          "key": "can_shoot"
        }
      }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_shoot" }
  },
  {
    "id": "CORE.Cleanup.Safety.Charge.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_charge" } }
      ]
    },
    "effect": [
      {
        "appendLogNote": { "message": "WARNING: units still had can_charge at TurnEnded -- expected empty" }
      },
      {
        "removeStatus": {
          "target": { "selector": "units_can_charge" },
          "key": "can_charge"
        }
      }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_charge" }
  },
  {
    "id": "CORE.Cleanup.Safety.Fight.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": {
      "all": [
        { "selector": { "id": "units_can_fight" } }
      ]
    },
    "effect": [
      {
        "appendLogNote": { "message": "WARNING: units still had can_fight at TurnEnded -- expected empty" }
      },
      {
        "removeStatus": {
          "target": { "selector": "units_can_fight" },
          "key": "can_fight"
        }
      }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_fight" }
  }
```

- [ ] **Step 2: Verify cleanup rules use high priority (100) so they fire after all other TurnEnded rules**

Priority 100 is highest in the pack. The SSCC spec says high priority fires last (ascending order). Correct.

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-core-turn/rules.json
git commit -m "feat: add turn management and safety cleanup rules"
```

---

### Task 11: Final validation pass

**Files:**
- Review: all files in `packs/wh40k-10e-core-turn/`

- [ ] **Step 1: Verify rules.json is valid JSON**

```bash
python3 -c "import json; json.load(open('packs/wh40k-10e-core-turn/rules.json')); print('Valid JSON')"
```

Expected: `Valid JSON`

- [ ] **Step 2: Verify timeline.yaml is valid YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('packs/wh40k-10e-core-turn/timeline.yaml')); print('Valid YAML')"
```

Expected: `Valid YAML`

- [ ] **Step 3: Verify glossary.yaml is valid YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('packs/wh40k-10e-core-turn/glossary.yaml')); print('Valid YAML')"
```

Expected: `Valid YAML`

- [ ] **Step 4: Cross-reference all event IDs**

Collect all event IDs from:
1. `timeline.yaml` -- timeline events and subSequence events
2. `rules.json` -- all `trigger.event` values and `emit.eventId` values

Every `trigger.event` must appear in either set 1 or set 2. Every `emit.eventId` must appear in set 2 (rule-emitted events) or set 1 (timeline events).

Timeline events: `StartOfGame`, `RoundStarted`, `TurnStarted`, `CommandPhaseStarted`, `CommandPhaseEnded`, `MovementPhaseStarted`, `MovementPhaseEnded`, `ShootingPhaseStarted`, `ShootingPhaseEnded`, `ChargePhaseStarted`, `ChargePhaseEnded`, `FightPhaseStarted`, `FightPhaseEnded`, `EndPhaseStarted`, `EndPhaseEnded`, `TurnEnded`, `RoundEnded`, `EndOfGame`.

Rule-emitted events: `CommandPointsAwarded`, `UnitMovementStarted`, `UnitMovementEnded`, `UnitShootingStarted`, `UnitShootingEnded`, `UnitChargeStarted`, `UnitChargeEnded`, `ChargeTargetDeclared`, `ChargeRollMade`, `ChargeMoveCompleted`, `UnitFightStarted`, `UnitFightEnded`.

System events (engine-provided): `ChoiceSelected`.

Verify: every `trigger.event` in `rules.json` is in one of these three sets.

- [ ] **Step 5: Cross-reference all selector IDs**

Every selector referenced in a rule's `when` clause or `effect` target must exist in `glossary.yaml`.

Selectors used in rules: `active_player_units`, `units_can_move`, `units_can_shoot`, `units_can_charge`, `units_can_fight`, `units_advanced`, `units_fell_back`, `units_battleshocked`.

- [ ] **Step 6: Cross-reference all state paths**

Every `path` in rules must resolve against `initial_state.json`:
- `$.activation.unitId` -- exists
- `$.activation.type` -- exists
- `$.turnPlayer` -- exists
- `$.charge.rollResult` -- exists

- [ ] **Step 7: Commit any fixes**

```bash
git add packs/wh40k-10e-core-turn/
git commit -m "fix: corrections from validation pass"
```

Only commit if changes were needed. Skip if all validations passed.

- [ ] **Step 8: Final commit for the complete pack**

```bash
git add packs/wh40k-10e-core-turn/ docs/superpowers/
git commit -m "feat: complete wh40k-10e-core-turn skeleton pack with design spec and plan"
```
