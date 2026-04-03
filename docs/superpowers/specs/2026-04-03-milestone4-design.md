# SSCC Engine Milestone 4 -- Design Spec

**Date:** 2026-04-03
**Scope:** Choice undo, snapshot/restore, RNG state management, enhanced logging

---

## 1. What Milestone 4 Includes

1. **RNG state save/restore** -- expose internal Mulberry32 state for snapshot
2. **Snapshot system** -- auto-snapshot before each `applyChoice`
3. **Choice undo with cascade** -- undo a choice and all subsequent choices
4. **Undo confirmation tiers** -- normal undo vs RNG-involved undo (requires confirm)
5. **Enhanced logging** -- fill Section 16.6 gaps
6. **Scenario replay tests** -- fixed-seed tests exercising undo

## What Milestone 4 Does NOT Include

- Selective undo (undo choice X, keep independent choices after X)
- `whyNot` API
- Forward simulation with decision policies

### Future: Selective Undo

M4's snapshot system stores choice ID + args alongside state and RNG,
which is the data selective undo would need. A future milestone can add
selective replay on top of the same snapshot stack: restore to before X,
skip X, replay subsequent choices, cascade-undo from the first one whose
conditions are no longer met.

---

## 2. RNG State Save/Restore

### Changes to SeededRNG

Add two methods to expose the internal Mulberry32 state:

```typescript
interface RNGSnapshot {
  seed: number;       // the original seed (for logging/debugging)
  internalState: number;  // the Mulberry32 `s` variable
}

class SeededRNG {
  // ... existing methods ...

  /** Capture the full RNG state for snapshot. */
  captureState(): RNGSnapshot;

  /** Restore RNG to a previously captured state. */
  restoreState(snapshot: RNGSnapshot): void;
}
```

`captureState` returns both the original seed and the internal `s`
variable. `restoreState` sets both, so the RNG produces the exact same
sequence it would have from that point forward.

### Why not just re-seed?

`reseed(seed)` resets to the beginning of a seed's sequence.
`restoreState` puts the RNG at an arbitrary point within a sequence --
wherever it was when the snapshot was taken. This is O(1) and exact.

---

## 3. Snapshot System

### ChoiceSnapshot

```typescript
interface ChoiceSnapshot {
  choiceInstanceId: string;  // which choice this snapshot precedes
  state: State;              // full game state before the choice
  rngState: RNGSnapshot;     // RNG state before the choice
  choiceId: string;          // what was chosen (for future selective replay)
  args?: Record<string, unknown>;  // choice args (for future selective replay)
  usedRNG: boolean;          // did this choice trigger RNG effects?
}
```

### Snapshot stack

The engine maintains a `private choiceHistory: ChoiceSnapshot[]` stack.

**On each `applyChoice` call:**

1. Push a snapshot: `{ state, rngState, choiceInstanceId, choiceId, args }`
2. Execute the choice (existing logic)
3. After execution, set `usedRNG` on the snapshot based on the
   `usedRNG` flag from effect results (see below)

**Stack lifecycle:**

- Grows with each `applyChoice`
- Trimmed on undo (pop entries from the undone choice onward)
- Cleared on `advanceToNextEvent` -- once the sequencer moves forward,
  past choices are committed and can no longer be undone

Clearing on advance is the key invariant: undo is only available within
a single pause point. Once the game moves to the next event, all
choices from the previous event are final.

### RNG tracking during effect execution

Rather than parsing log messages, add a simple flag to track RNG usage:

```typescript
// In executeEffect, when rng.nextInt is called:
// Set a flag on the effect result
interface EffectResult {
  // ... existing fields ...
  usedRNG: boolean;
}
```

The engine checks `effectResult.usedRNG` after executing effects for
a choice and sets the snapshot's `usedRNG` accordingly. If any effect
in the choice's evaluation chain used RNG, the snapshot is marked.

---

## 4. Choice Undo

### API

```typescript
interface UndoResult {
  success: boolean;
  /** Choices that were undone (the target + any cascade). */
  undoneChoices: string[];
  /** The restored state. */
  state: State;
}

class SSCCEngine {
  /**
   * Check if a choice can be undone and what confirmation is needed.
   *
   * Returns null if the choice cannot be undone (not in history).
   * Returns { requiresConfirm: false } for normal undo.
   * Returns { requiresConfirm: true, reason } for RNG-involved undo.
   */
  canUndoChoice(choiceInstanceId: string): UndoCheck | null;

  /**
   * Undo a choice and all choices made after it.
   *
   * If the choice (or any subsequent choice) involved RNG effects,
   * the caller must pass confirm: true. Without it, the method throws.
   *
   * Returns the list of undone choices and the restored state.
   */
  undoChoice(choiceInstanceId: string, options?: { confirm?: boolean }): UndoResult;
}

interface UndoCheck {
  requiresConfirm: boolean;
  reason?: string;
  /** How many choices will be undone (this one + cascade). */
  cascadeCount: number;
}
```

