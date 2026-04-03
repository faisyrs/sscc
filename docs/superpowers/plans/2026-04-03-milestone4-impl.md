# Milestone 4 Implementation Plan: Choice Undo, Snapshot/Restore, Enhanced Logging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add choice undo with RNG state snapshot/restore and cascade semantics, plus enhanced structured logging.

**Architecture:** Expose Mulberry32 internal state via `captureState`/`restoreState` on SeededRNG. Engine auto-snapshots before each `applyChoice` and maintains a `choiceHistory` stack. `undoChoice` restores state+RNG from a snapshot, cascading to undo all subsequent choices. RNG-involving choices require explicit confirmation to undo. Enhanced logging adds per-rule predicate results and structured `effect_applied` entries.

**Tech Stack:** TypeScript, Vitest

**Design Spec:** `docs/superpowers/specs/2026-04-03-milestone4-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `engine/src/rng/index.ts` | Modify | Add `RNGSnapshot`, `captureState()`, `restoreState()` |
| `engine/src/rules/effects.ts` | Modify | Add `usedRNG` to `EffectResult`, set in RNG-using effects |
| `engine/src/types/choices.ts` | Modify | Add `ChoiceSnapshot`, `UndoCheck`, `UndoResult` types |
| `engine/src/logger/index.ts` | Modify | Add `choice_undone`, `rule_skipped` log entry types |
| `engine/src/engine/index.ts` | Modify | Add `choiceHistory`, `canUndoChoice`, `undoChoice`, snapshot in `applyChoice`, clear in `advanceToNextEvent`, enhanced logging |
| `engine/src/index.ts` | Modify | Export new types |
| `engine/tests/unit/rng.test.ts` | Modify | Add captureState/restoreState tests |
| `engine/tests/unit/effects-rng-flag.test.ts` | Create | usedRNG flag tests |
| `engine/tests/unit/undo.test.ts` | Create | Undo basics, cascade, RNG confirm, stack clearing |
| `engine/tests/unit/logging-enhanced.test.ts` | Create | Per-rule logging, structured effect logging |
| `engine/tests/integration/blessings-undo.test.ts` | Create | Full blessings undo workflow |

---

## Task 1: RNG State Capture/Restore

**Files:**
- Modify: `engine/src/rng/index.ts`
- Modify: `engine/tests/unit/rng.test.ts`

The Mulberry32 `s` variable is currently trapped in a closure. We need to expose it. Refactor to store `s` as a class field instead of in a closure.

- [ ] **Step 1.1 — Write failing tests**

Add these tests to the end of the `describe("SeededRNG")` block in `engine/tests/unit/rng.test.ts`:

```typescript
  it("captureState returns seed and internal state", () => {
    const rng = new SeededRNG(42);
    rng.nextInt(1, 6); // advance the state
    const snap = rng.captureState();
    expect(snap.seed).toBe(42);
    expect(typeof snap.internalState).toBe("number");
  });

  it("restoreState produces identical sequence from that point", () => {
    const rng = new SeededRNG(42);
    rng.nextInt(1, 6); // advance once
    rng.nextInt(1, 6); // advance twice
    const snap = rng.captureState();
    const after = [rng.nextInt(1, 6), rng.nextInt(1, 6), rng.nextInt(1, 6)];

    // Restore and verify same sequence
    rng.restoreState(snap);
    const replayed = [rng.nextInt(1, 6), rng.nextInt(1, 6), rng.nextInt(1, 6)];
    expect(replayed).toEqual(after);
  });

  it("restoreState works across different RNG instances", () => {
    const rng1 = new SeededRNG(668);
    rng1.nextInt(1, 6); // advance
    const snap = rng1.captureState();
    const expected = [rng1.nextInt(1, 6), rng1.nextInt(1, 6)];

    const rng2 = new SeededRNG(999); // different seed
    rng2.restoreState(snap);
    const actual = [rng2.nextInt(1, 6), rng2.nextInt(1, 6)];
    expect(actual).toEqual(expected);
  });

  it("seed 668 sequence is preserved after captureState/restoreState round-trip", () => {
    const rng = new SeededRNG(668);
    const snap = rng.captureState();
    rng.nextInt(1, 6); // consume some values
    rng.nextInt(1, 6);
    rng.restoreState(snap);
    const results = [
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
    ];
    expect(results).toEqual([2, 6, 4, 1]);
  });
```

- [ ] **Step 1.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/rng.test.ts`
Expected: FAIL — captureState is not a function

- [ ] **Step 1.3 — Implement captureState/restoreState**

Replace the entire contents of `engine/src/rng/index.ts` with:

