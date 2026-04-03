import type {
  PredicateNode,
  TargetRef,
  PlayerRef,
  State,
  GameEvent,
  Glossary,
  SelectorDef,
} from "../types/index.js";
import { get } from "../state/index.js";
import { readDiePool, dieMatchesFilter } from "./pool-helpers.js";

/**
 * Evaluate a predicate tree against current state and event.
 */
export function evaluatePredicate(
  node: PredicateNode,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): boolean {
  // --- Composition ---
  if ("all" in node) {
    return (node as { all: PredicateNode[] }).all.every((child) =>
      evaluatePredicate(child, state, event, glossary),
    );
  }
  if ("any" in node) {
    return (node as { any: PredicateNode[] }).any.some((child) =>
      evaluatePredicate(child, state, event, glossary),
    );
  }
  if ("not" in node) {
    return !evaluatePredicate(
      (node as { not: PredicateNode }).not,
      state,
      event,
      glossary,
    );
  }

  // --- Leaf predicates ---
  if ("pathEquals" in node) {
    const { path, value, valueFromEventParam } = (node as any).pathEquals;
    const actual = get(state, path);
    const expected =
      valueFromEventParam !== undefined
        ? event.params[valueFromEventParam]
        : value;
    return actual === expected;
  }

  if ("pathIn" in node) {
    const { path, value } = (node as any).pathIn;
    const arr = get(state, path);
    if (!Array.isArray(arr)) return false;
    return arr.includes(value);
  }

  if ("pathAtLeast" in node) {
    const { path, value } = (node as any).pathAtLeast;
    const actual = get(state, path);
    return typeof actual === "number" && actual >= value;
  }

  if ("pathMissing" in node) {
    const { path } = (node as any).pathMissing;
    return get(state, path) === undefined;
  }

  if ("eventParamEquals" in node) {
    const { param, value } = (node as any).eventParamEquals;
    return event.params[param] === value;
  }

  if ("resourceAtLeast" in node) {
    const { player, resource, amount } = (node as any).resourceAtLeast;
    const playerId = resolvePlayerRef(player, event);
    const actual = get(state, `$.resources.${playerId}.${resource}`);
    return typeof actual === "number" && actual >= amount;
  }

  if ("counterAtLeast" in node) {
    const { path, value } = (node as any).counterAtLeast;
    const actual = get(state, path);
    return typeof actual === "number" && actual >= value;
  }

  if ("counterEquals" in node) {
    const { path, value } = (node as any).counterEquals;
    const actual = get(state, path);
    return typeof actual === "number" && actual === value;
  }

  if ("hasStatus" in node) {
    const { target, key } = (node as any).hasStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    return entityIds.length > 0 && entityIds.every((id) => {
      const statuses = get(state, `$.units.${id}.statuses`) as Record<string, unknown> | undefined;
      return statuses !== undefined && key in statuses;
    });
  }

  if ("missingStatus" in node) {
    const { target, key } = (node as any).missingStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    return entityIds.length > 0 && entityIds.every((id) => {
      const statuses = get(state, `$.units.${id}.statuses`) as Record<string, unknown> | undefined;
      return statuses === undefined || !(key in statuses);
    });
  }

  if ("tagPresent" in node) {
    const { target, tag } = (node as any).tagPresent;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    return entityIds.length > 0 && entityIds.every((id) => {
      const keywords = get(state, `$.units.${id}.keywords`) as unknown[];
      return Array.isArray(keywords) && keywords.includes(tag);
    });
  }

  if ("selector" in node) {
    const { id } = (node as any).selector;
    const ids = evaluateSelector(id, state, event, glossary);
    return ids.length > 0;
  }

  if ("poolContainsPattern" in node) {
    const { pool, filter, pattern } = (node as any).poolContainsPattern;
    const dice = readDiePool(state, pool);
    const filtered = dice.filter((d) => dieMatchesFilter(d, filter));
    const minVal = pattern.minValue ?? 1;
    const eligible = filtered.filter((d) => (d.value as number) >= minVal);

    // Group by value
    const groups = new Map<number, number>();
    for (const d of eligible) {
      const v = d.value as number;
      groups.set(v, (groups.get(v) ?? 0) + 1);
    }

    const needed = pattern.kind === "double" ? 2 : 3;
    for (const count of groups.values()) {
      if (count >= needed) return true;
    }
    return false;
  }

  if ("diePoolCount" in node) {
    const { pool, filter, min } = (node as any).diePoolCount;
    const dice = readDiePool(state, pool);
    const count = dice.filter((d) => dieMatchesFilter(d, filter)).length;
    return count >= min;
  }

  throw new Error(`Unknown predicate type: ${JSON.stringify(node)}`);
}

