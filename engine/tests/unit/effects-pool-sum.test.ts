import { describe, it, expect } from "vitest";
import { executeEffect } from "../../src/rules/effects.js";
import type { Effect, GameEvent, State, Glossary } from "../../src/types/index.js";
import { get } from "../../src/state/index.js";

const glossary: Glossary = { keywords: [], selectors: {} };
const baseEvent: GameEvent = { id: "BattleshockTestResolve", params: { player: "A" } };

function exec(effect: Effect, state: State) {
  return executeEffect(state, effect, baseEvent, "test-rule", glossary);
}

describe("computePoolSum effect", () => {
  it("sums all dice values in pool and writes to targetPath", () => {
    const state: State = {
      battleshock: {
        rollResult: {
          count: 2,
          d0: { value: 3, rerolled: false },
          d1: { value: 5, rerolled: false },
        },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.battleshock.rollResult", targetPath: "$.battleshock.sum" } },
      state,
    );
    expect(get(result.state, "$.battleshock.sum")).toBe(8);
  });

  it("skips spent dice when skipSpent is true", () => {
    const state: State = {
      pool: {
        count: 3,
        d0: { value: 4, rerolled: false, spent: false },
        d1: { value: 2, rerolled: false, spent: true },
        d2: { value: 6, rerolled: false, spent: false },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.pool", targetPath: "$.poolTotal", skipSpent: true } },
      state,
    );
    expect(get(result.state, "$.poolTotal")).toBe(10);
  });

  it("includes spent dice when skipSpent is false/absent", () => {
    const state: State = {
      pool: {
        count: 2,
        d0: { value: 3, rerolled: false, spent: true },
        d1: { value: 4, rerolled: false, spent: false },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.pool", targetPath: "$.total" } },
      state,
    );
    expect(get(result.state, "$.total")).toBe(7);
  });

  it("writes 0 for empty pool", () => {
    const state: State = {
      pool: { count: 0 },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.pool", targetPath: "$.total" } },
      state,
    );
    expect(get(result.state, "$.total")).toBe(0);
  });

  it("throws when pool has no count", () => {
    const state: State = { pool: {} };
    expect(() =>
      exec(
        { computePoolSum: { poolPath: "$.pool", targetPath: "$.total" } },
        state,
      ),
    ).toThrow();
  });

  it("logs the sum result", () => {
    const state: State = {
      roll: {
        count: 2,
        d0: { value: 1, rerolled: false },
        d1: { value: 6, rerolled: false },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.roll", targetPath: "$.sum" } },
      state,
    );
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].message).toContain("7");
    expect(result.logEntries[0].message).toContain("$.roll");
  });
});