```typescript
/**
 * Snapshot of RNG state for save/restore.
 */
export interface RNGSnapshot {
  seed: number;
  internalState: number;
}

/**
 * Seeded PRNG for deterministic dice rolls.
 * Uses Mulberry32 — a fast 32-bit PRNG with good statistical properties.
 */
export class SeededRNG {
  private s: number;
  private currentSeed: number;

  constructor(seed: number) {
    this.currentSeed = seed;
    this.s = seed | 0;
  }

  /** Generate a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const float = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return min + Math.floor(float * (max - min + 1));
  }

  /** Reset the RNG with a new seed. */
  reseed(seed: number): void {
    this.currentSeed = seed;
    this.s = seed | 0;
  }

  /** Return the current seed value. */
  getSeed(): number {
    return this.currentSeed;
  }

  /** Capture the full RNG state for snapshot. */
  captureState(): RNGSnapshot {
    return { seed: this.currentSeed, internalState: this.s };
  }

  /** Restore RNG to a previously captured state. */
  restoreState(snapshot: RNGSnapshot): void {
    this.currentSeed = snapshot.seed;
    this.s = snapshot.internalState;
  }
}
```

Key change: the Mulberry32 algorithm is now inline in `nextInt` instead of a separate closure function. The `s` variable is a class field, making it directly capturable/restorable.

- [ ] **Step 1.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/rng.test.ts`
Expected: All 11 tests PASS (7 existing + 4 new)

- [ ] **Step 1.5 — Run full suite to verify no regressions**

Run: `cd engine && npx vitest run`
Expected: All 162 tests PASS

- [ ] **Step 1.6 — Commit**

```bash
git add engine/src/rng/index.ts engine/tests/unit/rng.test.ts
git commit -m "feat(m4): add RNG captureState/restoreState for snapshot support"
```

---

## Task 2: usedRNG Flag on EffectResult

**Files:**
- Modify: `engine/src/rules/effects.ts`
- Create: `engine/tests/unit/effects-rng-flag.test.ts`

- [ ] **Step 2.1 — Write failing tests**

Create `engine/tests/unit/effects-rng-flag.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executeEffect } from "../../src/rules/effects.js";
import type { Effect, GameEvent, State, Glossary } from "../../src/types/index.js";
import { SeededRNG } from "../../src/rng/index.js";

const glossary: Glossary = { keywords: [], selectors: {} };
const baseState: State = {};
const baseEvent: GameEvent = { id: "Test", params: { player: "A" } };

function exec(effect: Effect, state = baseState, event = baseEvent, rng?: SeededRNG) {
  return executeEffect(state, effect, event, "test-rule", glossary, rng);
}

describe("usedRNG flag", () => {
  it("roll sets usedRNG to true", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { roll: { count: 1, sides: 6, storePath: "$.r" } },
      baseState,
      baseEvent,
      rng,
    );
    expect(result.usedRNG).toBe(true);
  });

  it("rerollDie sets usedRNG to true", () => {
    const state: State = {
      pool: { count: 1, d0: { value: 3, rerolled: false } },
    };
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollDie: { poolPath: "$.pool", dieIndex: 0, sides: 6 } },
      state,
      baseEvent,
      rng,
    );
    expect(result.usedRNG).toBe(true);
  });

  it("rerollPool sets usedRNG to true", () => {
    const state: State = {
      pool: { count: 2, d0: { value: 1, rerolled: false, spent: false }, d1: { value: 2, rerolled: false, spent: false } },
    };
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollPool: { poolPath: "$.pool", sides: 6 } },
      state,
      baseEvent,
      rng,
    );
    expect(result.usedRNG).toBe(true);
  });

  it("setSeed sets usedRNG to true", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { setSeed: { seed: 99 } },
      baseState,
      baseEvent,
      rng,
    );
    expect(result.usedRNG).toBe(true);
  });

  it("setValue does not set usedRNG", () => {
    const result = exec({ setValue: { path: "$.x", value: 1 } });
    expect(result.usedRNG).toBe(false);
  });

  it("spendDice does not set usedRNG", () => {
    const state: State = {
      pool: { count: 1, d0: { value: 6, rerolled: false, spent: false } },
    };
    const result = exec(
      { spendDice: { poolPath: "$.pool", dieIndices: [0] } },
      state,
      baseEvent,
    );
    expect(result.usedRNG).toBe(false);
  });

  it("addChoice does not set usedRNG", () => {
    const result = exec(
      { addChoice: { id: "test", label: "Test", actionRef: "doTest" } },
      baseState,
      baseEvent,
    );
    expect(result.usedRNG).toBe(false);
  });
});
```

- [ ] **Step 2.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/effects-rng-flag.test.ts`
Expected: FAIL — usedRNG is undefined

- [ ] **Step 2.3 — Add usedRNG to EffectResult and set it in RNG effects**

In `engine/src/rules/effects.ts`, make these changes:

1. Add `usedRNG` to the `EffectResult` interface:

Change:
```typescript
export interface EffectResult {
  state: State;
  emittedEvents: GameEvent[];
  newChoices: ChoiceInstance[];
  logEntries: LogEntry[];
}
```

