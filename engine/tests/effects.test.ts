import { describe, it, expect } from 'vitest';
import type { Effect, State } from '../src/types.js';
import { executeEffect, executeEffects, EffectContext } from '../src/effects.js';
import { SeededRNG } from '../src/rng.js';

function makeCtx(state: State, overrides?: Partial<EffectContext>): EffectContext {
  return {
    state,
    rng: new SeededRNG(42),
    objects: new Map(),
    selectors: new Map(),
    derived: new Map(),
    log: [],
    currentEvent: 'test-event',
    ...overrides,
  };
}

// --- set ---
describe('set effect', () => {
  it('sets a literal value at a path', () => {
    const state: State = {};
    const effect: Effect = { set: '$.round', value: 1 };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.state['round']).toBe(1);
  });

  it('increments with { add: N }', () => {
    const state: State = { cp: 5 };
    const effect: Effect = { set: '$.cp', value: { add: 2 } };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.state['cp']).toBe(7);
  });

  it('increments from 0 when path missing', () => {
    const state: State = {};
    const effect: Effect = { set: '$.cp', value: { add: 3 } };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.state['cp']).toBe(3);
  });

  it('copies value from another path via { path }', () => {
    const state: State = { source: 42 };
    const effect: Effect = { set: '$.target', value: { path: '$.source' } };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.state['target']).toBe(42);
  });

  it('sets a bare flag (no $. prefix, no value)', () => {
    const state: State = {};
    const effect: Effect = { set: 'battleshock' };
    const result = executeEffect(effect, makeCtx(state));
    const flags = result.state['flags'] as Record<string, unknown>;
    expect(flags['battleshock']).toBe(true);
  });

  it('sets a flag with expiresOn', () => {
    const state: State = {};
    const effect: Effect = { set: 'temp-buff', expiresOn: 'end-of-turn' };
    const result = executeEffect(effect, makeCtx(state));
    const flags = result.state['flags'] as Record<string, unknown>;
    expect(flags['temp-buff']).toEqual({ value: true, expiresOn: 'end-of-turn' });
  });

  it('skips valueFromChoice effects', () => {
    const state: State = { x: 1 };
    const effect: Effect = { set: '$.x', valueFromChoice: 'player-pick' };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.state['x']).toBe(1); // unchanged
  });
});

// --- unset ---
describe('unset effect', () => {
  it('unsets a simple $. path', () => {
    const state: State = { round: 3, phase: 'command' };
    const effect: Effect = { unset: '$.round' };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.state['round']).toBeUndefined();
    expect(result.state['phase']).toBe('command');
  });

  it('unsets a flag', () => {
    const state: State = { flags: { active: true, other: true } };
    const effect: Effect = { unset: 'active' };
    const result = executeEffect(effect, makeCtx(state));
    const flags = result.state['flags'] as Record<string, unknown>;
    expect(flags['active']).toBeUndefined();
    expect(flags['other']).toBe(true);
  });

  it('bulk unsets with selector', () => {
    const state: State = {
      players: {
        p1: { units: { u1: { hp: 10, moved: true }, u2: { hp: 5, moved: true } } },
      },
    };
    const objects = new Map([['unit', '$.players.*.units.*']]);
    const effect: Effect = {
      unset: { key: 'moved', target: { object: 'unit' } },
    };
    const result = executeEffect(effect, makeCtx(state, { objects }));
    const u1 = (((result.state['players'] as Record<string, unknown>)['p1'] as Record<string, unknown>)['units'] as Record<string, unknown>)['u1'] as Record<string, unknown>;
    const u2 = (((result.state['players'] as Record<string, unknown>)['p1'] as Record<string, unknown>)['units'] as Record<string, unknown>)['u2'] as Record<string, unknown>;
    expect(u1['moved']).toBeUndefined();
    expect(u2['moved']).toBeUndefined();
    expect(u1['hp']).toBe(10);
  });
});

// --- sequence ---
describe('sequence effect', () => {
  it('returns enterSequence for a named sequence', () => {
    const state: State = {};
    const effect: Effect = { sequence: 'movement-phase' };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.enterSequence).toBe('movement-phase');
    expect(result.state).toEqual(state);
  });

  it('returns enterSequence for inline event list', () => {
    const state: State = {};
    const effect: Effect = { sequence: ['step-a', 'step-b'] };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.enterSequence).toEqual(['step-a', 'step-b']);
  });
});

