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
