# SSCC Engine Specification v0.2.0

*State, Sequence, Condition, Choice — a game-agnostic rules engine.*

**Design philosophy:** Push all validation to load time. The timeline is a finite, deterministic event template — no arbitrary branching or unbounded loops. The engine is game-agnostic; all game semantics live in pack data.

---

## Purpose

This document contains:

1. A **game-agnostic specification** for an SSCC rules engine.
2. A set of **target example data files** showing how that engine can support a **Warhammer 40,000-capable** system:
   - event-driven sequencing with structured timeline nodes
   - state-based eligibility with typed predicates
   - reason-based prohibitions and patches
   - choices with cost pre-computation and lifecycle
   - roll sub-sequences for attack resolution
   - temporary effects that expire on future events
   - rule provenance, priority, and conflict resolution
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

State changes only through explicit engine effects.

**`initial_state.json` defines the canonical state schema.** All `path` references in predicates and effects are validated against this schema at pack load time. If a path cannot resolve against the initial state structure, the pack fails validation.

### Sequence

A **finite, parameterized event template** — not a flat list.

The timeline is a tree of typed nodes (see Section 5) that the engine walks deterministically. Because every node type is finite and bounded, the engine can **enumerate all possible event IDs at load time**. This means every `trigger.event` in every rule can be validated before the game starts.

Examples of events the timeline emits:
- `StartOfTurn`
- `MovementPhaseStarted`
- `ChargeDeclarationsEnded`
- `BeforeHitRolls`
- `OnNaturalCritHit`
- `EndOfRound`

The engine advances through this timeline and evaluates rules at each event.

### Condition

A **pure boolean function** over:
- the current state
- the current event
- current event parameters
- optional selector outputs

Conditions determine whether a rule applies. Conditions have **no side effects** — they read state but never modify it. Every predicate has a typed signature and a load-time validation rule (see Section 8).

### Choice

A legal, explicit option offered to a player or AI.

Examples:
- choose a unit to activate
- spend a resource to use a reaction
- choose to reroll or not reroll
- select a target
- choose a mode or profile

The **choice vocabulary is known at load time** — every `addChoice` effect declares a `choiceId` and `actionRef` that can be validated against the rule set. The **active choice set** (which choices are currently offered) is determined at runtime by rule evaluation.

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
Malformed packs should fail validation with useful diagnostics at load time.

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
- timeline node tree (see Section 5)
- reusable sub-sequences

### 4.3 `glossary.yaml`
Defines:
- normalized keywords
- shared terms
- reason keys
- reusable selectors (see Section 7)
- optional event aliases or tags

### 4.4 `rules.json`
Defines rulelets. Each rulelet is:
- event-triggered
- condition-guarded
- effect-bearing
- priority-aware
- provenance-labeled

### 4.5 `initial_state.json`
Defines both the **initial state values** and the **state schema contract**. Every `path` reference in predicates and effects must resolve against this structure. The engine validates all paths at load time.

---

## 5. Timeline Node Types

The timeline is built from exactly **five node types**. There is no `branch`, no `if`, no `while`. The engine can enumerate all possible event IDs at load time because every node type is finite and bounded.

### 5.1 `event`

Emit a named event with parameters.

```yaml
- event: StartOfGame
```

```yaml
- event: TurnStarted
  params: [player]
```

**Load-time property:** Fully known. The event ID and its parameter names are statically declared.

### 5.2 `sequence`

An ordered list of child nodes. Executed top to bottom.

```yaml
- sequence:
    - event: CommandPhaseStarted
      params: [player]
    - event: CommandPhaseEnded
      params: [player]
```

**Load-time property:** Fully known. All children are recursively enumerable.

### 5.3 `repeat`

Run the body N times, where N is a literal integer or a state-path reference. When N comes from a state path, the value is read once at the start of the repeat — it does not change mid-iteration.

```yaml
- repeat:
    count: { path: "$.totalRounds" }
    indexParam: round
    body:
      - event: RoundStarted
        params: [round]
      # ... round body ...
      - event: RoundEnded
        params: [round]
```

**Load-time property:** Bounded. The set of event IDs in the body is fully known. The iteration count is runtime, but the engine knows exactly which events *can* fire.

### 5.4 `forEach`

Run the body once per member of a named set type. The set is evaluated at runtime from state.

```yaml
- forEach:
    over: { kind: "player", from: "$.players" }
    bindParam: player
    body:
      - event: TurnStarted
        params: [player]
      # ... turn body ...
      - event: TurnEnded
        params: [player]
```

**Load-time property:** The set *type* is known; cardinality is runtime. The event IDs in the body are fully known. An empty set produces zero iterations — this is not branching, it is simply zero repetitions.

### 5.5 `subSequence`

A named, reusable sequence with parameters. Declared once, referenced by name.

```yaml
subSequences:
  resolveHitRolls:
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    body:
      - event: BeforeHitRolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: HitDiceRolled
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      # ...
```

Referenced in the timeline as:

```yaml
- subSequence: resolveHitRolls
  params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
```

**Load-time property:** Fully known. The sub-sequence is resolved by name and inlined for validation purposes.

### Timeline Examples

**Battle round loop** — `repeat` with N from state:

