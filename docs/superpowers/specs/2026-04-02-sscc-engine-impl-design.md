# SSCC Engine Implementation -- Design Spec

**Date:** 2026-04-02
**Scope:** Milestone 1 -- core engine in TypeScript, enough to run Hello Pack and wh40k-10e-core-turn skeleton pack
**Language:** TypeScript
**Architecture:** Single package, layered modules with strict interfaces

---

## 1. What Milestone 1 Includes

From SSCC Engine Specification Part V:

- State manager with path resolution
- Timeline walker supporting all five node types (event, sequence, repeat, forEach, subSequence)
- Rule matching and predicate evaluation
- Choices with lifecycle (offered -> selected -> resolved | expired)
- Statuses and prohibitions
- Cleanup via event-triggered rules
- System events (ChoiceSelected, ChoiceAdded, ChoiceResolved, ChoiceExpired)
- Conflict resolution (stack/override/patch)
- Status expiry (engine-managed `expiresOn`)
- Pack loader with load-time validation
- Append-only logger for explainability

## What Milestone 1 Does NOT Include

- Choice costs and resource spending
- Roll sub-sequences and RNG (`roll` effect verb)
- `whyNot` API
- Snapshot/restore
- `simulate` API

---

## 2. Project Structure

```text
engine/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    types/
      index.ts         -- re-exports all types
      pack.ts          -- Pack file schema types (timeline, glossary, rules, manifest)
      state.ts         -- State, StatusEntry, path resolution types
      events.ts        -- Event, EventParams types
      rules.ts         -- Rule, Predicate, Effect, Precedence, Provenance types
      choices.ts       -- Choice, ChoiceInstance, ChoiceState types
    loader/
      index.ts         -- loadPack(): reads files, validates, returns LoadedPack
      timeline.ts      -- parse + validate timeline.yaml
      glossary.ts      -- parse + validate glossary.yaml
      rules.ts         -- parse + validate rules.json
      state.ts         -- parse + validate initial_state.json
      validation.ts    -- cross-reference checks (events, selectors, paths, actionRefs)
    state/
      index.ts         -- StateManager: get, set, applyStatus, removeStatus, expireStatuses
    sequencer/
      index.ts         -- EventSequencer: walks timeline node tree, yields events
    rules/
      index.ts         -- RuleExecutor: match, evaluate, resolve, execute
      predicates.ts    -- one evaluator per predicate type
      effects.ts       -- one executor per effect verb
      conflicts.ts     -- conflict resolution algorithm
    choices/
      index.ts         -- ChoiceManager: add, select, expire, enumerate
    engine/
      index.ts         -- SSCCEngine: top-level orchestrator, public API
    logger/
      index.ts         -- Logger: append-only event/rule/effect/choice log
  tests/
    unit/
      state.test.ts
      predicates.test.ts
      effects.test.ts
      conflicts.test.ts
      choices.test.ts
      sequencer.test.ts
    integration/
      hello-pack.test.ts
      wh40k-turn.test.ts
```

### Dependency direction

```text
engine -> sequencer -> rules -> state
                    -> choices -> state
          loader (standalone, used at init)
          logger (standalone, used everywhere via injection)
          types (shared, no dependencies)
```

Each module exports only through its `index.ts`. Internal types stay internal.

---

## 3. Core Types

### State

An immutable JSON-compatible object. Every mutation returns a new state object
(structural sharing via spread).

Paths are JSONPath-like strings: `$.activation.unitId`, `$.resources.A.cp`.

Statuses on entities are stored as objects, not arrays:

```typescript
// On a unit in state:
statuses: {
  "can_move": { expiresOn: null },
  "advanced_move": { expiresOn: "TurnEnded" }
}
```

This allows the engine to track expiry metadata per status.

### Event

```typescript
interface GameEvent {
  id: string;              // e.g., "MovementPhaseStarted"
  params: Record<string, unknown>;  // e.g., { player: "A" }
}
```

Timeline events and rule-emitted events are the same type.

### Rule

Matches the SSCC spec Section 14 rulelet schema:

```typescript
interface Rule {
  id: string;
  scope: "global" | "player" | "entity" | "unit" | "attack";
  trigger: { event: string };
  when: PredicateNode;
  effect: Effect[];
  precedence: { priority: number; strategy: "stack" | "override" | "patch" };
  provenance: { source: string; page?: number; note?: string };
}
```

