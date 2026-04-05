import type { Condition, State, ObjectMap, SelectorDef, SelectorMap, Rule } from './types.js';
import { getPath, hasFlag } from './state.js';

export interface EvalContext {
  state: State;
  objects: ObjectMap;
  selectors: SelectorMap;
  firedOnRules: Set<string>;
  currentEvent: string;
  entityPath?: string;
}

/**
 * Enumerate all objects matching a path pattern with wildcards.
 * e.g. "$.players.*.units.*" expands to all unit paths.
 */
export function enumerateObjects(
  state: State,
  pattern: string,
): Array<{ path: string; value: unknown }> {
  // Strip leading "$." and split
  const raw = pattern.startsWith('$.') ? pattern.slice(2) : pattern;
  const segments = raw.split('.');
  const results: Array<{ path: string; value: unknown }> = [];
  walk(state, segments, '$', results);
  return results;
}

function walk(
  obj: unknown,
  segments: string[],
  currentPath: string,
  results: Array<{ path: string; value: unknown }>,
): void {
  if (segments.length === 0) {
    results.push({ path: currentPath, value: obj });
    return;
  }
  if (obj === null || obj === undefined || typeof obj !== 'object') return;

  const [head, ...rest] = segments;
  const record = obj as Record<string, unknown>;

  if (head === '*') {
    for (const key of Object.keys(record)) {
      walk(record[key], rest, `${currentPath}.${key}`, results);
    }
  } else {
    if (head in record) {
      walk(record[head], rest, `${currentPath}.${head}`, results);
    }
  }
}

/**
 * Resolve a path that may start with "$entity." by substituting the entity path.
 */
function resolveEntityPath(path: string, entityPath?: string): string {
  if (path.startsWith('$entity.') && entityPath) {
    return entityPath + '.' + path.slice('$entity.'.length);
  }
  return path;
}

export function evaluateCondition(condition: Condition, ctx: EvalContext): boolean {
  // is
  if ('is' in condition) {
    const x = (condition as { is: string }).is;
    if (x.startsWith('$entity.') && ctx.entityPath) {
      const resolved = ctx.entityPath + '.' + x.slice('$entity.'.length);
      return getPath(ctx.state, resolved) !== undefined;
    }
    if (x.startsWith('$.')) {
      return getPath(ctx.state, x) !== undefined;
    }
    return hasFlag(ctx.state, x);
  }

  // on — same as is (flag check); rule loop handles fire-once
  if ('on' in condition) {
    const x = (condition as { on: string }).on;
    return hasFlag(ctx.state, x);
  }

  // all
  if ('all' in condition) {
    const children = (condition as { all: Condition[] }).all;
    return children.every(c => evaluateCondition(c, ctx));
  }

  // any
  if ('any' in condition) {
    const children = (condition as { any: Condition[] }).any;
    return children.some(c => evaluateCondition(c, ctx));
  }

  // not
  if ('not' in condition) {
    const child = (condition as { not: Condition }).not;
    return !evaluateCondition(child, ctx);
  }

  // pathEquals
  if ('pathEquals' in condition) {
    const { path, value } = (condition as { pathEquals: { path: string; value: unknown } }).pathEquals;
    const resolvedPath = resolveEntityPath(path, ctx.entityPath);
    const actual = getPath(ctx.state, resolvedPath);
    // value can be { path: "$.x" } meaning compare with another path
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'path' in (value as Record<string, unknown>)) {
      const otherPath = (value as { path: string }).path;
      const resolvedOther = resolveEntityPath(otherPath, ctx.entityPath);
      const expected = getPath(ctx.state, resolvedOther);
      return actual === expected;
    }
    return actual === value;
  }

  // pathAtLeast
  if ('pathAtLeast' in condition) {
    const { path, value } = (condition as { pathAtLeast: { path: string; value: number } }).pathAtLeast;
    const resolvedPath = resolveEntityPath(path, ctx.entityPath);
    const actual = getPath(ctx.state, resolvedPath);
    return typeof actual === 'number' && actual >= value;
  }

  // pathAtLeastPath
  if ('pathAtLeastPath' in condition) {
    const { path, otherPath } = (condition as { pathAtLeastPath: { path: string; otherPath: string } }).pathAtLeastPath;
    const resolvedPath = resolveEntityPath(path, ctx.entityPath);
    const resolvedOther = resolveEntityPath(otherPath, ctx.entityPath);
    const a = getPath(ctx.state, resolvedPath);
    const b = getPath(ctx.state, resolvedOther);
    return typeof a === 'number' && typeof b === 'number' && a >= b;
  }

  // pathMissing
  if ('pathMissing' in condition) {
    const path = (condition as { pathMissing: string }).pathMissing;
    const resolvedPath = resolveEntityPath(path, ctx.entityPath);
    return getPath(ctx.state, resolvedPath) === undefined;
  }

  // pathIn
  if ('pathIn' in condition) {
    const { path, values } = (condition as { pathIn: { path: string; values: unknown[] } }).pathIn;
    const resolvedPath = resolveEntityPath(path, ctx.entityPath);
    const actual = getPath(ctx.state, resolvedPath);
    return values.includes(actual);
  }

  // selector
  if ('selector' in condition) {
    const selectorDef = resolveSelectorDef((condition as { selector: SelectorDef }).selector, ctx.selectors);
    const objectType = selectorDef.object;
    const pathPattern = ctx.objects.get(objectType);
    if (!pathPattern) return false;

    const instances = enumerateObjects(ctx.state, pathPattern);
    if (!selectorDef.where) return instances.length > 0;

    for (const inst of instances) {
      const childCtx: EvalContext = { ...ctx, entityPath: inst.path };
      if (evaluateCondition(selectorDef.where, childCtx)) {
        return true;
      }
    }
    return false;
  }

  // tagPresent
  if ('tagPresent' in condition) {
    const { target, tag } = (condition as { tagPresent: { target: { path: string }; tag: string } }).tagPresent;
    const resolvedPath = resolveEntityPath(target.path, ctx.entityPath);
    const keywords = getPath(ctx.state, resolvedPath + '.keywords');
    if (Array.isArray(keywords)) {
      return keywords.includes(tag);
    }
    return false;
  }

  // playerChoice — always true (marker)
  if ('playerChoice' in condition) {
    return true;
  }

  // manual — always true
  if ('manual' in condition) {
    return true;
  }

  return false;
}