// --- test ---
describe('test effect', () => {
  it('rolls dice and executes pass branch when passing', () => {
    // Use a fixed seed and known roll behavior
    const rng = new SeededRNG(42);
    // Pre-roll to know the value: roll 1d6
    const preRng = new SeededRNG(42);
    const roll = preRng.rollDie(6);

    const state: State = {};
    const effect: Effect = {
      test: {
        roll: { count: 1, sides: 6 },
        compare: 'gte',
        target: { value: 1 }, // always passes with d6 >= 1
        pass: [{ set: '$.passed', value: true }],
        fail: [{ set: '$.passed', value: false }],
      },
    };
    const result = executeEffect(effect, makeCtx(state, { rng }));
    expect(result.state['passed']).toBe(true);
  });

  it('executes fail branch when failing', () => {
    const rng = new SeededRNG(42);
    const state: State = {};
    const effect: Effect = {
      test: {
        roll: { count: 1, sides: 6 },
        compare: 'gte',
        target: { value: 100 }, // always fails
        pass: [{ set: '$.passed', value: true }],
        fail: [{ set: '$.passed', value: false }],
      },
    };
    const result = executeEffect(effect, makeCtx(state, { rng }));
    expect(result.state['passed']).toBe(false);
  });

  it('reads roll count from path', () => {
    const rng = new SeededRNG(42);
    const state: State = { diceCount: 2 };
    const effect: Effect = {
      test: {
        roll: { count: { path: '$.diceCount' }, sides: 6 },
        compare: 'gte',
        target: { value: 1 },
        pass: [{ set: '$.passed', value: true }],
        fail: [{ set: '$.passed', value: false }],
      },
    };
    const result = executeEffect(effect, makeCtx(state, { rng }));
    // With 2d6 >= 1, always passes
    expect(result.state['passed']).toBe(true);
  });

  it('uses lte comparison', () => {
    const rng = new SeededRNG(42);
    const state: State = {};
    const effect: Effect = {
      test: {
        roll: { count: 1, sides: 6 },
        compare: 'lte',
        target: { value: 100 }, // roll <= 100 always passes
        pass: [{ set: '$.ok', value: true }],
        fail: [{ set: '$.ok', value: false }],
      },
    };
    const result = executeEffect(effect, makeCtx(state, { rng }));
    expect(result.state['ok']).toBe(true);
  });

  it('reads target from state path', () => {
    const rng = new SeededRNG(42);
    const state: State = { threshold: 1 };
    const effect: Effect = {
      test: {
        roll: { count: 1, sides: 6 },
        compare: 'gte',
        target: { path: '$.threshold' },
        pass: [{ set: '$.passed', value: true }],
        fail: [{ set: '$.passed', value: false }],
      },
    };
    const result = executeEffect(effect, makeCtx(state, { rng }));
    expect(result.state['passed']).toBe(true);
  });

  it('uses derivedEvaluator callback for derived target', () => {
    const rng = new SeededRNG(42);
    const state: State = {};
    const effect: Effect = {
      test: {
        roll: { count: 1, sides: 6 },
        compare: 'gte',
        target: { derived: 'toughness', unit: { path: '$.units.u1' } },
        pass: [{ set: '$.passed', value: true }],
        fail: [{ set: '$.passed', value: false }],
      },
    };
    // derivedEvaluator returns 1, so d6 >= 1 always passes
    const result = executeEffect(effect, makeCtx(state, {
      rng,
      derivedEvaluator: () => 1,
    }));
    expect(result.state['passed']).toBe(true);
  });
});

// --- setSeed ---
describe('setSeed effect', () => {
  it('updates RNG state', () => {
    const rng = new SeededRNG(42);
    const state: State = {};
    const effect: Effect = { setSeed: 999 };
    executeEffect(effect, makeCtx(state, { rng }));
    expect(rng.getState()).toBe(999);
  });
});

// --- appendLogNote ---
describe('appendLogNote effect', () => {
  it('adds a log entry', () => {
    const state: State = {};
    const effect: Effect = { appendLogNote: 'Turn started' };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].type).toBe('note');
    expect(result.logEntries[0].message).toBe('Turn started');
    expect(result.logEntries[0].event).toBe('test-event');
  });
});

// --- manual ---
describe('manual effect', () => {
  it('adds a manual log entry', () => {
    const state: State = {};
    const effect: Effect = { manual: 'Resolve line of sight' };
    const result = executeEffect(effect, makeCtx(state));
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].type).toBe('manual');
    expect(result.logEntries[0].message).toBe('Resolve line of sight');
  });
});

// --- executeEffects ---
describe('executeEffects', () => {
  it('chains multiple effects and threads state', () => {
    const state: State = {};
    const effects: Effect[] = [
      { set: '$.round', value: 1 },
      { set: '$.round', value: { add: 1 } },
      { appendLogNote: 'Round incremented' },
    ];
    const result = executeEffects(effects, makeCtx(state));
    expect(result.state['round']).toBe(2);
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].message).toBe('Round incremented');
  });

  it('preserves last enterSequence', () => {
    const state: State = {};
    const effects: Effect[] = [
      { sequence: 'first' },
      { sequence: 'second' },
    ];
    const result = executeEffects(effects, makeCtx(state));
    expect(result.enterSequence).toBe('second');
  });

  it('handles empty effect list', () => {
    const state: State = { x: 1 };
    const result = executeEffects([], makeCtx(state));
    expect(result.state).toEqual({ x: 1 });
    expect(result.logEntries).toHaveLength(0);
  });
});
