import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  classifyKey,
  parseRulesFile,
  parseArmyFile,
  extractEventRefs,
  indexRules,
  loadPack,
} from '../src/loader.js';

const fixtures = resolve(import.meta.dirname, 'fixtures');
const fix = (name: string) => resolve(fixtures, name);

// ---------------------------------------------------------------------------
// classifyKey
// ---------------------------------------------------------------------------

describe('classifyKey', () => {
  it('classifies reserved keys', () => {
    expect(classifyKey('include', ['a.rules'])).toBe('include');
    expect(classifyKey('objects', { unit: '$.x' })).toBe('objects');
    expect(classifyKey('macros', {})).toBe('macros');
    expect(classifyKey('derived', {})).toBe('derived');
    expect(classifyKey('selectors', {})).toBe('selectors');
    expect(classifyKey('keywords', [])).toBe('keywords');
  });

  it('classifies arrays as sequences', () => {
    expect(classifyKey('game', ['startOfGame'])).toBe('sequence');
  });

  it('classifies objects with "when" as rules', () => {
    expect(classifyKey('CORE.Rule', { when: { on: 'x' }, effect: [] })).toBe('rule');
  });

  it('classifies objects with "template" as templates', () => {
    expect(classifyKey('boyz', { template: 'unit', params: [] })).toBe('template');
  });

  it('throws for unclassifiable keys', () => {
    expect(() => classifyKey('mystery', 42)).toThrow('Cannot classify');
  });
});

// ---------------------------------------------------------------------------
// parseRulesFile
// ---------------------------------------------------------------------------