```yaml
- repeat:
    count: { path: "$.totalRounds" }
    indexParam: round
    body:
      - event: RoundStarted
        params: [round]
      # ... phases ...
      - event: RoundEnded
        params: [round]
```

**Player turns** — `forEach` over player set:

```yaml
- forEach:
    over: { kind: "player", from: "$.players" }
    bindParam: player
    body:
      - event: TurnStarted
        params: [player]
      # ... phases ...
      - event: TurnEnded
        params: [player]
```

**Fight activations** — `forEach` over eligible units:

```yaml
- forEach:
    over: { kind: "unit", from: "$.eligibleFighters" }
    bindParam: attackerUnitId
    body:
      - event: FightActivationStarted
        params: [player, attackerUnitId]
      # ... attack sub-sequences ...
      - event: FightActivationEnded
        params: [player, attackerUnitId]
```

---

## 6. System Events

The engine emits certain events automatically. These are **never declared in pack timelines** — the engine produces them in response to choice-related state changes.

| Event | Parameters | When emitted |
|---|---|---|
| `ChoiceAdded` | choiceId, player, sourceRuleId | An `addChoice` effect executes |
| `ChoiceSelected` | choiceId, player, sourceRuleId, actionRef, args, choiceInstanceId | A player or AI selects a choice |
| `ChoiceResolved` | choiceId, choiceInstanceId | The action triggered by a choice completes |
| `ChoiceExpired` | choiceId, choiceInstanceId | A choice expires (event reached or explicitly removed) |

Pack rules **may** trigger on system events. For example, a rule triggered by `ChoiceSelected` with `eventParamEquals: { param: "choiceId", value: "gain_coin" }` is how choice actions are implemented.

---

## 7. Selector Evaluation Semantics

Selectors are **named, typed, set-valued queries** over state, parameterized by event params.

### Return type

A selector always returns `Set<EntityId>`. Never null — an empty set is the bottom value.

### Resolution modes

#### `byEventParam`

Resolve a single entity by reading an event parameter.

```yaml
event_attacker_unit:
  kind: unit
  byEventParam: attackerUnitId
```

Returns a set containing the single entity whose ID matches the event parameter value.

**Load-time check:** `kind` must be a known entity type. The named event parameter must exist on at least one event that triggers a rule using this selector.

#### `where`

Filter entities of the given kind by a predicate.

```yaml
units_with_status_advanced:
  kind: unit
  where:
    hasStatus: advanced_move
```

Returns all entities of the given kind for which the predicate is true.

**Load-time check:** `kind` must be a known entity type. The `where` predicate must be well-formed per Section 8.

#### `all`

Return all entities of the given kind.

```yaml
all_units:
  kind: unit
  all: true
```

**Load-time check:** `kind` must be a known entity type.

### Effect target consumption

When an effect references a selector as its target, a **consumption mode** determines how the set is used:

| Mode | Meaning | Example |
|---|---|---|
| `each` (default) | Apply the effect once per entity in the set | `applyStatus` to each unit |
| `one` | Exactly one entity required; error if set is empty or has multiple | Target of a single-target ability |
| `all` | Treat the set as a whole (e.g., count members) | "All units in range" as a group |

Cardinality constraints belong on **effects**, not selectors. A selector is a pure query; the effect decides how to consume the result.

---

## 8. Predicate Type System

Every predicate has a name, a typed signature, evaluation semantics, and a load-time validation rule. Predicates are pure functions — they read state and return a boolean.

### Predicate Reference

| Predicate | Signature | Semantics | Load-time check |
|---|---|---|---|
| `hasStatus` | `(target: Selector, key: StatusKey)` | True if target entity has the named status | Selector exists; key declared in glossary |
| `missingStatus` | `(target: Selector, key: StatusKey)` | True if target entity lacks the named status | Selector exists; key declared in glossary |
| `pathEquals` | `(path: StatePath, value: Literal \| EventParamRef)` | True if state at path equals value | Path resolves in initial state schema |
| `pathIn` | `(path: StatePath, value: Literal)` | True if value is a member of the array at path | Path resolves; target is array type |
| `pathAtLeast` | `(path: StatePath, value: number)` | True if numeric value at path >= value | Path resolves; target is numeric |
| `pathMissing` | `(path: StatePath)` | True if path does not exist in current state | Parent path resolves in schema |
| `resourceAtLeast` | `(player: PlayerRef, resource: string, amount: number)` | True if player's resource >= amount | Resource key exists in initial state schema |
| `eventParamEquals` | `(param: string, value: Literal)` | True if the named event parameter equals value | Param exists on at least one triggering event |
| `counterAtLeast` | `(path: StatePath, value: number)` | True if numeric value at path >= value | Path resolves; target is numeric |
| `counterEquals` | `(path: StatePath, value: number)` | True if numeric value at path == value | Path resolves; target is numeric |
| `tagPresent` | `(target: Selector, tag: string)` | True if target entity has the named tag/keyword | Selector exists |
| `selector` | `(id: SelectorId)` | True if the named selector returns a non-empty set | Selector exists |

### Composition

Predicates are composable using:

- **`all`** — logical AND: all child predicates must be true
- **`any`** — logical OR: at least one child predicate must be true
- **`not`** — logical negation: child predicate must be false

