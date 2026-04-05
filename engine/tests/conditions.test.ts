import { describe, it, expect } from 'vitest';
import type { Condition, State, Rule } from '../src/types.js';
import {
  evaluateCondition,
  enumerateObjects,
  isOptionalRule,
  getChoicePlayer,
  extractEventRefs,
  usesOnCondition,
  EvalContext,
} from '../src/conditions.js';

function makeCtx(state: State, overrides?: Partial<EvalContext>): EvalContext {
  return {
    state,
    objects: new Map(),
    selectors: new Map(),
    firedOnRules: new Set(),
    currentEvent: 'test-event',
    ...overrides,
  };
}

function makeRule(when: Condition, id = 'r1'): Rule {
  return { id, when, effect: [] };
}

// --- is ---
describe('is condition', () => {
  it('returns true when flag is set', () => {
    const state: State = { flags: { battleshock: true } };
    expect(evaluateCondition({ is: 'battleshock' }, makeCtx(state))).toBe(true);
  });

  it('returns false when flag is not set', () => {
    const state: State = { flags: {} };
    expect(evaluateCondition({ is: 'battleshock' }, makeCtx(state))).toBe(false);
  });

  it('resolves $entity. prefix against entityPath', () => {
    const state: State = { players: { p1: { units: { u1: { moved: true } } } } };
    const ctx = makeCtx(state, { entityPath: '$.players.p1.units.u1' });
    expect(evaluateCondition({ is: '$entity.moved' }, ctx)).toBe(true);
  });

  it('returns false for $entity. when value missing', () => {
    const state: State = { players: { p1: { units: { u1: {} } } } };
    const ctx = makeCtx(state, { entityPath: '$.players.p1.units.u1' });
    expect(evaluateCondition({ is: '$entity.moved' }, ctx)).toBe(false);
  });

  it('checks $. path directly from state', () => {
    const state: State = { turnPlayer: 'p1' };
    expect(evaluateCondition({ is: '$.turnPlayer' }, makeCtx(state))).toBe(true);
  });

  it('returns false for missing $. path', () => {
    const state: State = {};
    expect(evaluateCondition({ is: '$.turnPlayer' }, makeCtx(state))).toBe(false);
  });
});

// --- on ---
describe('on condition', () => {
  it('returns true when flag is set', () => {
    const state: State = { flags: { 'command-phase': true } };
    expect(evaluateCondition({ on: 'command-phase' }, makeCtx(state))).toBe(true);
  });

  it('returns false when flag is not set', () => {
    const state: State = { flags: {} };
    expect(evaluateCondition({ on: 'command-phase' }, makeCtx(state))).toBe(false);
  });
});

// --- all, any, not ---
describe('all condition', () => {
  it('returns true when all children are true', () => {
    const state: State = { flags: { a: true, b: true } };
    const cond: Condition = { all: [{ is: 'a' }, { is: 'b' }] };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(true);
  });

  it('returns false when any child is false', () => {
    const state: State = { flags: { a: true } };
    const cond: Condition = { all: [{ is: 'a' }, { is: 'b' }] };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(false);
  });
});

describe('any condition', () => {
  it('returns true when at least one child is true', () => {
    const state: State = { flags: { a: true } };
    const cond: Condition = { any: [{ is: 'a' }, { is: 'b' }] };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(true);
  });

  it('returns false when no children are true', () => {
    const state: State = { flags: {} };
    const cond: Condition = { any: [{ is: 'a' }, { is: 'b' }] };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(false);
  });
});

describe('not condition', () => {
  it('inverts true to false', () => {
    const state: State = { flags: { a: true } };
    expect(evaluateCondition({ not: { is: 'a' } }, makeCtx(state))).toBe(false);
  });

  it('inverts false to true', () => {
    const state: State = { flags: {} };
    expect(evaluateCondition({ not: { is: 'a' } }, makeCtx(state))).toBe(true);
  });
});

// --- pathEquals ---
describe('pathEquals condition', () => {
  it('returns true when path value equals expected value', () => {
    const state: State = { round: 3 };
    const cond: Condition = { pathEquals: { path: '$.round', value: 3 } };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(true);
  });

  it('returns false when values differ', () => {
    const state: State = { round: 2 };
    const cond: Condition = { pathEquals: { path: '$.round', value: 3 } };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(false);
  });

  it('compares with another path via { path } value', () => {
    const state: State = { a: 5, b: 5 };
    const cond: Condition = { pathEquals: { path: '$.a', value: { path: '$.b' } } };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(true);
  });

  it('resolves $entity. in path', () => {
    const state: State = { players: { p1: { units: { u1: { hp: 10 } } } } };
    const ctx = makeCtx(state, { entityPath: '$.players.p1.units.u1' });
    const cond: Condition = { pathEquals: { path: '$entity.hp', value: 10 } };
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });
});

