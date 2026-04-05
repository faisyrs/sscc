import { describe, it, expect } from 'vitest';
import {
  deepClone,
  getPath,
  setPath,
  unsetPath,
  hasFlag,
  setFlag,
  unsetFlag,
  expireFlags,
  resolveValue,
} from '../src/state.js';
import type { State } from '../src/types.js';

describe('deepClone', () => {
  it('returns a deep copy that does not share references', () => {
    const state: State = { a: { b: 1 } };
    const clone = deepClone(state);
    (clone['a'] as Record<string, unknown>)['b'] = 2;
    expect((state['a'] as Record<string, unknown>)['b']).toBe(1);
  });
});

describe('getPath', () => {
  const state: State = {
    players: {
      p1: { cp: 5, units: { u1: { hp: 10 }, u2: { hp: 8 } } },
      p2: { cp: 3, units: { u3: { hp: 12 } } },
    },
    turnPlayer: 'p1',
    flags: { commandPhase: true },
  };

  it('resolves a simple root path', () => {
    expect(getPath(state, '$.turnPlayer')).toBe('p1');
  });

  it('resolves nested paths', () => {
    expect(getPath(state, '$.players.p1.cp')).toBe(5);
  });

  it('returns undefined for missing paths', () => {
    expect(getPath(state, '$.players.p1.nonexistent')).toBeUndefined();
    expect(getPath(state, '$.x.y.z')).toBeUndefined();
  });

  it('resolves wildcard * at one level', () => {
    const result = getPath(state, '$.players.*.cp');
    expect(result).toEqual([5, 3]);
  });

  it('resolves wildcard * with nested access', () => {
    const result = getPath(state, '$.players.*.units.*.hp');
    expect(result).toEqual([10, 8, 12]);
  });

  it('resolves bare name as flag path', () => {
    expect(getPath(state, 'commandPhase')).toBe(true);
  });

  it('returns undefined for missing flag', () => {
    expect(getPath(state, 'nonexistentFlag')).toBeUndefined();
  });
});

describe('setPath', () => {
  it('sets a value at a nested path', () => {
    const state: State = { players: { p1: { cp: 5 } } };
    const next = setPath(state, '$.players.p1.cp', 3);
    expect(getPath(next, '$.players.p1.cp')).toBe(3);
  });

  it('creates intermediate objects as needed', () => {
    const state: State = {};
    const next = setPath(state, '$.players.p1.cp', 5);
    expect(getPath(next, '$.players.p1.cp')).toBe(5);
  });

  it('does not mutate the original state', () => {
    const state: State = { players: { p1: { cp: 5 } } };
    setPath(state, '$.players.p1.cp', 3);
    expect((state['players'] as Record<string, unknown>)['p1']).toEqual({ cp: 5 });
  });

  it('sets a flag via bare name path', () => {
    const state: State = { flags: {} };
    const next = setPath(state, '$.flags.myFlag', true);
    expect(getPath(next, '$.flags.myFlag')).toBe(true);
  });
});

describe('unsetPath', () => {
  it('removes a key at the given path', () => {
    const state: State = { players: { p1: { cp: 5, hp: 10 } } };
    const next = unsetPath(state, '$.players.p1.cp');
    expect(getPath(next, '$.players.p1.cp')).toBeUndefined();
    expect(getPath(next, '$.players.p1.hp')).toBe(10);
  });

  it('does not mutate the original state', () => {
    const state: State = { a: { b: 1 } };
    unsetPath(state, '$.a.b');
    expect((state['a'] as Record<string, unknown>)['b']).toBe(1);
  });

  it('handles missing intermediate paths gracefully', () => {
    const state: State = {};
    const next = unsetPath(state, '$.a.b.c');
    expect(next).toEqual({});
  });
});

