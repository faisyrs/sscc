# SSCC Engine Specification and Example Data Packs
*Provisional draft — examples should be validated against the final engine schema and real game packs before production use.*

## Purpose

This document contains:

1. A **game-agnostic specification** for an SSCC (**State, Sequence, Condition, Choice**) rules engine.
2. A set of **target example data files** showing how that engine can support the kind of **Warhammer 40,000-capable** system discussed so far:
   - event-driven sequencing
   - state-based eligibility
   - reason-based prohibitions and patches
   - reaction windows
   - micro-events for attack resolution
   - temporary effects that expire on future events
   - rule provenance and priority
   - reusable selectors and glossary terms

The examples are intentionally **data-first** and avoid hardcoding game mechanics into engine code.

---

# Part I — SSCC Engine Specification

## 1. Core Definitions

Use these terms precisely.

### State
The complete, structured snapshot of facts at a point in time.

Examples:
- active player
- round number
- entities in play
- unit statuses
- resources such as command points
- once-per-phase usage flags
- reaction windows that are currently open

State changes only through explicit engine effects.

### Sequence
An **ordered stream of events**.

A game is not modeled only as "phases." It is modeled as a timeline of **named events**, some coarse and some fine-grained.

Examples:
- `StartOfTurn`
- `MovementPhaseStarted`
- `ChargeDeclarationsEnded`
- `BeforeHitRolls`
- `OnNaturalCritHit`
- `EndOfRound`

The engine advances through this timeline and evaluates rules at each event.

### Condition
A boolean expression over:
- the current state
- the current event
- current event parameters
- optional selector outputs

Conditions determine whether a rule applies.

### Choice
A legal, explicit option offered to a player or AI.

Examples:
- choose a unit to activate
- spend a resource to use a reaction
- choose to reroll or not reroll
- select a target
- choose a mode or profile

A good engine does not merely apply rules; it also enumerates legal choices and explains why they are legal or blocked.

---

## 2. High-Level System Requirements

The engine must be:

### Data-driven
All game behavior comes from external pack files:
- timeline
- glossary/selectors
- rules
- initial state
- optional schemas/manifests

### Deterministic
All randomness must be seedable and logged.

### Explainable
For every:
- offered choice
- blocked choice
- applied effect
- state transition

the engine should record:
- which rules fired
- which conditions were satisfied
- which reason keys were added or removed
- which RNG values were used

### Extensible
A new game should be added by writing a new pack, not by rewriting the engine.

### Safe
Malformed packs should fail validation with useful diagnostics.

---

## 3. Data Pack Layout

A game pack is a directory such as:

```text
/packs/<pack-id>/
  manifest.yaml
  timeline.yaml
  glossary.yaml
  rules.json
  initial_state.json
```

Optional additions:
- `schemas/`
- `tests/`
- `examples/`
- `docs/`

---

## 4. File Roles

### 4.1 `manifest.yaml`
Declares:
- pack id
- display name
- version
- engine compatibility
- dependencies

### 4.2 `timeline.yaml`
Defines:
- events
- event ordering
- windows (reaction/interrupt windows)
- optional reusable sub-sequences

### 4.3 `glossary.yaml`
Defines:
- normalized keywords
- shared terms
- reusable selectors
- optional event aliases or tags

### 4.4 `rules.json`
Defines rulelets. Each rulelet is:
- event-triggered
- condition-guarded
- effect-bearing
- priority-aware
- provenance-labeled

### 4.5 `initial_state.json`
Defines the initial state shape for the pack.

---

## 5. Rulelet Shape

A rulelet should follow a schema similar to this:

```json
{
  "id": "CORE.Example.1",
  "scope": "global",
  "trigger": { "event": "SomeEvent" },
  "when": {
    "all": [],
    "any": []
  },
  "effect": [],
  "lifetime": "instant",
  "precedence": {
    "priority": 50,
    "strategy": "stack"
  },
  "provenance": {
    "source": "Pack Name",
    "page": 0,
    "note": "Optional"
  }
}
```

### Recommended fields

