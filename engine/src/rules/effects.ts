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
import { SeededRNG } from "../rng/index.js";

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
  rng?: SeededRNG,
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
    const { id, label, actionRef, limits, costs, selectionFrom, selectionFilter, pick } = effect.addChoice;
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
      selectionFilter: selectionFilter as Record<string, unknown> | undefined,
      pick: pick as number | undefined,
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

  if ("roll" in effect) {
    if (!rng) throw new Error("roll effect requires RNG — pass seed to engine constructor");
    const { sides = 6, storePath, defaults } = effect.roll;
    const count = resolveCount(effect.roll.count, state);
    let s = set(state, `${storePath}.count`, count);
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const value = rng.nextInt(1, sides);
      values.push(value);
      const die: Record<string, unknown> = { value, rerolled: false, ...defaults };
      s = set(s, `${storePath}.d${i}`, die);
    }
    result.state = s;
    result.logEntries.push({
      type: "note",
      message: `roll: ${count}d${sides} -> [${values.join(", ")}] at ${storePath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("rerollDie" in effect) {
    if (!rng) throw new Error("rerollDie effect requires RNG");
    const { poolPath, sides = 6 } = effect.rerollDie;
    const dieIndex = resolveCount(effect.rerollDie.dieIndex, state);
    const diePath = `${poolPath}.d${dieIndex}`;
    const die = get(state, diePath) as Record<string, unknown> | undefined;
    if (!die) throw new Error(`No die at ${diePath}`);
    if (die.rerolled === true) throw new Error(`Die ${dieIndex} already rerolled at ${poolPath}`);
    const oldValue = die.value;
    const newValue = rng.nextInt(1, sides);
    result.state = set(state, diePath, { ...die, value: newValue, rerolled: true });
    result.logEntries.push({
      type: "note",
      message: `reroll: die[${dieIndex}] ${oldValue} -> ${newValue} at ${poolPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("rerollPool" in effect) {
    if (!rng) throw new Error("rerollPool effect requires RNG");
    const { poolPath, sides = 6 } = effect.rerollPool;
    const count = get(state, `${poolPath}.count`) as number;
    if (typeof count !== "number") throw new Error(`No pool count at ${poolPath}`);
    let s = state;
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const oldDie = get(s, `${poolPath}.d${i}`) as Record<string, unknown> | undefined;
      const value = rng.nextInt(1, sides);
      values.push(value);
      // Preserve keys from original die but reset value, rerolled, spent
      const newDie: Record<string, unknown> = { ...oldDie, value, rerolled: false, spent: false };
      s = set(s, `${poolPath}.d${i}`, newDie);
    }
    result.state = s;
    result.logEntries.push({
      type: "note",
      message: `rerollPool: ${count}d${sides} -> [${values.join(", ")}] at ${poolPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("spendDice" in effect) {
    const { poolPath } = effect.spendDice;
    const dieIndices = resolveDieIndices(effect.spendDice.dieIndices, event);
    let s = state;
    for (const idx of dieIndices) {
      const diePath = `${poolPath}.d${idx}`;
      const die = get(s, diePath) as Record<string, unknown> | undefined;
      if (!die) throw new Error(`No die at ${diePath}`);
      if (die.spent === true) throw new Error(`Die ${idx} already spent at ${poolPath}`);
      s = set(s, diePath, { ...die, spent: true });
    }
    result.state = s;
    result.logEntries.push({
      type: "note",
      message: `spendDice: [${dieIndices.join(", ")}] at ${poolPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("setSeed" in effect) {
    if (!rng) throw new Error("setSeed effect requires RNG");
    const { seed } = effect.setSeed;
    rng.reseed(seed);
    result.logEntries.push({
      type: "note",
      message: `RNG reseeded to ${seed}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
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

/**
 * Resolve a count field that may be a literal or a state path reference.
 */
function resolveCount(countOrRef: number | { path: string }, state: State): number {
  if (typeof countOrRef === "number") return countOrRef;
  const val = get(state, countOrRef.path);
  if (typeof val !== "number") throw new Error(`Count path ${countOrRef.path} resolved to non-number: ${val}`);
  return val;
}

/**
 * Resolve dieIndices that may be a literal array or a fromChoice reference.
 */
function resolveDieIndices(
  indicesOrRef: number[] | { fromChoice: string },
  event: GameEvent,
): number[] {
  if (Array.isArray(indicesOrRef)) return indicesOrRef;
  const val = event.params[indicesOrRef.fromChoice];
  if (!Array.isArray(val)) throw new Error(`fromChoice ${indicesOrRef.fromChoice} did not resolve to array`);
  return val as number[];
}
