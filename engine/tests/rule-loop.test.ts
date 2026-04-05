import { describe, it, expect, vi } from 'vitest';
import type {
  State,
  Rule,
  MatchedRule,
  RuleLoopChoice,
  PlayerChoiceFn,
  SequenceMap,
} from '../src/types.js';
import { runRuleLoop, type RuleLoopContext } from '../src/rule-loop.js';
import { SeededRNG } from '../src/rng.js';

function makeCtx(
  state: State,
  rules: Rule[],
  overrides?: Partial<RuleLoopContext>,
): RuleLoopContext {
  // Build ruleIndex from rules
  const ruleIndex = buildRuleIndex(rules);

  return {
    state,
    rules,
    ruleIndex,
    objects: new Map(),
    selectors: new Map(),
    derived: new Map(),
    sequences: new Map(),
    rng: new SeededRNG(42),
    log: [],
    playerChoice: async () => ({ type: 'pass' as const }),
    firedOnRules: new Set(),
    currentEvent: 'testEvent',
    snapshots: [],
    ...overrides,
  };
}

/** Simple ruleIndex builder: index rules by their on/is event references. */
function buildRuleIndex(rules: Rule[]): Map<string, Rule[]> {
  const index = new Map<string, Rule[]>();
  for (const rule of rules) {
    const events = extractFlags(rule.when);
    for (const event of events) {
      if (!index.has(event)) index.set(event, []);
      index.get(event)!.push(rule);
    }
  }
  return index;
}

function extractFlags(condition: Record<string, unknown>): string[] {
  const flags: string[] = [];
  if ('on' in condition) flags.push(condition.on as string);
  if ('is' in condition) flags.push(condition.is as string);
  if ('all' in condition) {
    for (const c of condition.all as Record<string, unknown>[]) {
      flags.push(...extractFlags(c));
    }
  }
  if ('any' in condition) {
    for (const c of condition.any as Record<string, unknown>[]) {
      flags.push(...extractFlags(c));
    }
  }
  if ('not' in condition) {
    flags.push(...extractFlags(condition.not as Record<string, unknown>));
  }
  return flags;
}