// --- pathAtLeast ---
describe('pathAtLeast condition', () => {
  it('returns true when value >= threshold', () => {
    const state: State = { cp: 5 };
    expect(evaluateCondition({ pathAtLeast: { path: '$.cp', value: 3 } }, makeCtx(state))).toBe(true);
  });

  it('returns true when value == threshold', () => {
    const state: State = { cp: 3 };
    expect(evaluateCondition({ pathAtLeast: { path: '$.cp', value: 3 } }, makeCtx(state))).toBe(true);
  });

  it('returns false when value < threshold', () => {
    const state: State = { cp: 2 };
    expect(evaluateCondition({ pathAtLeast: { path: '$.cp', value: 3 } }, makeCtx(state))).toBe(false);
  });

  it('returns false when path missing', () => {
    const state: State = {};
    expect(evaluateCondition({ pathAtLeast: { path: '$.cp', value: 3 } }, makeCtx(state))).toBe(false);
  });
});

// --- pathAtLeastPath ---
describe('pathAtLeastPath condition', () => {
  it('returns true when path >= otherPath', () => {
    const state: State = { a: 5, b: 3 };
    expect(evaluateCondition({ pathAtLeastPath: { path: '$.a', otherPath: '$.b' } }, makeCtx(state))).toBe(true);
  });

  it('returns false when path < otherPath', () => {
    const state: State = { a: 2, b: 3 };
    expect(evaluateCondition({ pathAtLeastPath: { path: '$.a', otherPath: '$.b' } }, makeCtx(state))).toBe(false);
  });
});

// --- pathMissing ---
describe('pathMissing condition', () => {
  it('returns true when path does not exist', () => {
    const state: State = {};
    expect(evaluateCondition({ pathMissing: '$.foo' }, makeCtx(state))).toBe(true);
  });

  it('returns false when path exists', () => {
    const state: State = { foo: 42 };
    expect(evaluateCondition({ pathMissing: '$.foo' }, makeCtx(state))).toBe(false);
  });
});

// --- pathIn ---
describe('pathIn condition', () => {
  it('returns true when value is in the set', () => {
    const state: State = { phase: 'command' };
    expect(evaluateCondition({ pathIn: { path: '$.phase', values: ['command', 'movement'] } }, makeCtx(state))).toBe(true);
  });

  it('returns false when value is not in the set', () => {
    const state: State = { phase: 'shooting' };
    expect(evaluateCondition({ pathIn: { path: '$.phase', values: ['command', 'movement'] } }, makeCtx(state))).toBe(false);
  });
});

// --- selector ---
describe('selector condition', () => {
  it('returns true when objects match', () => {
    const state: State = { players: { p1: { units: { u1: { hp: 10 } } } } };
    const objects = new Map([['unit', '$.players.*.units.*']]);
    const cond: Condition = { selector: { object: 'unit' } };
    expect(evaluateCondition(cond, makeCtx(state, { objects }))).toBe(true);
  });

  it('returns false when no objects exist', () => {
    const state: State = { players: { p1: { units: {} } } };
    const objects = new Map([['unit', '$.players.*.units.*']]);
    const cond: Condition = { selector: { object: 'unit' } };
    expect(evaluateCondition(cond, makeCtx(state, { objects }))).toBe(false);
  });

  it('filters with where condition using $entity', () => {
    const state: State = {
      players: { p1: { units: { u1: { hp: 10, moved: true }, u2: { hp: 5 } } } },
    };
    const objects = new Map([['unit', '$.players.*.units.*']]);
    const cond: Condition = {
      selector: { object: 'unit', where: { is: '$entity.moved' } },
    };
    expect(evaluateCondition(cond, makeCtx(state, { objects }))).toBe(true);
  });

  it('returns false when no objects match where', () => {
    const state: State = {
      players: { p1: { units: { u1: { hp: 10 }, u2: { hp: 5 } } } },
    };
    const objects = new Map([['unit', '$.players.*.units.*']]);
    const cond: Condition = {
      selector: { object: 'unit', where: { is: '$entity.moved' } },
    };
    expect(evaluateCondition(cond, makeCtx(state, { objects }))).toBe(false);
  });

  it('resolves named selector by id', () => {
    const state: State = { players: { p1: { units: { u1: { hp: 10 } } } } };
    const objects = new Map([['unit', '$.players.*.units.*']]);
    const selectors = new Map([['active-units', { object: 'unit' }]]);
    const cond: Condition = { selector: { object: 'unit', id: 'active-units' } };
    expect(evaluateCondition(cond, makeCtx(state, { objects, selectors }))).toBe(true);
  });
});

