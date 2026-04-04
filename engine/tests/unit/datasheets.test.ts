import { describe, it, expect } from "vitest";
import { parseDatasheets, mergeDatasheets } from "../../src/loader/datasheets.js";
import type { State } from "../../src/types/index.js";

describe("parseDatasheets", () => {
  it("parses a valid datasheets object", () => {
    const raw = {
      datasheets: {
        intercessor_squad: {
          name: "Intercessor Squad",
          keywords: ["INFANTRY"],
          stats: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
          profiles: {
            ranged: { id: "wp_bolt", name: "Bolt Rifle", A: 2, BS: 3, S: 4, AP: -1, D: 1, keywords: [] },
          },
        },
      },
    };
    const result = parseDatasheets(raw);
    expect(result.get("intercessor_squad")).toBeDefined();
    expect(result.get("intercessor_squad")!.name).toBe("Intercessor Squad");
    expect(result.get("intercessor_squad")!.stats.Ld).toBe(6);
  });

  it("returns empty map for undefined input", () => {
    const result = parseDatasheets(undefined);
    expect(result.size).toBe(0);
  });

  it("returns empty map for null input", () => {
    const result = parseDatasheets(null);
    expect(result.size).toBe(0);
  });
});

describe("mergeDatasheets", () => {
  const datasheets = new Map([
    [
      "intercessor_squad",
      {
        name: "Intercessor Squad",
        keywords: ["INFANTRY"],
        stats: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
        profiles: {
          ranged: { id: "wp_bolt", name: "Bolt Rifle", A: 2, BS: 3, S: 4, AP: -1, D: 1, keywords: [] as string[] },
        },
      },
    ],
  ]);

  it("merges datasheet fields into unit state", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          datasheet: "intercessor_squad",
          models: { total: 5, remaining: 5 },
          statuses: {},
        },
      },
    };
    const { state: merged, errors } = mergeDatasheets(state, datasheets);
    expect(errors).toHaveLength(0);
    const u1 = (merged as any).units.u1;
    expect(u1.name).toBe("Intercessor Squad");
    expect(u1.keywords).toEqual(["INFANTRY"]);
    expect(u1.stats.Ld).toBe(6);
    expect(u1.profiles.ranged.id).toBe("wp_bolt");
    expect(u1.datasheet).toBeUndefined();
  });

  it("unit-level fields override datasheet fields", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          datasheet: "intercessor_squad",
          name: "Custom Name",
          models: { total: 5, remaining: 5 },
          statuses: {},
        },
      },
    };
    const { state: merged } = mergeDatasheets(state, datasheets);
    expect((merged as any).units.u1.name).toBe("Custom Name");
  });

  it("returns error for missing datasheet reference", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          datasheet: "nonexistent",
          models: { total: 5, remaining: 5 },
          statuses: {},
        },
      },
    };
    const { errors } = mergeDatasheets(state, datasheets);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("DATASHEET_NOT_FOUND");
    expect(errors[0].message).toContain("nonexistent");
  });

  it("skips units without datasheet field", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          name: "Manual Unit",
          keywords: ["VEHICLE"],
          stats: { M: 10, T: 8, Sv: 2, W: 12, Ld: 7, OC: 4 },
          models: { total: 1, remaining: 1 },
          statuses: {},
        },
      },
    };
    const { state: merged, errors } = mergeDatasheets(state, datasheets);
    expect(errors).toHaveLength(0);
    expect((merged as any).units.u1.name).toBe("Manual Unit");
  });

  it("works when datasheets map is empty", () => {
    const state: State = {
      units: {
        u1: { id: "u1", owner: "A", models: { total: 5, remaining: 5 }, statuses: {} },
      },
    };
    const { state: merged, errors } = mergeDatasheets(state, new Map());
    expect(errors).toHaveLength(0);
    expect(merged).toEqual(state);
  });
});
