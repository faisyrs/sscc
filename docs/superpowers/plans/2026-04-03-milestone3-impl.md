# Milestone 3 Implementation Plan: Dice Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seeded RNG, dice state bundles, pool operations, and pattern-matching predicates to the SSCC engine.

**Architecture:** New `rng/` module for SeededRNG. Extend `types/rules.ts` with 5 new effect verbs and 2 new predicates. Extend `types/choices.ts` with `selectionFilter`/`pick`. Implement executors in `rules/effects.ts`, predicates in `rules/predicates.ts`, conflict domains in `rules/conflicts.ts`. Wire RNG into engine constructor. Two integration test packs validate attack pipeline and Blessings of Khorne.

**Tech Stack:** TypeScript, Vitest

**Design Spec:** `docs/superpowers/specs/2026-04-03-milestone3-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `engine/src/rng/index.ts` | Create | SeededRNG class (Mulberry32 PRNG) |
| `engine/src/types/rules.ts` | Modify | Add `roll`, `rerollDie`, `rerollPool`, `spendDice`, `setSeed` to Effect union; add `poolContainsPattern`, `diePoolCount` to PredicateNode |
| `engine/src/types/choices.ts` | Modify | Add `selectionFilter`, `pick` to ChoiceInstance |
| `engine/src/rules/effects.ts` | Modify | Implement 5 new effect executors; accept `rng` parameter |
| `engine/src/rules/predicates.ts` | Modify | Implement `poolContainsPattern`, `diePoolCount` |
| `engine/src/rules/conflicts.ts` | Modify | Add conflict domains for 5 new effects |
| `engine/src/engine/index.ts` | Modify | Accept seed option, create RNG, pass to effects, validate multi-die selection |
| `engine/src/index.ts` | Modify | Export `SeededRNG` |
| `engine/tests/unit/rng.test.ts` | Create | SeededRNG determinism, range, reseed |
| `engine/tests/unit/effects-roll.test.ts` | Create | roll, rerollDie, rerollPool, spendDice, setSeed |
| `engine/tests/unit/predicates-pool.test.ts` | Create | poolContainsPattern, diePoolCount |
| `engine/tests/unit/choices-multiselect.test.ts` | Create | Multi-die selection validation |
| `engine/tests/integration/attack-pipeline.test.ts` | Create | Section 13 worked example |
| `engine/tests/integration/blessings.test.ts` | Create | Blessings of Khorne pool flow |
| `packs/attack-test/` | Create | Minimal attack pipeline pack |
| `packs/blessings-test/` | Create | Blessings pool pack |

---

## Task 1: SeededRNG Class

**Files:**
- Create: `engine/src/rng/index.ts`
- Create: `engine/tests/unit/rng.test.ts`

- [ ] **Step 1.1 — Write failing tests**

Create `engine/tests/unit/rng.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SeededRNG } from "../../src/rng/index.js";

describe("SeededRNG", () => {
  it("produces deterministic sequence for same seed", () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const seq1 = [rng1.nextInt(1, 6), rng1.nextInt(1, 6), rng1.nextInt(1, 6)];
    const seq2 = [rng2.nextInt(1, 6), rng2.nextInt(1, 6), rng2.nextInt(1, 6)];
    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(99);
    const seq1 = [rng1.nextInt(1, 6), rng1.nextInt(1, 6), rng1.nextInt(1, 6)];
    const seq2 = [rng2.nextInt(1, 6), rng2.nextInt(1, 6), rng2.nextInt(1, 6)];
    expect(seq1).not.toEqual(seq2);
  });

  it("nextInt returns values within inclusive range", () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(1, 6);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(6);
    }
  });

  it("nextInt returns values within range for non-d6", () => {
    const rng = new SeededRNG(456);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(1, 20);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(20);
    }
  });

  it("reseed resets the sequence", () => {
    const rng = new SeededRNG(42);
    const first = [rng.nextInt(1, 6), rng.nextInt(1, 6)];
    rng.reseed(42);
    const second = [rng.nextInt(1, 6), rng.nextInt(1, 6)];
    expect(first).toEqual(second);
  });

  it("getSeed returns current seed", () => {
    const rng = new SeededRNG(42);
    expect(rng.getSeed()).toBe(42);
    rng.reseed(99);
    expect(rng.getSeed()).toBe(99);
  });

  it("seed 668 produces [2, 6, 4, 1] for 4d6", () => {
    const rng = new SeededRNG(668);
    const results = [
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
    ];
    expect(results).toEqual([2, 6, 4, 1]);
  });
});
```

- [ ] **Step 1.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/rng.test.ts`
Expected: FAIL — module not found

- [ ] **Step 1.3 — Implement SeededRNG**

Create `engine/src/rng/index.ts`:

```typescript
/**
 * Mulberry32 — a fast 32-bit PRNG with good statistical properties.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded PRNG for deterministic dice rolls.
 */
export class SeededRNG {
  private rng: () => number;
  private currentSeed: number;

  constructor(seed: number) {
    this.currentSeed = seed;
    this.rng = mulberry32(seed);
  }

  /** Generate a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  /** Reset the RNG with a new seed. */
  reseed(seed: number): void {
    this.currentSeed = seed;
    this.rng = mulberry32(seed);
  }

  /** Return the current seed value. */
  getSeed(): number {
    return this.currentSeed;
  }
}
```

- [ ] **Step 1.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/rng.test.ts`
Expected: 7 tests PASS

- [ ] **Step 1.5 — Commit**

```bash
git add engine/src/rng/index.ts engine/tests/unit/rng.test.ts
git commit -m "feat(m3): add SeededRNG class with Mulberry32 PRNG"
```

---

## Task 2: Type Definitions — Effects, Predicates, Choices

**Files:**
- Modify: `engine/src/types/rules.ts`
- Modify: `engine/src/types/choices.ts`
- Modify: `engine/src/index.ts`

- [ ] **Step 2.1 — Add 5 new effect verbs to Effect union and update addChoice in `engine/src/types/rules.ts`**

Add these variants to the `Effect` type union (after the `mergeInto` line):

```typescript
  | { roll: { count: number | { path: string }; sides?: number; storePath: string; defaults?: Record<string, unknown> } }
  | { rerollDie: { poolPath: string; dieIndex: number | { path: string }; sides?: number } }
  | { rerollPool: { poolPath: string; sides?: number } }
  | { spendDice: { poolPath: string; dieIndices: number[] | { fromChoice: string } } }
  | { setSeed: { seed: number } };
```

Also update the existing `addChoice` variant in the `Effect` union to include `selectionFilter` and `pick`:

```typescript
  | { addChoice: { id: string; label: string; actionRef: string; limits?: Record<string, unknown>; costs?: Record<string, unknown>; selectionFrom?: TargetRef; selectionFilter?: Record<string, unknown>; pick?: number } }
```

- [ ] **Step 2.2 — Add 2 new predicates to PredicateNode union in `engine/src/types/rules.ts`**

Add these variants to the `PredicateNode` type union (after the `selector` line):

```typescript
  | { poolContainsPattern: { pool: string; filter?: Record<string, unknown>; pattern: { kind: "double" | "triple"; minValue?: number } } }
  | { diePoolCount: { pool: string; filter?: Record<string, unknown>; min: number } };
