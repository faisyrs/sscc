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