describe('hasFlag / setFlag / unsetFlag', () => {
  it('returns false when no flags exist', () => {
    expect(hasFlag({}, 'test')).toBe(false);
  });

  it('returns true after setting a flag', () => {
    const state = setFlag({}, 'commandPhase');
    expect(hasFlag(state, 'commandPhase')).toBe(true);
  });

  it('returns false after unsetting a flag', () => {
    let state = setFlag({}, 'commandPhase');
    state = unsetFlag(state, 'commandPhase');
    expect(hasFlag(state, 'commandPhase')).toBe(false);
  });

  it('setFlag with expiresOn stores expiry metadata', () => {
    const state = setFlag({}, 'myFlag', 'endOfPhase');
    expect(hasFlag(state, 'myFlag')).toBe(true);
    const flagVal = getPath(state, '$.flags.myFlag');
    expect(flagVal).toEqual({ value: true, expiresOn: 'endOfPhase' });
  });

  it('hasFlag returns true for expiry-form flags', () => {
    const state: State = {
      flags: { myFlag: { value: true, expiresOn: 'endOfPhase' } },
    };
    expect(hasFlag(state, 'myFlag')).toBe(true);
  });
});

describe('expireFlags', () => {
  it('removes flags matching the event name', () => {
    let state: State = {};
    state = setFlag(state, 'flagA', 'endOfPhase');
    state = setFlag(state, 'flagB', 'endOfTurn');
    state = setFlag(state, 'flagC'); // simple flag, no expiry

    const next = expireFlags(state, 'endOfPhase');
    expect(hasFlag(next, 'flagA')).toBe(false);
    expect(hasFlag(next, 'flagB')).toBe(true);
    expect(hasFlag(next, 'flagC')).toBe(true);
  });

  it('returns state unchanged when no flags exist', () => {
    const state: State = {};
    const next = expireFlags(state, 'endOfPhase');
    expect(next).toEqual({});
  });

  it('leaves simple boolean flags untouched', () => {
    let state: State = {};
    state = setFlag(state, 'simpleFlag');
    const next = expireFlags(state, 'endOfPhase');
    expect(hasFlag(next, 'simpleFlag')).toBe(true);
  });
});

describe('resolveValue', () => {
  it('returns literal string as-is', () => {
    expect(resolveValue({}, 'hello')).toBe('hello');
  });

  it('returns literal number as-is', () => {
    expect(resolveValue({}, 42)).toBe(42);
  });

  it('returns literal boolean as-is', () => {
    expect(resolveValue({}, true)).toBe(true);
  });

  it('returns null as-is', () => {
    expect(resolveValue({}, null)).toBe(null);
  });

  it('returns undefined as-is', () => {
    expect(resolveValue({}, undefined)).toBeUndefined();
  });

  it('returns { add: N } as-is', () => {
    const val = { add: 5 };
    expect(resolveValue({}, val)).toEqual({ add: 5 });
  });

  it('resolves { path } by reading from state', () => {
    const state: State = { players: { p1: { cp: 7 } } };
    expect(resolveValue(state, { path: '$.players.p1.cp' })).toBe(7);
  });

  it('resolves { path } returning undefined for missing path', () => {
    expect(resolveValue({}, { path: '$.missing' })).toBeUndefined();
  });

  it('resolves { random } using rng', () => {
    const mockRng = { rollDie: (sides: number) => sides }; // always returns max
    const result = resolveValue({}, { random: { min: 1, max: 6 } }, mockRng);
    // rollDie(6) returns 6, so result = 6 - 1 + 1 = 6
    expect(result).toBe(6);
  });

  it('resolves { random } with min > 1', () => {
    const mockRng = { rollDie: (_: number) => 1 }; // always returns 1
    const result = resolveValue({}, { random: { min: 3, max: 8 } }, mockRng);
    // rollDie(6) returns 1, so result = 1 - 1 + 3 = 3
    expect(result).toBe(3);
  });

  it('returns arrays as-is', () => {
    const arr = [1, 2, 3];
    expect(resolveValue({}, arr)).toEqual([1, 2, 3]);
  });

  it('returns nested objects without path/random/add as-is', () => {
    const val = { foo: 'bar', nested: { x: 1 } };
    expect(resolveValue({}, val)).toEqual(val);
  });
});