### Predicate

Discriminated union. Each predicate type has its own shape:

```typescript
type PredicateNode =
  | { all: PredicateNode[] }
  | { any: PredicateNode[] }
  | { not: PredicateNode }
  | { hasStatus: { target: TargetRef; key: string } }
  | { missingStatus: { target: TargetRef; key: string } }
  | { pathEquals: { path: string; value?: unknown; valueFromEventParam?: string } }
  | { pathIn: { path: string; value: unknown } }
  | { pathAtLeast: { path: string; value: number } }
  | { pathMissing: { path: string } }
  | { resourceAtLeast: { player: PlayerRef; resource: string; amount: number } }
  | { eventParamEquals: { param: string; value: unknown } }
  | { counterAtLeast: { path: string; value: number } }
  | { counterEquals: { path: string; value: number } }
  | { tagPresent: { target: TargetRef; tag: string } }
  | { selector: { id: string } };
```

### Effect

Discriminated union. Each effect verb has its own shape:

```typescript
type Effect =
  | { applyStatus: { target: TargetRef; key: string; expiresOn?: string } }
  | { removeStatus: { target: TargetRef; key: string } }
  | { setValue: { path: string; value?: unknown; valueFromPath?: string; valueFromEventParam?: string } }
  | { modifyCounter: { path: string; delta?: number; deltaFromPath?: string } }
  | { addProhibition: { target: TargetRef; action: string; reason: string } }
  | { removeProhibition: { target: TargetRef; action: string; reason: string } }
  | { addChoice: { id: string; label: string; actionRef: string; limits?: object; costs?: object; selectionFrom?: TargetRef } }
  | { consumeUsage: { scope: string; key: string } }
  | { resetUsage: { scope: string; keys: string[] } }
  | { emit: { eventId: string; params?: Record<string, unknown> } }
  | { award: { target: PlayerRef; resource: string; amount: number } }
  | { spendResource: { target: PlayerRef; resource: string; amount: number } }
  | { appendLogNote: { message: string } }
  | { ensureExists: { path: string; defaultValue: unknown } }
  | { mergeInto: { path: string; value: object } };
```

Note: `roll` is excluded from Milestone 1.

### Choice

```typescript
interface ChoiceInstance {
  choiceInstanceId: string;
  choiceId: string;
  label: string;
  actionRef: string;
  player: string;
  sourceRuleId: string;
  createdAtEvent: string;
  state: "offered" | "selected" | "resolved" | "expired" | "cancelled";
  selectionFrom?: TargetRef;
}
```

### LoadedPack

```typescript
interface LoadedPack {
  manifest: Manifest;
  timeline: TimelineNode[];
  subSequences: Record<string, SubSequence>;
  glossary: Glossary;
  rules: Rule[];
  rulesByEvent: Map<string, Rule[]>;   // indexed at load time
  initialState: State;
  allEventIds: Set<string>;            // timeline + emit, for validation
}
```

---

## 4. Component Interfaces

### StateManager

```typescript
get(state: State, path: string): unknown;
set(state: State, path: string, value: unknown): State;
applyStatus(state: State, entityId: string, key: string, expiresOn?: string): State;
removeStatus(state: State, entityId: string, key: string): State;
expireStatuses(state: State, eventId: string): State;
getStatuses(state: State, entityId: string): Record<string, StatusEntry>;
```

All return new state objects. Never mutate.

### EventSequencer

```typescript
// Generator that yields timeline events in order.
// For repeat/forEach, reads counts/sets from state at iteration time.
function* walkTimeline(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  getState: () => State
): Generator<GameEvent>;
```

The sequencer is a generator. The engine calls `next()` to get the next
timeline event. Between calls, the engine processes the event (rules, choices,
emitted events). The generator reads state when it needs to evaluate `repeat`
counts or `forEach` sets.

The sequencer does NOT handle rule-emitted events. Those are processed
recursively by the engine before it calls `next()` again.

### RuleExecutor

```typescript
evaluate(
  state: State,
  event: GameEvent,
  rules: Rule[],
  glossary: Glossary
): EvaluationResult;

interface EvaluationResult {
  matchedRules: Rule[];
  resolvedEffects: Effect[];
  predicateResults: Map<string, boolean>;  // for logging
}
```

