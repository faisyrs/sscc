import { describe, it, expect } from "vitest";
import { resolveConflicts, getConflictDomain } from "../../src/rules/conflicts.js";
import type { Rule, Effect } from "../../src/types/index.js";

function makeRule(id: string, priority: number, strategy: "stack" | "override" | "patch", effects: Effect[]): Rule {
  return {
    id,
    scope: "global",
    trigger: { event: "TestEvent" },
    when: { all: [] },
    effect: effects,
    precedence: { priority, strategy },
    provenance: { source: "test" },
  };
}

describe("getConflictDomain", () => {
  it("returns (path) for setValue", () => {
    const domain = getConflictDomain({ setValue: { path: "$.x", value: 1 } });
    expect(domain).toBe("setValue:$.x");
  });

  it("returns null for stackable effects like emit", () => {
    const domain = getConflictDomain({ emit: { eventId: "E1" } });
    expect(domain).toBeNull();
  });

  it("returns null for appendLogNote", () => {
    const domain = getConflictDomain({ appendLogNote: { message: "hi" } });
    expect(domain).toBeNull();
  });
});

describe("resolveConflicts", () => {
  it("stacks all rules when strategy is stack", () => {
    const rules = [
      makeRule("r1", 10, "stack", [{ modifyCounter: { path: "$.x", delta: 1 } }]),
      makeRule("r2", 20, "stack", [{ modifyCounter: { path: "$.x", delta: 2 } }]),
    ];
    const resolved = resolveConflicts(rules);
    // Both effects should be present, ordered by ascending priority
    expect(resolved).toHaveLength(2);
    expect(resolved[0].ruleId).toBe("r1");
    expect(resolved[1].ruleId).toBe("r2");
  });

  it("override: highest priority wins", () => {
    const rules = [
      makeRule("r1", 10, "override", [{ setValue: { path: "$.x", value: "low" } }]),
      makeRule("r2", 50, "override", [{ setValue: { path: "$.x", value: "high" } }]),
    ];
    const resolved = resolveConflicts(rules);
    // Only r2 should survive for the setValue:$.x domain
    const setValues = resolved.filter((r) => {
      const eff = r.effect;
      return "setValue" in eff && (eff as any).setValue.path === "$.x";
    });
    expect(setValues).toHaveLength(1);
    expect(setValues[0].ruleId).toBe("r2");
  });

  it("patch applies after stack/override", () => {
    const rules = [
      makeRule("r1", 10, "stack", [{ setValue: { path: "$.x", value: "base" } }]),
      makeRule("r2", 50, "patch", [{ setValue: { path: "$.x", value: "patched" } }]),
    ];
    const resolved = resolveConflicts(rules);
    // r1 first, then r2 (patch)
    expect(resolved).toHaveLength(2);
    expect(resolved[0].ruleId).toBe("r1");
    expect(resolved[1].ruleId).toBe("r2");
  });

  it("effects without conflict domains always pass through", () => {
    const rules = [
      makeRule("r1", 10, "stack", [
        { emit: { eventId: "E1" } },
        { emit: { eventId: "E2" } },
      ]),
      makeRule("r2", 20, "stack", [{ emit: { eventId: "E3" } }]),
    ];
    const resolved = resolveConflicts(rules);
    expect(resolved).toHaveLength(3);
  });

  it("ascending priority order: low fires first", () => {
    const rules = [
      makeRule("r_high", 50, "stack", [{ appendLogNote: { message: "high" } }]),
      makeRule("r_low", 5, "stack", [{ appendLogNote: { message: "low" } }]),
    ];
    const resolved = resolveConflicts(rules);
    expect(resolved[0].ruleId).toBe("r_low");
    expect(resolved[1].ruleId).toBe("r_high");
  });
});
