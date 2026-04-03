# Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the window concept from the SSCC engine and add choice cost pre-computation so every offered choice is guaranteed affordable.

**Architecture:** Modify existing engine modules — no new modules. Add `costs` to `ChoiceInstance`, filter unaffordable choices in `evaluateEvent`, deduct costs in `applyChoice`. Remove `"window"` from scope type. Clean up pack data and spec.

**Tech Stack:** TypeScript, Vitest

---

## Task 1: Remove Window References

Remove the window concept from types, pack data, and spec.

**Files:**
- Modify: `engine/src/types/rules.ts:82`
- Modify: `packs/wh40k-10e-core-turn/timeline.yaml:44`
- Modify: `packs/wh40k-10e-core-turn/initial_state.json:119`

- [ ] **Step 1.1** -- Remove `"window"` from `RuleScope` in `engine/src/types/rules.ts`

Change line 82 from:

```typescript
export type RuleScope = "global" | "player" | "entity" | "unit" | "attack" | "window";
```

to:

```typescript
export type RuleScope = "global" | "player" | "entity" | "unit" | "attack";
```

- [ ] **Step 1.2** -- Remove `windows: []` from `packs/wh40k-10e-core-turn/timeline.yaml`

Delete line 44:

```yaml
windows: []
```

- [ ] **Step 1.3** -- Remove `"windows": {}` from `packs/wh40k-10e-core-turn/initial_state.json`

Delete the line:

```json
  "windows": {},
```

- [ ] **Step 1.4** -- Verify compilation and existing tests still pass

```bash
cd engine && npx tsc --noEmit && npx vitest run
```

Expected: all 97 tests pass, no type errors.

- [ ] **Step 1.5** -- Commit

```bash
git add engine/src/types/rules.ts packs/wh40k-10e-core-turn/timeline.yaml packs/wh40k-10e-core-turn/initial_state.json
git commit -m "refactor: remove window concept from engine types and pack data"
```

---

## Task 2: Add Costs to ChoiceInstance

Store costs on choice instances so the engine can check and deduct them.

**Files:**
- Modify: `engine/src/types/choices.ts`
- Modify: `engine/src/rules/effects.ts`

- [ ] **Step 2.1** -- Add `costs` field to `ChoiceInstance` in `engine/src/types/choices.ts`

Add the `costs` field after `selectedArgs`:

```typescript
export interface ChoiceInstance {
  choiceInstanceId: string;
  choiceId: string;
  label: string;
  actionRef: string;
  player: string;
  sourceRuleId: string;
  createdAtEvent: string;
  state: ChoiceState;
  selectionFrom?: TargetRef;
  selectedArgs?: Record<string, unknown>;
  costs?: Record<string, number>;
}
```

- [ ] **Step 2.2** -- Pass costs through in effect executor (`engine/src/rules/effects.ts`)

In the `addChoice` handler (around line 138), add `costs` to the `ChoiceInstance`:

Change:

```typescript
    const choice: ChoiceInstance = {
      choiceInstanceId: `ci_${choiceCounter}`,
      choiceId: id,
      label,
      actionRef,
      player,
      sourceRuleId,
      createdAtEvent: event.id,
      state: "offered",
      selectionFrom,
    };
```

to:

```typescript
    const choice: ChoiceInstance = {
      choiceInstanceId: `ci_${choiceCounter}`,
      choiceId: id,
      label,
      actionRef,
      player,
      sourceRuleId,
      createdAtEvent: event.id,
      state: "offered",
      selectionFrom,
      costs: costs as Record<string, number> | undefined,
    };
```

- [ ] **Step 2.3** -- Verify compilation

```bash
cd engine && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 2.4** -- Commit

```bash
git add engine/src/types/choices.ts engine/src/rules/effects.ts
git commit -m "feat: store costs on ChoiceInstance for cost pre-computation"
```

---

## Task 3: Cost Pre-Computation and Deduction

Filter unaffordable choices at offer time. Deduct costs on selection.

**Files:**
- Modify: `engine/src/engine/index.ts`
- Create: `engine/tests/unit/engine-costs.test.ts`

- [ ] **Step 3.1** -- Write cost helper functions in `engine/src/engine/index.ts`

Add these two functions before the `SSCCEngine` class definition:

```typescript
import { get, set, expireStatuses } from "../state/index.js";

/**
 * Check if a player can afford the costs of a choice.
 * Looks up $.resources.<playerId>.<resourceKey> for each cost entry.
 */