/**
 * Resolve a PlayerRef to a player ID string.
 */
function resolvePlayerRef(ref: PlayerRef, event: GameEvent): string {
  if ("literal" in ref) return ref.literal;
  if ("eventParam" in ref) return event.params[ref.eventParam] as string;
  throw new Error(`Cannot resolve player ref: ${JSON.stringify(ref)}`);
}

/**
 * Resolve a TargetRef to an array of entity IDs.
 */
export function resolveTargetEntityIds(
  target: TargetRef | undefined,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): string[] {
  if (!target) return [];

  if ("path" in target) {
    const val = get(state, target.path);
    if (typeof val === "string") return [val];
    return [];
  }

  if ("eventParam" in target) {
    const val = event.params[target.eventParam];
    if (typeof val === "string") return [val];
    return [];
  }

  if ("selector" in target) {
    return evaluateSelector(target.selector, state, event, glossary);
  }

  return [];
}

/**
 * Evaluate a named selector from the glossary, returning matching entity IDs.
 */
export function evaluateSelector(
  selectorId: string,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): string[] {
  const def = glossary.selectors[selectorId];
  if (!def) return [];
  return evaluateSelectorDef(def, state, event, glossary);
}

/**
 * Evaluate a SelectorDef against state.
 */
export function evaluateSelectorDef(
  def: SelectorDef,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): string[] {
  if (def.byEventParam) {
    const val = event.params[def.byEventParam];
    return typeof val === "string" ? [val] : [];
  }

  // Get all entities of the given kind
  const entities = getEntitiesOfKind(def.kind, state, event);

  if (def.all) return entities;

  if (def.where) {
    return entities.filter((entityId) => {
      // For the where predicate, we need to evaluate it in the context of each entity
      // The hasStatus/missingStatus predicates check the entity directly when no target is specified
      return evaluatePredicateForEntity(def.where!, entityId, state, event, glossary);
    });
  }

  return entities;
}

/**
 * Get all entity IDs of a given kind.
 */
function getEntitiesOfKind(kind: string, state: State, event: GameEvent): string[] {
  if (kind === "unit") {
    const units = get(state, "$.units") as Record<string, unknown> | undefined;
    if (!units) return [];
    // Filter by active player if turnPlayer is set
    return Object.keys(units);
  }
  if (kind === "player") {
    const players = get(state, "$.players") as string[] | undefined;
    return players ?? [];
  }
  return [];
}

/**
 * Evaluate a predicate in the context of a specific entity.
 * Used by selector `where` clauses where hasStatus/missingStatus
 * should check the iterated entity, not a target ref.
 */
function evaluatePredicateForEntity(
  node: PredicateNode,
  entityId: string,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): boolean {
  // For hasStatus/missingStatus in a where clause, the implicit target is the current entity
  if ("hasStatus" in node) {
    const { key } = (node as any).hasStatus;
    const target = (node as any).hasStatus.target;
    if (!target) {
      const statuses = get(state, `$.units.${entityId}.statuses`) as Record<string, unknown> | undefined;
      return statuses !== undefined && key in statuses;
    }
  }
  if ("missingStatus" in node) {
    const { key } = (node as any).missingStatus;
    const target = (node as any).missingStatus.target;
    if (!target) {
      const statuses = get(state, `$.units.${entityId}.statuses`) as Record<string, unknown> | undefined;
      return statuses === undefined || !(key in statuses);
    }
  }
  // For pathEquals in a where clause, evaluate normally
  if ("pathEquals" in node) {
    return evaluatePredicate(node, state, event, glossary);
  }

  // Fall through to general evaluation
  return evaluatePredicate(node, state, event, glossary);
}

/**
 * Resolve a PlayerRef to a player ID string. Exported for use by effects.
 */
export function resolvePlayer(ref: PlayerRef, event: GameEvent): string {
  return resolvePlayerRef(ref, event);
}
