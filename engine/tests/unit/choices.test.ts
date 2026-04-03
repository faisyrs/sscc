import { describe, it, expect } from "vitest";
import {
  addChoice,
  selectChoice,
  resolveChoice,
  expireChoicesByEvent,
  getActiveChoices,
  hasUnresolvedChoices,
} from "../../src/choices/index.js";
import type { ChoiceInstance, State } from "../../src/types/index.js";

function makeChoice(overrides: Partial<ChoiceInstance> = {}): ChoiceInstance {
  return {
    choiceInstanceId: "ci_1",
    choiceId: "test_choice",
    label: "Test",
    actionRef: "TestAction",
    player: "A",
    sourceRuleId: "rule1",
    createdAtEvent: "SomeEvent",
    state: "offered",
    ...overrides,
  };
}

const emptyState: State = { _choices: [] };

describe("addChoice", () => {
  it("adds choice to state and it becomes active", () => {
    const choice = makeChoice();
    const state = addChoice(emptyState, choice);
    const active = getActiveChoices(state);
    expect(active).toHaveLength(1);
    expect(active[0].choiceId).toBe("test_choice");
  });

  it("multiple choices accumulate", () => {
    let state = emptyState;
    state = addChoice(state, makeChoice({ choiceInstanceId: "ci_1" }));
    state = addChoice(state, makeChoice({ choiceInstanceId: "ci_2", choiceId: "other" }));
    expect(getActiveChoices(state)).toHaveLength(2);
  });
});

describe("selectChoice", () => {
  it("marks choice as selected and returns ChoiceSelected event", () => {
    let state = addChoice(emptyState, makeChoice());
    const result = selectChoice(state, "ci_1", { selectedUnitId: "u1" });
    expect(result.event.id).toBe("ChoiceSelected");
    expect(result.event.params.choiceId).toBe("test_choice");
    expect(result.event.params.selectedUnitId).toBe("u1");
    expect(result.event.params.player).toBe("A");
    const choices = getActiveChoices(result.state);
    // After selection, it is in "selected" state -- still tracked but not "offered"
    expect(choices).toHaveLength(0);
  });
});

describe("resolveChoice", () => {
  it("marks selected choice as resolved", () => {
    let state = addChoice(emptyState, makeChoice());
    const { state: s2 } = selectChoice(state, "ci_1");
    const s3 = resolveChoice(s2, "ci_1");
    expect(hasUnresolvedChoices(s3)).toBe(false);
  });
});

describe("hasUnresolvedChoices", () => {
  it("returns true when offered choices exist", () => {
    const state = addChoice(emptyState, makeChoice());
    expect(hasUnresolvedChoices(state)).toBe(true);
  });

  it("returns false when no choices exist", () => {
    expect(hasUnresolvedChoices(emptyState)).toBe(false);
  });

  it("returns false after all choices are resolved", () => {
    let state = addChoice(emptyState, makeChoice());
    const { state: s2 } = selectChoice(state, "ci_1");
    const s3 = resolveChoice(s2, "ci_1");
    expect(hasUnresolvedChoices(s3)).toBe(false);
  });
});

describe("expireChoicesByEvent", () => {
  it("expires choices that have no explicit expiry when called", () => {
    let state = addChoice(emptyState, makeChoice());
    const { state: s2, expiredEvents } = expireChoicesByEvent(state);
    expect(getActiveChoices(s2)).toHaveLength(0);
    expect(expiredEvents).toHaveLength(1);
    expect(expiredEvents[0].id).toBe("ChoiceExpired");
  });
});
