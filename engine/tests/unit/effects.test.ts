import { describe, it, expect } from "vitest";
import { executeEffect } from "../../src/rules/effects.js";
import type { Effect, GameEvent, State, Glossary } from "../../src/types/index.js";
import { get, getStatuses } from "../../src/state/index.js";

const glossary: Glossary = {
  keywords: [],
  selectors: {
    active_player_units: {
      kind: "unit",
      where: { pathEquals: { path: "$.turnPlayer", valueFromEventParam: "player" } },
    },
    all_units: { kind: "unit", all: true },
  },
};

const baseState: State = {
  turnPlayer: "A",
  players: ["A", "B"],
  units: {
    u1: {
      id: "u1",
      owner: "A",
      statuses: {},
      keywords: ["INFANTRY"],
      eligibility: { shoot: { prohibitions: [] }, charge: { prohibitions: [] } },
    },
    u2: {
      id: "u2",
      owner: "B",
      statuses: {},
      keywords: [],
      eligibility: { shoot: { prohibitions: [] }, charge: { prohibitions: [] } },
    },
  },
  resources: { A: { cp: 1 }, B: { cp: 0 } },
  activation: { unitId: "u1", type: null },
  usage: {},
  statuses: {},
};

const baseEvent: GameEvent = {
  id: "MovementPhaseStarted",
  params: { player: "A" },
};

function exec(effect: Effect, state = baseState, event = baseEvent) {
  return executeEffect(state, effect, event, "test-rule", glossary);
}

describe("applyStatus", () => {
  it("applies status to entity resolved from path", () => {
    const result = exec({
      applyStatus: { target: { path: "$.activation.unitId" }, key: "can_move" },
    });
    expect(getStatuses(result.state, "u1")).toHaveProperty("can_move");
  });

  it("applies status with expiresOn", () => {
    const result = exec({
      applyStatus: {
        target: { path: "$.activation.unitId" },
        key: "advanced_move",
        expiresOn: "TurnEnded",
      },
    });
    expect(getStatuses(result.state, "u1").advanced_move).toEqual({
      expiresOn: "TurnEnded",
    });
  });

  it("applies to all entities from selector", () => {
    const state = {
      ...baseState,
      units: {
        u1: { id: "u1", owner: "A", statuses: {}, keywords: [] },
        u2: { id: "u2", owner: "A", statuses: {}, keywords: [] },
      },
    };
    const result = exec(
      { applyStatus: { target: { selector: "all_units" }, key: "can_move" } },
      state,
    );
    expect(getStatuses(result.state, "u1")).toHaveProperty("can_move");
    expect(getStatuses(result.state, "u2")).toHaveProperty("can_move");
  });
});

describe("removeStatus", () => {
  it("removes status from entity", () => {
    const state = {
      ...baseState,
      units: {
        ...baseState.units,
        u1: {
          ...(baseState.units as any).u1,
          statuses: { can_move: { expiresOn: null } },
        },
      },
    } as State;
    const result = exec(
      { removeStatus: { target: { path: "$.activation.unitId" }, key: "can_move" } },
      state,
    );
    expect(getStatuses(result.state, "u1")).toEqual({});
  });
});

describe("setValue", () => {
  it("sets a literal value", () => {
    const result = exec({ setValue: { path: "$.activation.type", value: "advance" } });
    expect(get(result.state, "$.activation.type")).toBe("advance");
  });

  it("sets value from event param", () => {
    const result = exec({
      setValue: { path: "$.turnPlayer", valueFromEventParam: "player" },
    });
    expect(get(result.state, "$.turnPlayer")).toBe("A");
  });

  it("sets value from another path", () => {
    const result = exec({
      setValue: { path: "$.activation.type", valueFromPath: "$.turnPlayer" },
    });
    expect(get(result.state, "$.activation.type")).toBe("A");
  });
});

describe("modifyCounter", () => {
  it("increments by delta", () => {
    const result = exec({ modifyCounter: { path: "$.resources.A.cp", delta: 2 } });
    expect(get(result.state, "$.resources.A.cp")).toBe(3);
  });

  it("decrements by negative delta", () => {
    const result = exec({ modifyCounter: { path: "$.resources.A.cp", delta: -1 } });
    expect(get(result.state, "$.resources.A.cp")).toBe(0);
  });
});

