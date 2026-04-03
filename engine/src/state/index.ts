import type { State, StatusEntry } from "../types/index.js";

/**
 * Parse a $-prefixed path into segments.
 * "$.a.b.c" -> ["a", "b", "c"]
 * "$" -> []
 */
function parsePath(path: string): string[] {
  if (path === "$") return [];
  if (!path.startsWith("$.")) {
    throw new Error(`Invalid state path: ${path} (must start with "$." or be "$")`);
  }
  return path.slice(2).split(".");
}

/**
 * Get a value from state at the given path.
 * Returns undefined if any segment along the path is missing or not an object.
 */
export function get(state: State, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = state;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Set a value in state at the given path, returning a new state.
 * Creates intermediate objects for missing segments.
 * Never mutates the input state.
 */
export function set(state: State, path: string, value: unknown): State {
  const segments = parsePath(path);
  if (segments.length === 0) {
    // Setting root -- value must be a Record
    return value as State;
  }
  return setRecursive(state, segments, 0, value) as State;
}

function setRecursive(
  current: unknown,
  segments: string[],
  index: number,
  value: unknown,
): unknown {
  const obj =
    current !== null && current !== undefined && typeof current === "object"
      ? (current as Record<string, unknown>)
      : {};
  const seg = segments[index];
  if (index === segments.length - 1) {
    return { ...obj, [seg]: value };
  }
  return {
    ...obj,
    [seg]: setRecursive(obj[seg], segments, index + 1, value),
  };
}

/**
 * Get all statuses for an entity (looks up units.<entityId>.statuses).
 */
export function getStatuses(
  state: State,
  entityId: string,
): Record<string, StatusEntry> {
  const result = get(state, `$.units.${entityId}.statuses`);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, StatusEntry>;
  }
  return {};
}

/**
 * Apply a status to an entity. Idempotent -- re-applying is a no-op.
 */
export function applyStatus(
  state: State,
  entityId: string,
  key: string,
  expiresOn: string | null,
): State {
  const current = getStatuses(state, entityId);
  if (key in current) return state;
  const entry: StatusEntry = { expiresOn };
  const newStatuses = { ...current, [key]: entry };
  return set(state, `$.units.${entityId}.statuses`, newStatuses);
}

/**
 * Remove a status from an entity. No-op if not present.
 */
export function removeStatus(
  state: State,
  entityId: string,
  key: string,
): State {
  const current = getStatuses(state, entityId);
  if (!(key in current)) return state;
  const { [key]: _, ...rest } = current;
  return set(state, `$.units.${entityId}.statuses`, rest);
}

/**
 * Expire all statuses across all entities whose expiresOn matches the event ID.
 * Called at the START of event evaluation, before rules fire.
 */
export function expireStatuses(state: State, eventId: string): State {
  const units = get(state, "$.units") as Record<string, unknown> | undefined;
  if (!units || typeof units !== "object") return state;

  let current = state;
  for (const entityId of Object.keys(units)) {
    const statuses = getStatuses(current, entityId);
    let changed = false;
    const newStatuses: Record<string, StatusEntry> = {};
    for (const [key, entry] of Object.entries(statuses)) {
      if (entry.expiresOn === eventId) {
        changed = true;
      } else {
        newStatuses[key] = entry;
      }
    }
    if (changed) {
      current = set(current, `$.units.${entityId}.statuses`, newStatuses);
    }
  }
  return current;
}