```

- [ ] **Step 2.3 — Add `selectionFilter` and `pick` to ChoiceInstance in `engine/src/types/choices.ts`**

Add two fields after `costs`:

```typescript
export interface ChoiceInstance {
  choiceInstanceId: string;
  choiceId: string;
  label: string;
  actionRef: string;
  player: string;
  sourceRuleId: string;
  createdAtEvent: string;
  state: ChoiceState;
  selectionFrom?: TargetRef;
  selectedArgs?: Record<string, unknown>;
  costs?: Record<string, number>;
  selectionFilter?: Record<string, unknown>;
  pick?: number;
}
```

- [ ] **Step 2.4 — Export SeededRNG from `engine/src/index.ts`**

Add to the exports:

```typescript
export { SeededRNG } from "./rng/index.js";
```

- [ ] **Step 2.5 — Run existing tests to verify nothing breaks**

Run: `cd engine && npx vitest run`
Expected: All 105 existing tests PASS

- [ ] **Step 2.6 — Commit**

```bash
git add engine/src/types/rules.ts engine/src/types/choices.ts engine/src/index.ts
git commit -m "feat(m3): add dice effect/predicate types and choice multi-select fields"
```

---

## Task 3: Conflict Domains for New Effects

**Files:**
- Modify: `engine/src/rules/conflicts.ts`

- [ ] **Step 3.1 — Add conflict domains for all 5 new effect verbs**

In `getConflictDomain`, add these cases before the final `return null`:

```typescript
  if ("roll" in effect) {
    return `roll:${effect.roll.storePath}`;
  }
  if ("rerollDie" in effect) {
    const idx = typeof effect.rerollDie.dieIndex === "number"
      ? effect.rerollDie.dieIndex
      : effect.rerollDie.dieIndex.path;
    return `rerollDie:${effect.rerollDie.poolPath}:${idx}`;
  }
  if ("rerollPool" in effect) {
    return `rerollPool:${effect.rerollPool.poolPath}`;
  }
  if ("spendDice" in effect) {
    const indices = Array.isArray(effect.spendDice.dieIndices)
      ? effect.spendDice.dieIndices.slice().sort().join(",")
      : effect.spendDice.dieIndices.fromChoice;
    return `spendDice:${effect.spendDice.poolPath}:${indices}`;
  }
  if ("setSeed" in effect) {
    return "setSeed";
  }
```

- [ ] **Step 3.2 — Run existing tests**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3.3 — Commit**

```bash
git add engine/src/rules/conflicts.ts
git commit -m "feat(m3): add conflict domains for dice effects"
```

---

## Task 4: Pool Helper — readDiePool

The `roll`, `rerollDie`, `rerollPool`, `spendDice` effects and the `poolContainsPattern`, `diePoolCount` predicates all need to read die bundles from state. Extract a shared helper.

**Files:**
- Create: `engine/src/rules/pool-helpers.ts`
- Create: `engine/tests/unit/pool-helpers.test.ts`

- [ ] **Step 4.1 — Write failing tests**

Create `engine/tests/unit/pool-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readDiePool, dieMatchesFilter } from "../../src/rules/pool-helpers.js";
import type { State } from "../../src/types/index.js";

const poolState: State = {
  blessingsRoll: {
    count: 4,
    d0: { value: 2, rerolled: false, spent: false },
    d1: { value: 6, rerolled: false, spent: false },
    d2: { value: 6, rerolled: true, spent: false },
    d3: { value: 3, rerolled: false, spent: true },
  },
};

describe("readDiePool", () => {
  it("reads all die bundles from a pool path", () => {
    const dice = readDiePool(poolState, "$.blessingsRoll");
    expect(dice).toHaveLength(4);
    expect(dice[0]).toEqual({ index: 0, value: 2, rerolled: false, spent: false });
    expect(dice[1]).toEqual({ index: 1, value: 6, rerolled: false, spent: false });
    expect(dice[2]).toEqual({ index: 2, value: 6, rerolled: true, spent: false });
    expect(dice[3]).toEqual({ index: 3, value: 3, rerolled: false, spent: true });
  });

  it("returns empty array for missing pool", () => {
    const dice = readDiePool(poolState, "$.nonexistent");
    expect(dice).toEqual([]);
  });
});

describe("dieMatchesFilter", () => {
  it("matches when all filter fields match", () => {
    const die = { index: 0, value: 6, rerolled: false, spent: false };
    expect(dieMatchesFilter(die, { rerolled: false, spent: false })).toBe(true);
  });

  it("rejects when any filter field differs", () => {
    const die = { index: 0, value: 6, rerolled: true, spent: false };
    expect(dieMatchesFilter(die, { rerolled: false })).toBe(false);
  });

  it("matches with no filter (undefined)", () => {
    const die = { index: 0, value: 6, rerolled: false, spent: false };
    expect(dieMatchesFilter(die, undefined)).toBe(true);
  });
});
```

- [ ] **Step 4.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/pool-helpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4.3 — Implement pool helpers**

Create `engine/src/rules/pool-helpers.ts`:

```typescript
import type { State } from "../types/index.js";
import { get } from "../state/index.js";

export interface PoolDie {
  index: number;
  value: number;
  [key: string]: unknown;
}

/**
 * Read all die bundles from a pool path.
 * Expects state at poolPath to have a `count` field and `d0`, `d1`, ... bundles.
 */
export function readDiePool(state: State, poolPath: string): PoolDie[] {
  const count = get(state, `${poolPath}.count`);
  if (typeof count !== "number" || count <= 0) return [];
  const dice: PoolDie[] = [];
  for (let i = 0; i < count; i++) {
    const bundle = get(state, `${poolPath}.d${i}`) as Record<string, unknown> | undefined;
    if (bundle && typeof bundle === "object") {
      dice.push({ ...bundle, index: i } as PoolDie);
    }
  }
  return dice;
}

/**
 * Check if a die matches all fields in a filter object.
 * Returns true if filter is undefined or empty.
 */
export function dieMatchesFilter(
  die: PoolDie,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (die[key] !== expected) return false;
  }
  return true;
}
```

- [ ] **Step 4.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/pool-helpers.test.ts`
Expected: 5 tests PASS

- [ ] **Step 4.5 — Commit**

```bash
git add engine/src/rules/pool-helpers.ts engine/tests/unit/pool-helpers.test.ts
git commit -m "feat(m3): add pool-helpers for reading die bundles from state"
```

---

## Task 5: Effect Executors — roll, rerollDie, rerollPool, spendDice, setSeed

**Files:**
- Modify: `engine/src/rules/effects.ts`
- Create: `engine/tests/unit/effects-roll.test.ts`

- [ ] **Step 5.1 — Write failing tests**