```json
{
  "all": [
    { "hasStatus": { "target": { "selector": "active_player_units" }, "key": "advanced_move" } },
    { "not": { "pathEquals": { "path": "$.someFlag", "value": true } } }
  ]
}
```

---

## 9. Effect Verb Schemas

Each effect verb has a name, parameter schema, target cardinality, conflict domain, stackability, and load-time checks.

### Stackability modes

- **stackable** — Multiple instances all apply independently.
- **singleton** — At most one instance per conflict domain. Within the same priority, last-in-order wins. Across priorities, highest priority wins.
- **reducible** — Multiple instances accumulate (e.g., deltas are summed).

### 9.1 State and Counters

#### `applyStatus`

| Field | Value |
|---|---|
| Parameters | `target: Selector`, `key: StatusKey`, `expiresOn?: EventId` |
| Target cardinality | `each` |
| Conflict domain | `(target, key)` |
| Stackability | singleton (idempotent — applying same status twice is a no-op) |
| Load-time checks | Selector exists; key in glossary; expiresOn event exists in timeline |

#### `removeStatus`

| Field | Value |
|---|---|
| Parameters | `target: Selector`, `key: StatusKey` |
| Target cardinality | `each` |
| Conflict domain | `(target, key)` |
| Stackability | singleton |
| Load-time checks | Selector exists; key in glossary |

#### `modifyCounter`

| Field | Value |
|---|---|
| Parameters | `path: StatePath`, `delta: number \| deltaFromPath: StatePath` |
| Target cardinality | n/a (path-based) |
| Conflict domain | `(path)` |
| Stackability | reducible (deltas accumulate) |
| Load-time checks | Path resolves in schema; target is numeric |

#### `setValue`

| Field | Value |
|---|---|
| Parameters | `path: StatePath`, `value: Literal \| valueFromPath: StatePath \| valueFromEventParam: string` |
| Target cardinality | n/a (path-based) |
| Conflict domain | `(path)` |
| Stackability | singleton (last-write-wins within same priority) |
| Load-time checks | Path resolves in schema; source path resolves if used |

### 9.2 Eligibility and Choice Structure

#### `addProhibition`

| Field | Value |
|---|---|
| Parameters | `target: Selector`, `action: string`, `reason: ReasonKey` |
| Target cardinality | `each` |
| Conflict domain | `(target, action, reason)` |
| Stackability | singleton (idempotent) |
| Load-time checks | Selector exists; reason key in glossary |

#### `removeProhibition`

| Field | Value |
|---|---|
| Parameters | `target: Selector`, `action: string`, `reason: ReasonKey` |
| Target cardinality | `each` |
| Conflict domain | `(target, action, reason)` |
| Stackability | singleton |
| Load-time checks | Selector exists; reason key in glossary |

#### `addChoice`

| Field | Value |
|---|---|
| Parameters | `id: ChoiceId`, `label: string`, `actionRef: RuleId`, `limits?: object`, `costs?: object` |
| Target cardinality | n/a |
| Conflict domain | `(choiceId)` |
| Stackability | singleton |
| Load-time checks | actionRef references an existing rule; cost resources exist in schema |

#### `consumeUsage`

| Field | Value |
|---|---|
| Parameters | `scope: string`, `key: UsageKey` |
| Target cardinality | n/a |
| Conflict domain | `(scope, key)` |
| Stackability | singleton |
| Load-time checks | Scope is valid scope type |

#### `resetUsage`

| Field | Value |
|---|---|
| Parameters | `scope: string`, `keys: UsageKey[]` |
| Target cardinality | n/a |
| Conflict domain | `(scope, key)` per key |
| Stackability | singleton |
| Load-time checks | Scope is valid scope type |

### 9.3 Randomness

#### `roll`

| Field | Value |
|---|---|
| Parameters | `count: number \| StatePathRef`, `sides: number` (default 6), `storePath: StatePath` |
| Target cardinality | n/a |
| Conflict domain | `(storePath)` |
| Stackability | singleton |
| Load-time checks | storePath resolves in schema; count path resolves if StatePathRef |

Writes an array of integers to `storePath`. That is all. No comparison, no threshold — downstream rules on later events read the array and classify results.

### 9.4 Event Control

#### `emit`

| Field | Value |
|---|---|
| Parameters | `eventId: EventId`, `params?: object` |
| Target cardinality | n/a |
| Conflict domain | none |
| Stackability | stackable |
| Load-time checks | eventId exists in timeline or is a system event |

### 9.5 Resources and Scoring

#### `award`

| Field | Value |
|---|---|
| Parameters | `target: PlayerRef \| EventParamRef`, `resource: string`, `amount: number` |
| Target cardinality | n/a |
| Conflict domain | `(target, resource)` |
| Stackability | reducible (amounts accumulate) |
| Load-time checks | Resource exists in initial state schema |

#### `spendResource`

| Field | Value |
|---|---|
| Parameters | `target: PlayerRef \| EventParamRef`, `resource: string`, `amount: number` |
| Target cardinality | n/a |
| Conflict domain | `(target, resource)` |
| Stackability | reducible (amounts accumulate) |
| Load-time checks | Resource exists in initial state schema |

