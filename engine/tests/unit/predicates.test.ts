import { describe, it, expect } from "vitest";
import { evaluatePredicate } from "../../src/rules/predicates.js";
import type { PredicateNode } from "../../src/types/index.js";
import type { GameEvent, State } from "../../src/types/index.js";
import type { Glossary } from "../../src/types/index.js";

const glossary: Glossary = {
  keywords: ["INFANTRY"],
  selectors: {
    units_can_move: { kind: "unit", where: { hasStatus: { key: "can_move" } } },
    empty_selector: { kind: "unit", where: { hasStatus: { key: "nonexistent_status" } } },
    all_units: { kind: "unit", all: true },
  },
};

const baseState: State = {
  turnPlayer: "A",
  units: {
    u1: { id: "u1", owner: "A", keywords: ["INFANTRY"], statuses: { can_move: { expiresOn: null } } },
    u2: { id: "u2", owner: "B", keywords: ["VEHICLE"], statuses: {} },
  },
  resources: { A: { cp: 3 }, B: { cp: 0 } },
  activation: { unitId: "u1" },
};

const baseEvent: GameEvent = { id: "MovementPhaseStarted", params: { player: "A" } };

function evaluate(pred: PredicateNode, state = baseState, event = baseEvent) {
  return evaluatePredicate(pred, state, event, glossary);
}

describe("Composition predicates", () => {
  it("all with empty array is vacuously true", () => {
    expect(evaluate({ all: [] })).toBe(true);
  });

  it("all with mixed results returns false", () => {
    expect(
      evaluate({
        all: [
          { pathEquals: { path: "$.turnPlayer", value: "A" } },
          { pathEquals: { path: "$.turnPlayer", value: "B" } },
        ],
      }),
    ).toBe(false);
  });

  it("any returns true when at least one child is true", () => {
    expect(
      evaluate({
        any: [
          { pathEquals: { path: "$.turnPlayer", value: "B" } },
          { pathEquals: { path: "$.turnPlayer", value: "A" } },
        ],
      }),
    ).toBe(true);
  });

  it("any with empty array is false", () => {
    expect(evaluate({ any: [] })).toBe(false);
  });

  it("not negates", () => {
    expect(evaluate({ not: { pathEquals: { path: "$.turnPlayer", value: "B" } } })).toBe(true);
  });

  it("nested composition: all containing not containing any", () => {
    expect(
      evaluate({
        all: [
          { not: { any: [{ pathEquals: { path: "$.turnPlayer", value: "B" } }] } },
        ],
      }),
    ).toBe(true);
  });
});

describe("pathEquals", () => {
  it("matches literal value", () => {
    expect(evaluate({ pathEquals: { path: "$.turnPlayer", value: "A" } })).toBe(true);
  });

  it("matches value from event param", () => {
    expect(evaluate({ pathEquals: { path: "$.turnPlayer", valueFromEventParam: "player" } })).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(evaluate({ pathEquals: { path: "$.turnPlayer", value: "B" } })).toBe(false);
  });
});

describe("pathIn", () => {
  it("returns true if value is in the array at path", () => {
    const state = { ...baseState, items: ["x", "y", "z"] };
    expect(evaluate({ pathIn: { path: "$.items", value: "y" } }, state)).toBe(true);
  });

  it("returns false if value is not in array", () => {
    const state = { ...baseState, items: ["x", "y"] };
    expect(evaluate({ pathIn: { path: "$.items", value: "z" } }, state)).toBe(false);
  });
});

describe("pathAtLeast", () => {
  it("returns true when value >= threshold", () => {
    expect(evaluate({ pathAtLeast: { path: "$.resources.A.cp", value: 3 } })).toBe(true);
  });

  it("returns false when value < threshold", () => {
    expect(evaluate({ pathAtLeast: { path: "$.resources.A.cp", value: 4 } })).toBe(false);
  });
});

describe("pathMissing", () => {
  it("returns true for missing path", () => {
    expect(evaluate({ pathMissing: { path: "$.nonexistent" } })).toBe(true);
  });

  it("returns false for present path", () => {
    expect(evaluate({ pathMissing: { path: "$.turnPlayer" } })).toBe(false);
  });
});

describe("eventParamEquals", () => {
  it("matches event parameter", () => {
    expect(evaluate({ eventParamEquals: { param: "player", value: "A" } })).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(evaluate({ eventParamEquals: { param: "player", value: "B" } })).toBe(false);
  });

  it("returns false for missing param", () => {
    expect(evaluate({ eventParamEquals: { param: "missing", value: "A" } })).toBe(false);
  });
});

describe("resourceAtLeast", () => {
  it("returns true when resource >= amount", () => {
    expect(
      evaluate({ resourceAtLeast: { player: { eventParam: "player" }, resource: "cp", amount: 2 } }),
    ).toBe(true);
  });

  it("returns false when resource < amount", () => {
    expect(
      evaluate({ resourceAtLeast: { player: { literal: "B" }, resource: "cp", amount: 1 } }),
    ).toBe(false);
  });
});

describe("counterAtLeast and counterEquals", () => {
  it("counterAtLeast returns true when >=", () => {
    expect(evaluate({ counterAtLeast: { path: "$.resources.A.cp", value: 3 } })).toBe(true);
  });

  it("counterEquals returns true on exact match", () => {
    expect(evaluate({ counterEquals: { path: "$.resources.A.cp", value: 3 } })).toBe(true);
  });

  it("counterEquals returns false on mismatch", () => {
    expect(evaluate({ counterEquals: { path: "$.resources.A.cp", value: 2 } })).toBe(false);
  });
});

describe("hasStatus and missingStatus", () => {
  it("hasStatus with path target", () => {
    expect(
      evaluate({ hasStatus: { target: { path: "$.activation.unitId" }, key: "can_move" } }),
    ).toBe(true);
  });

  it("missingStatus with path target", () => {
    expect(
      evaluate({ missingStatus: { target: { path: "$.activation.unitId" }, key: "can_move" } }),
    ).toBe(false);
  });

  it("missingStatus returns true when status absent", () => {
    expect(
      evaluate({ missingStatus: { target: { path: "$.activation.unitId" }, key: "advanced_move" } }),
    ).toBe(true);
  });
});

describe("tagPresent", () => {
  it("returns true when keyword present", () => {
    expect(
      evaluate({ tagPresent: { target: { path: "$.activation.unitId" }, tag: "INFANTRY" } }),
    ).toBe(true);
  });

  it("returns false when keyword absent", () => {
    expect(
      evaluate({ tagPresent: { target: { path: "$.activation.unitId" }, tag: "VEHICLE" } }),
    ).toBe(false);
  });
});

describe("selector predicate", () => {
  it("returns true when selector produces non-empty set", () => {
    expect(evaluate({ selector: { id: "units_can_move" } })).toBe(true);
  });

  it("returns false when selector produces empty set", () => {
    expect(evaluate({ selector: { id: "empty_selector" } })).toBe(false);
  });
});