Create `engine/tests/unit/effects-roll.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executeEffect } from "../../src/rules/effects.js";
import type { Effect, GameEvent, State, Glossary } from "../../src/types/index.js";
import { get } from "../../src/state/index.js";
import { SeededRNG } from "../../src/rng/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";

const glossary: Glossary = { keywords: [], selectors: {} };
const baseState: State = {};
const baseEvent: GameEvent = { id: "RollDice", params: { player: "A" } };

function exec(effect: Effect, state = baseState, event = baseEvent, rng?: SeededRNG) {
  return executeEffect(state, effect, event, "test-rule", glossary, rng);
}

describe("roll effect", () => {
  it("creates die bundles at storePath", () => {
    const rng = new SeededRNG(668);
    const result = exec(
      { roll: { count: 4, sides: 6, storePath: "$.hitRolls" } },
      baseState,
      baseEvent,
      rng,
    );
    expect(get(result.state, "$.hitRolls.count")).toBe(4);
    expect(get(result.state, "$.hitRolls.d0")).toEqual({ value: 2, rerolled: false });
    expect(get(result.state, "$.hitRolls.d1")).toEqual({ value: 6, rerolled: false });
    expect(get(result.state, "$.hitRolls.d2")).toEqual({ value: 4, rerolled: false });
    expect(get(result.state, "$.hitRolls.d3")).toEqual({ value: 1, rerolled: false });
  });

  it("applies custom defaults to each die", () => {
    const rng = new SeededRNG(668);
    const result = exec(
      { roll: { count: 2, sides: 6, storePath: "$.pool", defaults: { rerolled: false, spent: false } } },
      baseState,
      baseEvent,
      rng,
    );
    expect(get(result.state, "$.pool.d0")).toEqual({ value: 2, rerolled: false, spent: false });
    expect(get(result.state, "$.pool.d1")).toEqual({ value: 6, rerolled: false, spent: false });
  });

  it("resolves count from state path", () => {
    const rng = new SeededRNG(42);
    const state: State = { attackCount: 3 };
    const result = exec(
      { roll: { count: { path: "$.attackCount" } as any, sides: 6, storePath: "$.rolls" } },
      state,
      baseEvent,
      rng,
    );
    expect(get(result.state, "$.rolls.count")).toBe(3);
  });

  it("defaults sides to 6", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { roll: { count: 1, storePath: "$.r" } } as any,
      baseState,
      baseEvent,
      rng,
    );
    expect(get(result.state, "$.r.count")).toBe(1);
    const die = get(result.state, "$.r.d0") as any;
    expect(die.value).toBeGreaterThanOrEqual(1);
    expect(die.value).toBeLessThanOrEqual(6);
  });

  it("throws if rng not provided", () => {
    expect(() => exec({ roll: { count: 1, sides: 6, storePath: "$.r" } })).toThrow();
  });

  it("logs the roll result", () => {
    const rng = new SeededRNG(668);
    const result = exec(
      { roll: { count: 4, sides: 6, storePath: "$.hitRolls" } },
      baseState,
      baseEvent,
      rng,
    );
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].message).toContain("4d6");
    expect(result.logEntries[0].message).toContain("[2, 6, 4, 1]");
  });
});

describe("rerollDie effect", () => {
  const poolState: State = {
    hitRolls: {
      count: 3,
      d0: { value: 1, rerolled: false },
      d1: { value: 5, rerolled: false },
      d2: { value: 3, rerolled: false },
    },
  };

  it("rerolls a single die and marks it rerolled", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollDie: { poolPath: "$.hitRolls", dieIndex: 0, sides: 6 } },
      poolState,
      baseEvent,
      rng,
    );
    const die = get(result.state, "$.hitRolls.d0") as any;
    expect(die.rerolled).toBe(true);
    expect(die.value).toBeGreaterThanOrEqual(1);
    expect(die.value).toBeLessThanOrEqual(6);
  });

  it("preserves other fields on the die", () => {
    const state: State = {
      pool: { count: 1, d0: { value: 3, rerolled: false, spent: false } },
    };
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollDie: { poolPath: "$.pool", dieIndex: 0, sides: 6 } },
      state,
      baseEvent,
      rng,
    );
    const die = get(result.state, "$.pool.d0") as any;
    expect(die.rerolled).toBe(true);
    expect(die.spent).toBe(false);
  });

  it("throws if die already rerolled", () => {
    const state: State = {
      pool: { count: 1, d0: { value: 3, rerolled: true } },
    };
    const rng = new SeededRNG(42);
    expect(() =>
      exec({ rerollDie: { poolPath: "$.pool", dieIndex: 0, sides: 6 } }, state, baseEvent, rng),
    ).toThrow("already rerolled");
  });

  it("throws if rng not provided", () => {
    expect(() =>
      exec({ rerollDie: { poolPath: "$.hitRolls", dieIndex: 0, sides: 6 } }, poolState),
    ).toThrow();
  });

  it("logs the reroll", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollDie: { poolPath: "$.hitRolls", dieIndex: 0, sides: 6 } },
      poolState,
      baseEvent,
      rng,
    );
    expect(result.logEntries[0].message).toContain("die[0]");
    expect(result.logEntries[0].message).toContain("1 ->");
  });
});

describe("rerollPool effect", () => {
  const poolState: State = {
    pool: {
      count: 3,
      d0: { value: 1, rerolled: true, spent: false },
      d1: { value: 5, rerolled: false, spent: true },
      d2: { value: 3, rerolled: false, spent: false },
    },
  };

  it("rerolls all dice and resets rerolled and spent flags", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollPool: { poolPath: "$.pool", sides: 6 } },
      poolState,
      baseEvent,
      rng,
    );
    const dice = readDiePool(result.state, "$.pool");
    expect(dice).toHaveLength(3);
    for (const die of dice) {
      expect(die.rerolled).toBe(false);
      expect(die.spent).toBe(false);
      expect(die.value).toBeGreaterThanOrEqual(1);
      expect(die.value).toBeLessThanOrEqual(6);
    }
  });

  it("preserves count", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollPool: { poolPath: "$.pool", sides: 6 } },
      poolState,
      baseEvent,
      rng,
    );
    expect(get(result.state, "$.pool.count")).toBe(3);
  });

  it("logs the pool reroll", () => {
    const rng = new SeededRNG(42);
    const result = exec(
      { rerollPool: { poolPath: "$.pool", sides: 6 } },
      poolState,
      baseEvent,
      rng,
    );
    expect(result.logEntries[0].message).toContain("rerollPool");
    expect(result.logEntries[0].message).toContain("3d6");
  });
});

describe("spendDice effect", () => {
  const poolState: State = {
    pool: {
      count: 4,
      d0: { value: 6, rerolled: false, spent: false },
      d1: { value: 6, rerolled: false, spent: false },
      d2: { value: 3, rerolled: false, spent: false },
      d3: { value: 1, rerolled: false, spent: true },
    },
  };

  it("marks selected dice as spent", () => {
    const result = exec(
      { spendDice: { poolPath: "$.pool", dieIndices: [0, 1] } },
      poolState,
      baseEvent,
    );
    expect((get(result.state, "$.pool.d0") as any).spent).toBe(true);
    expect((get(result.state, "$.pool.d1") as any).spent).toBe(true);
    expect((get(result.state, "$.pool.d2") as any).spent).toBe(false);
  });

  it("throws if die already spent", () => {
    expect(() =>
      exec({ spendDice: { poolPath: "$.pool", dieIndices: [3] } }, poolState),
    ).toThrow("already spent");
  });

  it("preserves other fields", () => {
    const result = exec(
      { spendDice: { poolPath: "$.pool", dieIndices: [0] } },
      poolState,
      baseEvent,
    );
    const die = get(result.state, "$.pool.d0") as any;
    expect(die.value).toBe(6);
    expect(die.rerolled).toBe(false);
  });

  it("logs which dice were spent", () => {
    const result = exec(
      { spendDice: { poolPath: "$.pool", dieIndices: [0, 1] } },
      poolState,
      baseEvent,
    );
    expect(result.logEntries[0].message).toContain("[0, 1]");
  });
});

describe("setSeed effect", () => {
  it("reseeds the RNG", () => {
    const rng = new SeededRNG(1);
    exec({ setSeed: { seed: 668 } }, baseState, baseEvent, rng);
    expect(rng.getSeed()).toBe(668);
    // After reseed, should produce the known 668 sequence
    expect(rng.nextInt(1, 6)).toBe(2);
  });

  it("throws if rng not provided", () => {
    expect(() => exec({ setSeed: { seed: 42 } })).toThrow();
  });

  it("logs the reseed", () => {
    const rng = new SeededRNG(1);
    const result = exec({ setSeed: { seed: 668 } }, baseState, baseEvent, rng);
    expect(result.logEntries[0].message).toContain("668");
  });
});
```

