import type {
  Effect,
  GameEvent,
  State,
  Glossary,
  PlayerRef,
  TargetRef,
} from "../types/index.js";
import type { ChoiceInstance } from "../types/index.js";
import { get, set, applyStatus, removeStatus } from "../state/index.js";
import { resolveTargetEntityIds, resolvePlayer } from "./predicates.js";

export interface LogEntry {
  type: string;
  message: string;
  ruleId?: string;
  eventId?: string;
}

export interface EffectResult {
  state: State;
  emittedEvents: GameEvent[];
  newChoices: ChoiceInstance[];
  logEntries: LogEntry[];
}

let choiceCounter = 0;

/** Reset choice counter (for testing). */
export function resetChoiceCounter(): void {
  choiceCounter = 0;
}

/**
 * Execute a single effect against state, returning new state and side effects.
 */
export function executeEffect(
  state: State,
  effect: Effect,
  event: GameEvent,
  sourceRuleId: string,
  glossary: Glossary,
): EffectResult {
  const result: EffectResult = {
    state,
    emittedEvents: [],
    newChoices: [],
    logEntries: [],
  };

  if ("applyStatus" in effect) {
    const { target, key, expiresOn } = effect.applyStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      s = applyStatus(s, id, key, expiresOn ?? null);
    }
    result.state = s;
    return result;
  }

  if ("removeStatus" in effect) {
    const { target, key } = effect.removeStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      s = removeStatus(s, id, key);
    }
    result.state = s;
    return result;
  }

  if ("setValue" in effect) {
    const { path, value, valueFromPath, valueFromEventParam } = effect.setValue;
    let resolved: unknown;
    if (valueFromEventParam !== undefined) {
      resolved = event.params[valueFromEventParam];
    } else if (valueFromPath !== undefined) {
      resolved = get(state, valueFromPath);
    } else {
      resolved = value;
    }
    result.state = set(state, path, resolved);
    return result;
  }

  if ("modifyCounter" in effect) {
    const { path, delta, deltaFromPath } = effect.modifyCounter;
    const current = get(state, path);
    const currentNum = typeof current === "number" ? current : 0;
    let d: number;
    if (deltaFromPath !== undefined) {
      const val = get(state, deltaFromPath);
      d = typeof val === "number" ? val : 0;
    } else {
      d = delta ?? 0;
    }
    result.state = set(state, path, currentNum + d);
    return result;
  }

  if ("addProhibition" in effect) {
    const { target, action, reason } = effect.addProhibition;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      const prohibPath = `$.units.${id}.eligibility.${action}.prohibitions`;
      const current = get(s, prohibPath) as Array<{ reason: string }> | undefined;
      const arr = current ?? [];
      // Idempotent: do not add duplicate
      if (!arr.some((p) => p.reason === reason)) {
        s = set(s, prohibPath, [...arr, { reason }]);
      }
    }
    result.state = s;
    return result;
  }

  if ("removeProhibition" in effect) {
    const { target, action, reason } = effect.removeProhibition;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      const prohibPath = `$.units.${id}.eligibility.${action}.prohibitions`;
      const current = get(s, prohibPath) as Array<{ reason: string }> | undefined;
      if (current) {
        s = set(
          s,
          prohibPath,
          current.filter((p) => p.reason !== reason),
        );
      }
    }
    result.state = s;
    return result;
  }

  if ("addChoice" in effect) {
    const { id, label, actionRef, limits, costs, selectionFrom } = effect.addChoice;
    choiceCounter++;
    const player = resolveCurrentPlayer(event);
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
    result.newChoices.push(choice);
    return result;
  }

  if ("consumeUsage" in effect) {
    const { scope, key } = effect.consumeUsage;
    result.state = set(state, `$.usage.${scope}.${key}`, true);
    return result;
  }

  if ("resetUsage" in effect) {
    const { scope, keys } = effect.resetUsage;
    let s = state;
    const scopeObj = get(s, `$.usage.${scope}`) as Record<string, unknown> | undefined;
    if (scopeObj) {
      const newScope = { ...scopeObj };
      for (const key of keys) {
        delete newScope[key];
      }
      s = set(s, `$.usage.${scope}`, newScope);
    }
    result.state = s;
    return result;
  }

  if ("emit" in effect) {
    const { eventId, params } = effect.emit;
    const resolvedParams: Record<string, unknown> = {};
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (
          val !== null &&
          typeof val === "object" &&
          "eventParam" in (val as Record<string, unknown>)
        ) {
          resolvedParams[key] = event.params[(val as { eventParam: string }).eventParam];
        } else {
          resolvedParams[key] = val;
        }
      }
    }
    result.emittedEvents.push({ id: eventId, params: resolvedParams });
    return result;
  }

  if ("award" in effect) {
    const { target, resource, amount } = effect.award;
    const playerId = resolvePlayer(target, event);
    const path = `$.resources.${playerId}.${resource}`;
    const current = get(state, path);
    const currentNum = typeof current === "number" ? current : 0;
    result.state = set(state, path, currentNum + amount);
    return result;
  }

  if ("spendResource" in effect) {
    const { target, resource, amount } = effect.spendResource;
    const playerId = resolvePlayer(target, event);
    const path = `$.resources.${playerId}.${resource}`;
    const current = get(state, path);
    const currentNum = typeof current === "number" ? current : 0;
    result.state = set(state, path, currentNum - amount);
    return result;
  }

  if ("appendLogNote" in effect) {
    result.logEntries.push({
      type: "note",
      message: effect.appendLogNote.message,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("ensureExists" in effect) {
    const { path, defaultValue } = effect.ensureExists;
    const current = get(state, path);
    if (current === undefined) {
      result.state = set(state, path, defaultValue);
    }
    return result;
  }

  if ("mergeInto" in effect) {
    const { path, value } = effect.mergeInto;
    const current = get(state, path) as Record<string, unknown> | undefined;
    const merged = { ...(current ?? {}), ...value };
    result.state = set(state, path, merged);
    return result;
  }

  throw new Error(`Unknown effect verb: ${JSON.stringify(effect)}`);
}

/**
 * Determine the current player from event params.
 * Falls back to "unknown" if no player param.
 */
function resolveCurrentPlayer(event: GameEvent): string {
  if (typeof event.params.player === "string") return event.params.player;
  return "unknown";
}