- `id`: stable rule id
- `scope`: one of `global`, `player`, `entity`, `unit`, `attack`, `window`
- `trigger`: event or window
- `when`: additional predicates
- `effect`: array of effect verbs
- `lifetime`: timing information
- `precedence`: conflict handling metadata
- `provenance`: source traceability

---

## 6. Predicates

Predicates should remain game-agnostic in the engine, even if game-specific packs use game-specific state fields.

Recommended starter predicates:

- `hasStatus`
- `missingStatus`
- `counterAtLeast`
- `counterEquals`
- `resourceAtLeast`
- `windowOpen`
- `windowClosed`
- `eventParamEquals`
- `selector`
- `tagPresent`
- `pathEquals`
- `pathIn`
- `pathAtLeast`
- `pathMissing`

Predicates should be composable using:
- `all`
- `any`
- `not`

---

## 7. Effect Verbs

Implement a closed set of generic verbs.

### State and counters
- `applyStatus`
- `removeStatus`
- `modifyCounter`
- `setValue`

### Eligibility and choice structure
- `addProhibition`
- `removeProhibition`
- `addChoice`
- `consumeUsage`
- `resetUsage`

### Randomness
- `roll`

### Event and window control
- `emit`
- `openWindow`
- `closeWindow`

### Resources and scoring
- `award`
- `spendResource`

### Optional convenience verbs
- `appendLogNote`
- `ensureExists`
- `mergeInto`

---

## 8. Recommended Best Practices for Rule Packs

### 8.1 Small, composable rulelets
One trigger, one purpose.

### 8.2 Durations by future event
Instead of vague phrases like "until end of turn," define an effect that expires on a named event.

### 8.3 State-first, eligibility-second
Prefer:
1. applying a status or token
2. having later rules inspect that status

This is more explainable and easier to override than eagerly hard-forbidding future actions.

### 8.4 Use reason keys for prohibitions
Every prohibition should include a machine-readable reason key.

Example:
- `advanced_move`
- `fell_back`
- `out_of_range`
- `already_used_this_phase`

Overrides should remove a specific reason key, not broadly "allow everything."

### 8.5 Stable provenance
Every rule should have a stable id and provenance metadata.

### 8.6 Event-driven cleanup
Cleanup is just another rule triggered by another event.

### 8.7 Avoid hidden state
All meaningful transitions should happen through effects and logged events.

### 8.8 Test with fixed seeds
Scenario tests should be replayable.

---

## 9. Engine Components

### 9.1 State Manager
- immutable or copy-on-write snapshots
- effect application
- snapshot/restore

### 9.2 Event Sequencer
- reads timeline
- emits events in order
- supports sub-events
- opens/closes windows

### 9.3 Rule Executor
- indexes rules by trigger event
- evaluates conditions
- applies precedence
- executes effects

### 9.4 Choice Orchestrator
- enumerates legal choices
- validates selected choice
- explains why choices are blocked

### 9.5 RNG subsystem
- seeded
- reproducible
- logs roll path and result

### 9.6 Logger
Append-only log entries for:
- event start/end
- rules fired
- choices offered
- choices selected
- effects applied
- random outcomes

---

## 10. Minimal API Expectations

The engine should expose functions equivalent to:

- `loadPack(path)`
- `initializeState(pack, overrides?)`
- `advanceToNextEvent(state)`
- `enumerateChoices(state, event)`
- `applyChoice(state, choiceId, args?, seed?)`
- `whyNot(state, proposedChoice)`
- `snapshot(state)`
- `restore(snapshot)`
- `simulate(state, policy, horizon, seed)`

---

## 11. Output Expectations for a First Implementation

A first implementation should include:

1. Core engine library
2. A generic demo pack ("Hello Pack")
3. A richer example pack demonstrating 40K-style requirements
4. Schema validation
5. Scenario tests
6. Documentation

---

# Part II — Generic Reference Pack ("Hello Pack")

This pack proves the loop without referencing any specific game.

## `manifest.yaml`

```yaml
id: hello-pack
name: Hello Pack
version: 0.1.0
engine_version: ^0.1.0
dependencies: []
```

## `timeline.yaml`