- [ ] **Step 5.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/effects-roll.test.ts`
Expected: FAIL — unknown effect verbs

- [ ] **Step 5.3 — Update executeEffect signature and add RNG effects**

In `engine/src/rules/effects.ts`, make these changes:

1. Add imports at top:

```typescript
import { SeededRNG } from "../rng/index.js";
import { readDiePool } from "./pool-helpers.js";
```

2. Change the `executeEffect` signature to accept optional `rng`:

```typescript
export function executeEffect(
  state: State,
  effect: Effect,
  event: GameEvent,
  sourceRuleId: string,
  glossary: Glossary,
  rng?: SeededRNG,
): EffectResult {
```

3. Add the 5 new effect handlers before the final `throw` at the bottom:

```typescript
  if ("roll" in effect) {
    if (!rng) throw new Error("roll effect requires RNG — pass seed to engine constructor");
    const { sides = 6, storePath, defaults } = effect.roll;
    const count = resolveCount(effect.roll.count, state);
    let s = set(state, `${storePath}.count`, count);
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const value = rng.nextInt(1, sides);
      values.push(value);
      const die: Record<string, unknown> = { value, rerolled: false, ...defaults };
      s = set(s, `${storePath}.d${i}`, die);
    }
    result.state = s;
    result.logEntries.push({
      type: "note",
      message: `roll: ${count}d${sides} -> [${values.join(", ")}] at ${storePath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("rerollDie" in effect) {
    if (!rng) throw new Error("rerollDie effect requires RNG");
    const { poolPath, sides = 6 } = effect.rerollDie;
    const dieIndex = resolveCount(effect.rerollDie.dieIndex, state);
    const diePath = `${poolPath}.d${dieIndex}`;
    const die = get(state, diePath) as Record<string, unknown> | undefined;
    if (!die) throw new Error(`No die at ${diePath}`);
    if (die.rerolled === true) throw new Error(`Die ${dieIndex} already rerolled at ${poolPath}`);
    const oldValue = die.value;
    const newValue = rng.nextInt(1, sides);
    result.state = set(state, diePath, { ...die, value: newValue, rerolled: true });
    result.logEntries.push({
      type: "note",
      message: `reroll: die[${dieIndex}] ${oldValue} -> ${newValue} at ${poolPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("rerollPool" in effect) {
    if (!rng) throw new Error("rerollPool effect requires RNG");
    const { poolPath, sides = 6 } = effect.rerollPool;
    const count = get(state, `${poolPath}.count`) as number;
    if (typeof count !== "number") throw new Error(`No pool count at ${poolPath}`);
    let s = state;
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const oldDie = get(s, `${poolPath}.d${i}`) as Record<string, unknown> | undefined;
      const value = rng.nextInt(1, sides);
      values.push(value);
      // Preserve keys from original die but reset value, rerolled, spent
      const newDie: Record<string, unknown> = { ...oldDie, value, rerolled: false, spent: false };
      s = set(s, `${poolPath}.d${i}`, newDie);
    }
    result.state = s;
    result.logEntries.push({
      type: "note",
      message: `rerollPool: ${count}d${sides} -> [${values.join(", ")}] at ${poolPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("spendDice" in effect) {
    const { poolPath } = effect.spendDice;
    const dieIndices = resolveDieIndices(effect.spendDice.dieIndices, event);
    let s = state;
    for (const idx of dieIndices) {
      const diePath = `${poolPath}.d${idx}`;
      const die = get(s, diePath) as Record<string, unknown> | undefined;
      if (!die) throw new Error(`No die at ${diePath}`);
      if (die.spent === true) throw new Error(`Die ${idx} already spent at ${poolPath}`);
      s = set(s, diePath, { ...die, spent: true });
    }
    result.state = s;
    result.logEntries.push({
      type: "note",
      message: `spendDice: [${dieIndices.join(", ")}] at ${poolPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("setSeed" in effect) {
    if (!rng) throw new Error("setSeed effect requires RNG");
    const { seed } = effect.setSeed;
    rng.reseed(seed);
    result.logEntries.push({
      type: "note",
      message: `RNG reseeded to ${seed}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }
```

4. Add these two helper functions at the bottom of the file:

```typescript
/**
 * Resolve a count field that may be a literal or a state path reference.
 */
function resolveCount(countOrRef: number | { path: string }, state: State): number {
  if (typeof countOrRef === "number") return countOrRef;
  const val = get(state, countOrRef.path);
  if (typeof val !== "number") throw new Error(`Count path ${countOrRef.path} resolved to non-number: ${val}`);
  return val;
}

/**
 * Resolve dieIndices that may be a literal array or a fromChoice reference.
 */
function resolveDieIndices(
  indicesOrRef: number[] | { fromChoice: string },
  event: GameEvent,
): number[] {
  if (Array.isArray(indicesOrRef)) return indicesOrRef;
  const val = event.params[indicesOrRef.fromChoice];
  if (!Array.isArray(val)) throw new Error(`fromChoice ${indicesOrRef.fromChoice} did not resolve to array`);
  return val as number[];
}
```

- [ ] **Step 5.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/effects-roll.test.ts`
Expected: All tests PASS

- [ ] **Step 5.5 — Run full suite to verify no regressions**

Run: `cd engine && npx vitest run`
Expected: All tests PASS (existing tests call `executeEffect` without `rng` — the optional param is backward-compatible)

- [ ] **Step 5.6 — Commit**

```bash
git add engine/src/rules/effects.ts engine/tests/unit/effects-roll.test.ts
git commit -m "feat(m3): implement roll, rerollDie, rerollPool, spendDice, setSeed effects"
```

---

## Task 6: Pool Predicates — poolContainsPattern, diePoolCount

**Files:**
- Modify: `engine/src/rules/predicates.ts`
- Create: `engine/tests/unit/predicates-pool.test.ts`

- [ ] **Step 6.1 — Write failing tests**

Create `engine/tests/unit/predicates-pool.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluatePredicate } from "../../src/rules/predicates.js";
import type { PredicateNode, GameEvent, State, Glossary } from "../../src/types/index.js";

const glossary: Glossary = { keywords: [], selectors: {} };
const event: GameEvent = { id: "Test", params: {} };

/**
 * Pool: [1, 2, 2, 3, 4, 6, 6, 6]
 * d0=1, d1=2, d2=2, d3=3, d4=4, d5=6, d6=6, d7=6
 * d3 is spent
 */
const poolState: State = {
  pool: {
    count: 8,
    d0: { value: 1, rerolled: false, spent: false },
    d1: { value: 2, rerolled: false, spent: false },
    d2: { value: 2, rerolled: false, spent: false },
    d3: { value: 3, rerolled: false, spent: true },
    d4: { value: 4, rerolled: false, spent: false },
    d5: { value: 6, rerolled: false, spent: false },
    d6: { value: 6, rerolled: false, spent: false },
    d7: { value: 6, rerolled: false, spent: false },
  },
};

function check(node: PredicateNode, state = poolState): boolean {
  return evaluatePredicate(node, state, event, glossary);
}

describe("poolContainsPattern", () => {
  it("finds a double among unspent dice", () => {
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "double" } } }),
    ).toBe(true);
  });

  it("finds a double with minValue", () => {
    // Double 6 exists (d5, d6, d7)
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "double", minValue: 6 } } }),
    ).toBe(true);
  });

  it("rejects double with minValue too high", () => {
    // No unspent double 7+
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "double", minValue: 7 } } }),
    ).toBe(false);
  });

  it("finds a triple among unspent dice", () => {
    // Triple 6 exists (d5, d6, d7)
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple" } } }),
    ).toBe(true);
  });

  it("finds triple with minValue", () => {
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple", minValue: 6 } } }),
    ).toBe(true);
  });

  it("rejects triple with minValue when only double exists at that value", () => {
    // Double 2 exists but no triple 2
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple", minValue: 2 } } }),
    ).toBe(false);
  });

  it("respects filter — spent dice excluded", () => {
    // All dice spent except d4 (value 4)
    const allSpent: State = {
      pool: {
        count: 3,
        d0: { value: 6, rerolled: false, spent: true },
        d1: { value: 6, rerolled: false, spent: true },
        d2: { value: 4, rerolled: false, spent: false },
      },
    };
    expect(
      check(
        { poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "double" } } },
        allSpent,
      ),
    ).toBe(false);
  });

  it("works with no filter (considers all dice)", () => {
    const state: State = {
      pool: {
        count: 2,
        d0: { value: 3, rerolled: false, spent: true },
        d1: { value: 3, rerolled: false, spent: true },
      },
    };
    expect(
      check({ poolContainsPattern: { pool: "$.pool", pattern: { kind: "double" } } }, state),
    ).toBe(true);
  });

  it("returns false for empty or missing pool", () => {
    expect(
      check({ poolContainsPattern: { pool: "$.nopool", pattern: { kind: "double" } } }),
    ).toBe(false);
  });
});