function canAffordCosts(
  state: State,
  playerId: string,
  costs: Record<string, number>,
): boolean {
  for (const [resource, amount] of Object.entries(costs)) {
    const current = get(state, `$.resources.${playerId}.${resource}`);
    if (typeof current !== "number" || current < amount) {
      return false;
    }
  }
  return true;
}

/**
 * Deduct costs from a player's resources. Returns new state.
 * Caller must verify affordability first.
 */
function deductCosts(
  state: State,
  playerId: string,
  costs: Record<string, number>,
): State {
  let s = state;
  for (const [resource, amount] of Object.entries(costs)) {
    const current = get(s, `$.resources.${playerId}.${resource}`) as number;
    s = set(s, `$.resources.${playerId}.${resource}`, current - amount);
  }
  return s;
}
```

Also update the existing import of `expireStatuses` to include `get` and `set`:

Change:

```typescript
import { expireStatuses } from "../state/index.js";
```

to:

```typescript
import { get, set, expireStatuses } from "../state/index.js";
```

- [ ] **Step 3.2** -- Add cost filtering in `evaluateEvent`

In the `evaluateEvent` method, replace the "Step 5: Add new choices to state" block:

Change:

```typescript
    // Step 5: Add new choices to state
    for (const choice of allNewChoices) {
      state = addChoice(state, choice);
      this.logger.log("choice_offered", `Choice offered: ${choice.choiceId}`, {
        eventId: event.id,
        data: {
          choiceId: choice.choiceId,
          choiceInstanceId: choice.choiceInstanceId,
          player: choice.player,
        },
      });
    }
```

to:

```typescript
    // Step 5: Add new choices to state (filter unaffordable)
    for (const choice of allNewChoices) {
      if (choice.costs && Object.keys(choice.costs).length > 0) {
        if (!canAffordCosts(state, choice.player, choice.costs)) {
          this.logger.log("choice_suppressed", `Choice suppressed (unaffordable): ${choice.choiceId}`, {
            eventId: event.id,
            data: {
              choiceId: choice.choiceId,
              player: choice.player,
              costs: choice.costs,
            },
          });
          continue;
        }
      }
      state = addChoice(state, choice);
      this.logger.log("choice_offered", `Choice offered: ${choice.choiceId}`, {
        eventId: event.id,
        data: {
          choiceId: choice.choiceId,
          choiceInstanceId: choice.choiceInstanceId,
          player: choice.player,
        },
      });
    }