### Behavior

**`canUndoChoice(id)`:**

1. Find the snapshot with this `choiceInstanceId` in `choiceHistory`
2. If not found, return `null` (choice isn't in history -- either it
   never existed or the sequencer has advanced past it)
3. Check if this snapshot or any snapshot after it has `usedRNG: true`
4. Return `{ requiresConfirm, cascadeCount }`

**`undoChoice(id, options)`:**

1. Call `canUndoChoice(id)` -- throw if null
2. If `requiresConfirm` and `options?.confirm !== true`, throw
   `"Undo involves RNG effects -- pass { confirm: true } to proceed"`
3. Find the snapshot's index in the stack
4. Restore `this.state` from the snapshot's `state`
5. Restore `this.rng` from the snapshot's `rngState`
6. Collect all choice instance IDs from this index onward as `undoneChoices`
7. Truncate `choiceHistory` at this index (remove this snapshot and all after)
8. Log: `"undo: reverted to before choice {choiceId}, undid {N} choices"`
9. Return `{ success: true, undoneChoices, state }`

### Cascade behavior

Undoing choice X always undoes X and everything after X. This is the
safe default -- it guarantees consistency without needing to verify
whether subsequent choices are still valid.

### When undo is not available

- After `advanceToNextEvent` -- the snapshot stack is cleared
- For choices not in the stack (already committed or unknown ID)

### Log entries

Add a new log entry type:

```typescript
type LogEntryType =
  // ... existing types ...
  | "choice_undone";
```

On undo, log entries created by the undone choices are NOT removed
from the log. The log is append-only. Instead, an `"choice_undone"`
entry is appended listing which choices were reverted.

---

## 5. Enhanced Logging

Section 16.6 of the spec calls for logging:

| Category | Current Status | M4 Change |
|---|---|---|
| Event start/end | event_fired logged | No change needed |
| Rules fired (with predicate results) | rules_matched logged (rule IDs only) | Add predicate results per rule |
| Choices offered/selected/expired | All logged | No change needed |
| Effects applied | Logged as "note" from effects | Add structured effect_applied entries |
| Random outcomes | Logged in roll/reroll note messages | No change needed (covered by effect notes) |
| Reason keys added/removed | Not logged | Add logging for addProhibition/removeProhibition |

### 5.1 Predicate results per rule

Currently `evaluateEvent` logs a single `rules_matched` entry listing
all matched rule IDs. Change to log per-rule results, replacing the
bulk entry with individual entries:

```typescript
// In evaluateEvent, replace the existing rules_matched block with:
for (const [ruleId, matched] of evalResult.predicateResults) {
  this.logger.log(
    matched ? "rules_matched" : "rule_skipped",
    `Rule ${ruleId}: ${matched ? "matched" : "skipped"}`,
    { eventId: event.id, ruleId },
  );
}
```

Add `"rule_skipped"` to `LogEntryType`.

Note: this changes existing logging behavior. Existing tests that check
for a single `rules_matched` entry with multiple rule IDs will need
updating to expect per-rule entries instead.

### 5.2 Structured effect logging

Currently effects log free-text "note" messages. Add a structured
`"effect_applied"` log entry from the engine after each effect executes:

```typescript
this.logger.log("effect_applied", `Effect: ${Object.keys(resolvedEffect.effect)[0]}`, {
  eventId: event.id,
  ruleId: resolvedEffect.ruleId,
  data: { effect: resolvedEffect.effect },
});
```

This preserves the existing note-based messages from effects (for
human readability) while adding structured entries (for programmatic
access).

### 5.3 Prohibition logging

In `executeEffect`, when `addProhibition` or `removeProhibition`
effects fire, log the reason key:

```typescript
// Already handled by the general effect_applied logging above.
// The data field will contain the full effect object, including
// action and reason. No additional specific logging needed.
```

---

## 6. Engine Integration

### Constructor changes

None -- the constructor already accepts `{ seed?: number }`.

### New private fields