### 9.6 Convenience

#### `appendLogNote`

| Field | Value |
|---|---|
| Parameters | `message: string` |
| Target cardinality | n/a |
| Conflict domain | none |
| Stackability | stackable |
| Load-time checks | none |

#### `ensureExists`

| Field | Value |
|---|---|
| Parameters | `path: StatePath`, `defaultValue: any` |
| Target cardinality | n/a |
| Conflict domain | `(path)` |
| Stackability | singleton |
| Load-time checks | Parent path resolves in schema |

#### `mergeInto`

| Field | Value |
|---|---|
| Parameters | `path: StatePath`, `value: object` |
| Target cardinality | n/a |
| Conflict domain | `(path)` |
| Stackability | reducible (merges accumulate) |
| Load-time checks | Path resolves in schema |

---

## 10. Conflict Resolution Algorithm

When the engine arrives at an event, it resolves rules as follows:

1. **Collect** all rules whose `trigger.event` matches the current event.
2. **Evaluate** each rule's `when` predicates against the current state.
3. **Filter** to only matching rules (predicates all true).
4. **Group** matching rules by conflict domain (derived from their effects — see Section 9).
5. **Within each domain**, apply the declared strategy:
   - **`stack`**: All rules apply. Reducible effects accumulate (deltas sum). Singleton effects use last-in-priority-order.
   - **`override`**: Only the highest-priority rule applies. Same-priority tie within override = **pack validation error** (caught at load time).
   - **`patch`**: Applies *after* stack/override resolution. Patches modify results by specific reason key or path.
6. **Execute** resolved effects in priority order — **ascending** (low priority fires first, high priority fires last). This means overrides and patches take effect after base rules.

### Load-time conflict detection

Two rules with `strategy: "override"` that share the same trigger event, same conflict domain, and same priority value produce a **pack validation error**. This is caught at load time, not runtime.

---

## 11. Choice Lifecycle

### States

```text
offered --> selected --> resolved
    |                       |
    +--> expired            +--> (complete)
    |
    +--> cancelled
```

### Choice instance fields

Every choice instance carries:

| Field | Description |
|---|---|
| `choiceInstanceId` | Unique instance identifier |
| `choiceId` | From the `addChoice` effect |
| `createdAtEvent` | Event during which this choice was offered |
| `expiresAtEvent` | Optional: event that causes expiry |
| `sourceRuleId` | Rule that created this choice |
| `player` | Player to whom the choice is offered |

### Expiry

A choice remains active until one of:
- It is **selected** and its action resolves
- It is **explicitly removed** by a rule effect
- Its **expiry event** fires (if `expiresAtEvent` is set)

When a choice expires, the engine emits a `ChoiceExpired` system event.

---

## 12. Roll Sub-Sequences

These are canonical `subSequence` definitions for resolving dice-based mechanics. Each step is a named event where pack rules can hook in.

### `resolveHitRolls`

```yaml
resolveHitRolls:
  params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  body:
    - event: BeforeHitRolls
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: HitDiceRolled
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: BeforeHitRerolls
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: HitRerollsResolved
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: HitDiceEvaluated
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: OnNaturalCritHit
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: AfterHitResolution
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
```

**Step responsibilities:**

| Event | What happens |
|---|---|
| `BeforeHitRolls` | Rules set threshold (from WS), crit threshold, mods, reroll policy; `roll` verb executes and stores raw die results |
| `HitDiceRolled` | Post-roll hook — pack rules can react to the raw dice array before rerolls |
| `BeforeHitRerolls` | Rules flag specific dice indices for reroll |
| `HitRerollsResolved` | Engine rerolls flagged indices, updates stored results |
| `HitDiceEvaluated` | Rules compare each die to threshold, classify as hit/miss/crit |
| `OnNaturalCritHit` | Per-crit: rules react (Lethal Hits, Sustained Hits, etc.) |
| `AfterHitResolution` | Rules tally final hit count |

### `resolveWoundRolls`

```yaml
resolveWoundRolls:
  params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  body:
    - event: BeforeWoundRolls
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: WoundDiceRolled
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: BeforeWoundRerolls
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: WoundRerollsResolved
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: WoundDiceEvaluated
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: OnNaturalCritWound
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: AfterWoundResolution
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
```

### `resolveSaveRolls`

```yaml
resolveSaveRolls:
  params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  body:
    - event: BeforeSaveRolls
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: SaveDiceRolled
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: BeforeSaveRerolls
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: SaveRerollsResolved
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: SaveDiceEvaluated
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: OnFailedSave
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: AfterSaveResolution
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
```

### `resolveDamage`

```yaml
resolveDamage:
  params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
  body:
    - event: BeforeDamageAllocation
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: AfterDamageAllocation
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: BeforeFeelNoPain
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    - event: AfterFeelNoPain
      params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
```

---

## 13. Worked Roll Example — Hit Resolution

One complete path through the `resolveHitRolls` sub-sequence, showing how pure pack rules drive every step.

**Setup:** Attacker unit `u_attacker` has WS 3+, abilities ["Lethal Hits", "Sustained 1"], 4 attacks. The `currentAttack.hitRolls` array and `hitSummary` are in state.