```yaml
events:
  - id: StartOfGame
  - id: TurnStarted
    params: [player]
  - id: MainPhaseStarted
    params: [player]
  - id: MainPhaseEnded
    params: [player]
  - id: TurnEnded
    params: [player]
```

## `glossary.yaml`

```yaml
keywords: []
selectors:
  active_player:
    kind: player
    where:
      pathEquals:
        path: $.turnPlayer
        valueFromEventParam: player
```

## `initial_state.json`

```json
{
  "turnNumber": 1,
  "turnPlayer": "A",
  "resources": {
    "A": { "coin": 0 },
    "B": { "coin": 0 }
  },
  "usage": {},
  "statuses": {}
}
```

## `rules.json`

```json
[
  {
    "id": "HELLO.Coin.Choice.1",
    "scope": "player",
    "trigger": { "event": "MainPhaseStarted" },
    "when": {
      "all": [
        { "pathEquals": { "path": "$.turnPlayer", "valueFromEventParam": "player" } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "gain_coin",
          "label": "Gain 1 coin",
          "actionRef": "HELLO.Action.GainCoin",
          "limits": { "oncePerTurn": true }
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  },
  {
    "id": "HELLO.Action.GainCoin",
    "scope": "player",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "gain_coin" } }
      ]
    },
    "effect": [
      {
        "award": {
          "target": { "eventParam": "player" },
          "resource": "coin",
          "amount": 1
        }
      },
      {
        "consumeUsage": {
          "scope": "player",
          "key": "gain_coin_once_per_turn"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  },
  {
    "id": "HELLO.ResetUsage.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": { "all": [] },
    "effect": [
      {
        "resetUsage": {
          "scope": "player",
          "keys": ["gain_coin_once_per_turn"]
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  }
]
```

---

# Part III — 40K-Capable Example Pack

The goal of this example is **not** to fully encode 40K. The goal is to show the kind of data shape that can support the 40K-style requirements we have discussed.

This example demonstrates:

- phases as events
- reaction windows
- state-based restrictions
- reason-based eligibility
- overrides via patches
- attack micro-events
- hit/wound critical behavior through data
- cleanup via future events

## 1. `manifest.yaml`

```yaml
id: wh40k-example-pack
name: Warhammer 40,000 Example Pack
version: 0.1.0
engine_version: ^0.1.0
dependencies: []
```

## 2. `timeline.yaml`

```yaml
events:
  - id: StartOfGame
  - id: RoundStarted
    params: [round]
  - id: TurnStarted
    params: [player]

  - id: CommandPhaseStarted
    params: [player]
  - id: CommandPhaseEnded
    params: [player]

  - id: MovementPhaseStarted
    params: [player]
  - id: UnitAdvanced
    params: [player, unitId]
  - id: UnitFellBack
    params: [player, unitId]
  - id: MovementPhaseEnded
    params: [player]

  - id: ShootingPhaseStarted
    params: [player]
  - id: ShootingPhaseEnded
    params: [player]

  - id: ChargePhaseStarted
    params: [player]
  - id: ChargeDeclarationsEnded
    params: [player]
  - id: ChargePhaseEnded
    params: [player]

  - id: FightPhaseStarted
    params: [player]
  - id: FightActivationStarted
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: BeforeAttackCount
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: AfterAttackCount
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

  - id: BeforeHitRolls
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: OnNaturalCritHit
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: AfterHitResolution
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

  - id: BeforeWoundRolls
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: OnNaturalCritWound
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: AfterWoundResolution
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

  - id: FightActivationEnded
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  - id: FightPhaseEnded
    params: [player]

  - id: EndPhaseStarted
    params: [player]
  - id: EndPhaseEnded
    params: [player]

  - id: TurnEnded
    params: [player]
  - id: RoundEnded
    params: [round]

windows:
  - id: OverwatchWindow
    opens_on: ChargeDeclarationsEnded
    closes_on: FightPhaseStarted
```

## 3. `glossary.yaml`

