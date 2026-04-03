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
    expect(() =>
      validateDieSelection(poolState, "$.pool", [0, 2], { spent: false }, 2),
    ).toThrow("does not match filter");
  });
});