### Step 1: `BeforeHitRolls` — Set defaults and roll dice

**Rule: CORE.Attack.HitDefaults.1** (priority 10)
```json
{
  "effect": [
    { "setValue": { "path": "$.currentAttack.hitSummary.critThreshold", "value": 6 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.threshold", "value": 3 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.mods", "value": 0 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.reroll", "value": "none" } },
    { "setValue": { "path": "$.currentAttack.hitSummary.hits", "value": 0 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.critHits", "value": 0 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.autoWounds", "value": 0 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.spawnedHits", "value": 0 } }
  ]
}
```

**Rule: CORE.Attack.HitThreshold.FromWS.1** (priority 15)
```json
{
  "effect": [
    { "setValue": { "path": "$.currentAttack.hitSummary.threshold", "valueFromPath": "$.units.u_attacker.profiles.melee.WS" } }
  ]
}
```

**Rule: CORE.Attack.HitRoll.Execute.1** (priority 20)
```json
{
  "effect": [
    { "roll": { "count": { "path": "$.currentAttack.attackCount" }, "sides": 6, "storePath": "$.currentAttack.hitRolls" } }
  ]
}
```

State after: `hitRolls = [2, 6, 4, 1]` (example with seed), threshold = 3, critThreshold = 6.

### Step 2: `HitDiceRolled`

No pack rules needed — the engine wrote the raw array in the previous step. Rules could hook here for "on roll" triggers if needed.

### Step 3: `BeforeHitRerolls`

No reroll rules in this example (`reroll: "none"`). If a reroll ability were active, a rule here would flag indices.

### Step 4: `HitRerollsResolved`

No indices flagged, no rerolls occur.

### Step 5: `HitDiceEvaluated`

**Rule: CORE.Attack.HitEvaluate.1** (priority 10)
Compares each die in `hitRolls` against `threshold` and `critThreshold`:
- Die 2: miss (2 < 3)
- Die 6: critical hit (6 >= 6)
- Die 4: hit (4 >= 3, 4 < 6)
- Die 1: miss (1 < 3)

```json
{
  "effect": [
    { "setValue": { "path": "$.currentAttack.hitSummary.hits", "value": 1 } },
    { "setValue": { "path": "$.currentAttack.hitSummary.critHits", "value": 1 } }
  ]
}
```

### Step 6: `OnNaturalCritHit` — fires once per critical hit

**Rule: CORE.Attack.CritHit.LethalHits.1** (priority 40)
```json
{
  "when": { "all": [{ "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Lethal Hits" } }] },
  "effect": [{ "modifyCounter": { "path": "$.currentAttack.hitSummary.autoWounds", "delta": 1 } }]
}
```

**Rule: CORE.Attack.CritHit.Sustained1.1** (priority 40)
```json
{
  "when": { "all": [{ "pathIn": { "path": "$.units.u_attacker.abilities", "value": "Sustained 1" } }] },
  "effect": [{ "modifyCounter": { "path": "$.currentAttack.hitSummary.spawnedHits", "delta": 1 } }]
}
```

State after: `autoWounds = 1`, `spawnedHits = 1`.

### Step 7: `AfterHitResolution`

**Rule: CORE.Attack.HitTally.1** (priority 10)
Tallies final count: 1 normal hit + 1 spawned hit = 2 hits proceeding to wound rolls. Plus 1 auto-wound bypassing wound rolls entirely.

### Summary

| Die | Raw | Result | Ability trigger |
|---|---|---|---|
| 1 | 2 | Miss | — |
| 2 | 6 | Crit hit | Lethal Hits (+1 auto-wound), Sustained 1 (+1 hit) |
| 3 | 4 | Hit | — |
| 4 | 1 | Miss | — |

Final: 2 hits proceed to wound rolls, 1 auto-wound bypasses wound rolls.

---

## 14. Rulelet Shape

A rulelet should follow this schema:

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

### Fields

| Field | Description |
|---|---|
| `id` | Stable rule identifier. Convention: `PACK.Category.Name.Version` |
| `scope` | One of: `global`, `player`, `entity`, `unit`, `attack` |
| `trigger` | Event that activates this rule |
| `when` | Additional predicates (Section 8) |
| `effect` | Array of effect verbs (Section 9) |
| `precedence.priority` | Numeric priority. Low fires first, high fires last. |
| `precedence.strategy` | One of: `stack`, `override`, `patch` |
| `provenance` | Source traceability metadata |

### Strategy values

- **`stack`** — Rule applies alongside other rules in the same domain. This is the default.
- **`override`** — Only the highest-priority rule in this domain applies. Two override rules at the same priority on the same domain = pack validation error.
- **`patch`** — Applies after stack/override resolution. Used for targeted modifications by specific reason key or path.

### Effect expiry

The `expiresOn` field belongs on **individual effects** (e.g., `applyStatus`), not on the rule itself. Rules are persistent — they are always loaded and always evaluated. Effects may be temporary.

---

## 15. Pack Dependencies

### Load order

Dependencies are loaded first, in declared order. A pack can depend on other packs.

### Merge behavior

