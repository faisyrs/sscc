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
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "double", minValue: 6 } } }),
    ).toBe(true);
  });

  it("rejects double with minValue too high", () => {
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "double", minValue: 7 } } }),
    ).toBe(false);
  });

  it("finds a triple among unspent dice", () => {
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple" } } }),
    ).toBe(true);
  });

  it("finds triple with minValue", () => {
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple", minValue: 6 } } }),
    ).toBe(true);
  });

  it("finds triple with minValue when higher values also qualify", () => {
    // minValue 2 means >= 2; triple of 6s qualifies
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple", minValue: 2 } } }),
    ).toBe(true);
  });

  it("rejects triple when no group of 3+ exists at or above minValue", () => {
    // Only a double of 2s and triple of 6s among unspent; minValue 7 excludes all
    expect(
      check({ poolContainsPattern: { pool: "$.pool", filter: { spent: false }, pattern: { kind: "triple", minValue: 7 } } }),
    ).toBe(false);
  });

  it("respects filter — spent dice excluded", () => {
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
    ).toBe(true);
  });

  it("rejects when count below min", () => {
    expect(
      check({ diePoolCount: { pool: "$.pool", filter: { spent: false }, min: 8 } }),
    ).toBe(false);
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