// --- tagPresent ---
describe('tagPresent condition', () => {
  it('returns true when tag is in keywords array', () => {
    const state: State = {
      players: { p1: { units: { u1: { keywords: ['infantry', 'psyker'] } } } },
    };
    const cond: Condition = {
      tagPresent: { target: { path: '$.players.p1.units.u1' }, tag: 'psyker' },
    };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(true);
  });

  it('returns false when tag is not in keywords', () => {
    const state: State = {
      players: { p1: { units: { u1: { keywords: ['infantry'] } } } },
    };
    const cond: Condition = {
      tagPresent: { target: { path: '$.players.p1.units.u1' }, tag: 'psyker' },
    };
    expect(evaluateCondition(cond, makeCtx(state))).toBe(false);
  });
});

// --- playerChoice ---
describe('playerChoice condition', () => {
  it('always returns true', () => {
    const state: State = {};
    expect(evaluateCondition({ playerChoice: { player: '$.turnPlayer' } }, makeCtx(state))).toBe(true);
  });
});

// --- manual ---
describe('manual condition', () => {
  it('always returns true', () => {
    const state: State = {};
    expect(evaluateCondition({ manual: 'Check line of sight' }, makeCtx(state))).toBe(true);
  });
});

// --- helper functions ---
describe('isOptionalRule', () => {
  it('returns true when rule contains playerChoice', () => {
    const rule = makeRule({ all: [{ is: 'x' }, { playerChoice: { player: '$.p' } }] });
    expect(isOptionalRule(rule)).toBe(true);
  });

  it('returns false when rule has no playerChoice', () => {
    const rule = makeRule({ is: 'x' });
    expect(isOptionalRule(rule)).toBe(false);
  });

  it('detects playerChoice in nested any', () => {
    const rule = makeRule({ any: [{ playerChoice: { player: '$.p' } }] });
    expect(isOptionalRule(rule)).toBe(true);
  });
});

describe('getChoicePlayer', () => {
  it('returns player path from playerChoice', () => {
    const rule = makeRule({ playerChoice: { player: '$.turnPlayer' } });
    expect(getChoicePlayer(rule)).toBe('$.turnPlayer');
  });

  it('returns null when no playerChoice', () => {
    const rule = makeRule({ is: 'x' });
    expect(getChoicePlayer(rule)).toBeNull();
  });
});

describe('extractEventRefs', () => {
  it('finds on and is references', () => {
    const cond: Condition = { all: [{ on: 'command-phase' }, { is: 'active' }] };
    const refs = extractEventRefs(cond);
    expect(refs.on).toEqual(['command-phase']);
    expect(refs.is).toEqual(['active']);
  });

  it('finds nested references', () => {
    const cond: Condition = { any: [{ on: 'a' }, { not: { is: 'b' } }] };
    const refs = extractEventRefs(cond);
    expect(refs.on).toEqual(['a']);
    expect(refs.is).toEqual(['b']);
  });
});

describe('usesOnCondition', () => {
  it('returns true when rule has on condition', () => {
    const rule = makeRule({ on: 'command-phase' });
    expect(usesOnCondition(rule)).toBe(true);
  });

  it('returns false when rule has no on condition', () => {
    const rule = makeRule({ is: 'active' });
    expect(usesOnCondition(rule)).toBe(false);
  });
});

// --- enumerateObjects ---
describe('enumerateObjects', () => {
  it('expands single wildcard', () => {
    const state: State = { players: { p1: { cp: 5 }, p2: { cp: 3 } } };
    const results = enumerateObjects(state, '$.players.*');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.path).sort()).toEqual(['$.players.p1', '$.players.p2']);
  });

  it('expands multiple wildcards', () => {
    const state: State = {
      players: {
        p1: { units: { u1: { hp: 10 }, u2: { hp: 8 } } },
        p2: { units: { u3: { hp: 12 } } },
      },
    };
    const results = enumerateObjects(state, '$.players.*.units.*');
    expect(results).toHaveLength(3);
    const paths = results.map(r => r.path).sort();
    expect(paths).toEqual([
      '$.players.p1.units.u1',
      '$.players.p1.units.u2',
      '$.players.p2.units.u3',
    ]);
  });

  it('returns empty when no matches', () => {
    const state: State = { players: {} };
    const results = enumerateObjects(state, '$.players.*.units.*');
    expect(results).toHaveLength(0);
  });

  it('returns concrete path without wildcards', () => {
    const state: State = { round: 3 };
    const results = enumerateObjects(state, '$.round');
    expect(results).toEqual([{ path: '$.round', value: 3 }]);
  });
});