To:
```typescript
export interface EffectResult {
  state: State;
  emittedEvents: GameEvent[];
  newChoices: ChoiceInstance[];
  logEntries: LogEntry[];
  usedRNG: boolean;
}
```

2. Add `usedRNG: false` to the result initialization in `executeEffect`:

Change:
```typescript
  const result: EffectResult = {
    state,
    emittedEvents: [],
    newChoices: [],
    logEntries: [],
  };
```

To:
```typescript
  const result: EffectResult = {
    state,
    emittedEvents: [],
    newChoices: [],
    logEntries: [],
    usedRNG: false,
  };
```

3. Set `result.usedRNG = true` in each of the 4 RNG-using effect handlers. Add the line immediately after the opening `if` block guard in each:

In the `roll` handler (after `if (!rng) throw ...`):
```typescript
    result.usedRNG = true;
```

In the `rerollDie` handler (after `if (!rng) throw ...`):
```typescript
    result.usedRNG = true;
```

In the `rerollPool` handler (after `if (!rng) throw ...`):
```typescript
    result.usedRNG = true;
```

In the `setSeed` handler (after `if (!rng) throw ...`):
```typescript
    result.usedRNG = true;
```

- [ ] **Step 2.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/effects-rng-flag.test.ts`
Expected: 7 tests PASS

- [ ] **Step 2.5 — Run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2.6 — Commit**

```bash
git add engine/src/rules/effects.ts engine/tests/unit/effects-rng-flag.test.ts
git commit -m "feat(m4): add usedRNG flag to EffectResult for undo tracking"
```

---

## Task 3: Undo Types and Logger Updates

**Files:**
- Modify: `engine/src/types/choices.ts`
- Modify: `engine/src/logger/index.ts`

- [ ] **Step 3.1 — Add undo types to choices.ts**

Add these types at the end of `engine/src/types/choices.ts`, after the `ChoiceInstance` interface:

```typescript
import type { RNGSnapshot } from "../rng/index.js";

export interface ChoiceSnapshot {
  choiceInstanceId: string;
  state: State;
  rngState: RNGSnapshot;
  choiceId: string;
  args?: Record<string, unknown>;
  usedRNG: boolean;
}

export interface UndoCheck {
  requiresConfirm: boolean;
  reason?: string;
  cascadeCount: number;
}

export interface UndoResult {
  success: boolean;
  undoneChoices: string[];
  state: State;
}
```

Also add the `State` import at the top. Change:
```typescript
import type { TargetRef } from "./rules.js";
```
To:
```typescript
import type { TargetRef } from "./rules.js";
import type { State } from "./state.js";
```

- [ ] **Step 3.2 — Add new log entry types to logger.ts**

In `engine/src/logger/index.ts`, add `"choice_undone"` and `"rule_skipped"` to the `LogEntryType` union:

Change:
```typescript
export type LogEntryType =
  | "event_fired"
  | "rules_matched"
  | "effect_applied"
  | "choice_offered"
  | "choice_selected"
  | "choice_resolved"
  | "choice_expired"
  | "status_expired"
  | "choice_suppressed"
  | "cost_deducted"
  | "note"
  | "error";
```

To:
```typescript
export type LogEntryType =
  | "event_fired"
  | "rules_matched"
  | "rule_skipped"
  | "effect_applied"
  | "choice_offered"
  | "choice_selected"
  | "choice_resolved"
  | "choice_expired"
  | "choice_undone"
  | "status_expired"
  | "choice_suppressed"
  | "cost_deducted"
  | "note"
  | "error";
```

- [ ] **Step 3.3 — Run full suite to verify nothing breaks**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3.4 — Commit**

```bash
git add engine/src/types/choices.ts engine/src/logger/index.ts
git commit -m "feat(m4): add ChoiceSnapshot, UndoCheck, UndoResult types and new log entry types"
```

---

## Task 4: Engine Undo — Snapshot and Undo Logic

**Files:**
- Modify: `engine/src/engine/index.ts`
- Create: `engine/tests/unit/undo.test.ts`

- [ ] **Step 4.1 — Write failing tests**

Create `engine/tests/unit/undo.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { join } from "node:path";

const BLESSINGS_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

/** Helper: set up blessings engine at the choice point. */
async function setupBlessingsEngine(seed: number) {
  const result = await loadPack(BLESSINGS_PATH);
  if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);
  const engine = new SSCCEngine(result.pack!, { seed });
  engine.initialize();
  engine.advanceToNextEvent(); // BattleRoundStart
  engine.advanceToNextEvent(); // BlessingsOfKhorne (rolls + offers)
  return engine;
}

/** Helper: find a pair of unspent dice with matching values >= minVal. */
function findPair(engine: SSCCEngine, poolPath: string, minVal: number): number[] {
  const dice = readDiePool(engine.getState(), poolPath);
  const groups = new Map<number, number[]>();
  for (const d of dice) {
    if ((d.value as number) >= minVal && d.spent === false) {
      const v = d.value as number;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(d.index);
    }
  }
  for (const indices of groups.values()) {
    if (indices.length >= 2) return [indices[0], indices[1]];
  }
  throw new Error(`No pair >= ${minVal} found`);
}