```yaml
keywords:
  - INFANTRY
  - VEHICLE
  - CHARACTER
  - MONSTER

reason_keys:
  charge:
    - advanced_move
    - fell_back
    - no_valid_target
  shoot:
    - advanced_move
    - fell_back
    - no_valid_target

selectors:
  active_player_units:
    kind: unit
    where:
      pathEquals:
        path: $.turnPlayer
        valueFromEventParam: player

  event_attacker_unit:
    kind: unit
    byEventParam: attackerUnitId

  event_defender_unit:
    kind: unit
    byEventParam: defenderUnitId

  event_weapon_profile:
    kind: weaponProfile
    byEventParam: weaponProfileId

  units_with_status_advanced:
    kind: unit
    where:
      hasStatus: advanced_move
```

## 4. `initial_state.json`

```json
{
  "round": 1,
  "turnPlayer": "A",
  "resources": {
    "A": { "cp": 1 },
    "B": { "cp": 1 }
  },
  "windows": {
    "OverwatchWindow": false
  },
  "armyStatuses": {
    "A": [],
    "B": []
  },
  "usage": {},
  "units": {
    "u_attacker": {
      "id": "u_attacker",
      "owner": "A",
      "name": "Attacker Unit",
      "keywords": ["INFANTRY"],
      "statuses": [],
      "abilities": ["Lethal Hits", "Sustained 1"],
      "profiles": {
        "melee": {
          "id": "wp_melee",
          "name": "Melee Weapon",
          "A": 4,
          "WS": 3,
          "S": 5,
          "D": 2,
          "keywords": []
        }
      },
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    },
    "u_defender": {
      "id": "u_defender",
      "owner": "B",
      "name": "Defender Unit",
      "keywords": ["INFANTRY"],
      "statuses": [],
      "abilities": [],
      "profiles": {},
      "stats": {
        "T": 4
      }
    }
  },
  "currentAttack": {
    "attackCount": 0,
    "hitRolls": [],
    "hitSummary": {
      "critThreshold": 6,
      "mods": 0,
      "reroll": "none",
      "hits": 0,
      "critHits": 0,
      "autoWounds": 0,
      "spawnedHits": 0
    },
    "woundRolls": [],
    "woundSummary": {
      "critThreshold": 6,
      "mods": 0,
      "reroll": "none",
      "normalWounds": 0,
      "critWounds": 0,
      "mortalWounds": 0
    }
  }
}
```

## 5. `rules.json`

### 5.1 Movement creates state, not hardcoded future gates

```json
[
  {
    "id": "CORE.Move.Advance.ApplyStatus.1",
    "scope": "unit",
    "trigger": { "event": "UnitAdvanced" },
    "when": { "all": [] },
    "effect": [
      {
        "applyStatus": {
          "target": { "eventParam": "unitId" },
          "key": "advanced_move",
          "expiresOn": "TurnEnded"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 13 }
  },
  {
    "id": "CORE.Move.FallBack.ApplyStatus.1",
    "scope": "unit",
    "trigger": { "event": "UnitFellBack" },
    "when": { "all": [] },
    "effect": [
      {
        "applyStatus": {
          "target": { "eventParam": "unitId" },
          "key": "fell_back",
          "expiresOn": "TurnEnded"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 14 }
  }
]
```

### 5.2 Shooting and charge eligibility are computed later from state

```json
[
  {
    "id": "CORE.Shoot.Advanced.Prohibit.1",
    "scope": "unit",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": {
      "all": [
        { "hasStatus": { "target": { "selector": "active_player_units" }, "key": "advanced_move" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "active_player_units" },
          "action": "shoot",
          "reason": "advanced_move"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 13 }
  },
  {
    "id": "CORE.Charge.Advanced.Prohibit.1",
    "scope": "unit",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": {
      "all": [
        { "hasStatus": { "target": { "selector": "active_player_units" }, "key": "advanced_move" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "active_player_units" },
          "action": "charge",
          "reason": "advanced_move"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 13 }
  },
  {
    "id": "CORE.Charge.FallBack.Prohibit.1",
    "scope": "unit",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": {
      "all": [
        { "hasStatus": { "target": { "selector": "active_player_units" }, "key": "fell_back" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "active_player_units" },
          "action": "charge",
          "reason": "fell_back"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 14 }
  }
]
```

### 5.3 Override example: reason-based patch