```

- [ ] **Step 3.3** -- Add cost deduction in `applyChoice`

In the `applyChoice` method, add cost verification and deduction before the `selectChoice` call:

Change:

```typescript
  applyChoice(
    choiceInstanceId: string,
    args?: Record<string, unknown>,
  ): State {
    const { state: newState, event } = selectChoice(
      this.state,
      choiceInstanceId,
      args,
    );
    this.state = newState;
```

to:

```typescript
  applyChoice(
    choiceInstanceId: string,
    args?: Record<string, unknown>,
  ): State {
    // Find the choice and verify costs are still affordable
    const activeChoices = getActiveChoices(this.state);
    const choice = activeChoices.find((c) => c.choiceInstanceId === choiceInstanceId);
    if (!choice) {
      throw new Error(`Choice instance not found or not active: ${choiceInstanceId}`);
    }

    // Deduct costs before selection
    if (choice.costs && Object.keys(choice.costs).length > 0) {
      if (!canAffordCosts(this.state, choice.player, choice.costs)) {
        throw new Error(
          `Player ${choice.player} cannot afford choice ${choice.choiceId}: ` +
          `costs ${JSON.stringify(choice.costs)}`
        );
      }
      this.state = deductCosts(this.state, choice.player, choice.costs);
      this.logger.log("cost_deducted", `Costs deducted for ${choice.choiceId}`, {
        data: {
          choiceId: choice.choiceId,
          player: choice.player,
          costs: choice.costs,
        },
      });
    }

    const { state: newState, event } = selectChoice(
      this.state,
      choiceInstanceId,
      args,
    );
    this.state = newState;
```

- [ ] **Step 3.4** -- Write failing tests in `engine/tests/unit/engine-costs.test.ts`

```typescript
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
    timeline: [{ event: "TestEvent" }],
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
```

- [ ] **Step 3.5** -- Run tests to verify they fail

```bash
cd engine && npx vitest run tests/unit/engine-costs.test.ts
```

Expected: tests fail because cost filtering and deduction are not yet wired in (Steps 3.1-3.3 describe the code changes — implement them before this step if following TDD strictly, or implement them first and then run).

- [ ] **Step 3.6** -- Run all tests to verify everything passes

```bash
cd engine && npx vitest run
```

Expected: all existing tests pass plus the 5 new cost tests.

- [ ] **Step 3.7** -- Commit

```bash
git add engine/src/engine/index.ts engine/tests/unit/engine-costs.test.ts
git commit -m "feat: add choice cost pre-computation and deduction"
```

---

## Task 4: Overwatch Integration Test

End-to-end test with a minimal pack that demonstrates overwatch as pure SSCC.

**Files:**
- Create: `packs/overwatch-test/manifest.yaml`
- Create: `packs/overwatch-test/timeline.yaml`
- Create: `packs/overwatch-test/glossary.yaml`
- Create: `packs/overwatch-test/initial_state.json`
- Create: `packs/overwatch-test/rules.json`
- Create: `engine/tests/integration/overwatch.test.ts`

- [ ] **Step 4.1** -- Create `packs/overwatch-test/manifest.yaml`

```yaml
id: overwatch-test
name: Overwatch Test Pack
version: 0.1.0
engine_version: "^0.1.0"
dependencies: []
```

- [ ] **Step 4.2** -- Create `packs/overwatch-test/timeline.yaml`

A minimal timeline: StartOfGame, one round, one player turn with a charge phase containing `ChargeDeclarationsEnded` and `ChargePhaseEnded`, then EndOfGame.

```yaml
timeline:
  - event: StartOfGame

  - sequence:
      - event: TurnStarted
        params: [player]

      - event: ChargePhaseStarted
        params: [player]

      - event: ChargeDeclarationsEnded
        params: [player]

      - event: ChargePhaseEnded
        params: [player]

      - event: TurnEnded
        params: [player]

  - event: EndOfGame

subSequences: {}
```

- [ ] **Step 4.3** -- Create `packs/overwatch-test/glossary.yaml`

```yaml
keywords: []

statuses: {}

reason_keys: {}

selectors: {}
```

- [ ] **Step 4.4** -- Create `packs/overwatch-test/initial_state.json`

```json
{
  "players": ["A"],
  "turnPlayer": "A",
  "resources": {
    "A": { "cp": 1 }
  },
  "usage": {}
}
```

- [ ] **Step 4.5** -- Create `packs/overwatch-test/rules.json`

```json
[
  {
    "id": "TEST.SetTurnPlayer",
    "scope": "global",
    "trigger": { "event": "TurnStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "setValue": {
          "path": "$.turnPlayer",
          "valueFromEventParam": "player"
        }
      }
    ],
    "precedence": { "priority": 1, "strategy": "stack" },
    "provenance": { "source": "Test" }
  },
  {
    "id": "CORE.Stratagem.Overwatch.1",
    "scope": "player",
    "trigger": { "event": "ChargeDeclarationsEnded" },
    "when": {
      "all": [
        {
          "resourceAtLeast": {
            "player": { "eventParam": "player" },
            "resource": "cp",
            "amount": 1
          }
        }
      ]
    },
    "effect": [
      {
        "addChoice": {
          "id": "overwatch",
          "label": "Use Overwatch (1 CP)",
          "actionRef": "CORE.Stratagem.Overwatch.Resolve.1",
          "costs": { "cp": 1 }
        }
      }
    ],
    "precedence": { "priority": 60, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  },
  {
    "id": "CORE.Stratagem.Overwatch.Resolve.1",
    "scope": "player",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "overwatch" } }
      ]
    },
    "effect": [
      {
        "consumeUsage": {
          "scope": "player",
          "key": "overwatch_used_this_phase"
        }
      },
      {
        "appendLogNote": { "message": "Overwatch fired" }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules" }
  }
]
```

- [ ] **Step 4.6** -- Write `engine/tests/integration/overwatch.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/overwatch-test");