describe("diePoolCount", () => {
  it("counts unspent dice", () => {
    expect(
      check({ diePoolCount: { pool: "$.pool", filter: { spent: false }, min: 7 } }),
    ).toBe(true); // 7 unspent (d3 is spent)
  });

  it("rejects when count below min", () => {
    expect(
      check({ diePoolCount: { pool: "$.pool", filter: { spent: false }, min: 8 } }),
    ).toBe(false); // only 7 unspent
  });

  it("counts with multiple filter fields", () => {
    expect(
      check({ diePoolCount: { pool: "$.pool", filter: { spent: false, rerolled: false }, min: 7 } }),
    ).toBe(true);
  });

  it("returns false for missing pool", () => {
    expect(
      check({ diePoolCount: { pool: "$.nopool", filter: { spent: false }, min: 1 } }),
    ).toBe(false);
  });
});
```

- [ ] **Step 6.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/predicates-pool.test.ts`
Expected: FAIL — unknown predicate type

- [ ] **Step 6.3 — Implement pool predicates**

In `engine/src/rules/predicates.ts`, add import at top:

```typescript
import { readDiePool, dieMatchesFilter } from "./pool-helpers.js";
```

Add these two predicate handlers before the final `throw`:

```typescript
  if ("poolContainsPattern" in node) {
    const { pool, filter, pattern } = (node as any).poolContainsPattern;
    const dice = readDiePool(state, pool);
    const filtered = dice.filter((d) => dieMatchesFilter(d, filter));
    const minVal = pattern.minValue ?? 1;
    const eligible = filtered.filter((d) => (d.value as number) >= minVal);

    // Group by value
    const groups = new Map<number, number>();
    for (const d of eligible) {
      const v = d.value as number;
      groups.set(v, (groups.get(v) ?? 0) + 1);
    }

    const needed = pattern.kind === "double" ? 2 : 3;
    for (const count of groups.values()) {
      if (count >= needed) return true;
    }
    return false;
  }

  if ("diePoolCount" in node) {
    const { pool, filter, min } = (node as any).diePoolCount;
    const dice = readDiePool(state, pool);
    const count = dice.filter((d) => dieMatchesFilter(d, filter)).length;
    return count >= min;
  }
```

- [ ] **Step 6.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/predicates-pool.test.ts`
Expected: All tests PASS

- [ ] **Step 6.5 — Run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6.6 — Commit**

```bash
git add engine/src/rules/predicates.ts engine/tests/unit/predicates-pool.test.ts
git commit -m "feat(m3): implement poolContainsPattern and diePoolCount predicates"
```

---

## Task 7: Engine Integration — RNG Wiring and Multi-Die Selection

**Files:**
- Modify: `engine/src/engine/index.ts`
- Create: `engine/tests/unit/choices-multiselect.test.ts`

- [ ] **Step 7.1 — Write failing tests for multi-die selection validation**

Create `engine/tests/unit/choices-multiselect.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateDieSelection } from "../../src/engine/index.js";
import type { State } from "../../src/types/index.js";

const poolState: State = {
  pool: {
    count: 4,
    d0: { value: 6, rerolled: false, spent: false },
    d1: { value: 6, rerolled: false, spent: false },
    d2: { value: 3, rerolled: false, spent: true },
    d3: { value: 1, rerolled: false, spent: false },
  },
};