```json
[
  {
    "id": "EXAMPLE.Override.AdvanceCharge.1",
    "scope": "unit",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": {
      "all": [
        { "pathIn": { "path": "$.armyStatuses.A", "value": "waaagh_active" } },
        { "hasStatus": { "target": { "selector": "active_player_units" }, "key": "advanced_move" } }
      ]
    },
    "effect": [
      {
        "removeProhibition": {
          "target": { "selector": "active_player_units" },
          "action": "charge",
          "reason": "advanced_move"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 90, "strategy": "override" },
    "provenance": { "source": "Example faction rule" }
  }
]
```

### 5.4 Reaction window example

```json
[
  {
    "id": "CORE.Window.Overwatch.Open.1",
    "scope": "window",
    "trigger": { "event": "ChargeDeclarationsEnded" },
    "when": { "all": [] },
    "effect": [
      { "openWindow": { "id": "OverwatchWindow" } }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  },
  {
    "id": "CORE.Window.Overwatch.Close.1",
    "scope": "window",
    "trigger": { "event": "FightPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "closeWindow": { "id": "OverwatchWindow" } }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  },
  {
    "id": "CORE.Stratagem.Overwatch.1",
    "scope": "player",
    "trigger": { "event": "ChargeDeclarationsEnded" },
    "when": {
      "all": [
        { "windowOpen": { "id": "OverwatchWindow" } },
        { "resourceAtLeast": { "player": "B", "resource": "cp", "amount": 1 } }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "overwatch",
          "label": "Use reaction fire",
          "actionRef": "CORE.Stratagem.Overwatch.Resolve.1",
          "costs": { "cp": 1 }
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 60, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  }
]
```

### 5.5 Fight attack micro-pipeline

#### 5.5.1 Attack count

```json
[
  {
    "id": "CORE.Fight.AttackCount.FromProfile.1",
    "scope": "attack",
    "trigger": { "event": "BeforeAttackCount" },
    "when": { "all": [] },
    "effect": [
      {
        "setValue": {
          "path": "$.currentAttack.attackCount",
          "valueFromPath": "$.units.u_attacker.profiles.melee.A"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Example melee profile" }
  }
]
```

#### 5.5.2 Hit step defaults

```json
[
  {
    "id": "CORE.Attack.HitDefaults.1",
    "scope": "attack",
    "trigger": { "event": "BeforeHitRolls" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.currentAttack.hitSummary.critThreshold", "value": 6 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.mods", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.reroll", "value": "none" } }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core defaults" }
  }
]
```

#### 5.5.3 Crit threshold from abilities

```json
[
  {
    "id": "EXAMPLE.Hit.CritOn5.1",
    "scope": "attack",
    "trigger": { "event": "BeforeHitRolls" },
    "when": {
      "all": [
        { "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Crit on 5+" } }
      ]
    },
    "effect": [
      { "setValue": { "path": "$.currentAttack.hitSummary.critThreshold", "value": 5 } }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 20, "strategy": "override" },
    "provenance": { "source": "Example attack ability" }
  }
]
```

#### 5.5.4 Lethal Hits as data