describe('parseRulesFile', () => {
  it('extracts sequences, rules from simple.rules', async () => {
    const parsed = await parseRulesFile(fix('simple.rules'));

    // 2 sequences: startOfGame, game
    expect(parsed.sequences.size).toBe(2);
    expect(parsed.sequences.has('startOfGame')).toBe(true);
    expect(parsed.sequences.has('game')).toBe(true);

    // startOfGame is a leaf: contains "event"
    expect(parsed.sequences.get('startOfGame')).toEqual(['event']);

    // game references startOfGame
    expect(parsed.sequences.get('game')).toEqual(['startOfGame']);

    // 1 rule
    expect(parsed.rules.length).toBe(1);
    expect(parsed.rules[0].id).toBe('CORE.TestRule');
    expect(parsed.rules[0].label).toBe('Test rule');
  });

  it('parses repeat steps from with-repeat.rules', async () => {
    const parsed = await parseRulesFile(fix('with-repeat.rules'));

    const game = parsed.sequences.get('game')!;
    expect(game.length).toBe(3);
    expect(game[0]).toBe('startOfGame');
    // repeat step: { round: { repeat: 3 } }
    const repeatStep = game[1] as Record<string, { repeat: number }>;
    expect(repeatStep['round']).toEqual({ repeat: 3 });
    expect(game[2]).toBe('endOfGame');
  });

  it('parses objects from with-objects.rules', async () => {
    const parsed = await parseRulesFile(fix('with-objects.rules'));
    expect(parsed.objects.get('player')).toBe('$.players');
    expect(parsed.objects.get('unit')).toBe('$.players.*.units');
  });

  it('parses templates from template.rules', async () => {
    const parsed = await parseRulesFile(fix('template.rules'));
    const tmpl = parsed.templates.get('testUnit')!;
    expect(tmpl.template).toBe('unit');
    expect(tmpl.params).toEqual(['owner', 'id']);
    expect(tmpl.state.path).toBe('$.players.{owner}.units.{id}');
  });

  it('stores named selectors from with-selectors.rules', async () => {
    const parsed = await parseRulesFile(fix('with-selectors.rules'));
    expect(parsed.selectors.has('turnPlayer_units')).toBe(true);
    const sel = parsed.selectors.get('turnPlayer_units')!;
    expect(sel.object).toBe('unit');
    expect(sel.where).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Include resolution
// ---------------------------------------------------------------------------

describe('include resolution', () => {
  it('merges included files via loadPack', async () => {
    const pack = await loadPack(fix('with-include.rules'), []);

    // Should have sequences from both files
    expect(pack.sequences.has('startOfGame')).toBe(true);
    expect(pack.sequences.has('game')).toBe(true);
    expect(pack.sequences.has('endOfGame')).toBe(true);

    // Should have the rule from included.rules
    expect(pack.rules.some(r => r.id === 'INCLUDED.Rule')).toBe(true);
  });

  it('throws on circular includes', async () => {
    await expect(loadPack(fix('circular-a.rules'), [])).rejects.toThrow('Circular include');
  });
});

// ---------------------------------------------------------------------------
// Army file parsing
// ---------------------------------------------------------------------------

describe('parseArmyFile', () => {
  it('extracts includes and units from simple.army', async () => {
    const army = await parseArmyFile(fix('simple.army'));
    expect(army.includes).toEqual(['template.rules']);
    expect(army.units.length).toBe(2);
    expect(army.units[0].template).toBe('testUnit');
    expect(army.units[0].bind).toEqual({ owner: 'player1', id: 'unit_1' });
    expect(army.units[1].bind).toEqual({ owner: 'player1', id: 'unit_2' });
  });
});

// ---------------------------------------------------------------------------
// Template expansion
// ---------------------------------------------------------------------------

describe('template expansion', () => {
  it('stamps units into initial state with substituted values', async () => {
    const pack = await loadPack(fix('with-objects.rules'), [fix('simple.army')]);

    // Player containers should exist
    const players = pack.initialState['players'] as Record<string, unknown>;
    expect(players).toBeDefined();

    const p1 = players['player1'] as Record<string, unknown>;
    expect(p1['cp']).toBe(0);

    const units = p1['units'] as Record<string, unknown>;
    expect(units).toBeDefined();

    const u1 = units['unit_1'] as Record<string, unknown>;
    expect(u1['name']).toBe('Test Unit');
    expect(u1['owner']).toBe('player1');
    expect((u1['stats'] as Record<string, number>)['M']).toBe(6);
    expect(u1['keywords']).toEqual(['INFANTRY']);

    const u2 = units['unit_2'] as Record<string, unknown>;
    expect(u2['name']).toBe('Test Unit');
    expect(u2['owner']).toBe('player1');
  });
});

// ---------------------------------------------------------------------------
// Rule indexing
// ---------------------------------------------------------------------------

describe('rule indexing', () => {
  it('indexes rules by on/is event references', () => {
    const rules = [
      {
        id: 'R1',
        when: { on: 'startOfGame' } as any,
        effect: [],
      },
      {
        id: 'R2',
        when: { all: [{ is: 'commandPhase' }, { on: 'startOfGame' }] } as any,
        effect: [],
      },
    ];
    const index = indexRules(rules);

    expect(index.get('startOfGame')?.length).toBe(2);
    expect(index.get('commandPhase')?.length).toBe(1);
    expect(index.get('commandPhase')?.[0].id).toBe('R2');
  });
});

describe('extractEventRefs', () => {
  it('extracts on and is from nested conditions', () => {
    const cond = {
      all: [
        { on: 'alpha' },
        { any: [{ is: 'beta' }, { on: 'gamma' }] },
        { not: { is: 'delta' } },
      ],
    } as any;
    const refs = extractEventRefs(cond);
    expect(refs.on.sort()).toEqual(['alpha', 'gamma']);
    expect(refs.is.sort()).toEqual(['beta', 'delta']);
  });
});

// ---------------------------------------------------------------------------
// Duplicate rule detection
// ---------------------------------------------------------------------------

describe('duplicate rule detection', () => {
  it('throws on duplicate rule IDs across included files', async () => {
    await expect(loadPack(fix('dup-a.rules'), [])).rejects.toThrow('Duplicate rule ID: "SHARED.Rule"');
  });
});

// ---------------------------------------------------------------------------
// Full loadPack
// ---------------------------------------------------------------------------

describe('loadPack', () => {
  it('produces a valid LoadedPack from core + army', async () => {
    const pack = await loadPack(fix('with-objects.rules'), [fix('simple.army')]);

    // Has sequences from core
    expect(pack.sequences.has('game')).toBe(true);

    // Has objects
    expect(pack.objects.get('unit')).toBe('$.players.*.units');

    // Has templates from army include
    expect(pack.templates.has('testUnit')).toBe(true);

    // With only 1 army, attacker/defender are not set
    const players = pack.initialState['players'] as Record<string, unknown>;
    expect(players['player1']).toBeDefined();

    // ruleIndex is a Map
    expect(pack.ruleIndex).toBeInstanceOf(Map);
  });

  it('sets up two players when two army files given', async () => {
    const pack = await loadPack(fix('with-objects.rules'), [fix('simple.army'), fix('simple.army')]);

    expect(pack.initialState['attacker']).toBe('player1');
    expect(pack.initialState['defender']).toBe('player2');

    const players = pack.initialState['players'] as Record<string, Record<string, unknown>>;
    expect(players['player1']['cp']).toBe(0);
    expect(players['player2']['cp']).toBe(0);
  });

  it('loads selectors into the pack', async () => {
    const pack = await loadPack(fix('with-selectors.rules'), []);
    expect(pack.selectors.has('turnPlayer_units')).toBe(true);
  });
});