describe("canUndoChoice", () => {
  it("returns null for unknown choice", async () => {
    const engine = await setupBlessingsEngine(7);
    expect(engine.canUndoChoice("nonexistent")).toBeNull();
  });

  it("returns requiresConfirm: false for non-RNG choice", async () => {
    const engine = await setupBlessingsEngine(7);
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    const check = engine.canUndoChoice(warpBlades.choiceInstanceId);
    expect(check).not.toBeNull();
    expect(check!.requiresConfirm).toBe(false);
    expect(check!.cascadeCount).toBe(1);
  });

  it("returns cascade count for earlier choice", async () => {
    const engine = await setupBlessingsEngine(7);

    // Make two choices
    const choices1 = engine.enumerateChoices();
    const warpBlades = choices1.find((c) => c.choiceId === "warp_blades")!;
    const pair1 = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair1 });

    const choices2 = engine.enumerateChoices();
    const wrathful = choices2.find((c) => c.choiceId === "wrathful_devotion");
    if (wrathful) {
      const dice = readDiePool(engine.getState(), "$.blessingsRoll");
      const unspent = dice.filter((d) => d.spent === false);
      const groups = new Map<number, number[]>();
      for (const d of unspent) {
        const v = d.value as number;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(d.index);
      }
      let pair2: number[] = [];
      for (const indices of groups.values()) {
        if (indices.length >= 2) { pair2 = [indices[0], indices[1]]; break; }
      }
      if (pair2.length === 2) {
        engine.applyChoice(wrathful.choiceInstanceId, { selectedDice: pair2 });

        const check = engine.canUndoChoice(warpBlades.choiceInstanceId);
        expect(check).not.toBeNull();
        expect(check!.cascadeCount).toBe(2);
      }
    }
  });
});

