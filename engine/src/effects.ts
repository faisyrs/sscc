import type {
  Effect,
  SetEffect,
  UnsetEffect,
  SequenceEffect,
  TestEffect,
  SetSeedEffect,
  AppendLogNoteEffect,
  ManualEffect,
  State,
  ObjectMap,
  SelectorDef,
  SelectorMap,
  DerivedStateMap,
  LogEntry,
} from './types.js';
import { getPath, setPath, unsetPath, hasFlag, setFlag, unsetFlag, resolveValue, deepClone } from './state.js';
import { SeededRNG } from './rng.js';
import { enumerateObjects, evaluateCondition } from './conditions.js';

export interface EffectResult {
  state: State;
  enterSequence?: string | string[];
  logEntries: LogEntry[];
}

export interface EffectContext {
  state: State;
  rng: SeededRNG;
  objects: ObjectMap;
  selectors: SelectorMap;
  derived: DerivedStateMap;
  log: LogEntry[];
  currentEvent: string;
  derivedEvaluator?: (name: string, unitPath: string, state: State) => number;
}

export function executeEffect(effect: Effect, ctx: EffectContext): EffectResult {
  // set
  if ('set' in effect && !('setSeed' in effect)) {
    return executeSet(effect as SetEffect, ctx);
  }

  // unset
  if ('unset' in effect) {
    return executeUnset(effect as UnsetEffect, ctx);
  }

  // sequence
  if ('sequence' in effect) {
    const seq = (effect as SequenceEffect).sequence;
    return { state: ctx.state, enterSequence: seq, logEntries: [] };
  }

  // test
  if ('test' in effect) {
    return executeTest(effect as TestEffect, ctx);
  }

  // setSeed
  if ('setSeed' in effect) {
    const seed = (effect as SetSeedEffect).setSeed;
    ctx.rng.setState(seed);
    return { state: ctx.state, logEntries: [] };
  }

  // appendLogNote
  if ('appendLogNote' in effect) {
    const message = (effect as AppendLogNoteEffect).appendLogNote;
    const entry: LogEntry = {
      type: 'note',
      event: ctx.currentEvent,
      message,
      timestamp: Date.now(),
    };
    return { state: ctx.state, logEntries: [entry] };
  }

  // manual
  if ('manual' in effect) {
    const message = (effect as ManualEffect).manual;
    const entry: LogEntry = {
      type: 'manual',
      event: ctx.currentEvent,
      message,
      timestamp: Date.now(),
    };
    return { state: ctx.state, logEntries: [entry] };
  }

  return { state: ctx.state, logEntries: [] };
}

function executeSet(effect: SetEffect, ctx: EffectContext): EffectResult {
  const path = effect.set;
  let state = ctx.state;

  // valueFromChoice — skip, the engine handles this at choice time
  if (effect.valueFromChoice !== undefined) {
    return { state, logEntries: [] };
  }

  // No $.prefix — flag set
  if (!path.startsWith('$.')) {
    if (effect.value === undefined) {
      // bare flag set
      state = setFlag(state, path, effect.expiresOn);
    } else {
      // flag with value — resolve and set
      const resolved = resolveValue(state, effect.value, ctx.rng);
      if (typeof resolved === 'object' && resolved !== null && 'add' in (resolved as Record<string, unknown>)) {
        const addN = (resolved as { add: number }).add;
        const current = getPath(state, `$.flags.${path}`);
        const currentNum = typeof current === 'number' ? current : 0;
        state = setPath(state, `$.flags.${path}`, currentNum + addN);
      } else {
        state = setPath(state, `$.flags.${path}`, resolved);
      }
    }
    return { state, logEntries: [] };
  }

  // $.path set
  if (effect.value === undefined) {
    // set path to true
    state = setPath(state, path, true);
    return { state, logEntries: [] };
  }

  const resolved = resolveValue(state, effect.value, ctx.rng);

  // { add: N } — increment
  if (typeof resolved === 'object' && resolved !== null && 'add' in (resolved as Record<string, unknown>)) {
    const addN = (resolved as { add: number }).add;
    const current = getPath(state, path);
    const currentNum = typeof current === 'number' ? current : 0;
    state = setPath(state, path, currentNum + addN);
  } else {
    state = setPath(state, path, resolved);
  }

  return { state, logEntries: [] };
}

function executeUnset(effect: UnsetEffect, ctx: EffectContext): EffectResult {
  let state = ctx.state;
  const target = effect.unset;

  if (typeof target === 'string') {
    // Simple unset
    if (target.startsWith('$.')) {
      state = unsetPath(state, target);
    } else {
      state = unsetFlag(state, target);
    }
    return { state, logEntries: [] };
  }

  // Bulk unset with selector
  const { key, target: selectorDef } = target;
  const objectType = selectorDef.object;
  const pathPattern = ctx.objects.get(objectType);
  if (!pathPattern) return { state, logEntries: [] };

  const instances = enumerateObjects(state, pathPattern);
  for (const inst of instances) {
    if (selectorDef.where) {
      const evalCtx = {
        state,
        objects: ctx.objects,
        selectors: ctx.selectors,
        firedOnRules: new Set<string>(),
        currentEvent: ctx.currentEvent,
        entityPath: inst.path,
      };
      if (!evaluateCondition(selectorDef.where, evalCtx)) continue;
    }
    state = unsetPath(state, `${inst.path}.${key}`);
  }

  return { state, logEntries: [] };
}

function executeTest(effect: TestEffect, ctx: EffectContext): EffectResult {
  const test = effect.test;
  let state = ctx.state;
  let sum = 0;

  // Roll dice
  if (test.roll) {
    let count: number;
    if (typeof test.roll.count === 'number') {
      count = test.roll.count;
    } else {
      const countVal = getPath(state, test.roll.count.path);
      count = typeof countVal === 'number' ? countVal : 0;
    }
    for (let i = 0; i < count; i++) {
      sum += ctx.rng.rollDie(test.roll.sides);
    }
  }

  // Use pool
  if (test.usePool) {
    const pool = getPath(state, test.usePool);
    if (Array.isArray(pool)) {
      sum = pool.reduce((acc: number, v: unknown) => acc + (typeof v === 'number' ? v : 0), 0);
    }
  }

  // Resolve target value
  let targetValue: number;
  if (test.target.value !== undefined) {
    targetValue = test.target.value;
  } else if (test.target.path) {
    const tv = getPath(state, test.target.path);
    targetValue = typeof tv === 'number' ? tv : 0;
  } else if (test.target.derived && test.target.unit?.path && ctx.derivedEvaluator) {
    targetValue = ctx.derivedEvaluator(test.target.derived, test.target.unit.path, state);
  } else {
    targetValue = 0;
  }

  // Compare
  let passed: boolean;
  switch (test.compare) {
    case 'gte':
      passed = sum >= targetValue;
      break;
    case 'lte':
      passed = sum <= targetValue;
      break;
    case 'eq':
      passed = sum === targetValue;
      break;
    default:
      passed = false;
  }

  // Execute branch
  const branch = passed ? test.pass : test.fail;
  const branchCtx = { ...ctx, state };
  return executeEffects(branch, branchCtx);
}

export function executeEffects(effects: Effect[], ctx: EffectContext): EffectResult {
  let state = ctx.state;
  const logEntries: LogEntry[] = [];
  let enterSequence: string | string[] | undefined;

  for (const effect of effects) {
    const result = executeEffect(effect, { ...ctx, state });
    state = result.state;
    logEntries.push(...result.logEntries);
    if (result.enterSequence !== undefined) {
      enterSequence = result.enterSequence;
    }
  }

  return { state, enterSequence, logEntries };
}