- **Manifests:** Validated for compatibility.
- **Glossaries:** Keywords, reason keys, and selectors merge. Duplicates with identical definitions are allowed; conflicting duplicates are a load error.
- **Rules:** All rules from all packs are loaded. Conflict resolution (Section 10) handles interactions via priority and strategy.
- **Timeline:** The base pack defines the timeline structure. Dependent packs **cannot replace** the base timeline — they may only extend it at named insertion points declared by the base pack.

### Override and patch semantics

Later packs may:
- **Add** new rules that stack with existing ones
- **Override** existing domains using higher-priority override rules
- **Patch** specific reason keys or paths using patch-strategy rules

---

## 16. Engine Components

### 16.1 State Manager
- Immutable or copy-on-write snapshots
- Effect application
- Snapshot/restore
- Path resolution and validation

### 16.2 Event Sequencer
- Reads timeline node tree
- Walks nodes recursively (sequence, repeat, forEach, subSequence)
- Emits events in order
- Emits system events (Section 6)

### 16.3 Rule Executor
- Indexes rules by trigger event
- Evaluates conditions (Section 8)
- Groups by conflict domain
- Applies conflict resolution (Section 10)
- Executes effects (Section 9)

### 16.4 Choice Orchestrator
- Manages choice lifecycle (Section 11)
- Enumerates legal choices
- Validates selected choice
- Explains why choices are blocked (reason keys)

### 16.5 RNG Subsystem
- Seeded
- Reproducible
- Logs roll path and result

### 16.6 Logger

Append-only log entries for:
- Event start/end
- Rules fired (with predicate results)
- Choices offered/selected/expired
- Effects applied
- Random outcomes
- Reason keys added/removed

---

## 17. Minimal API Expectations

The engine should expose functions equivalent to:

- `loadPack(path)` — Load, validate, and merge a pack. Returns validation errors or a loaded pack.
- `initializeState(pack, overrides?)` — Create initial state from pack, with optional overrides.
- `advanceToNextEvent(state)` — Step the timeline forward one event.
- `enumerateChoices(state, event)` — List all currently legal choices.
- `applyChoice(state, choiceId, args?, seed?)` — Apply a player's choice.
- `whyNot(state, proposedChoice)` — Explain why a choice is blocked (returns reason keys and rule IDs).
- `snapshot(state)` — Serialize current state.
- `restore(snapshot)` — Deserialize state.
- `simulate(state, policy, horizon, seed)` — Run forward with a decision policy.

---

## 18. Output Expectations for a First Implementation

A first implementation should include:

1. Core engine library (Sections 5-11, 16)
2. Pack loader with load-time validation (Sections 4, 8, 9, 15)
3. A generic demo pack ("Hello Pack" — Part II)
4. A richer example pack demonstrating 40K-style requirements (Part III)
5. Schema validation
6. Scenario tests with fixed seeds
7. Documentation

---

# Part II — Generic Reference Pack ("Hello Pack")

This pack proves the loop without referencing any specific game.

## `manifest.yaml`

```yaml
id: hello-pack
name: Hello Pack
version: 0.2.0
engine_version: ^0.2.0
dependencies: []
```

## `timeline.yaml`

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
              - sequence:
                  - event: MainPhaseStarted
                    params: [player]
                  - event: MainPhaseEnded
                    params: [player]
              - event: TurnEnded
                params: [player]

        - event: RoundEnded
          params: [round]

  - event: EndOfGame

subSequences: {}
```

## `glossary.yaml`

```yaml
keywords: []