describe("validateDieSelection", () => {
  it("accepts valid selection matching filter and pick count", () => {
    expect(() =>
      validateDieSelection(poolState, "$.pool", [0, 1], { spent: false }, 2),
    ).not.toThrow();
  });

  it("rejects if wrong number of dice selected", () => {
    expect(() =>
      validateDieSelection(poolState, "$.pool", [0], { spent: false }, 2),
    ).toThrow("Expected 2 dice, got 1");
  });

  it("rejects if die index out of range", () => {
    expect(() =>
      validateDieSelection(poolState, "$.pool", [0, 99], { spent: false }, 2),
    ).toThrow();
  });

  it("rejects if die does not match filter", () => {
    // d2 is spent, filter requires spent: false
    expect(() =>
      validateDieSelection(poolState, "$.pool", [0, 2], { spent: false }, 2),
    ).toThrow("does not match filter");
  });
});
```

- [ ] **Step 7.2 — Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/choices-multiselect.test.ts`
Expected: FAIL — function not found

- [ ] **Step 7.3 — Wire RNG into engine and add multi-die validation**

In `engine/src/engine/index.ts`:

1. Add imports:

```typescript
import { SeededRNG } from "../rng/index.js";
import { readDiePool, dieMatchesFilter } from "../rules/pool-helpers.js";
```

2. Change the constructor to accept options and create RNG:

```typescript
  constructor(pack: LoadedPack, options?: { seed?: number }) {
    this.pack = pack;
    this.state = { ...pack.initialState, _choices: [] };
    this.logger = new Logger();
    const seed = options?.seed ?? Date.now();
    this.rng = new SeededRNG(seed);
    this.logger.log("note", `Engine initialized with seed ${seed}`);
  }
```

3. Add `rng` as a private field:

```typescript
  private rng: SeededRNG;
```

4. Pass `this.rng` to `executeEffect` calls. There are two call sites in `evaluateEvent` and they both need `this.rng`. Change:

```typescript
      const effectResult = executeEffect(
        state,
        resolvedEffect.effect,
        event,
        resolvedEffect.ruleId,
        this.pack.glossary,
      );
```

to:

```typescript
      const effectResult = executeEffect(
        state,
        resolvedEffect.effect,
        event,
        resolvedEffect.ruleId,
        this.pack.glossary,
        this.rng,
      );
```

5. Update `addChoice` in the effect executor call in `applyChoice` — the `selectionFilter` and `pick` fields need to flow through to `ChoiceInstance`. These are already on the type (from Task 2) and the effect executor already spreads them (from the `addChoice` handler in effects.ts). Update the `addChoice` handler in `engine/src/rules/effects.ts` to pass them:

In the `addChoice` handler in `engine/src/rules/effects.ts`, update the choice construction:

```typescript
  if ("addChoice" in effect) {
    const { id, label, actionRef, limits, costs, selectionFrom, selectionFilter, pick } = effect.addChoice;
    choiceCounter++;
    const player = resolveCurrentPlayer(event);
    const choice: ChoiceInstance = {
      choiceInstanceId: `ci_${choiceCounter}`,
      choiceId: id,
      label,
      actionRef,
      player,
      sourceRuleId,
      createdAtEvent: event.id,
      state: "offered",
      selectionFrom,
      costs: costs as Record<string, number> | undefined,
      selectionFilter: selectionFilter as Record<string, unknown> | undefined,
      pick: pick as number | undefined,
    };
    result.newChoices.push(choice);
    return result;
  }
```

6. Add the `validateDieSelection` function and export it from `engine/src/engine/index.ts`:

```typescript
/**
 * Validate a multi-die selection against pool state.
 */
export function validateDieSelection(
  state: State,
  poolPath: string,
  selectedIndices: number[],
  filter: Record<string, unknown> | undefined,
  expectedPick: number,
): void {
  if (selectedIndices.length !== expectedPick) {
    throw new Error(`Expected ${expectedPick} dice, got ${selectedIndices.length}`);
  }
  const dice = readDiePool(state, poolPath);
  for (const idx of selectedIndices) {
    const die = dice.find((d) => d.index === idx);
    if (!die) {
      throw new Error(`Die index ${idx} not found in pool at ${poolPath}`);
    }
    if (!dieMatchesFilter(die, filter)) {
      throw new Error(`Die ${idx} does not match filter at ${poolPath}`);
    }
  }
}
```

7. In `applyChoice`, add validation for multi-die selections before processing:

After the cost deduction block and before `selectChoice`, add:

```typescript
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
```

- [ ] **Step 7.4 — Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/choices-multiselect.test.ts`
Expected: 4 tests PASS

- [ ] **Step 7.5 — Run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 7.6 — Commit**

```bash
git add engine/src/engine/index.ts engine/src/rules/effects.ts engine/src/types/rules.ts engine/tests/unit/choices-multiselect.test.ts
git commit -m "feat(m3): wire RNG into engine, add multi-die selection validation"
```

---

## Task 8: Update Exports

**Files:**
- Modify: `engine/src/rules/index.ts`

- [ ] **Step 8.1 — Check current rules/index.ts exports**

Read `engine/src/rules/index.ts` and ensure `pool-helpers` is exported if needed by integration tests.

- [ ] **Step 8.2 — Add pool-helpers exports**

In `engine/src/rules/index.ts`, add:

```typescript
export { readDiePool, dieMatchesFilter } from "./pool-helpers.js";
```

And in `engine/src/index.ts`, add:

```typescript
export { readDiePool, dieMatchesFilter } from "./rules/pool-helpers.js";
```

- [ ] **Step 8.3 — Run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 8.4 — Commit**

```bash
git add engine/src/rules/index.ts engine/src/index.ts
git commit -m "feat(m3): export pool-helpers and SeededRNG"
```

---

## Task 9: Integration Test — Attack Pipeline

**Files:**
- Create: `packs/attack-test/manifest.yaml`
- Create: `packs/attack-test/initial_state.json`
- Create: `packs/attack-test/timeline.yaml`
- Create: `packs/attack-test/glossary.yaml`
- Create: `packs/attack-test/rules.json`
- Create: `engine/tests/integration/attack-pipeline.test.ts`

- [ ] **Step 9.1 — Create attack-test pack**

Create `packs/attack-test/manifest.yaml`:

```yaml
name: attack-test
version: "0.1.0"
description: Minimal pack for testing hit resolution with dice rolls
```

Create `packs/attack-test/initial_state.json`:

```json
{
  "players": ["attacker", "defender"],
  "turnPlayer": "attacker",
  "resources": {
    "attacker": { "cp": 1 },
    "defender": { "cp": 0 }
  },
  "units": {
    "tactical_squad": {
      "id": "tactical_squad",
      "owner": "attacker",
      "statuses": {},
      "keywords": ["INFANTRY"],
      "attacks": 4,
      "ws": 3,
      "abilities": ["lethal_hits", "sustained_1"]
    }
  },
  "currentAttack": {},
  "usage": {}
}
```

Create `packs/attack-test/timeline.yaml`:

```yaml
timeline:
  - event: SetupAttack
    params:
      player: attacker
      unitId: tactical_squad
  - event: RollToHit
    params:
      player: attacker
      unitId: tactical_squad
  - forEach:
      count:
        path: "$.currentAttack.hitRolls.count"
      as: currentDieIndex
      sequence:
        - event: EvaluateHitDie
          params:
            player: attacker
            dieIndex: "{currentDieIndex}"
            diePath: "$.currentAttack.hitRolls.d{currentDieIndex}"
  - event: ResolveHitResults
    params:
      player: attacker
