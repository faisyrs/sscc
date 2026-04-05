import type { State } from './types.js';

/** Deep clone state using structuredClone. */
export function deepClone(state: State): State {
  return structuredClone(state);
}

/**
 * Parse a path string into segments.
 * - `$.` prefix = root path, strip `$` and split on `.`
 * - No `$.` prefix = flag path, resolve under `$.flags.<name>`
 */
function parsePath(path: string): string[] {
  if (path.startsWith('$.') || path === '$') {
    // Strip leading '$.' and split
    const raw = path.slice(2); // remove '$.'
    if (raw === '') return [];
    return raw.split('.');
  }
  // Flag shorthand: bare name → flags.<name>
  return ['flags', path];
}

/**
 * Get value at path. Returns undefined if path doesn't exist.
 * Supports `*` wildcard: returns array of all matching values at that level.
 */
export function getPath(state: State, path: string): unknown {
  const segments = parsePath(path);
  return getPathRecursive(state, segments);
}

function getPathRecursive(obj: unknown, segments: string[]): unknown {
  if (segments.length === 0) return obj;
  if (obj === null || obj === undefined || typeof obj !== 'object') return undefined;

  const [head, ...rest] = segments;

  if (head === '*') {
    // Wildcard: collect values for all keys, then continue resolving rest
    const record = obj as Record<string, unknown>;
    const results: unknown[] = [];
    for (const key of Object.keys(record)) {
      const val = getPathRecursive(record[key], rest);
      if (val !== undefined) {
        if (rest.includes('*') || Array.isArray(val)) {
          // Flatten nested wildcard results
          results.push(...(Array.isArray(val) ? val : [val]));
        } else {
          results.push(val);
        }
      }
    }
    return results;
  }

  return getPathRecursive((obj as Record<string, unknown>)[head], rest);
}

/**
 * Set value at path. Creates intermediate objects as needed.
 * Returns new state (does not mutate input).
 */
export function setPath(state: State, path: string, value: unknown): State {
  const segments = parsePath(path);
  if (segments.length === 0) {
    // Setting root — value must be a State
    return deepClone(value as State);
  }
  return setPathRecursive(deepClone(state), segments, value) as State;
}

function setPathRecursive(obj: Record<string, unknown>, segments: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    obj[head] = value;
    return obj;
  }
  if (obj[head] === undefined || obj[head] === null || typeof obj[head] !== 'object') {
    obj[head] = {};
  }
  setPathRecursive(obj[head] as Record<string, unknown>, rest, value);
  return obj;
}

/**
 * Remove key at path. Returns new state (does not mutate input).
 */
export function unsetPath(state: State, path: string): State {
  const segments = parsePath(path);
  if (segments.length === 0) return {};
  const clone = deepClone(state);
  unsetPathRecursive(clone, segments);
  return clone;
}

function unsetPathRecursive(obj: Record<string, unknown>, segments: string[]): void {
  const [head, ...rest] = segments;
  if (rest.length === 0) {
    delete obj[head];
    return;
  }
  if (obj[head] !== undefined && obj[head] !== null && typeof obj[head] === 'object') {
    unsetPathRecursive(obj[head] as Record<string, unknown>, rest);
  }
}

/** Check if a flag exists in $.flags */
export function hasFlag(state: State, name: string): boolean {
  const flags = state['flags'] as Record<string, unknown> | undefined;
  if (!flags) return false;
  const val = flags[name];
  if (val === undefined) return false;
  if (val === true) return true;
  // Support { value: true, expiresOn: ... } form
  if (typeof val === 'object' && val !== null && (val as Record<string, unknown>)['value'] === true) {
    return true;
  }
  return false;
}

/** Set a flag (true) in $.flags, with optional expiry event. */
export function setFlag(state: State, name: string, expiresOn?: string): State {
  const value: unknown = expiresOn ? { value: true, expiresOn } : true;
  return setPath(state, `$.flags.${name}`, value);
}

/** Remove a flag from $.flags. */
export function unsetFlag(state: State, name: string): State {
  return unsetPath(state, `$.flags.${name}`);
}

/**
 * Remove all flags whose expiresOn matches the given event name.
 * Flags with expiry are stored as: $.flags.<name> = { value: true, expiresOn: "eventName" }
 * Simple flags (true) are left untouched.
 */
export function expireFlags(state: State, eventName: string): State {
  const flags = state['flags'] as Record<string, unknown> | undefined;
  if (!flags) return state;

  const clone = deepClone(state);
  const clonedFlags = clone['flags'] as Record<string, unknown>;

  for (const key of Object.keys(clonedFlags)) {
    const val = clonedFlags[key];
    if (
      typeof val === 'object' &&
      val !== null &&
      (val as Record<string, unknown>)['expiresOn'] === eventName
    ) {
      delete clonedFlags[key];
    }
  }

  return clone;
}

/**
 * Resolve a value definition.
 * - Literal values (string, number, boolean, null) -> return as-is
 * - { add: N } -> return as-is (caller handles increment)
 * - { path: "$.x" } -> read from state
 * - { random: { min: M, max: N } } -> use rng to generate random number in [min, max]
 * - Nested objects/arrays -> return as-is
 */
export function resolveValue(
  state: State,
  valueDef: unknown,
  rng?: { rollDie(sides: number): number },
): unknown {
  if (valueDef === null || valueDef === undefined) return valueDef;
  if (typeof valueDef !== 'object') return valueDef;
  if (Array.isArray(valueDef)) return valueDef;

  const obj = valueDef as Record<string, unknown>;

  // { path: "$.x" } — read from state
  if ('path' in obj && typeof obj['path'] === 'string') {
    return getPath(state, obj['path'] as string);
  }

  // { random: { min, max } } — generate random number
  if ('random' in obj && rng) {
    const rand = obj['random'] as { min: number; max: number };
    const range = rand.max - rand.min + 1;
    const roll = rng.rollDie(range); // [1, range]
    return roll - 1 + rand.min; // shift to [min, max]
  }

  // { add: N } and everything else — return as-is
  return valueDef;
}
