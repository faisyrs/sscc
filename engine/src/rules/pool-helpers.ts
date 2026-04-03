import type { State } from "../types/index.js";
import { get } from "../state/index.js";

export interface PoolDie {
  index: number;
  value: number;
  [key: string]: unknown;
}

/**
 * Read all die bundles from a pool path.
 * Expects state at poolPath to have a `count` field and `d0`, `d1`, ... bundles.
 */
export function readDiePool(state: State, poolPath: string): PoolDie[] {
  const count = get(state, `${poolPath}.count`);
  if (typeof count !== "number" || count <= 0) return [];
  const dice: PoolDie[] = [];
  for (let i = 0; i < count; i++) {
    const bundle = get(state, `${poolPath}.d${i}`) as Record<string, unknown> | undefined;
    if (bundle && typeof bundle === "object") {
      dice.push({ ...bundle, index: i } as PoolDie);
    }
  }
  return dice;
}

/**
 * Check if a die matches all fields in a filter object.
 * Returns true if filter is undefined or empty.
 */
export function dieMatchesFilter(
  die: PoolDie,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (die[key] !== expected) return false;
  }
  return true;
}
