import { describe, it, expect } from "vitest";
import {
  renderHeader,
  renderUnits,
  renderDicePool,
  renderChoices,
  renderEventLine,
} from "../src/renderer.js";
import type { State, GameEvent, ChoiceInstance } from "../../engine/src/types/index.js";

describe("renderHeader", () => {
  it("formats round, phase, and player", () => {
    const event: GameEvent = { id: "ShootingPhaseStart", params: { player: "attacker" } };
    const state: State = { battleRound: 2 };
    const output = renderHeader(state, event);
    expect(output).toContain("Battle Round 2");
    expect(output).toContain("Shooting");
    expect(output).toContain("attacker");
  });

  it("handles missing battleRound gracefully", () => {
    const event: GameEvent = { id: "StartOfGame", params: {} };
    const state: State = {};
    const output = renderHeader(state, event);
    expect(output).toContain("StartOfGame");
  });
});

describe("renderUnits", () => {
  it("lists units grouped by owner", () => {
    const state: State = {
      units: {
        tactical_squad: {
          id: "tactical_squad",
          owner: "attacker",
          keywords: ["INFANTRY"],
          statuses: {},
        },
        intercessors: {
          id: "intercessors",
          owner: "defender",
          keywords: ["INFANTRY", "PRIMARIS"],
          statuses: { overwatchReady: { expiresOn: null } },
        },
      },
    };
    const output = renderUnits(state);
    expect(output).toContain("attacker");
    expect(output).toContain("tactical_squad");
    expect(output).toContain("INFANTRY");
    expect(output).toContain("defender");
    expect(output).toContain("intercessors");
    expect(output).toContain("overwatchReady");
  });

  it("returns empty string when no units", () => {
    const output = renderUnits({});
    expect(output).toBe("");
  });
});

describe("renderDicePool", () => {
  it("formats dice with indices and spent markers", () => {
    const state: State = {
      blessingsRoll: {
        count: 4,
        d0: { value: 1, rerolled: false, spent: false },
        d1: { value: 6, rerolled: false, spent: true },
        d2: { value: 6, rerolled: false, spent: false },
        d3: { value: 3, rerolled: true, spent: false },
      },
    };
    const output = renderDicePool(state);
    expect(output).toContain("[0] 1");
    expect(output).toContain("[1] 6*");
    expect(output).toContain("[2] 6");
    expect(output).toContain("[3] 3");
    expect(output).toContain("* = spent");
  });

  it("returns empty string when no pools found", () => {
    const output = renderDicePool({ someValue: 42 });
    expect(output).toBe("");
  });
});

describe("renderChoices", () => {
  it("formats choices with pass option", () => {
    const choices: ChoiceInstance[] = [
      {
        choiceInstanceId: "ci_1",
        choiceId: "warp_blades",
        label: "Warp Blades (double 5+ or triple)",
        actionRef: "doWarpBlades",
        player: "attacker",
        sourceRuleId: "r1",
        createdAtEvent: "Blessings",
        state: "offered",
        pick: 2,
      },
      {
        choiceInstanceId: "ci_2",
        choiceId: "wrathful",
        label: "Wrathful Devotion (any double)",
        actionRef: "doWrathful",
        player: "attacker",
        sourceRuleId: "r2",
        createdAtEvent: "Blessings",
        state: "offered",
        pick: 2,
      },
    ];
    const output = renderChoices(choices);
    expect(output).toContain("0. Pass");
    expect(output).toContain("1. Warp Blades");
    expect(output).toContain("[pick 2 dice]");
    expect(output).toContain("2. Wrathful Devotion");
  });

  it("returns empty string for no choices", () => {
    const output = renderChoices([]);
    expect(output).toBe("");
  });
});

describe("renderEventLine", () => {
  it("formats a simple event", () => {
    const event: GameEvent = { id: "SetupAttack", params: { player: "attacker" } };
    const output = renderEventLine(event);
    expect(output).toContain("SetupAttack");
  });

  it("includes log notes if provided", () => {
    const event: GameEvent = { id: "RollToHit", params: {} };
    const notes = ["roll: 4d6 -> [2, 6, 4, 1] at $.currentAttack.hitRolls"];
    const output = renderEventLine(event, notes);
    expect(output).toContain("4d6");
    expect(output).toContain("[2, 6, 4, 1]");
  });
});
