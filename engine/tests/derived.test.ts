import { describe, it, expect } from 'vitest';
import type { DerivedStateMap, DerivedStateDef, State } from '../src/types.js';
import { evaluateDerived, getModifierValues } from '../src/derived.js';

function makeDefs(overrides?: Partial<DerivedStateDef>): DerivedStateMap {
  const def: DerivedStateDef = {
    base: { path: '$.selectedUnit.BaseLeadership' },
    modifiers: { match: '$.selectedUnit.CurrentLeadership.modifier*' },
    aggregate: 'sum',
    ...overrides,
  };
  return new Map([['CurrentLeadership', def]]);
}

describe('getModifierValues', () => {
  it('finds matching modifier keys', () => {
    const state: State = {
      unit1: {
        CurrentLeadership: {
          modifierDread: 1,
          modifierInspire: -1,
          unrelated: 'ignored',
        },
      },
    };
    const values = getModifierValues(state, '$.unit1.CurrentLeadership.modifier*');
    expect(values).toEqual(expect.arrayContaining([1, -1]));
    expect(values).toHaveLength(2);
  });

  it('returns empty when parent does not exist', () => {
    const state: State = {};
    const values = getModifierValues(state, '$.missing.path.modifier*');
    expect(values).toEqual([]);
  });
});

describe('evaluateDerived', () => {
  it('returns base value when no modifiers exist', () => {
    const state: State = {
      selectedUnit: { BaseLeadership: 7 },
    };
    const result = evaluateDerived('CurrentLeadership', makeDefs(), state);
    expect(result).toBe(7);
  });

  it('sums base + one modifier', () => {
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierDread: 1,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', makeDefs(), state);
    expect(result).toBe(8);
  });

  it('sums base + multiple modifiers', () => {
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierDread: 1,
          modifierInspire: -2,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', makeDefs(), state);
    expect(result).toBe(6);
  });

  it('clamps at max offset from base', () => {
    const defs = makeDefs({
      clamp: { max: { offset: 1 } },
    });
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierBig: 5,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', defs, state);
    expect(result).toBe(8); // base(7) + max offset(1)
  });

  it('clamps at min offset from base', () => {
    const defs = makeDefs({
      clamp: { min: { offset: -1 } },
    });
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierBig: -5,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', defs, state);
    expect(result).toBe(6); // base(7) + min offset(-1)
  });

  it('clamps with both min and max', () => {
    const defs = makeDefs({
      clamp: { min: { offset: -1 }, max: { offset: 1 } },
    });
    // Over max
    const stateOver: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: { modifierBig: 10 },
      },
    };
    expect(evaluateDerived('CurrentLeadership', defs, stateOver)).toBe(8);

    // Under min
    const stateUnder: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: { modifierBig: -10 },
      },
    };
    expect(evaluateDerived('CurrentLeadership', defs, stateUnder)).toBe(6);
  });

  it('does not clamp when no clamp defined', () => {
    const defs = makeDefs(); // no clamp
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierHuge: 100,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', defs, state);
    expect(result).toBe(107);
  });

  it('substitutes unitPath for $.selectedUnit', () => {
    const state: State = {
      players: {
        p1: {
          units: {
            u2: {
              BaseLeadership: 8,
              CurrentLeadership: {
                modifierAura: -1,
              },
            },
          },
        },
      },
    };
    const result = evaluateDerived(
      'CurrentLeadership',
      makeDefs(),
      state,
      '$.players.p1.units.u2',
    );
    expect(result).toBe(7);
  });

  it('returns 0 when base is not a number', () => {
    const state: State = {
      selectedUnit: { BaseLeadership: 'not-a-number' },
    };
    const result = evaluateDerived('CurrentLeadership', makeDefs(), state);
    expect(result).toBe(0);
  });

  it('throws for unknown derived name', () => {
    const state: State = {};
    expect(() => evaluateDerived('NonExistent', makeDefs(), state)).toThrow(
      'Unknown derived state: NonExistent',
    );
  });

  it('uses min aggregate', () => {
    const defs = makeDefs({ aggregate: 'min' });
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierA: 3,
          modifierB: 5,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', defs, state);
    expect(result).toBe(3); // min(7, 3, 5)
  });

  it('uses max aggregate', () => {
    const defs = makeDefs({ aggregate: 'max' });
    const state: State = {
      selectedUnit: {
        BaseLeadership: 7,
        CurrentLeadership: {
          modifierA: 3,
          modifierB: 10,
        },
      },
    };
    const result = evaluateDerived('CurrentLeadership', defs, state);
    expect(result).toBe(10); // max(7, 3, 10)
  });
});
