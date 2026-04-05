import type { DerivedStateMap, State } from './types.js';
import { getPath } from './state.js';

/**
 * Get all modifier values matching a glob pattern like
 * "$.players.p1.units.u1.CurrentLeadership.modifier*".
 *
 * The last segment may contain a wildcard suffix (e.g. "modifier*").
 * Split off the last segment, get the parent object, then find
 * matching keys.
 */
export function getModifierValues(state: State, pattern: string): number[] {
  // Strip "$." prefix and split
  const raw = pattern.startsWith('$.') ? pattern.slice(2) : pattern;
  const segments = raw.split('.');
  if (segments.length === 0) return [];

  const lastSeg = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  // Get the parent object
  const parentPath = parentSegments.length > 0 ? `$.${parentSegments.join('.')}` : '$';
  const parent = getPath(state, parentPath);
  if (parent === null || parent === undefined || typeof parent !== 'object' || Array.isArray(parent)) {
    return [];
  }

  const record = parent as Record<string, unknown>;

  // If lastSeg contains '*', it's a glob pattern
  if (lastSeg.includes('*')) {
    const prefix = lastSeg.replace('*', '');
    const values: number[] = [];
    for (const key of Object.keys(record)) {
      if (key.startsWith(prefix)) {
        const val = record[key];
        if (typeof val === 'number') {
          values.push(val);
        }
      }
    }
    return values;
  }

  // Exact match
  const val = record[lastSeg];
  if (typeof val === 'number') return [val];
  return [];
}

export function evaluateDerived(
  name: string,
  definitions: DerivedStateMap,
  state: State,
  unitPath?: string,
): number {
  const def = definitions.get(name);
  if (!def) throw new Error(`Unknown derived state: ${name}`);

  // Resolve base path — if unitPath provided, replace "$.selectedUnit" with actual unit path
  let basePath = def.base.path;
  if (unitPath) {
    basePath = basePath.replace('$.selectedUnit', unitPath);
  }
  const base = getPath(state, basePath);
  if (typeof base !== 'number') return 0;

  // Find modifiers matching the glob pattern
  let modPattern = def.modifiers.match;
  if (unitPath) {
    modPattern = modPattern.replace('$.selectedUnit', unitPath);
  }

  const modValues = getModifierValues(state, modPattern);

  // Aggregate
  let total: number;
  const agg = def.aggregate || 'sum';
  switch (agg) {
    case 'sum':
      total = base + modValues.reduce((a, b) => a + b, 0);
      break;
    case 'min':
      total = modValues.length > 0 ? Math.min(base, ...modValues) : base;
      break;
    case 'max':
      total = modValues.length > 0 ? Math.max(base, ...modValues) : base;
      break;
    default:
      total = base;
  }

  // Clamp relative to base
  if (def.clamp) {
    if (def.clamp.min !== undefined) {
      total = Math.max(total, base + def.clamp.min.offset);
    }
    if (def.clamp.max !== undefined) {
      total = Math.min(total, base + def.clamp.max.offset);
    }
  }

  return total;
}