reason_keys: {}

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
  "totalRounds": 3,
  "turnNumber": 1,
  "turnPlayer": "A",
  "players": ["A", "B"],
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
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  }
]
```

---

# Part III — 40K-Capable Example Pack

The goal of this example is **not** to fully encode 40K. The goal is to show the kind of data shape that can support 40K-style requirements.

This example demonstrates:
- phases as events with structured timeline nodes
- choices with cost pre-computation and lifecycle
- state-based restrictions with typed predicates
- reason-based eligibility
- overrides via patches
- attack micro-events via roll sub-sequences
- hit/wound/save/damage resolution through data
- cleanup via future events

## 1. `manifest.yaml`

```yaml
id: wh40k-example-pack
name: Warhammer 40,000 Example Pack
version: 0.2.0
engine_version: ^0.2.0
dependencies: []
```

## 2. `timeline.yaml`

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

              - sequence:
                  - event: CommandPhaseStarted
                    params: [player]
                  - event: CommandPhaseEnded
                    params: [player]

              - sequence:
                  - event: MovementPhaseStarted
                    params: [player]
                  - event: UnitAdvanced
                    params: [player, unitId]
                  - event: UnitFellBack
                    params: [player, unitId]
                  - event: MovementPhaseEnded
                    params: [player]

              - sequence:
                  - event: ShootingPhaseStarted
                    params: [player]
                  - event: ShootingPhaseEnded
                    params: [player]

              - sequence:
                  - event: ChargePhaseStarted
                    params: [player]
                  - event: ChargeDeclarationsEnded
                    params: [player]
                  - event: ChargePhaseEnded
                    params: [player]

              - sequence:
                  - event: FightPhaseStarted
                    params: [player]
                  - forEach:
                      over: { kind: "unit", from: "$.eligibleFighters" }
                      bindParam: attackerUnitId
                      body:
                        - event: FightActivationStarted
                          params: [player, attackerUnitId]

                        # defenderUnitId and weaponProfileId are resolved by
                        # choice selection during FightActivationStarted.
                        # The forEach below iterates over weapon profiles
                        # chosen for this activation.
                        - forEach:
                            over: { kind: "weaponActivation", from: "$.currentFightActivation.weaponTargetPairs" }
                            bindParams: [defenderUnitId, weaponProfileId]
                            body:
                              - event: BeforeAttackCount
                                params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
                              - event: AfterAttackCount
                                params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

                              - subSequence: resolveHitRolls
                                params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
                              - subSequence: resolveWoundRolls
                                params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
                              - subSequence: resolveSaveRolls
                                params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
                              - subSequence: resolveDamage
                                params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

                        - event: FightActivationEnded
                          params: [player, attackerUnitId]
                  - event: FightPhaseEnded
                    params: [player]

              - sequence:
                  - event: EndPhaseStarted
                    params: [player]
                  - event: EndPhaseEnded
                    params: [player]

              - event: TurnEnded
                params: [player]

        - event: RoundEnded
          params: [round]

  - event: EndOfGame

subSequences:
  resolveHitRolls:
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    body:
      - event: BeforeHitRolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: HitDiceRolled
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: BeforeHitRerolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: HitRerollsResolved
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: HitDiceEvaluated
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: OnNaturalCritHit
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: AfterHitResolution
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

  resolveWoundRolls:
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    body:
      - event: BeforeWoundRolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: WoundDiceRolled
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: BeforeWoundRerolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: WoundRerollsResolved
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: WoundDiceEvaluated
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: OnNaturalCritWound
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: AfterWoundResolution
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

  resolveSaveRolls:
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    body:
      - event: BeforeSaveRolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: SaveDiceRolled
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: BeforeSaveRerolls
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: SaveRerollsResolved
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: SaveDiceEvaluated
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: OnFailedSave
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: AfterSaveResolution
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]

  resolveDamage:
    params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
    body:
      - event: BeforeDamageAllocation
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: AfterDamageAllocation
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: BeforeFeelNoPain
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
      - event: AfterFeelNoPain
        params: [player, attackerUnitId, defenderUnitId, weaponProfileId]
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
  "totalRounds": 5,
  "round": 1,
  "turnPlayer": "A",
  "players": ["A", "B"],
  "resources": {
    "A": { "cp": 1 },
    "B": { "cp": 1 }
  },
  "armyStatuses": {
    "A": [],
    "B": []
  },
  "usage": {},
  "eligibleFighters": [],
  "currentFightActivation": {
    "weaponTargetPairs": []
  },
  "units": {
    "u_attacker": {
      "id": "u_attacker",
      "owner": "A",
      "name": "Attacker Unit",
      "keywords": ["INFANTRY"],
      "statuses": {},
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
      "statuses": {},
      "abilities": [],
      "profiles": {},
      "stats": {
        "T": 4,
        "Sv": 4
      }
    }
  },
  "currentAttack": {
    "attackCount": 0,
    "hitRolls": [],
    "hitSummary": {
      "threshold": 3,
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
    },
    "saveRolls": [],
    "saveSummary": {
      "threshold": 4,
      "mods": 0,
      "reroll": "none",
      "failedSaves": 0
    },
    "damageSummary": {
      "totalDamage": 0,
      "damageAfterFnp": 0
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
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 13 }
  },
  {
    "id": "CORE.Shoot.FallBack.Prohibit.1",
    "scope": "unit",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": {
      "all": [
        { "hasStatus": { "target": { "selector": "active_player_units" }, "key": "fell_back" } }
      ]
    },
    "effect": [
      {
        "addProhibition": {
          "target": { "selector": "active_player_units" },
          "action": "shoot",
          "reason": "fell_back"
        }
      }
    ],
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 14 }
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
    "precedence": { "priority": 90, "strategy": "patch" },
    "provenance": { "source": "Example faction rule" }
  }
]
```

### 5.4 Overwatch example (state-driven)

```json
[
  {
    "id": "CORE.Stratagem.Overwatch.1",
    "scope": "player",
    "trigger": { "event": "ChargeDeclarationsEnded" },
    "when": {
      "all": [
        { "resourceAtLeast": {
            "player": { "eventParam": "player" },
            "resource": "cp",
            "amount": 1
        }}
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "overwatch",
          "label": "Use Overwatch (1 CP)",
          "actionRef": "CORE.Stratagem.Overwatch.Resolve.1",
          "costs": { "cp": 1 }
        }
      }
    ],
    "precedence": { "priority": 60, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  },
  {
    "id": "CORE.Stratagem.Overwatch.Resolve.1",
    "scope": "player",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "overwatch" } }
      ]
    },
    "effect": [
      {
        "consumeUsage": {
          "scope": "player",
          "key": "overwatch_used_this_phase"
        }
      },
      {
        "appendLogNote": { "message": "Overwatch fired" }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  }
]
```

