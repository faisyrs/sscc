import { describe, it, expect } from 'vitest';
import type {
  LoadedPack,
  Rule,
  MatchedRule,
  RuleLoopChoice,
  PlayerChoiceFn,
  Condition,
} from '../src/types.js';
import { SSCCEngine } from '../src/engine.js';
import { extractEventRefs } from '../src/conditions.js';

/**
 * Build a ruleIndex: map from event flag names to rules that reference them.
 */
function buildRuleIndex(rules: Rule[]): Map<string, Rule[]> {
  const index = new Map<string, Rule[]>();
  for (const rule of rules) {
    const refs = extractEventRefs(rule.when);
    const allEvents = [...refs.on, ...refs.is];
    for (const event of allEvents) {
      if (!index.has(event)) index.set(event, []);
      index.get(event)!.push(rule);
    }
  }
  return index;
}

describe('SSCCEngine', () => {
  // Pack: game -> [startOfGame, mainPhase, endOfGame] (each is an event leaf)
  // Rules:
  //   - "on: startOfGame" sets $.started = true (fires once)
  //   - "is: mainPhase" increments $.counter until it reaches 3
  //   - "on: endOfGame" sets $.ended = true
  function makePack(): LoadedPack {
    const rules: Rule[] = [
      {
        id: 'start-rule',
        when: { on: 'startOfGame' },
        effect: [{ set: '$.started', value: true }],
        label: 'Start of game',
      },
      {
        id: 'main-rule',
        when: {
          all: [
            { is: 'mainPhase' },
            { not: { pathAtLeast: { path: '$.counter', value: 3 } } },
          ],
        },
        effect: [{ set: '$.counter', value: { add: 1 } }],
        label: 'Increment counter',
      },
      {
        id: 'end-rule',
        when: { on: 'endOfGame' },
        effect: [{ set: '$.ended', value: true }],
        label: 'End of game',
      },
    ];

    const ruleIndex = buildRuleIndex(rules);

    return {
      sequences: new Map([
        ['game', ['startOfGame', 'mainPhase', 'endOfGame']],
        ['startOfGame', ['event']],
        ['mainPhase', ['event']],
        ['endOfGame', ['event']],
      ]),
      rules,
      objects: new Map(),
      macros: new Map(),
      derived: new Map(),
      templates: new Map(),
      selectors: new Map(),
      initialState: { flags: {}, counter: 0 },
      ruleIndex,
    };
  }

  it('processes events in sequence order', async () => {
    const pack = makePack();
    const autoChoiceFn: PlayerChoiceFn = async (options) => {
      return { type: 'rule', rule: options[0].rule };
    };
    const engine = new SSCCEngine(pack, autoChoiceFn, 42);

    // Event 1: startOfGame
    const ev1 = await engine.advanceToNextEvent();
    expect(ev1).not.toBeNull();
    expect(ev1!.event).toBe('startOfGame');
    expect(ev1!.state['started']).toBe(true);

    // Event 2: mainPhase
    const ev2 = await engine.advanceToNextEvent();
    expect(ev2).not.toBeNull();
    expect(ev2!.event).toBe('mainPhase');
    expect(ev2!.state['counter']).toBe(3); // 'is' rule fires 3 times

    // Event 3: endOfGame
    const ev3 = await engine.advanceToNextEvent();
    expect(ev3).not.toBeNull();
    expect(ev3!.event).toBe('endOfGame');
    expect(ev3!.state['ended']).toBe(true);

    // No more events
    const ev4 = await engine.advanceToNextEvent();
    expect(ev4).toBeNull();
  });

  it('on rule fires once, is rule fires multiple times', async () => {
    const pack = makePack();
    const autoChoiceFn: PlayerChoiceFn = async (options) => {
      return { type: 'rule', rule: options[0].rule };
    };
    const engine = new SSCCEngine(pack, autoChoiceFn, 42);

    // Process all events
    await engine.advanceToNextEvent(); // startOfGame
    await engine.advanceToNextEvent(); // mainPhase
    await engine.advanceToNextEvent(); // endOfGame

    const log = engine.getLog();
    const startFirings = log.filter(e => e.ruleId === 'start-rule');
    const mainFirings = log.filter(e => e.ruleId === 'main-rule');
    const endFirings = log.filter(e => e.ruleId === 'end-rule');

    expect(startFirings).toHaveLength(1); // on: fires once
    expect(mainFirings).toHaveLength(3); // is: fires until counter=3
    expect(endFirings).toHaveLength(1); // on: fires once
  });

  it('undo restores previous state', async () => {
    const pack = makePack();
    const autoChoiceFn: PlayerChoiceFn = async (options) => {
      return { type: 'rule', rule: options[0].rule };
    };
    const engine = new SSCCEngine(pack, autoChoiceFn, 42);

    // Process startOfGame
    await engine.advanceToNextEvent();
    expect(engine.getState()['started']).toBe(true);

    // Undo should restore state from before the start rule fired
    const undoneState = engine.undo();
    expect(undoneState).not.toBeNull();
    expect(undoneState!['started']).toBeUndefined();
    expect(undoneState!['counter']).toBe(0);
  });

  it('returns null from undo when no snapshots', () => {
    const pack = makePack();
    const autoChoiceFn: PlayerChoiceFn = async () => ({ type: 'pass' });
    const engine = new SSCCEngine(pack, autoChoiceFn, 42);

    expect(engine.undo()).toBeNull();
  });

  it('getLog returns all log entries', async () => {
    const pack = makePack();
    const autoChoiceFn: PlayerChoiceFn = async (options) => {
      return { type: 'rule', rule: options[0].rule };
    };
    const engine = new SSCCEngine(pack, autoChoiceFn, 42);

    await engine.advanceToNextEvent(); // startOfGame

    const log = engine.getLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log.some(e => e.type === 'rule_fired')).toBe(true);
  });
});
