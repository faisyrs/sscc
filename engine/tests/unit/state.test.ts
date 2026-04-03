import { describe, it, expect } from "vitest";
import {
  get,
  set,
  applyStatus,
  removeStatus,
  expireStatuses,
  getStatuses,
} from "../../src/state/index.js";

describe("State path resolution", () => {
  const state = {
    units: {
      u1: { statuses: {}, name: "Alpha" },
      u2: { statuses: {}, name: "Beta" },
    },
    turnPlayer: null,
    resources: { A: { cp: 3 } },
    nested: { deep: { value: 42 } },
  };

  it("resolves a nested path", () => {
    expect(get(state, "$.nested.deep.value")).toBe(42);
  });

  it("returns undefined for missing key in existing parent", () => {
    expect(get(state, "$.nested.deep.nonexistent")).toBeUndefined();
  });

  it("returns undefined for path through null", () => {
    expect(get(state, "$.turnPlayer.something")).toBeUndefined();
  });

  it("returns null for a path whose value is null", () => {
    expect(get(state, "$.turnPlayer")).toBeNull();
  });

  it("returns the root when path is $", () => {
    expect(get(state, "$")).toBe(state);
  });
});

describe("State set", () => {
  const state = { a: { b: { c: 1 } }, x: 10 };

  it("returns new state with changed value, original unchanged", () => {
    const next = set(state, "$.a.b.c", 99);
    expect(get(next, "$.a.b.c")).toBe(99);
    expect(get(state, "$.a.b.c")).toBe(1);
  });

  it("preserves sibling references (structural sharing)", () => {
    const state2 = { a: { b: 1 }, c: { d: 2 } };
    const next = set(state2, "$.a.b", 99);
    expect((next as any).c).toBe((state2 as any).c);
  });

  it("creates intermediate objects for missing path segments", () => {
    const next = set({}, "$.a.b.c", "hello");
    expect(get(next, "$.a.b.c")).toBe("hello");
  });
});

describe("Status apply/remove/expire", () => {
  it("applies a status with expiresOn", () => {
    const state = { units: { u1: { statuses: {} } } };
    const next = applyStatus(state, "u1", "can_move", null);
    const statuses = getStatuses(next, "u1");
    expect(statuses).toEqual({ can_move: { expiresOn: null } });
  });

  it("applying same status twice is idempotent", () => {
    const state = { units: { u1: { statuses: {} } } };
    const s1 = applyStatus(state, "u1", "can_move", null);
    const s2 = applyStatus(s1, "u1", "can_move", null);
    expect(getStatuses(s2, "u1")).toEqual({ can_move: { expiresOn: null } });
  });

  it("removes a status", () => {
    const state = { units: { u1: { statuses: { can_move: { expiresOn: null } } } } };
    const next = removeStatus(state, "u1", "can_move");
    expect(getStatuses(next, "u1")).toEqual({});
  });

  it("removing a non-existent status is a no-op", () => {
    const state = { units: { u1: { statuses: {} } } };
    const next = removeStatus(state, "u1", "can_move");
    expect(getStatuses(next, "u1")).toEqual({});
  });

  it("expires statuses matching event ID across all entities", () => {
    const state = {
      units: {
        u1: { statuses: { advanced_move: { expiresOn: "TurnEnded" }, can_move: { expiresOn: null } } },
        u2: { statuses: { fell_back: { expiresOn: "TurnEnded" } } },
      },
    };
    const next = expireStatuses(state, "TurnEnded");
    expect(getStatuses(next, "u1")).toEqual({ can_move: { expiresOn: null } });
    expect(getStatuses(next, "u2")).toEqual({});
  });

  it("expire with no matching statuses returns equivalent state", () => {
    const state = { units: { u1: { statuses: { x: { expiresOn: "Other" } } } } };
    const next = expireStatuses(state, "TurnEnded");
    expect(getStatuses(next, "u1")).toEqual({ x: { expiresOn: "Other" } });
  });
});