describe("Overwatch without windows", () => {
  it("loads the overwatch test pack", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
  });

  it("offers overwatch when player has 1+ CP, deducts on selection", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    // Advance through StartOfGame, TurnStarted, ChargePhaseStarted
    let advance = engine.advanceToNextEvent();
    while (advance !== null && !advance.paused) {
      advance = engine.advanceToNextEvent();
    }

    // Should be paused at ChargeDeclarationsEnded with overwatch offered
    expect(advance).not.toBeNull();
    expect(advance!.paused).toBe(true);
    expect(advance!.event.id).toBe("ChargeDeclarationsEnded");

    const choices = engine.enumerateChoices();
    expect(choices.length).toBe(1);
    expect(choices[0].choiceId).toBe("overwatch");
    expect(choices[0].costs).toEqual({ cp: 1 });

    // Select overwatch
    engine.applyChoice(choices[0].choiceInstanceId);

    // CP should be deducted
    const state = engine.getState();
    expect(get(state, "$.resources.A.cp")).toBe(0);

    // Usage should be consumed
    expect(get(state, "$.usage.player.overwatch_used_this_phase")).toBe(true);

    // Log should contain overwatch fired
    const log = engine.getLog();
    const notes = log.filter((e) => e.type === "note");
    expect(notes.some((n) => n.message.includes("Overwatch fired"))).toBe(true);
  });

  it("does not offer overwatch when player has 0 CP", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    // Override initial state to 0 CP
    const pack = {
      ...result.pack,
      initialState: {
        ...result.pack.initialState,
        resources: { A: { cp: 0 } },
      },
    };

    const engine = new SSCCEngine(pack);
    engine.initialize();

    // Advance through all events -- should never pause
    let advance = engine.advanceToNextEvent();
    let pausedAtCharge = false;
    while (advance !== null) {
      if (advance.paused && advance.event.id === "ChargeDeclarationsEnded") {
        pausedAtCharge = true;
        break;
      }
      advance = engine.advanceToNextEvent();
    }

    // The engine should NOT pause at ChargeDeclarationsEnded
    // because the resourceAtLeast predicate prevents the rule from matching,
    // AND cost pre-computation would suppress the choice even if offered
    expect(pausedAtCharge).toBe(false);

    // Verify suppression or no-match in log
    const state = engine.getState();
    expect(get(state, "$.resources.A.cp")).toBe(0);
  });
});
```

- [ ] **Step 4.7** -- Run integration tests

```bash
cd engine && npx vitest run tests/integration/overwatch.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 4.8** -- Run the full test suite

```bash
cd engine && npx vitest run
```

Expected: all tests pass (92 unit + 5 new cost unit + 5 existing integration + 3 new overwatch integration).

- [ ] **Step 4.9** -- Commit

```bash
git add packs/overwatch-test/ engine/tests/integration/overwatch.test.ts
git commit -m "test: add overwatch integration test using pure state + events"
```

---

## Task 5: Update Specification Document

Remove window references from `SSCC_ENGINE_SPECIFICATION.md`.

**Files:**
- Modify: `SSCC_ENGINE_SPECIFICATION.md`

- [ ] **Step 5.1** -- Remove window-related content from the spec

Make these changes to `SSCC_ENGINE_SPECIFICATION.md`:

1. **Section 2 (High-Level System Requirements)**: In the "reaction windows with choice lifecycle" bullet, change to "choices with cost pre-computation and lifecycle"

2. **Section 1 (Core Definitions, State examples)**: Remove "reaction windows that are currently open"

3. **Section 4.2 (timeline.yaml)**: Remove "windows (reaction/interrupt windows)"

4. **Section 6 (System Events)**: Remove `windowId` from `ChoiceSelected` params. Remove "window closed" from `ChoiceExpired` description.

5. **Section 8 (Predicate Type System)**: Remove the `windowOpen` and `windowClosed` rows from the predicate reference table.

6. **Remove Section 9.4** ("Event and Window Control") entirely -- delete `openWindow` and `closeWindow` effect definitions.

7. **Section 11 (Choice Lifecycle)**: Remove `expiresOnWindowClose` from choice instance fields table. Remove "Its **window closes**" from the expiry list.

8. **Section 14 (Rulelet Shape)**: Remove `"window"` from the scope values list.

9. **Section 16.2 (Event Sequencer)**: Remove "Opens/closes windows" from the responsibilities list.

10. **Section 5.4**: Replace the "Reaction window example" with the state-driven overwatch pattern from the design spec (Section 4 of the Milestone 2 design). Title it "Overwatch example (state-driven)".

11. **Milestone 2 in Part V**: Update to say "Add choice cost pre-computation" instead of "Add windows and costs".

- [ ] **Step 5.2** -- Commit

```bash
git add SSCC_ENGINE_SPECIFICATION.md
git commit -m "docs: remove window concept from SSCC spec, add cost pre-computation"
```

---

## Task 6: Final Verification

- [ ] **Step 6.1** -- Run the full test suite one final time

```bash
cd engine && npx tsc --noEmit && npx vitest run
```

Expected: clean compilation, all tests pass.

- [ ] **Step 6.2** -- Verify no window references remain in engine code

```bash
grep -r "window" engine/src/ --include="*.ts" -i
```

Expected: no matches (or only the word "window" in unrelated contexts like comments).