Internally calls predicates.ts to evaluate `when` clauses, conflicts.ts to
resolve conflicts, and returns the ordered list of effects to apply.

### Effect Executor

```typescript
executeEffect(
  state: State,
  effect: Effect,
  event: GameEvent,
  sourceRuleId: string
): EffectResult;

interface EffectResult {
  state: State;
  emittedEvents: GameEvent[];
  newChoices: ChoiceInstance[];
  logEntries: LogEntry[];
}
```

Each effect returns new state plus any side-effects (emitted events, choices).

### ChoiceManager

```typescript
addChoice(state: State, choice: ChoiceInstance): State;
selectChoice(state: State, choiceId: string, args?: Record<string, unknown>): {
  state: State;
  event: GameEvent;  // ChoiceSelected event to evaluate
};
expireAll(state: State): State;
getActiveChoices(state: State): ChoiceInstance[];
hasUnresolvedChoices(state: State): boolean;
```

### SSCCEngine (public API)

```typescript
interface SSCCEngine {
  loadPack(path: string): Promise<LoadedPack | ValidationError[]>;
  initializeState(pack: LoadedPack): State;
  advanceToNextEvent(state: State): { state: State; event: GameEvent } | null;
  enumerateChoices(state: State): ChoiceInstance[];
  applyChoice(state: State, choiceId: string, args?: Record<string, unknown>): State;
  getLog(): LogEntry[];
}
```

This is the external interface. Internally, the engine orchestrates the
evaluation loop.

---

## 5. Engine Evaluation Loop

The core loop is recursive, not queue-based. When a rule emits an event, the
engine evaluates it immediately (depth-first).

```text
evaluateEvent(state, event):
  state = expireStatuses(state, event.id)
  log(EventFired, event)

  effects = ruleExecutor.evaluate(state, event, rulesByEvent[event.id])
  log(RulesMatched, effects.matchedRules)

  emittedEvents = []
  newChoices = []

  for each effect in effects.resolvedEffects:
    result = executeEffect(state, effect, event, sourceRuleId)
    state = result.state
    emittedEvents.push(...result.emittedEvents)
    newChoices.push(...result.newChoices)
    log(EffectApplied, effect, result)

  // Add choices from this event's effects to state
  for each choice in newChoices:
    state = choiceManager.addChoice(state, choice)

  // Process emitted events immediately (depth-first, recursive).
  // Each emitted event may itself add choices and emit more events --
  // those are handled within the recursive call.
  for each emitted in emittedEvents:
    state = evaluateEvent(state, emitted)

  // After all emitted events are resolved, if choices are active,
  // the engine pauses here. The outer loop (advanceToNextEvent) checks
  // hasUnresolvedChoices and waits for applyChoice() to be called.

  return state
```

### Choice resolution flow

When the caller invokes `applyChoice(state, choiceId)`:

1. ChoiceManager marks the choice as "selected"
2. A `ChoiceSelected` event is created with params: choiceId, player, actionRef, selectedUnitId (if applicable)
3. The engine calls `evaluateEvent(state, choiceSelectedEvent)` -- recursive, depth-first
4. If the resulting rules emit more events or add more choices, those are resolved before returning
5. After resolution, the engine checks `hasUnresolvedChoices`:
   - If true: return state, wait for next `applyChoice()`
   - If false: the timeline sequencer advances to the next event

---

## 6. Pack Loader and Validation

The loader reads all pack files, parses YAML/JSON, and performs load-time
validation. All validation errors are collected before returning (not fail-fast).

### Load-time checks

1. **Schema validation:** Each file matches its expected structure
2. **Event cross-references:** Every `trigger.event` in rules exists in timeline events OR rule `emit` effects OR system events
3. **Selector cross-references:** Every selector used in rules exists in glossary
4. **ActionRef cross-references:** Every `addChoice.actionRef` points to a valid rule ID
5. **State path validation:** Every `path` in predicates and effects resolves against initial_state structure
6. **Duplicate detection:** No duplicate rule IDs
7. **Override conflict detection:** Two rules with `strategy: "override"`, same trigger, same conflict domain, same priority = validation error
8. **Status and reason key validation:** All status keys and reason keys referenced in effects exist in glossary