The `resourceAtLeast` predicate prevents the choice from being offered when CP is insufficient. The engine's cost pre-computation provides a second layer of guarantee — choices with costs that the player cannot afford are suppressed at offer time. Usage tracking (`consumeUsage`) prevents repeat use within a phase.

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
      { "setValue": { "path": "$.currentAttack.hitSummary.threshold", "value": 3 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.mods", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.reroll", "value": "none" } },
      { "setValue": { "path": "$.currentAttack.hitSummary.hits", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.critHits", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.autoWounds", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.hitSummary.spawnedHits", "value": 0 } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core defaults" }
  }
]
```

#### 5.5.3 Hit threshold from weapon skill

```json
[
  {
    "id": "CORE.Attack.HitThreshold.FromWS.1",
    "scope": "attack",
    "trigger": { "event": "BeforeHitRolls" },
    "when": { "all": [] },
    "effect": [
      {
        "setValue": {
          "path": "$.currentAttack.hitSummary.threshold",
          "valueFromPath": "$.units.u_attacker.profiles.melee.WS"
        }
      }
    ],
    "precedence": { "priority": 15, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  }
]
```

#### 5.5.4 Roll dice for hits

```json
[
  {
    "id": "CORE.Attack.HitRoll.Execute.1",
    "scope": "attack",
    "trigger": { "event": "BeforeHitRolls" },
    "when": { "all": [] },
    "effect": [
      {
        "roll": {
          "count": { "path": "$.currentAttack.attackCount" },
          "sides": 6,
          "storePath": "$.currentAttack.hitRolls"
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  }
]
```

#### 5.5.5 Crit threshold from abilities

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
    "precedence": { "priority": 25, "strategy": "override" },
    "provenance": { "source": "Example attack ability" }
  }
]
```

#### 5.5.6 Lethal Hits as data

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
    "precedence": { "priority": 40, "strategy": "stack" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

#### 5.5.7 Sustained Hits as data

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
    "precedence": { "priority": 40, "strategy": "stack" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

#### 5.5.8 Wound step defaults

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
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core defaults" }
  }
]
```

#### 5.5.9 Anti-X affects critical wound threshold

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
    "precedence": { "priority": 30, "strategy": "override" },
    "provenance": { "source": "Weapon or unit ability" }
  }
]
```

#### 5.5.10 Devastating Wounds as data

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
- apply status `advanced_move` (on `UnitAdvanced`)
- later add prohibition `charge: advanced_move` (on `ChargePhaseStarted`)
- later remove that status and prohibition (on `TurnEnded`)

## 2. Use events instead of vague durations

Instead of:
- "until the end of the turn"

prefer:
- `expiresOn: TurnEnded`

## 3. Encode exceptions as patches, not special code

If a faction or upgrade overrides a general rule:
- do not hardcode that in the engine
- write a higher-priority rule with `strategy: "patch"` that removes a specific reason key

## 4. Encode attack keywords as event-triggered data

Critical hits and wounds should not be special-cased per keyword in the engine.
The engine should only know:
- an event happened
- rules on that event can modify counters or thresholds

Use the roll sub-sequences (Section 12) to structure the dice pipeline.

## 5. Make blocked choices explainable

Every blocked choice should produce a list of reason keys and contributing rule ids. The `whyNot` API (Section 17) returns this information.

---

# Part V — Recommended First Implementation Milestones

## Milestone 1

Implement engine core with:
- State manager with path resolution (Section 16.1)
- Timeline walker supporting all five node types (Section 5)
- Rule matching and predicate evaluation (Sections 8, 16.3)
- Choices with lifecycle (Section 11)
- Statuses and prohibitions (Section 9.1, 9.2)
- Cleanup via event-triggered rules
- System events (Section 6)
- Conflict resolution (Section 10)

Validate with Hello Pack.

## Milestone 2

Add choice costs:
- Choice cost pre-computation (suppress unaffordable choices at offer time)
- Auto-deduct costs on choice selection
- Overwatch example using pure state + events

Validate with overwatch example using state-driven rules.

## Milestone 3

Add roll sub-sequences and RNG:
- Roll verb implementation (Section 9.3)
- Sub-sequence walker (Section 5.5)
- Hit/wound/save/damage pipelines (Section 12)

Validate with attack micro-pipeline and worked roll example (Section 13).

## Milestone 4

Add explainability and scenario replay:
- `whyNot` API for blocked choices
- Full append-only logging (Section 16.6)
- Scenario tests with fixed seeds
- Snapshot/restore

---

# Part VI — Summary

This specification defines a **game-independent SSCC engine** that can run sophisticated packs, including a 40K-like system.

The important design choices are:

- **State-first** rules — initial state defines the schema contract
- **Event-driven** sequencing — finite, parameterized timeline with five node types
- **Reason-based** eligibility — every prohibition carries a machine-readable reason key
- **Data-defined** critical behaviors — attack keywords as event-triggered pack rules
- **Cleanup by event** — temporary effects expire on named future events
- **Engine-agnostic** effect verbs — closed set with typed schemas and conflict domains
- **Load-time validation** — all paths, selectors, predicates, and cross-references checked before the game starts
- **Conflict resolution** — stack/override/patch strategies with deterministic priority ordering
- **Choice lifecycle** — offered/selected/resolved/expired with full explainability

The example files in this document are not meant to be complete rule implementations. They capture the **requirements and shape** of a 40K-capable data-driven system.
