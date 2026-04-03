import type { ChoiceInstance, State, GameEvent } from "../types/index.js";
import { get, set } from "../state/index.js";

/**
 * Get the choices array from state. Stored at $._choices.
 */
function getChoices(state: State): ChoiceInstance[] {
  const arr = get(state, "$._choices");
  return Array.isArray(arr) ? (arr as ChoiceInstance[]) : [];
}

/**
 * Replace the choices array in state.
 */
function setChoices(state: State, choices: ChoiceInstance[]): State {
  return set(state, "$._choices", choices);
}

/**
 * Add a choice instance to state.
 */
export function addChoice(state: State, choice: ChoiceInstance): State {
  const current = getChoices(state);
  return setChoices(state, [...current, choice]);
}

/**
 * Select a choice by its instance ID.
 * Returns updated state and a ChoiceSelected event.
 */
export function selectChoice(
  state: State,
  choiceInstanceId: string,
  args?: Record<string, unknown>,
): { state: State; event: GameEvent } {
  const choices = getChoices(state);
  const idx = choices.findIndex((c) => c.choiceInstanceId === choiceInstanceId);
  if (idx === -1) {
    throw new Error(`Choice instance not found: ${choiceInstanceId}`);
  }
  const choice = choices[idx];
  const updated: ChoiceInstance = {
    ...choice,
    state: "selected",
    selectedArgs: args,
  };
  const newChoices = [...choices];
  newChoices[idx] = updated;

  const event: GameEvent = {
    id: "ChoiceSelected",
    params: {
      choiceId: choice.choiceId,
      choiceInstanceId: choice.choiceInstanceId,
      player: choice.player,
      sourceRuleId: choice.sourceRuleId,
      actionRef: choice.actionRef,
      ...(args ?? {}),
    },
  };

  return { state: setChoices(state, newChoices), event };
}

/**
 * Mark a choice as resolved.
 */
export function resolveChoice(state: State, choiceInstanceId: string): State {
  const choices = getChoices(state);
  const newChoices = choices.map((c) =>
    c.choiceInstanceId === choiceInstanceId
      ? { ...c, state: "resolved" as const }
      : c,
  );
  return setChoices(state, newChoices);
}

/**
 * Get all currently active (offered) choices.
 */
export function getActiveChoices(state: State): ChoiceInstance[] {
  return getChoices(state).filter((c) => c.state === "offered");
}

/**
 * Check if there are any unresolved choices (offered or selected).
 */
export function hasUnresolvedChoices(state: State): boolean {
  return getChoices(state).some(
    (c) => c.state === "offered" || c.state === "selected",
  );
}

/**
 * Expire all currently offered choices.
 * Returns updated state and ChoiceExpired events.
 */
export function expireChoicesByEvent(state: State): {
  state: State;
  expiredEvents: GameEvent[];
} {
  const choices = getChoices(state);
  const expiredEvents: GameEvent[] = [];
  const newChoices = choices.map((c) => {
    if (c.state === "offered") {
      expiredEvents.push({
        id: "ChoiceExpired",
        params: {
          choiceId: c.choiceId,
          choiceInstanceId: c.choiceInstanceId,
        },
      });
      return { ...c, state: "expired" as const };
    }
    return c;
  });
  return { state: setChoices(state, newChoices), expiredEvents };
}

/**
 * Cancel all offered choices (used when new choices replace old ones).
 */
export function cancelOfferedChoices(state: State): State {
  const choices = getChoices(state);
  const newChoices = choices.map((c) =>
    c.state === "offered" ? { ...c, state: "cancelled" as const } : c,
  );
  return setChoices(state, newChoices);
}