function resolveSelectorDef(def: SelectorDef, selectors: SelectorMap): SelectorDef {
  if (def.id) {
    const named = selectors.get(def.id);
    if (named) return named;
  }
  return def;
}

/** Check if a rule's condition tree contains playerChoice */
export function isOptionalRule(rule: Rule): boolean {
  return containsPlayerChoice(rule.when);
}

function containsPlayerChoice(condition: Condition): boolean {
  if ('playerChoice' in condition) return true;
  if ('all' in condition) return (condition as { all: Condition[] }).all.some(containsPlayerChoice);
  if ('any' in condition) return (condition as { any: Condition[] }).any.some(containsPlayerChoice);
  if ('not' in condition) return containsPlayerChoice((condition as { not: Condition }).not);
  return false;
}

/** Get the player path from playerChoice, or null */
export function getChoicePlayer(rule: Rule): string | null {
  return findPlayerChoice(rule.when);
}

function findPlayerChoice(condition: Condition): string | null {
  if ('playerChoice' in condition) return (condition as { playerChoice: { player: string } }).playerChoice.player;
  if ('all' in condition) {
    for (const c of (condition as { all: Condition[] }).all) {
      const result = findPlayerChoice(c);
      if (result !== null) return result;
    }
  }
  if ('any' in condition) {
    for (const c of (condition as { any: Condition[] }).any) {
      const result = findPlayerChoice(c);
      if (result !== null) return result;
    }
  }
  if ('not' in condition) return findPlayerChoice((condition as { not: Condition }).not);
  return null;
}

/** Extract all on/is event references from a condition tree */
export function extractEventRefs(condition: Condition): { on: string[]; is: string[] } {
  const result = { on: [] as string[], is: [] as string[] };
  collectEventRefs(condition, result);
  return result;
}

function collectEventRefs(condition: Condition, result: { on: string[]; is: string[] }): void {
  if ('on' in condition) {
    result.on.push((condition as { on: string }).on);
  } else if ('is' in condition) {
    result.is.push((condition as { is: string }).is);
  } else if ('all' in condition) {
    for (const c of (condition as { all: Condition[] }).all) collectEventRefs(c, result);
  } else if ('any' in condition) {
    for (const c of (condition as { any: Condition[] }).any) collectEventRefs(c, result);
  } else if ('not' in condition) {
    collectEventRefs((condition as { not: Condition }).not, result);
  }
}

/** Check if a rule uses 'on' (fire-once) semantics */
export function usesOnCondition(rule: Rule): boolean {
  return hasOnCondition(rule.when);
}

function hasOnCondition(condition: Condition): boolean {
  if ('on' in condition) return true;
  if ('all' in condition) return (condition as { all: Condition[] }).all.some(hasOnCondition);
  if ('any' in condition) return (condition as { any: Condition[] }).any.some(hasOnCondition);
  if ('not' in condition) return hasOnCondition((condition as { not: Condition }).not);
  return false;
}