```json
[
  {
    "id": "CORE.Attack.CritHit.LethalHits.1",
    "scope": "attack",
    "trigger": { "event": "OnNaturalCritHit" },
    "when": {
      "all": [
        { "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Lethal Hits" } }
      ]
    },
    "effect": [
      {
        "modifyCounter": {
          "path": "$.currentAttack.hitSummary.autoWounds",
          "delta": 1
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 40, "strategy": "stack" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

#### 5.5.5 Sustained Hits as data

```json
[
  {
    "id": "CORE.Attack.CritHit.Sustained1.1",
    "scope": "attack",
    "trigger": { "event": "OnNaturalCritHit" },
    "when": {
      "all": [
        { "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Sustained 1" } }
      ]
    },
    "effect": [
      {
        "modifyCounter": {
          "path": "$.currentAttack.hitSummary.spawnedHits",
          "delta": 1
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 40, "strategy": "stack" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

#### 5.5.6 Wound step defaults

```json
[
  {
    "id": "CORE.Attack.WoundDefaults.1",
    "scope": "attack",
    "trigger": { "event": "BeforeWoundRolls" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.currentAttack.woundSummary.critThreshold", "value": 6 } },
      { "setValue": { "path": "$.currentAttack.woundSummary.mods", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.woundSummary.reroll", "value": "none" } }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core defaults" }
  }
]
```

#### 5.5.7 Anti-X affects critical wound threshold

```json
[
  {
    "id": "CORE.Attack.WoundCrit.AntiInfantry4.1",
    "scope": "attack",
    "trigger": { "event": "BeforeWoundRolls" },
    "when": {
      "all": [
        { "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Anti-INFANTRY 4+" } },
        { "pathIn": { "path": "$.units.u_defender.keywords", "value": "INFANTRY" } }
      ]
    },
    "effect": [
      { "setValue": { "path": "$.currentAttack.woundSummary.critThreshold", "value": 4 } }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 30, "strategy": "override" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

#### 5.5.8 Devastating Wounds as data

```json
[
  {
    "id": "CORE.Attack.CritWound.Devastating.1",
    "scope": "attack",
    "trigger": { "event": "OnNaturalCritWound" },
    "when": {
      "all": [
        { "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Devastating Wounds" } }
      ]
    },
    "effect": [
      {
        "modifyCounter": {
          "path": "$.currentAttack.woundSummary.mortalWounds",
          "deltaFromPath": "$.units.u_attacker.profiles.melee.D"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 50, "strategy": "stack" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

### 5.6 Cleanup rule example

```json
[
  {
    "id": "CORE.Cleanup.RemoveAdvanced.1",
    "scope": "unit",
    "trigger": { "event": "TurnEnded" },
    "when": { "all": [] },
    "effect": [
      {
        "removeStatus": {
          "target": { "selector": "units_with_status_advanced" },
          "key": "advanced_move"
        }
      },
      {
        "removeProhibition": {
          "target": { "selector": "units_with_status_advanced" },
          "action": "shoot",
          "reason": "advanced_move"
        }
      },
      {
        "removeProhibition": {
          "target": { "selector": "units_with_status_advanced" },
          "action": "charge",
          "reason": "advanced_move"
        }
      }
    ],
    "lifetime": "instant",
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core cleanup pattern" }
  }
]
```

---

# Part IV — Notes on Translating Existing Game Rules into This Format

## 1. Start with state, not prose
Ask:
- what fact becomes true?
- what fact stops being true?
- what counter changes?

Example:
- "A unit that advanced cannot charge this turn"
becomes:
- apply state `advanced_move`
- later add prohibition `charge: advanced_move`
- later remove that state and prohibition at `TurnEnded`

## 2. Use events instead of vague durations
Instead of:
- "until the end of the turn"

prefer:
- `expiresOn: TurnEnded`

## 3. Encode exceptions as patches, not special code
If a faction or upgrade overrides a general rule:
- do not hardcode that in the engine
- write a higher-priority rule that removes a reason key

## 4. Encode attack keywords as event-triggered data
Critical hits and wounds should not be special-cased per keyword in the engine.
The engine should only know:
- an event happened
- rules on that event can modify counters or thresholds

## 5. Make blocked choices explainable
Every blocked choice should produce a list of reason keys and contributing rule ids.

---

# Part V — Recommended First Implementation Milestones

## Milestone 1
Implement engine core with:
- state
- timeline
- rule matching
- choices
- statuses
- prohibitions
- cleanup

Validate with Hello Pack.

## Milestone 2
Add windows and costs.
Validate with Overwatch-style example.

## Milestone 3
Add sub-events and RNG.
Validate with attack micro-pipeline.

## Milestone 4
Add explainability and scenario replay.
Validate with fixed seeds.

---

# Part VI — Summary

This specification is intended to support a **game-independent SSCC engine** that can later run sophisticated packs, including a 40K-like system.

The important design choices are:

- **state-first** rules
- **event-driven** sequencing
- **reason-based** eligibility
- **data-defined** critical behaviors and overrides
- **cleanup by event**
- **engine-agnostic** effect verbs

The example files in this document are not meant to be complete rule implementations. They are meant to capture the **requirements and shape** of a 40K-capable data-driven system.