describe('rule loop', () => {
  it('returns immediately when no rules match', async () => {
    const state: State = { flags: { testEvent: true } };
    const ctx = makeCtx(state, []);
    const result = await runRuleLoop(ctx);
    expect(result).toEqual(state);
  });

  it('auto-resolves single mandatory rule with no choices', async () => {
    const state: State = { flags: { testEvent: true }, counter: 0 };
    const rule: Rule = {
      id: 'auto-rule',
      when: { on: 'testEvent' },
      effect: [{ set: '$.counter', value: 1 }],
      label: 'Auto rule',
    };
    const ctx = makeCtx(state, [rule]);
    const result = await runRuleLoop(ctx);
    expect(result['counter']).toBe(1);
    // Should have taken a snapshot
    expect(ctx.snapshots).toHaveLength(1);
  });

  it('calls playerChoiceFn when multiple mandatory rules match', async () => {
    const state: State = { flags: { testEvent: true }, a: 0, b: 0 };
    const ruleA: Rule = {
      id: 'rule-a',
      when: { on: 'testEvent' },
      effect: [{ set: '$.a', value: 1 }],
      label: 'Rule A',
    };
    const ruleB: Rule = {
      id: 'rule-b',
      when: { on: 'testEvent' },
      effect: [{ set: '$.b', value: 1 }],
      label: 'Rule B',
    };

    let callCount = 0;
    const choiceFn: PlayerChoiceFn = async (options, canPass) => {
      callCount++;
      expect(canPass).toBe(false);
      expect(options).toHaveLength(2);
      // Pick the first option
      return { type: 'rule', rule: options[0].rule };
    };

    const ctx = makeCtx(state, [ruleA, ruleB], { playerChoice: choiceFn });
    const result = await runRuleLoop(ctx);
    // Both should have fired (on rules fire once each)
    // First call: playerChoice sees both, picks first. Second: auto-resolved (single mandatory)
    expect(result['a']).toBe(1);
    expect(result['b']).toBe(1);
    expect(callCount).toBe(1); // called once for the 2-rule choice; second auto-resolved
  });

  it('allows pass when only optional rules remain', async () => {
    const state: State = {
      flags: { testEvent: true },
      turnPlayer: { cp: 5 },
    };
    const rule: Rule = {
      id: 'optional-rule',
      when: {
        all: [
          { on: 'testEvent' },
          { playerChoice: { player: '$.turnPlayer' } },
        ],
      },
      effect: [{ set: '$.used', value: true }],
      label: 'Optional',
    };

    const choiceFn: PlayerChoiceFn = async (_options, canPass) => {
      expect(canPass).toBe(true);
      return { type: 'pass' };
    };

    const ctx = makeCtx(state, [rule], { playerChoice: choiceFn });
    const result = await runRuleLoop(ctx);
    expect(result['used']).toBeUndefined();
  });

  it('does not allow pass when mandatory rules exist', async () => {
    const state: State = {
      flags: { testEvent: true },
      turnPlayer: { cp: 5 },
      counter: 0,
    };
    // Use 'is' for the mandatory rule so it persists alongside the optional
    const mandatoryRule: Rule = {
      id: 'mandatory',
      when: {
        all: [
          { is: 'testEvent' },
          { not: { pathAtLeast: { path: '$.counter', value: 1 } } },
        ],
      },
      effect: [{ set: '$.counter', value: 1 }],
    };
    const optionalRule: Rule = {
      id: 'optional',
      when: {
        all: [
          { is: 'testEvent' },
          { playerChoice: { player: '$.turnPlayer' } },
          { not: { pathAtLeast: { path: '$.counter', value: 1 } } },
        ],
      },
      effect: [{ set: '$.used', value: true }],
    };

    let sawCanPassFalse = false;
    const choiceFn: PlayerChoiceFn = async (options, canPass) => {
      if (options.some(o => o.mandatory)) {
        expect(canPass).toBe(false);
        sawCanPassFalse = true;
      }
      // Pick mandatory first
      const mandatory = options.find(o => o.mandatory);
      if (mandatory) return { type: 'rule', rule: mandatory.rule };
      return { type: 'pass' };
    };

    const ctx = makeCtx(state, [mandatoryRule, optionalRule], {
      playerChoice: choiceFn,
    });
    await runRuleLoop(ctx);
    expect(sawCanPassFalse).toBe(true);
  });

  it('on rule fires once per event', async () => {
    const state: State = { flags: { testEvent: true }, counter: 0 };
    const rule: Rule = {
      id: 'on-rule',
      when: { on: 'testEvent' },
      effect: [{ set: '$.counter', value: { add: 1 } }],
    };
    const ctx = makeCtx(state, [rule]);
    const result = await runRuleLoop(ctx);
    expect(result['counter']).toBe(1);
  });

  it('is rule fires repeatedly until condition changes', async () => {
    const state: State = { flags: { testEvent: true }, counter: 0 };
    // Rule fires while counter < 3 and testEvent is set
    const rule: Rule = {
      id: 'is-rule',
      when: {
        all: [
          { is: 'testEvent' },
          { not: { pathAtLeast: { path: '$.counter', value: 3 } } },
        ],
      },
      effect: [{ set: '$.counter', value: { add: 1 } }],
    };
    const ctx = makeCtx(state, [rule]);
    const result = await runRuleLoop(ctx);
    expect(result['counter']).toBe(3);
  });

  it('filters out unaffordable optional rules', async () => {
    const state: State = {
      flags: { testEvent: true },
      turnPlayer: { cp: 0 },
    };
    const rule: Rule = {
      id: 'expensive',
      when: {
        all: [
          { on: 'testEvent' },
          { playerChoice: { player: '$.turnPlayer' } },
        ],
      },
      costs: { cp: 2 },
      effect: [{ set: '$.used', value: true }],
    };

    const choiceFn = vi.fn();
    const ctx = makeCtx(state, [rule], { playerChoice: choiceFn });
    const result = await runRuleLoop(ctx);
    // Player choice should never be called — rule was filtered out
    expect(choiceFn).not.toHaveBeenCalled();
    expect(result['used']).toBeUndefined();
  });

  it('deducts costs when rule is selected', async () => {
    const state: State = {
      flags: { testEvent: true },
      turnPlayer: { cp: 3 },
    };
    const rule: Rule = {
      id: 'costly',
      when: {
        all: [
          { on: 'testEvent' },
          { playerChoice: { player: '$.turnPlayer' } },
        ],
      },
      costs: { cp: 2 },
      effect: [{ set: '$.used', value: true }],
      label: 'Costly rule',
    };

    const choiceFn: PlayerChoiceFn = async (options) => {
      return { type: 'rule', rule: options[0].rule };
    };

    const ctx = makeCtx(state, [rule], { playerChoice: choiceFn });
    const result = await runRuleLoop(ctx);
    const tp = result['turnPlayer'] as Record<string, unknown>;
    expect(tp['cp']).toBe(1);
    expect(result['used']).toBe(true);
  });

  it('edit state modifies state and re-evaluates', async () => {
    const state: State = { flags: { testEvent: true }, counter: 0 };
    // Two rules: one always matches (is-based), another needs counter >= 5
    const alwaysRule: Rule = {
      id: 'always',
      when: {
        all: [
          { is: 'testEvent' },
          { playerChoice: { player: '$.turnPlayer' } },
        ],
      },
      effect: [{ set: '$.alwaysFired', value: true }],
    };
    const conditionalRule: Rule = {
      id: 'conditional',
      when: {
        all: [
          { on: 'testEvent' },
          { pathAtLeast: { path: '$.counter', value: 5 } },
        ],
      },
      effect: [{ set: '$.fired', value: true }],
    };

    let editDone = false;
    const choiceFn: PlayerChoiceFn = async (options, canPass) => {
      if (!editDone) {
        editDone = true;
        // Edit state to set counter to 5 instead of picking a rule
        return { type: 'editState', editPath: '$.counter', editValue: 5 };
      }
      // After edit, conditional rule now matches as mandatory — pick it if present
      const mandatory = options.find(o => o.mandatory);
      if (mandatory) return { type: 'rule', rule: mandatory.rule };
      return { type: 'pass' };
    };

    const ctx = makeCtx(state, [alwaysRule, conditionalRule], {
      playerChoice: choiceFn,
      turnPlayer: '$.turnPlayer',
    } as Partial<RuleLoopContext> as any);
    const result = await runRuleLoop(ctx);
    expect(result['counter']).toBe(5);
    expect(result['fired']).toBe(true);
  });

  it('takes snapshot before each rule fires', async () => {
    const state: State = { flags: { testEvent: true }, counter: 0 };
    const ruleA: Rule = {
      id: 'rule-a',
      when: { on: 'testEvent' },
      effect: [{ set: '$.counter', value: 1 }],
    };
    const ctx = makeCtx(state, [ruleA]);
    await runRuleLoop(ctx);
    expect(ctx.snapshots).toHaveLength(1);
    // Snapshot state should be the state before the rule fired
    expect(ctx.snapshots[0].state['counter']).toBe(0);
  });

  it('processes sub-sequence events in order', async () => {
    const sequences: SequenceMap = new Map([
      ['subSeq', ['subEventA', 'subEventB']],
      ['subEventA', ['event']],
      ['subEventB', ['event']],
    ]);

    const state: State = { flags: { testEvent: true }, order: '' };
    // Main rule enters sub-sequence
    const mainRule: Rule = {
      id: 'enter-sub',
      when: { on: 'testEvent' },
      effect: [
        { set: '$.order', value: 'main' },
        { sequence: 'subSeq' },
      ],
    };
    // Sub-event rules
    const subRuleA: Rule = {
      id: 'sub-a',
      when: { on: 'subEventA' },
      effect: [{ set: '$.subA', value: true }],
    };
    const subRuleB: Rule = {
      id: 'sub-b',
      when: { on: 'subEventB' },
      effect: [{ set: '$.subB', value: true }],
    };

    const allRules = [mainRule, subRuleA, subRuleB];
    const ctx = makeCtx(state, allRules, { sequences });
    const result = await runRuleLoop(ctx);
    expect(result['order']).toBe('main');
    expect(result['subA']).toBe(true);
    expect(result['subB']).toBe(true);
  });
});
