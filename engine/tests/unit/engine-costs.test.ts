import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { get } from "../../src/state/index.js";
import type { LoadedPack, Rule, Glossary } from "../../src/types/index.js";

/**
 * Build a minimal LoadedPack with custom rules and initial state.
 */
function buildPack(overrides: {
  rules?: Rule[];
  initialState?: Record<string, unknown>;
  glossary?: Partial<Glossary>;
}): LoadedPack {
  const rules = overrides.rules ?? [];
  const rulesByEvent = new Map<string, Rule[]>();
  for (const rule of rules) {
    const event = rule.trigger.event;
    const existing = rulesByEvent.get(event) ?? [];
    existing.push(rule);
    rulesByEvent.set(event, existing);
  }

  return {
    manifest: {
      id: "test-pack",
      name: "Test Pack",
      version: "0.1.0",
      engine_version: "^0.1.0",
      dependencies: [],
    },
    timeline: [
      {
        forEach: {
          over: { kind: "player", from: "$.players" },
          bindParam: "player",
          body: [{ event: "TestEvent", params: ["player"] }],
        },
      },
    ],
    subSequences: {},
    glossary: {
      keywords: [],
      selectors: {},
      ...overrides.glossary,
    },
    rules,
    rulesByEvent,
    initialState: overrides.initialState ?? {
      players: ["A", "B"],
      resources: { A: { cp: 1 }, B: { cp: 0 } },
    },
    allEventIds: new Set(["TestEvent"]),
  };
}

describe("Choice cost pre-computation", () => {
  const overwatchRule: Rule = {
    id: "TEST.Overwatch.1",
    scope: "player",
    trigger: { event: "TestEvent" },
    when: { all: [] },
    effect: [
      {
        addChoice: {
          id: "overwatch",
          label: "Use Overwatch (1 CP)",
          actionRef: "TEST.Overwatch.Resolve",
          costs: { cp: 1 },
        },
      },
    ],
    precedence: { priority: 10, strategy: "stack" },
    provenance: { source: "test" },
  };

  const resolveRule: Rule = {
    id: "TEST.Overwatch.Resolve",
    scope: "player",
    trigger: { event: "ChoiceSelected" },
    when: {
      all: [{ eventParamEquals: { param: "choiceId", value: "overwatch" } }],
    },
    effect: [{ appendLogNote: { message: "Overwatch fired" } }],
    precedence: { priority: 20, strategy: "stack" },
    provenance: { source: "test" },
  };

  it("offers choice when player can afford costs", () => {
    const pack = buildPack({
      rules: [overwatchRule, resolveRule],
      initialState: {
        players: ["A"],
        resources: { A: { cp: 2 } },
      },
    });

    const engine = new SSCCEngine(pack);
    engine.initialize();
    engine.advanceToNextEvent();

    const choices = engine.enumerateChoices();
    expect(choices.length).toBe(1);
    expect(choices[0].choiceId).toBe("overwatch");
    expect(choices[0].costs).toEqual({ cp: 1 });
  });

  it("suppresses choice when player cannot afford costs", () => {
    const pack = buildPack({
      rules: [overwatchRule, resolveRule],
      initialState: {
        players: ["A"],
        resources: { A: { cp: 0 } },
      },
    });

    const engine = new SSCCEngine(pack);
    engine.initialize();
    engine.advanceToNextEvent();

    const choices = engine.enumerateChoices();
    expect(choices.length).toBe(0);

    // Verify suppression was logged
    const log = engine.getLog();
    const suppressed = log.filter((e) => e.type === "choice_suppressed");
    expect(suppressed.length).toBe(1);
  });

  it("deducts costs when choice is selected", () => {
    const pack = buildPack({
      rules: [overwatchRule, resolveRule],
      initialState: {
        players: ["A"],
        resources: { A: { cp: 2 } },
      },
    });

    const engine = new SSCCEngine(pack);
    engine.initialize();
    engine.advanceToNextEvent();

    const choices = engine.enumerateChoices();
    engine.applyChoice(choices[0].choiceInstanceId);

    const state = engine.getState();
    expect(get(state, "$.resources.A.cp")).toBe(1);
  });

  it("throws when selecting a choice the player can no longer afford", () => {
    // Two choices, each costs 1 CP, but player only has 1 CP.
    // Both are offered (each affordable individually at offer time).
    // Selecting the first deducts CP to 0.
    // Selecting the second should throw.
    const choiceRule1: Rule = {
      id: "TEST.Choice1",
      scope: "player",
      trigger: { event: "TestEvent" },
      when: { all: [] },
      effect: [
        {
          addChoice: {
            id: "choice_a",
            label: "Choice A (1 CP)",
            actionRef: "TEST.Noop",
            costs: { cp: 1 },
          },
        },
      ],
      precedence: { priority: 10, strategy: "stack" },
      provenance: { source: "test" },
    };

    const choiceRule2: Rule = {
      id: "TEST.Choice2",
      scope: "player",
      trigger: { event: "TestEvent" },
      when: { all: [] },
      effect: [
        {
          addChoice: {
            id: "choice_b",
            label: "Choice B (1 CP)",
            actionRef: "TEST.Noop",
            costs: { cp: 1 },
          },
        },
      ],
      precedence: { priority: 11, strategy: "stack" },
      provenance: { source: "test" },
    };

    const noopRule: Rule = {
      id: "TEST.Noop",
      scope: "player",
      trigger: { event: "ChoiceSelected" },
      when: { all: [] },
      effect: [],
      precedence: { priority: 10, strategy: "stack" },
      provenance: { source: "test" },
    };

    const pack = buildPack({
      rules: [choiceRule1, choiceRule2, noopRule],
      initialState: {
        players: ["A"],
        resources: { A: { cp: 1 } },
      },
    });

    const engine = new SSCCEngine(pack);
    engine.initialize();
    engine.advanceToNextEvent();

    const choices = engine.enumerateChoices();
    expect(choices.length).toBe(2);

    // Select first choice -- should succeed, CP drops to 0
    engine.applyChoice(choices[0].choiceInstanceId);
    expect(get(engine.getState(), "$.resources.A.cp")).toBe(0);

    // Select second choice -- should throw, can't afford
    expect(() => engine.applyChoice(choices[1].choiceInstanceId)).toThrow(
      /cannot afford/,
    );
  });

  it("offers choice without costs normally (no filtering)", () => {
    const freeChoiceRule: Rule = {
      id: "TEST.Free",
      scope: "player",
      trigger: { event: "TestEvent" },
      when: { all: [] },
      effect: [
        {
          addChoice: {
            id: "free_action",
            label: "Free Action",
            actionRef: "TEST.Noop",
          },
        },
      ],
      precedence: { priority: 10, strategy: "stack" },
      provenance: { source: "test" },
    };

    const noopRule: Rule = {
      id: "TEST.Noop",
      scope: "player",
      trigger: { event: "ChoiceSelected" },
      when: { all: [] },
      effect: [],
      precedence: { priority: 10, strategy: "stack" },
      provenance: { source: "test" },
    };

    const pack = buildPack({
      rules: [freeChoiceRule, noopRule],
      initialState: {
        players: ["A"],
        resources: { A: { cp: 0 } },
      },
    });

    const engine = new SSCCEngine(pack);
    engine.initialize();
    engine.advanceToNextEvent();

    const choices = engine.enumerateChoices();
    expect(choices.length).toBe(1);
    expect(choices[0].choiceId).toBe("free_action");
  });
});
