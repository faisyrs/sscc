# SSCC Engine Milestone 2 -- Design Spec

**Date:** 2026-04-03
**Scope:** Remove windows, add choice cost pre-computation
**Branch:** milestone2

---

## 1. What Milestone 2 Includes

1. **Remove the window concept** from the engine, spec, and pack data
2. **Choice cost pre-computation** -- suppress unaffordable choices at offer time
3. **Auto-deduct costs** on choice selection as a safety guarantee
4. **Overwatch integration test** using pure state + events (no windows)

## What Milestone 2 Does NOT Include

- Roll sub-sequences and RNG (Milestone 3)
- `whyNot` API (Milestone 4)
- Snapshot/restore (Milestone 4)

---

## 2. Remove Windows

### Why

Windows are redundant in the SSCC paradigm. The engine is event-driven --
nothing happens between events. A "window" is just boolean state that is set
at one event and cleared at another. The existing state + predicate system
already handles this:

- `setValue` to set a flag at the "open" event
- `pathEquals` to check the flag when offering choices
- `setValue` to clear the flag at the "close" event
- `expiresOn` on statuses to auto-expire at the close event

### Changes

**Types (`types/rules.ts`):**
- Remove `"window"` from `RuleScope` union

**Types (`types/pack.ts`):**
- Remove `windows` field from timeline YAML parsing (ignore if present for
  backwards compatibility, but do not require)

**Predicates (`rules/predicates.ts`):**
- No changes needed (windowOpen/windowClosed were never implemented)

**Effects (`rules/effects.ts`):**
- No changes needed (openWindow/closeWindow were never implemented)

**Loader (`loader/validation.ts`):**
- Remove any window-related validation if present

**Spec (`SSCC_ENGINE_SPECIFICATION.md`):**
- Remove Section 9.4 "Event and Window Control" (openWindow, closeWindow)
- Remove `windowOpen`/`windowClosed` from predicate table (Section 8)
- Remove `expiresOnWindowClose` from choice instance fields (Section 11)
- Remove `windowId` from `ChoiceSelected` event params (Section 6)
- Remove `"window"` from rule scope values (Section 14)
- Replace Section 5.4 "Reaction window example" with state-driven overwatch
- Update Section 16.2 to remove "Opens/closes windows"
- Update the design philosophy notes as needed

**Pack data (`packs/wh40k-10e-core-turn/`):**
- Remove `windows: []` from timeline.yaml (or leave as empty, ignored)
- Remove `"windows": {}` from initial_state.json

---

## 3. Choice Cost Pre-Computation

### Problem

Without cost checking at offer time, the engine may offer a choice the
player cannot afford. This creates a bad UX: "here's a choice -- oh wait,
you can't actually take it."

### Solution

When an `addChoice` effect fires with a `costs` field:

1. **Resolve the player** from the event context (the event's `player`
   param, or the source rule's scope)
2. **Check each cost** against the player's resources in current state
3. **If the player cannot afford any cost, suppress the choice** -- do not
   add it to the active choices list

This means: every offered choice is guaranteed affordable at the moment
it was offered.

### On selection (safety deduction)

When `applyChoice` is called for a choice that has costs:

1. **Re-verify** the player can still afford the costs (state may have
   changed between offer and selection if multiple choices are pending)
2. **Deduct costs** from the player's resources before emitting the
   `ChoiceSelected` event
3. **If no longer affordable**, reject the selection (throw or return error)

### Implementation location

The cost check on offer happens in `engine/index.ts` in `evaluateEvent`,
after the effect executor returns a new choice but before adding it to
state. The cost deduction on selection happens in `applyChoice`.

### Cost format

The `costs` field on `addChoice` is `Record<string, number>`:

```json
{ "costs": { "cp": 1 } }
```

Each key is a resource name, each value is the amount to spend. The engine
looks up `$.resources.<playerId>.<resourceKey>` to check affordability.

---

## 4. Overwatch Without Windows

The overwatch example rewrites to pure SSCC:

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

No window open/close rules needed. The `resourceAtLeast` predicate
naturally prevents the choice from being offered when CP is insufficient.
The cost pre-computation provides a second layer of guarantee. Usage
tracking (`consumeUsage`) prevents repeat use within a phase.

---

## 5. Testing Strategy

### Unit tests

- **Cost pre-computation:** addChoice with costs, player can afford -> choice
  offered. Player cannot afford -> choice suppressed.
- **Cost deduction on selection:** selecting a choice with costs deducts
  resources. Selecting when no longer affordable -> rejection.

### Integration test

**Overwatch scenario:**
1. Load a test pack with overwatch rules (from Section 4 above)
2. Player A has 1 CP at ChargeDeclarationsEnded
3. Overwatch choice is offered
4. Select overwatch -> CP deducted to 0, usage consumed
5. Advance to next event -> no more overwatch offered (0 CP)
6. Verify log shows overwatch fired, CP at 0

**Zero CP scenario:**
1. Player A has 0 CP
2. Advance to ChargeDeclarationsEnded
3. Overwatch choice is NOT offered (cost pre-computation suppressed it)

---

## 6. Files Changed

| File | Change |
|---|---|
| `engine/src/types/rules.ts` | Remove `"window"` from RuleScope |
| `engine/src/types/choices.ts` | Add `costs` field to ChoiceInstance |
| `engine/src/rules/effects.ts` | Return costs in EffectResult for addChoice |
| `engine/src/engine/index.ts` | Cost check on offer, cost deduction on selection |
| `engine/src/choices/index.ts` | Store costs on ChoiceInstance |
| `engine/src/loader/validation.ts` | Remove window validation if any |
| `engine/tests/unit/engine-costs.test.ts` | Cost pre-computation tests |
| `engine/tests/integration/overwatch.test.ts` | Overwatch scenario |
| `packs/wh40k-10e-core-turn/timeline.yaml` | Remove windows line |
| `packs/wh40k-10e-core-turn/initial_state.json` | Remove windows field |
| `SSCC_ENGINE_SPECIFICATION.md` | Remove window sections, update examples |
