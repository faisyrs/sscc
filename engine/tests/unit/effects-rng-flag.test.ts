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