```typescript
private choiceHistory: ChoiceSnapshot[] = [];
```

### Modified `applyChoice`

Before existing logic:

```typescript
// Snapshot before choice
const snapshot: ChoiceSnapshot = {
  choiceInstanceId,
  state: this.state,
  rngState: this.rng.captureState(),
  choiceId: choice.choiceId,
  args,
  usedRNG: false,  // set after execution
};
```

After executing effects, check if RNG was used:

```typescript
// Track RNG usage from effect results
snapshot.usedRNG = /* true if any effect result had usedRNG */;
this.choiceHistory.push(snapshot);
```

### Modified `advanceToNextEvent`

Clear the snapshot stack when the caller advances past a pause point:

**Clear the stack when `advanceToNextEvent` is called and
`!hasUnresolvedChoices(this.state)`.** If the player explicitly
advances (no pending choices), past choices are committed.

```typescript
if (!hasUnresolvedChoices(this.state)) {
  this.choiceHistory = [];
}
```

### Exports

Export new types from `engine/src/index.ts`:

```typescript
export type { ChoiceSnapshot, UndoCheck, UndoResult } from "./engine/index.js";
```

---

## 7. Worked Example: Blessings Undo

### Setup

Engine at BlessingsOfKhorne event, pool rolled: `[1, 2, 2, 3, 4, 6, 6, 6]`.
Choices offered: Warp Blades, Wrathful Devotion, etc.

### Step 1: Player activates Warp Blades (d5 + d6)

```
choiceHistory: [
  { id: "ci_1", state: <before>, rng: <before>, choiceId: "warp_blades",
    args: { selectedDice: [5, 6] }, usedRNG: false }
]
```

State: d5.spent=true, d6.spent=true, blessingsActivated=1.

### Step 2: Player activates Wrathful Devotion (d1 + d2)

```
choiceHistory: [
  { id: "ci_1", ..., usedRNG: false },
  { id: "ci_2", state: <after warp blades>, rng: <after warp blades>,
    choiceId: "wrathful_devotion", args: { selectedDice: [1, 2] },
    usedRNG: false }
]
```

State: d1+d2+d5+d6 spent, blessingsActivated=2.

### Step 3: Player undoes Warp Blades

```typescript
engine.canUndoChoice("ci_1")
// → { requiresConfirm: false, cascadeCount: 2 }
// (2 choices will be undone: ci_1 and ci_2)

engine.undoChoice("ci_1")
// → { success: true, undoneChoices: ["ci_1", "ci_2"], state: <original> }
```

State restored to before Warp Blades. All dice unspent, blessingsActivated=0.
All blessing choices re-offered. Player picks again.

### Step 4: If the roll itself is undone

If the pool roll was a choice (e.g., "choose to roll blessings"):

```typescript
engine.canUndoChoice("ci_0")  // the roll choice
// → { requiresConfirm: true, reason: "RNG effects will be reverted",
//     cascadeCount: 3 }

engine.undoChoice("ci_0")
// → throws "Undo involves RNG effects -- pass { confirm: true }"

engine.undoChoice("ci_0", { confirm: true })
// → { success: true, undoneChoices: ["ci_0", "ci_1", "ci_2"], state: <before roll> }
```

RNG state is also restored, so a re-roll would produce the same values.
The UI should warn the player that they've seen the roll results.

---

## 8. Files Changed

| File | Change |
|---|---|
| `engine/src/rng/index.ts` | Add `captureState()`, `restoreState()`, `RNGSnapshot` type |
| `engine/src/types/choices.ts` | Add `ChoiceSnapshot`, `UndoCheck`, `UndoResult` types |
| `engine/src/rules/effects.ts` | Add `usedRNG` to `EffectResult` interface, set flag in RNG-using effects |
| `engine/src/engine/index.ts` | Add `choiceHistory`, `canUndoChoice`, `undoChoice`, snapshot logic in `applyChoice`, clear logic in `advanceToNextEvent` |
| `engine/src/logger/index.ts` | Add `choice_undone`, `rule_skipped`, log entry types |
| `engine/src/index.ts` | Export new types |
| `engine/tests/unit/rng.test.ts` | Add captureState/restoreState tests |
| `engine/tests/unit/undo.test.ts` | New: undo basics, cascade, RNG confirm, stack clearing |
| `engine/tests/unit/logging-enhanced.test.ts` | New: predicate results, effect_applied, prohibition logging |
| `engine/tests/integration/blessings-undo.test.ts` | New: full blessings undo workflow |