### Return type

```typescript
type LoadResult =
  | { ok: true; pack: LoadedPack }
  | { ok: false; errors: ValidationError[] };
```

---

## 7. Status Expiry

Statuses are stored as objects with optional `expiresOn`:

```typescript
interface StatusEntry {
  expiresOn: string | null;   // event ID, or null for rule-consumed
}

// In state, on a unit:
statuses: Record<string, StatusEntry>
```

At the start of every event evaluation (before rules fire), the engine calls
`expireStatuses(state, event.id)`. This scans all entities in state and removes
any status where `expiresOn` matches the current event ID.

This means rules firing at `TurnEnded` see `advanced_move` already gone (it
expired at the start of `TurnEnded` processing).

---

## 8. Conflict Resolution

Implements SSCC spec Section 10:

1. Collect rules matching the current event
2. Evaluate predicates, filter to matching rules
3. Group by conflict domain (derived from effects -- see spec Section 9)
4. Within each domain, apply strategy:
   - **stack**: all rules apply; reducible effects accumulate, singleton uses last-in-priority
   - **override**: highest priority wins; same-priority tie = load-time validation error
   - **patch**: applies after stack/override; modifies results by reason key or path
5. Execute resolved effects in ascending priority order (low fires first)

---

## 9. Testing Strategy

### Unit tests (focused on non-obvious logic)

- **State path resolution:** nested paths, null values, missing keys, array indexing
- **Status expiry:** expires matching event, doesn't expire non-matching, multiple entities, mixed expiry/non-expiry
- **Predicate composition:** `all` with mixed results, `any` short-circuit, nested `not`, empty `all` (vacuously true)
- **Conflict resolution:** two stack rules accumulate, override picks highest priority, patch modifies after stack
- **Choice lifecycle:** offer -> select -> resolve, offer -> expire, hasUnresolved after offer vs after select
- **Sequencer:** repeat reads count from state, forEach iterates set from state, subSequence resolves by name, empty forEach produces zero events

### Integration tests (the real value)

**Hello Pack end-to-end:**
- Load pack, run 3 rounds of 2-player turns
- On each `MainPhaseStarted`, select the "gain_coin" choice
- Verify final state: both players have 3 coins
- Verify log contains expected events in order

**WH40K skeleton turn:**
- Load pack, run 1 round of 1 player turn with scripted choices:
  - Movement: select u1, choose Advance
  - Shooting: verify u1 is NOT offered (prohibited by advanced_move)
  - Charge: verify u1 is NOT offered (prohibited by advanced_move)
- Verify state: u1 has `advanced_move` status, no `can_move`
- Verify CP was awarded

**WH40K choice-driven loop:**
- 2 units, both eligible to move
- Select u1 (Normal Move), verify u1 removed from eligible, u2 re-offered
- Select u2 (Advance), verify no more choices, engine advances to ShootingPhaseStarted
- Verify u2 has `advanced_move`, u1 does not

**Safety cleanup:**
- Artificially leave a `can_move` status on a unit at TurnEnded
- Verify the safety cleanup rule fires and logs a warning

### Test runner

Vitest. TypeScript-native, fast watch mode, good assertion library.

---

## 10. Dependencies

Minimal:

- `typescript` -- language
- `vitest` -- test runner
- `js-yaml` -- parse YAML files (timeline, glossary, manifest)

No framework. No build tool beyond `tsc`. The engine is a pure library with no
runtime dependencies beyond `js-yaml` for pack loading.

---

## 11. Initial State Schema Change

The `initial_state.json` format needs a change: unit statuses must be objects
(not arrays) to support expiry metadata.

Current:
```json
"statuses": []
```

New:
```json
"statuses": {}
```

When a status is applied:
```json
"statuses": {
  "can_move": { "expiresOn": null },
  "advanced_move": { "expiresOn": "TurnEnded" }
}
```

This change applies to both the initial_state.json file in the pack AND the
runtime state structure. The pack's initial_state starts with empty statuses
(`{}`); they are populated by rules at runtime.

The existing `initial_state.json` in the wh40k pack already uses `"statuses": {}`
at the top level, and unit-level statuses are `"statuses": []`. The unit-level
arrays need to become empty objects. This is a minor fix to the data pack.