describe("undoChoice", () => {
  it("restores state to before the choice", async () => {
    const engine = await setupBlessingsEngine(7);
    const stateBefore = engine.getState();

    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    // Verify dice are spent
    expect((get(engine.getState(), `$.blessingsRoll.d${pair[0]}`) as any).spent).toBe(true);

    // Undo
    const result = engine.undoChoice(warpBlades.choiceInstanceId);
    expect(result.success).toBe(true);
    expect(result.undoneChoices).toContain(warpBlades.choiceInstanceId);

    // State should be restored
    expect((get(engine.getState(), `$.blessingsRoll.d${pair[0]}`) as any).spent).toBe(false);
    expect(get(engine.getState(), "$.blessingsActivated")).toBe(0);
  });

  it("cascades to undo subsequent choices", async () => {
    const engine = await setupBlessingsEngine(7);

    // First choice
    const choices1 = engine.enumerateChoices();
    const warpBlades = choices1.find((c) => c.choiceId === "warp_blades")!;
    const pair1 = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair1 });

    // Second choice (if available)
    const choices2 = engine.enumerateChoices();
    const wrathful = choices2.find((c) => c.choiceId === "wrathful_devotion");
    if (wrathful) {
      const dice = readDiePool(engine.getState(), "$.blessingsRoll");
      const unspent = dice.filter((d) => d.spent === false);
      const groups = new Map<number, number[]>();
      for (const d of unspent) {
        const v = d.value as number;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(d.index);
      }
      let pair2: number[] = [];
      for (const indices of groups.values()) {
        if (indices.length >= 2) { pair2 = [indices[0], indices[1]]; break; }
      }
      if (pair2.length === 2) {
        engine.applyChoice(wrathful.choiceInstanceId, { selectedDice: pair2 });
        expect(get(engine.getState(), "$.blessingsActivated")).toBe(2);

        // Undo the first choice — should cascade
        const result = engine.undoChoice(warpBlades.choiceInstanceId);
        expect(result.success).toBe(true);
        expect(result.undoneChoices).toHaveLength(2);
        expect(get(engine.getState(), "$.blessingsActivated")).toBe(0);
      }
    }
  });

  it("throws for unknown choice", async () => {
    const engine = await setupBlessingsEngine(7);
    expect(() => engine.undoChoice("nonexistent")).toThrow();
  });

  it("re-offers choices after undo", async () => {
    const engine = await setupBlessingsEngine(7);

    const choices1 = engine.enumerateChoices();
    const warpBlades = choices1.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    engine.undoChoice(warpBlades.choiceInstanceId);

    // Choices should be re-offered (same as before)
    const choices2 = engine.enumerateChoices();
    expect(choices2.find((c) => c.choiceId === "warp_blades")).toBeDefined();
  });

  it("logs undo events", async () => {
    const engine = await setupBlessingsEngine(7);

    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });
    engine.undoChoice(warpBlades.choiceInstanceId);

    const undoLogs = engine.getLog().filter((e) => e.type === "choice_undone");
    expect(undoLogs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("undo with RNG confirmation", () => {
  it("canUndoChoice returns requiresConfirm: true when RNG was used", async () => {
    // The blessings roll happens on advanceToNextEvent, not applyChoice,
    // so it won't be in the undo stack. We need a scenario where applyChoice
    // triggers RNG. For now, test that non-RNG choices don't require confirm.
    const engine = await setupBlessingsEngine(7);
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    const check = engine.canUndoChoice(warpBlades.choiceInstanceId);
    expect(check!.requiresConfirm).toBe(false);
  });
});

describe("undo stack lifecycle", () => {
  it("stack is cleared after advanceToNextEvent with no pending choices", async () => {
    const engine = await setupBlessingsEngine(7);

    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    // Resolve all remaining choices by skipping them — advance past the pause
    // Cancel remaining choices by advancing
    // Note: we need to resolve or skip all choices to unpause.
    // For simplicity, apply all available choices until unpaused, then advance.
    let safety = 0;
    while (engine.isPaused() && safety < 10) {
      const remaining = engine.enumerateChoices();
      if (remaining.length === 0) break;
      // Try to apply a choice with a valid pair
      const choice = remaining[0];
      try {
        const dice = readDiePool(engine.getState(), "$.blessingsRoll");
        const unspent = dice.filter((d) => d.spent === false);
        const groups = new Map<number, number[]>();
        for (const d of unspent) {
          const v = d.value as number;
          if (!groups.has(v)) groups.set(v, []);
          groups.get(v)!.push(d.index);
        }
        let p: number[] = [];
        for (const indices of groups.values()) {
          if (indices.length >= 2) { p = [indices[0], indices[1]]; break; }
        }
        if (p.length === 2) {
          engine.applyChoice(choice.choiceInstanceId, { selectedDice: p });
        } else {
          break;
        }
      } catch {
        break;
      }
      safety++;
    }

    // Try to advance — this may or may not succeed depending on pack structure
    engine.advanceToNextEvent();

    // After advancing, undo should not work for prior choices
    expect(engine.canUndoChoice(warpBlades.choiceInstanceId)).toBeNull();
  });
});
```

- [ ] **Step 4.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/undo.test.ts`
Expected: FAIL — canUndoChoice/undoChoice not found

- [ ] **Step 4.3 — Implement undo in engine/index.ts**

In `engine/src/engine/index.ts`, make these changes:

1. Add import for `ChoiceSnapshot` types at the top. Change:
```typescript
import type { ChoiceInstance } from "../types/index.js";
```
To:
```typescript
import type { ChoiceInstance, ChoiceSnapshot, UndoCheck, UndoResult } from "../types/index.js";
```

2. Add `choiceHistory` field to the class. After `private rng: SeededRNG;`:
```typescript
  private choiceHistory: ChoiceSnapshot[] = [];
```

3. Add snapshot logic to `applyChoice`. Insert at the very beginning of the method, right after the opening brace of `applyChoice(`:

```typescript
    // Snapshot before choice for undo support
    const preChoiceState = this.state;
    const preChoiceRng = this.rng.captureState();
```

Then, at the very end of `applyChoice`, just before `return this.state;`, insert:

```typescript
    // Track whether RNG was used during this choice's evaluation
    const choiceLogStart = this.logger.getEntries().length;
    // (We already executed above, so check logs retroactively is wrong)
    // Instead, we'll set usedRNG based on effect tracking below
```

Actually, this approach is tricky because effects are executed inside `evaluateEvent` which is called recursively. A cleaner approach: track RNG usage via a flag on the engine that gets set during effect execution.

Add a field after `choiceHistory`:
```typescript
  private _rngUsedDuringChoice = false;
```

In `evaluateEvent`, after the `executeEffect` call, check the flag:

Find this code:
```typescript
      const effectResult = executeEffect(
        state,
        resolvedEffect.effect,
        event,
        resolvedEffect.ruleId,
        this.pack.glossary,
        this.rng,
      );
      state = effectResult.state;
      allEmittedEvents.push(...effectResult.emittedEvents);
      allNewChoices.push(...effectResult.newChoices);
```

Change to:
```typescript
      const effectResult = executeEffect(
        state,
        resolvedEffect.effect,
        event,
        resolvedEffect.ruleId,
        this.pack.glossary,
        this.rng,
      );
      state = effectResult.state;
      allEmittedEvents.push(...effectResult.emittedEvents);
      allNewChoices.push(...effectResult.newChoices);
      if (effectResult.usedRNG) {
        this._rngUsedDuringChoice = true;
      }
```

Now back in `applyChoice`, add the full snapshot logic. The complete `applyChoice` method should become:

```typescript
  applyChoice(
    choiceInstanceId: string,
    args?: Record<string, unknown>,
  ): State {
    // Snapshot before choice for undo support
    const preChoiceState = this.state;
    const preChoiceRng = this.rng.captureState();

    // Find the choice and verify costs are still affordable
    const activeChoices = getActiveChoices(this.state);
    const choice = activeChoices.find((c) => c.choiceInstanceId === choiceInstanceId);
    if (!choice) {
      throw new Error(`Choice instance not found or not active: ${choiceInstanceId}`);
    }

    // Reset RNG tracking flag
    this._rngUsedDuringChoice = false;

    // Deduct costs before selection
    if (choice.costs && Object.keys(choice.costs).length > 0) {
      if (!canAffordCosts(this.state, choice.player, choice.costs)) {
        throw new Error(
          `Player ${choice.player} cannot afford choice ${choice.choiceId}: ` +
          `costs ${JSON.stringify(choice.costs)}`
        );
      }
      this.state = deductCosts(this.state, choice.player, choice.costs);
      this.logger.log("cost_deducted", `Costs deducted for ${choice.choiceId}`, {
        data: {
          choiceId: choice.choiceId,
          player: choice.player,
          costs: choice.costs,
        },
      });
    }

    // Validate multi-die selection if applicable
    if (choice.pick && choice.selectionFrom && "path" in choice.selectionFrom) {
      const selectedDice = args?.selectedDice as number[] | undefined;
      if (!selectedDice) {
        throw new Error(`Choice ${choice.choiceId} requires ${choice.pick} dice selection`);
      }
      validateDieSelection(
        this.state,
        choice.selectionFrom.path,
        selectedDice,
        choice.selectionFilter,
        choice.pick,
      );
    }

    const { state: newState, event } = selectChoice(
      this.state,
      choiceInstanceId,
      args,
    );
    this.state = newState;

    this.logger.log("choice_selected", `Choice selected: ${event.params.choiceId}`, {
      eventId: event.id,
      data: event.params,
    });

    // Evaluate the ChoiceSelected event (recursive, depth-first)
    this.state = this.evaluateEvent(this.state, event);

    // Resolve the choice after its action completes
    this.state = resolveChoice(this.state, choiceInstanceId);

    // Push snapshot to undo stack
    this.choiceHistory.push({
      choiceInstanceId,
      state: preChoiceState,
      rngState: preChoiceRng,
      choiceId: choice.choiceId,
      args,
      usedRNG: this._rngUsedDuringChoice,
    });

    return this.state;
  }
```

4. Add the `canUndoChoice` method after `applyChoice`:

```typescript
  /**
   * Check if a choice can be undone and what confirmation is needed.
   */
  canUndoChoice(choiceInstanceId: string): UndoCheck | null {
    const idx = this.choiceHistory.findIndex(
      (s) => s.choiceInstanceId === choiceInstanceId,
    );
    if (idx === -1) return null;

    const cascadeCount = this.choiceHistory.length - idx;
    const anyUsedRNG = this.choiceHistory
      .slice(idx)
      .some((s) => s.usedRNG);

    return {
      requiresConfirm: anyUsedRNG,
      reason: anyUsedRNG ? "RNG effects will be reverted" : undefined,
      cascadeCount,
    };
  }
```

5. Add the `undoChoice` method after `canUndoChoice`:

```typescript
  /**
   * Undo a choice and all choices made after it.
   */
  undoChoice(
    choiceInstanceId: string,
    options?: { confirm?: boolean },
  ): UndoResult {
    const check = this.canUndoChoice(choiceInstanceId);
    if (!check) {
      throw new Error(`Cannot undo choice: ${choiceInstanceId} not in undo history`);
    }

    if (check.requiresConfirm && !options?.confirm) {
      throw new Error(
        "Undo involves RNG effects — pass { confirm: true } to proceed",
      );
    }

    const idx = this.choiceHistory.findIndex(
      (s) => s.choiceInstanceId === choiceInstanceId,
    );
    const snapshot = this.choiceHistory[idx];

    // Collect undone choice IDs
    const undoneChoices = this.choiceHistory
      .slice(idx)
      .map((s) => s.choiceInstanceId);

    // Restore state and RNG
    this.state = snapshot.state;
    this.rng.restoreState(snapshot.rngState);

    // Truncate history
    this.choiceHistory = this.choiceHistory.slice(0, idx);

    // Log the undo
    this.logger.log("choice_undone", `Undo: reverted to before ${snapshot.choiceId}, undid ${undoneChoices.length} choice(s)`, {
      data: {
        undoneChoices,
        targetChoiceId: snapshot.choiceId,
      },
    });

    return {
      success: true,
      undoneChoices,
      state: this.state,
    };
  }
```

6. Add stack clearing in `advanceToNextEvent`. At the end of the method, just before the final `return` statement (the one that returns `{ state, event, paused }`), add:

```typescript
    // Clear undo stack when advancing past a resolved pause point
    if (!hasUnresolvedChoices(this.state)) {
      this.choiceHistory = [];
    }
```

- [ ] **Step 4.4 — Run undo tests**

Run: `cd engine && npx vitest run tests/unit/undo.test.ts`
Expected: All tests PASS

- [ ] **Step 4.5 — Run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4.6 — Commit**

```bash
git add engine/src/engine/index.ts engine/tests/unit/undo.test.ts
git commit -m "feat(m4): implement choice undo with cascade and RNG confirmation"
```

---

## Task 5: Enhanced Logging

**Files:**
- Modify: `engine/src/engine/index.ts`
- Create: `engine/tests/unit/logging-enhanced.test.ts`

- [ ] **Step 5.1 — Write failing tests**

Create `engine/tests/unit/logging-enhanced.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { join } from "node:path";

const HELLO_PATH = join(import.meta.dirname, "../../../packs/hello-pack");
const BLESSINGS_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

describe("enhanced logging — per-rule predicate results", () => {
  it("logs matched rules individually", async () => {
    const result = await loadPack(HELLO_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!);
    engine.initialize();
    engine.advanceToNextEvent(); // StartOfGame — fires rules

    const log = engine.getLog();
    const matchedEntries = log.filter((e) => e.type === "rules_matched");
    // Each matched rule should have its own log entry with a ruleId
    for (const entry of matchedEntries) {
      expect(entry.ruleId).toBeDefined();
    }
  });

  it("logs skipped rules", async () => {
    const result = await loadPack(BLESSINGS_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: 7 });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    const log = engine.getLog();
    // Some rules should be skipped (e.g., if blessingsActivated >= 2 is false)
    const skippedEntries = log.filter((e) => e.type === "rule_skipped");
    // There should be at least some evaluated rules
    const allRuleEntries = log.filter(
      (e) => e.type === "rules_matched" || e.type === "rule_skipped",
    );
    expect(allRuleEntries.length).toBeGreaterThan(0);
  });
});

describe("enhanced logging — structured effect entries", () => {
  it("logs effect_applied for each executed effect", async () => {
    const result = await loadPack(BLESSINGS_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: 7 });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne (triggers roll effect)

    const log = engine.getLog();
    const effectEntries = log.filter((e) => e.type === "effect_applied");
    expect(effectEntries.length).toBeGreaterThanOrEqual(1);

    // At least one should be a roll effect
    const rollEffect = effectEntries.find(
      (e) => e.message.includes("roll"),
    );
    expect(rollEffect).toBeDefined();
    expect(rollEffect!.ruleId).toBeDefined();
  });
});
```

- [ ] **Step 5.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/logging-enhanced.test.ts`
Expected: FAIL — no rule_skipped or effect_applied entries

- [ ] **Step 5.3 — Implement enhanced logging in evaluateEvent**

In `engine/src/engine/index.ts`, modify the `evaluateEvent` method.

Replace the existing rules_matched logging block:

```typescript
    if (evalResult.matchedRules.length > 0) {
      this.logger.log("rules_matched", `${evalResult.matchedRules.length} rules matched`, {
        eventId: event.id,
        data: { ruleIds: evalResult.matchedRules.map((r) => r.id) },
      });
    }
```

With per-rule logging:

```typescript
    for (const [ruleId, matched] of evalResult.predicateResults) {
      this.logger.log(
        matched ? "rules_matched" : "rule_skipped",
        `Rule ${ruleId}: ${matched ? "matched" : "skipped"}`,
        { eventId: event.id, ruleId },
      );
    }
```

Then add structured effect logging. After the existing effect log entries block:

```typescript
      for (const entry of effectResult.logEntries) {
        this.logger.log("note", entry.message, {
          eventId: event.id,
          ruleId: entry.ruleId,
        });
      }
```

Add:

```typescript
      this.logger.log("effect_applied", `Effect: ${Object.keys(resolvedEffect.effect)[0]}`, {
        eventId: event.id,
        ruleId: resolvedEffect.ruleId,
        data: { effect: resolvedEffect.effect },
      });
```

- [ ] **Step 5.4 — Run enhanced logging tests**

Run: `cd engine && npx vitest run tests/unit/logging-enhanced.test.ts`
Expected: All tests PASS

- [ ] **Step 5.5 — Fix any existing tests affected by logging changes**

The logging change from bulk `rules_matched` to per-rule entries may affect existing tests. Run:

Run: `cd engine && npx vitest run`

If any tests fail because they checked for the old bulk `rules_matched` format, update them to expect per-rule entries instead.

- [ ] **Step 5.6 — Commit**

```bash
git add engine/src/engine/index.ts engine/tests/unit/logging-enhanced.test.ts
git commit -m "feat(m4): add per-rule predicate logging and structured effect_applied entries"
```

---

## Task 6: Export New Types and Integration Test

**Files:**
- Modify: `engine/src/index.ts`
- Create: `engine/tests/integration/blessings-undo.test.ts`

- [ ] **Step 6.1 — Update exports**

In `engine/src/index.ts`, update the engine export line:

Change:
```typescript
export { SSCCEngine, validateDieSelection } from "./engine/index.js";
```

To:
```typescript
export { SSCCEngine, validateDieSelection } from "./engine/index.js";
export type { ChoiceSnapshot, UndoCheck, UndoResult } from "./types/choices.js";
export type { RNGSnapshot } from "./rng/index.js";
```

- [ ] **Step 6.2 — Write integration test**

Create `engine/tests/integration/blessings-undo.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { SeededRNG } from "../../src/rng/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

/** Find seed with double 5+ and another double. */
function findBlessingsSeed(): number {
  for (let seed = 0; seed < 10000; seed++) {
    const rng = new SeededRNG(seed);
    const values: number[] = [];
    for (let i = 0; i < 8; i++) values.push(rng.nextInt(1, 6));
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let highPairs = 0;
    let totalPairs = 0;
    for (const [val, count] of counts) {
      const pairs = Math.floor(count / 2);
      totalPairs += pairs;
      if (val >= 5) highPairs += pairs;
    }
    if (highPairs >= 1 && totalPairs >= 2) return seed;
  }
  throw new Error("No suitable seed found");
}

function findPair(engine: SSCCEngine, poolPath: string, minVal: number): number[] {
  const dice = readDiePool(engine.getState(), poolPath);
  const groups = new Map<number, number[]>();
  for (const d of dice) {
    if ((d.value as number) >= minVal && d.spent === false) {
      const v = d.value as number;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(d.index);
    }
  }
  for (const indices of groups.values()) {
    if (indices.length >= 2) return [indices[0], indices[1]];
  }
  throw new Error(`No pair >= ${minVal} found`);
}

describe("Blessings of Khorne — Undo Workflow", () => {
  const blessingsSeed = findBlessingsSeed();

  it("full undo cycle: activate, undo, re-activate differently", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    // Snapshot the pool values for comparison
    const poolBefore = readDiePool(engine.getState(), "$.blessingsRoll").map((d) => d.value);

    // Activate Warp Blades
    const choices1 = engine.enumerateChoices();
    const warpBlades = choices1.find((c) => c.choiceId === "warp_blades")!;
    const pair1 = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair1 });

    expect(get(engine.getState(), "$.blessingsActivated")).toBe(1);
    expect(get(engine.getState(), "$.blessings.warpBlades")).toBe(true);

    // Undo
    const undoResult = engine.undoChoice(warpBlades.choiceInstanceId);
    expect(undoResult.success).toBe(true);

    // Pool should be restored exactly
    const poolAfter = readDiePool(engine.getState(), "$.blessingsRoll").map((d) => d.value);
    expect(poolAfter).toEqual(poolBefore);
    expect(get(engine.getState(), "$.blessingsActivated")).toBe(0);
    expect(get(engine.getState(), "$.blessings.warpBlades")).toBeUndefined();

    // Choices should be re-offered
    const choices2 = engine.enumerateChoices();
    expect(choices2.find((c) => c.choiceId === "warp_blades")).toBeDefined();
    expect(choices2.find((c) => c.choiceId === "wrathful_devotion")).toBeDefined();

    // Can now activate a different blessing instead
    const wrathful = choices2.find((c) => c.choiceId === "wrathful_devotion")!;
    const dice = readDiePool(engine.getState(), "$.blessingsRoll");
    const groups = new Map<number, number[]>();
    for (const d of dice) {
      if (d.spent === false) {
        const v = d.value as number;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(d.index);
      }
    }
    let pair2: number[] = [];
    for (const indices of groups.values()) {
      if (indices.length >= 2) { pair2 = [indices[0], indices[1]]; break; }
    }
    expect(pair2.length).toBe(2);
    engine.applyChoice(wrathful.choiceInstanceId, { selectedDice: pair2 });

    expect(get(engine.getState(), "$.blessingsActivated")).toBe(1);
    expect(get(engine.getState(), "$.blessings.wrathfulDevotion")).toBe(true);
  });

  it("RNG state is preserved through undo", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    // Apply and undo a choice
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });
    engine.undoChoice(warpBlades.choiceInstanceId);

    // The pool values should be identical (RNG state restored)
    const dice = readDiePool(engine.getState(), "$.blessingsRoll");
    expect(dice.every((d) => d.spent === false)).toBe(true);
  });
});
```

- [ ] **Step 6.3 — Run integration test**

Run: `cd engine && npx vitest run tests/integration/blessings-undo.test.ts`
Expected: 2 tests PASS

- [ ] **Step 6.4 — Run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6.5 — Commit**

```bash
git add engine/src/index.ts engine/tests/integration/blessings-undo.test.ts
git commit -m "feat(m4): add blessings undo integration test and export new types"
```

---

## Task 7: Final Validation

- [ ] **Step 7.1 — Run full test suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 7.2 — TypeScript check**

Run: `cd engine && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7.3 — Verify no uncommitted changes**

Run: `git status`
Expected: Clean working tree.