```

Create `packs/attack-test/glossary.yaml`:

```yaml
keywords:
  - INFANTRY

selectors:
  attacking_unit:
    kind: unit
    byEventParam: unitId
```

Create `packs/attack-test/rules.json`:

```json
[
  {
    "id": "setup_attack",
    "scope": "attack",
    "trigger": { "event": "SetupAttack" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.currentAttack.hits", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.autoWounds", "value": 0 } },
      { "setValue": { "path": "$.currentAttack.misses", "value": 0 } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "test" }
  },
  {
    "id": "roll_to_hit",
    "scope": "attack",
    "trigger": { "event": "RollToHit" },
    "when": { "all": [] },
    "effect": [
      { "roll": { "count": { "path": "$.units.tactical_squad.attacks" }, "sides": 6, "storePath": "$.currentAttack.hitRolls" } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "test" }
  },
  {
    "id": "evaluate_hit_miss",
    "scope": "attack",
    "trigger": { "event": "EvaluateHitDie" },
    "when": {
      "all": []
    },
    "effect": [
      { "appendLogNote": { "message": "Evaluating hit die" } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "test" }
  }
]
```

- [ ] **Step 9.2 — Write integration test**

Create `engine/tests/integration/attack-pipeline.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";

describe("Attack Pipeline (Section 13)", () => {
  it("rolls 4d6 hit dice with seed 668 producing [2, 6, 4, 1]", async () => {
    const pack = await loadPack("../../packs/attack-test");
    const engine = new SSCCEngine(pack, { seed: 668 });
    engine.initialize();

    // SetupAttack
    let result = engine.advanceToNextEvent();
    expect(result).not.toBeNull();
    expect(get(engine.getState(), "$.currentAttack.hits")).toBe(0);

    // RollToHit — triggers roll effect
    result = engine.advanceToNextEvent();
    expect(result).not.toBeNull();

    // Verify die bundles
    const state = engine.getState();
    expect(get(state, "$.currentAttack.hitRolls.count")).toBe(4);

    const dice = readDiePool(state, "$.currentAttack.hitRolls");
    expect(dice.map((d) => d.value)).toEqual([2, 6, 4, 1]);
    expect(dice.every((d) => d.rerolled === false)).toBe(true);
  });

  it("each die is individually addressable via state paths", async () => {
    const pack = await loadPack("../../packs/attack-test");
    const engine = new SSCCEngine(pack, { seed: 668 });
    engine.initialize();

    engine.advanceToNextEvent(); // SetupAttack
    engine.advanceToNextEvent(); // RollToHit

    const state = engine.getState();
    expect(get(state, "$.currentAttack.hitRolls.d0.value")).toBe(2);
    expect(get(state, "$.currentAttack.hitRolls.d1.value")).toBe(6);
    expect(get(state, "$.currentAttack.hitRolls.d2.value")).toBe(4);
    expect(get(state, "$.currentAttack.hitRolls.d3.value")).toBe(1);
  });

  it("seed determinism — same seed, same results", async () => {
    const pack = await loadPack("../../packs/attack-test");

    const engine1 = new SSCCEngine(pack, { seed: 668 });
    engine1.initialize();
    engine1.advanceToNextEvent();
    engine1.advanceToNextEvent();

    const engine2 = new SSCCEngine(pack, { seed: 668 });
    engine2.initialize();
    engine2.advanceToNextEvent();
    engine2.advanceToNextEvent();

    const dice1 = readDiePool(engine1.getState(), "$.currentAttack.hitRolls");
    const dice2 = readDiePool(engine2.getState(), "$.currentAttack.hitRolls");
    expect(dice1.map((d) => d.value)).toEqual(dice2.map((d) => d.value));
  });
});
```

- [ ] **Step 9.3 — Run integration test**

Run: `cd engine && npx vitest run tests/integration/attack-pipeline.test.ts`
Expected: 3 tests PASS

- [ ] **Step 9.4 — Commit**

```bash
git add packs/attack-test/ engine/tests/integration/attack-pipeline.test.ts
git commit -m "feat(m3): add attack pipeline integration test with seed 668"
```

---

## Task 10: Integration Test — Blessings of Khorne

**Files:**
- Create: `packs/blessings-test/manifest.yaml`
- Create: `packs/blessings-test/initial_state.json`
- Create: `packs/blessings-test/timeline.yaml`
- Create: `packs/blessings-test/glossary.yaml`
- Create: `packs/blessings-test/rules.json`
- Create: `engine/tests/integration/blessings.test.ts`

- [ ] **Step 10.1 — Create blessings-test pack**

Create `packs/blessings-test/manifest.yaml`:

```yaml
name: blessings-test
version: "0.1.0"
description: Minimal pack for testing Blessings of Khorne dice pool
```

Create `packs/blessings-test/initial_state.json`:

```json
{
  "players": ["worldeaters"],
  "turnPlayer": "worldeaters",
  "resources": {
    "worldeaters": { "cp": 2 }
  },
  "units": {},
  "blessingsActivated": 0,
  "usage": {}
}
```

Create `packs/blessings-test/timeline.yaml`:

```yaml
timeline:
  - event: BattleRoundStart
    params:
      player: worldeaters
  - event: BlessingsOfKhorne
    params:
      player: worldeaters
```

Create `packs/blessings-test/glossary.yaml`:

```yaml
keywords: []
selectors: {}
```

Create `packs/blessings-test/rules.json`:

```json
[
  {
    "id": "roll_blessings",
    "scope": "global",
    "trigger": { "event": "BlessingsOfKhorne" },
    "when": { "all": [] },
    "effect": [
      { "roll": { "count": 8, "sides": 6, "storePath": "$.blessingsRoll", "defaults": { "rerolled": false, "spent": false } } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "World Eaters Index" }
  },
  {
    "id": "offer_warp_blades",
    "scope": "global",
    "trigger": { "event": "BlessingsOfKhorne" },
    "when": {
      "all": [
        { "any": [
          { "poolContainsPattern": { "pool": "$.blessingsRoll", "filter": { "spent": false }, "pattern": { "kind": "double", "minValue": 5 } } },
          { "poolContainsPattern": { "pool": "$.blessingsRoll", "filter": { "spent": false }, "pattern": { "kind": "triple" } } }
        ] },
        { "counterAtLeast": { "path": "$.blessingsActivated", "value": 0 } },
        { "not": { "counterAtLeast": { "path": "$.blessingsActivated", "value": 2 } } }
      ]
    },
    "effect": [
      { "addChoice": {
          "id": "warp_blades",
          "label": "Warp Blades (double 5+ or triple)",
          "actionRef": "doActivateWarpBlades",
          "selectionFrom": { "path": "$.blessingsRoll" },
          "selectionFilter": { "spent": false },
          "pick": 2
      } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "World Eaters Index" }
  },
  {
    "id": "offer_wrathful_devotion",
    "scope": "global",
    "trigger": { "event": "BlessingsOfKhorne" },
    "when": {
      "all": [
        { "poolContainsPattern": { "pool": "$.blessingsRoll", "filter": { "spent": false }, "pattern": { "kind": "double" } } },
        { "counterAtLeast": { "path": "$.blessingsActivated", "value": 0 } },
        { "not": { "counterAtLeast": { "path": "$.blessingsActivated", "value": 2 } } }
      ]
    },
    "effect": [
      { "addChoice": {
          "id": "wrathful_devotion",
          "label": "Wrathful Devotion (any double)",
          "actionRef": "doActivateWrathfulDevotion",
          "selectionFrom": { "path": "$.blessingsRoll" },
          "selectionFilter": { "spent": false },
          "pick": 2
      } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "World Eaters Index" }
  },
  {
    "id": "do_activate_warp_blades",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "pathEquals": { "path": "$.event.choiceId", "value": "warp_blades" }
    },
    "effect": [
      { "spendDice": { "poolPath": "$.blessingsRoll", "dieIndices": { "fromChoice": "selectedDice" } } },
      { "modifyCounter": { "path": "$.blessingsActivated", "delta": 1 } },
      { "setValue": { "path": "$.blessings.warpBlades", "value": true } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "World Eaters Index" }
  },
  {
    "id": "do_activate_wrathful_devotion",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "pathEquals": { "path": "$.event.choiceId", "value": "wrathful_devotion" }
    },
    "effect": [
      { "spendDice": { "poolPath": "$.blessingsRoll", "dieIndices": { "fromChoice": "selectedDice" } } },
      { "modifyCounter": { "path": "$.blessingsActivated", "delta": 1 } },
      { "setValue": { "path": "$.blessings.wrathfulDevotion", "value": true } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "World Eaters Index" }
  }
]
```

- [ ] **Step 10.2 — Write integration test**

We need a seed that produces a pool with known patterns. We'll discover the seed in the test itself by trying seed candidates, or use a known approach. For determinism, we'll pick a seed and verify the pool in the test.

Create `engine/tests/integration/blessings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { SeededRNG } from "../../src/rng/index.js";

/**
 * Find a seed that produces a pool containing at least one double 5+
 * and one other double (for testing two blessings).
 */
function findBlessingsSeed(): { seed: number; values: number[] } {
  for (let seed = 0; seed < 10000; seed++) {
    const rng = new SeededRNG(seed);
    const values: number[] = [];
    for (let i = 0; i < 8; i++) values.push(rng.nextInt(1, 6));
    // Count by value
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    // Need: at least one pair with value >= 5, and another pair of any value
    let highPairs = 0;
    let totalPairs = 0;
    for (const [val, count] of counts) {
      const pairs = Math.floor(count / 2);
      totalPairs += pairs;
      if (val >= 5) highPairs += pairs;
    }
    if (highPairs >= 1 && totalPairs >= 2) {
      return { seed, values };
    }
  }
  throw new Error("No suitable seed found");
}

describe("Blessings of Khorne", () => {
  const { seed: blessingsSeed, values: expectedValues } = findBlessingsSeed();

  it("rolls 8d6 pool with spent tracking", async () => {
    const pack = await loadPack("../../packs/blessings-test");
    const engine = new SSCCEngine(pack, { seed: blessingsSeed });
    engine.initialize();

    // BattleRoundStart
    engine.advanceToNextEvent();

    // BlessingsOfKhorne — triggers roll + choice offers
    const result = engine.advanceToNextEvent();
    expect(result?.paused).toBe(true);

    const state = engine.getState();
    expect(get(state, "$.blessingsRoll.count")).toBe(8);

    const dice = readDiePool(state, "$.blessingsRoll");
    expect(dice.map((d) => d.value)).toEqual(expectedValues);
    expect(dice.every((d) => d.spent === false)).toBe(true);
    expect(dice.every((d) => d.rerolled === false)).toBe(true);
  });

  it("offers blessing choices based on pool patterns", async () => {
    const pack = await loadPack("../../packs/blessings-test");
    const engine = new SSCCEngine(pack, { seed: blessingsSeed });
    engine.initialize();

    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    const choices = engine.enumerateChoices();
    expect(choices.length).toBeGreaterThanOrEqual(1);

    const warpBlades = choices.find((c) => c.choiceId === "warp_blades");
    expect(warpBlades).toBeDefined();
    expect(warpBlades!.pick).toBe(2);
    expect(warpBlades!.selectionFilter).toEqual({ spent: false });
  });

  it("spending dice marks them spent and increments counter", async () => {
    const pack = await loadPack("../../packs/blessings-test");
    const engine = new SSCCEngine(pack, { seed: blessingsSeed });
    engine.initialize();

    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    // Find a valid double 5+ in the pool
    const dice = readDiePool(engine.getState(), "$.blessingsRoll");
    const highDice = dice.filter((d) => (d.value as number) >= 5);
    const counts = new Map<number, number[]>();
    for (const d of highDice) {
      const v = d.value as number;
      if (!counts.has(v)) counts.set(v, []);
      counts.get(v)!.push(d.index);
    }
    let pairIndices: number[] = [];
    for (const indices of counts.values()) {
      if (indices.length >= 2) {
        pairIndices = [indices[0], indices[1]];
        break;
      }
    }
    expect(pairIndices.length).toBe(2);

    // Select Warp Blades with the found pair
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pairIndices });

    const state = engine.getState();
    // Dice should be spent
    for (const idx of pairIndices) {
      expect((get(state, `$.blessingsRoll.d${idx}`) as any).spent).toBe(true);
    }
    // Counter incremented
    expect(get(state, "$.blessingsActivated")).toBe(1);
    // Blessing activated
    expect(get(state, "$.blessings.warpBlades")).toBe(true);
  });
});
```

- [ ] **Step 10.3 — Run integration test**

Run: `cd engine && npx vitest run tests/integration/blessings.test.ts`
Expected: 3 tests PASS

- [ ] **Step 10.4 — Run full test suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS

- [ ] **Step 10.5 — Commit**

```bash
git add packs/blessings-test/ engine/tests/integration/blessings.test.ts
git commit -m "feat(m3): add Blessings of Khorne integration test with pool patterns"
```

---

## Task 11: Final Validation

- [ ] **Step 11.1 — Run full test suite**

Run: `cd engine && npx vitest run`
Expected: All tests PASS. Count should be ~130+ (105 existing + ~25 new).

- [ ] **Step 11.2 — TypeScript check**

Run: `cd engine && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 11.3 — Commit all remaining changes**

If any unstaged changes remain, commit them.

- [ ] **Step 11.4 — Final commit**

```bash
git add -A
git commit -m "feat(m3): milestone 3 complete — dice engine with seeded RNG, state bundles, pool operations"
```