describe("addProhibition", () => {
  it("adds a prohibition to entity", () => {
    const result = exec({
      addProhibition: {
        target: { path: "$.activation.unitId" },
        action: "shoot",
        reason: "advanced_move",
      },
    });
    const prohibitions = get(result.state, "$.units.u1.eligibility.shoot.prohibitions") as any[];
    expect(prohibitions).toContainEqual({ reason: "advanced_move" });
  });
});

describe("removeProhibition", () => {
  it("removes a prohibition from entity", () => {
    const state = {
      ...baseState,
      units: {
        ...baseState.units,
        u1: {
          ...(baseState.units as any).u1,
          eligibility: { shoot: { prohibitions: [{ reason: "advanced_move" }] }, charge: { prohibitions: [] } },
        },
      },
    } as State;
    const result = exec(
      {
        removeProhibition: {
          target: { path: "$.activation.unitId" },
          action: "shoot",
          reason: "advanced_move",
        },
      },
      state,
    );
    const prohibitions = get(result.state, "$.units.u1.eligibility.shoot.prohibitions") as any[];
    expect(prohibitions).toEqual([]);
  });
});

describe("emit", () => {
  it("emits an event with params", () => {
    const result = exec({
      emit: { eventId: "UnitMovementStarted", params: { player: { eventParam: "player" } } },
    });
    expect(result.emittedEvents).toHaveLength(1);
    expect(result.emittedEvents[0].id).toBe("UnitMovementStarted");
  });

  it("resolves eventParam references in emitted event params", () => {
    const result = exec({
      emit: { eventId: "TestEvent", params: { p: { eventParam: "player" } } },
    });
    expect(result.emittedEvents[0].params.p).toBe("A");
  });
});

describe("award and spendResource", () => {
  it("awards resource to player", () => {
    const result = exec({
      award: { target: { eventParam: "player" }, resource: "cp", amount: 2 },
    });
    expect(get(result.state, "$.resources.A.cp")).toBe(3);
  });

  it("spends resource from player", () => {
    const result = exec({
      spendResource: { target: { eventParam: "player" }, resource: "cp", amount: 1 },
    });
    expect(get(result.state, "$.resources.A.cp")).toBe(0);
  });
});

describe("addChoice", () => {
  it("creates a choice instance", () => {
    const result = exec({
      addChoice: {
        id: "move_normal",
        label: "Normal Move",
        actionRef: "CORE.Move.TypeAction.Normal.1",
      },
    });
    expect(result.newChoices).toHaveLength(1);
    expect(result.newChoices[0].choiceId).toBe("move_normal");
    expect(result.newChoices[0].player).toBe("A");
  });
});

describe("consumeUsage and resetUsage", () => {
  it("consumeUsage marks a key as used", () => {
    const result = exec({ consumeUsage: { scope: "player", key: "gain_coin" } });
    expect(get(result.state, "$.usage.player.gain_coin")).toBe(true);
  });

  it("resetUsage clears usage keys", () => {
    const state = { ...baseState, usage: { player: { gain_coin: true, other: true } } } as State;
    const result = exec({ resetUsage: { scope: "player", keys: ["gain_coin"] } }, state);
    expect(get(result.state, "$.usage.player.gain_coin")).toBeUndefined();
    expect(get(result.state, "$.usage.player.other")).toBe(true);
  });
});

describe("appendLogNote", () => {
  it("produces a log entry", () => {
    const result = exec({ appendLogNote: { message: "test note" } });
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].message).toBe("test note");
  });
});

describe("ensureExists", () => {
  it("creates path with default value when missing", () => {
    const result = exec({ ensureExists: { path: "$.newField", defaultValue: [] } });
    expect(get(result.state, "$.newField")).toEqual([]);
  });

  it("does not overwrite existing value", () => {
    const result = exec({ ensureExists: { path: "$.turnPlayer", defaultValue: "X" } });
    expect(get(result.state, "$.turnPlayer")).toBe("A");
  });
});

describe("mergeInto", () => {
  it("merges object into existing path", () => {
    const result = exec({
      mergeInto: { path: "$.activation", value: { extra: "data" } },
    });
    expect(get(result.state, "$.activation.extra")).toBe("data");
    expect(get(result.state, "$.activation.unitId")).toBe("u1");
  });
});
