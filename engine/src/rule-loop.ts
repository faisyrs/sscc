import type {
  State,
  Rule,
  MatchedRule,
  LogEntry,
  ObjectMap,
  SelectorMap,
  DerivedStateMap,
  Snapshot,
  PlayerChoiceFn,
  SequenceMap,
  SequenceStep,
} from './types.js';
import { evaluateCondition, isOptionalRule, usesOnCondition, type EvalContext } from './conditions.js';
import { executeEffects, type EffectContext } from './effects.js';
import { getPath, setPath, setFlag, unsetFlag, expireFlags, deepClone } from './state.js';
import { SeededRNG } from './rng.js';
import { evaluateDerived } from './derived.js';

export interface RuleLoopContext {
  state: State;
  rules: Rule[];
  ruleIndex: Map<string, Rule[]>;
  objects: ObjectMap;
  selectors: SelectorMap;
  derived: DerivedStateMap;
  sequences: SequenceMap;
  rng: SeededRNG;
  log: LogEntry[];
  playerChoice: PlayerChoiceFn;
  firedOnRules: Set<string>;
  currentEvent: string;
  snapshots: Snapshot[];
}

/**
 * Find all rules that match the current state.
 * Returns mandatory and optional lists, with filtering applied.
 */
function findMatchingRules(
  state: State,
  ctx: RuleLoopContext,
): { mandatory: Rule[]; optional: Rule[] } {
  const mandatory: Rule[] = [];
  const optional: Rule[] = [];

  // Collect candidate rules from ruleIndex based on current flags
  const candidateSet = new Set<string>();
  const candidates: Rule[] = [];

  const flags = state['flags'] as Record<string, unknown> | undefined;
  if (flags) {
    for (const flagName of Object.keys(flags)) {
      const rules = ctx.ruleIndex.get(flagName);
      if (rules) {
        for (const rule of rules) {
          if (!candidateSet.has(rule.id)) {
            candidateSet.add(rule.id);
            candidates.push(rule);
          }
        }
      }
    }
  }

  const evalCtx: EvalContext = {
    state,
    objects: ctx.objects,
    selectors: ctx.selectors,
    firedOnRules: ctx.firedOnRules,
    currentEvent: ctx.currentEvent,
  };

  for (const rule of candidates) {
    // Skip 'on' rules that have already fired this event
    if (usesOnCondition(rule) && ctx.firedOnRules.has(rule.id)) {
      continue;
    }

    // Evaluate condition tree
    if (!evaluateCondition(rule.when, evalCtx)) {
      continue;
    }

    if (isOptionalRule(rule)) {
      // Check affordability for optional rules with costs
      if (rule.costs && !canAfford(state, rule.costs)) {
        continue;
      }
      optional.push(rule);
    } else {
      mandatory.push(rule);
    }
  }

  return { mandatory, optional };
}

/**
 * Check if the current turn player can afford the given costs.
 * Costs are { "cp": N } and we check $.turnPlayer.cp >= N.
 */
function canAfford(state: State, costs: Record<string, number>): boolean {
  for (const [key, amount] of Object.entries(costs)) {
    const current = getPath(state, `$.turnPlayer.${key}`);
    if (typeof current !== 'number' || current < amount) {
      return false;
    }
  }
  return true;
}

/**
 * Deduct costs from the turn player's resources.
 */
function deductCosts(state: State, costs: Record<string, number>): State {
  let s = state;
  for (const [key, amount] of Object.entries(costs)) {
    const current = getPath(s, `$.turnPlayer.${key}`);
    const currentNum = typeof current === 'number' ? current : 0;
    s = setPath(s, `$.turnPlayer.${key}`, currentNum - amount);
  }
  return s;
}

/**
 * Process a sub-sequence inline without touching the main sequencer.
 * Walks the named sequence's steps and for each event, runs the
 * event processing cycle (expire, set flag, rule loop, unset flag).
 */
async function processSubSequence(
  seqName: string,
  state: State,
  ctx: RuleLoopContext,
): Promise<State> {
  const steps = ctx.sequences.get(seqName);
  if (!steps) throw new Error(`Unknown sequence: "${seqName}"`);

  return walkSequenceSteps(steps, seqName, state, ctx);
}

async function walkSequenceSteps(
  steps: SequenceStep[],
  parentName: string,
  state: State,
  ctx: RuleLoopContext,
): Promise<State> {
  for (const step of steps) {
    // "event" leaf — fire parentName as the event
    if (step === 'event') {
      state = expireFlags(state, parentName);
      state = setFlag(state, parentName);

      // Start with parent's firedOnRules so parent 'on' rules don't re-fire
      const subFired = new Set<string>(ctx.firedOnRules);
      const subCtx: RuleLoopContext = {
        ...ctx,
        state,
        currentEvent: parentName,
        firedOnRules: subFired,
      };
      state = await runRuleLoop(subCtx);

      state = unsetFlag(state, parentName);
      continue;
    }

    // String reference to another sequence
    if (typeof step === 'string') {
      state = await processSubSequence(step, state, ctx);
      continue;
    }

    // Object step
    if (typeof step === 'object' && step !== null) {
      // Explicit reference: { sequence: "name" }
      if ('sequence' in step) {
        const name = (step as { sequence: string }).sequence;
        state = await processSubSequence(name, state, ctx);
        continue;
      }

      // Repeat: { someName: { repeat: N } }
      const keys = Object.keys(step);
      if (keys.length === 1) {
        const seqName = keys[0];
        const val = (step as Record<string, { repeat: number }>)[seqName];
        if (val && typeof val === 'object' && 'repeat' in val) {
          for (let i = 0; i < val.repeat; i++) {
            state = await processSubSequence(seqName, state, ctx);
          }
          continue;
        }
      }
    }

    throw new Error(`Unknown sequence step: ${JSON.stringify(step)}`);
  }

  return state;
}

export async function runRuleLoop(ctx: RuleLoopContext): Promise<State> {
  let state = ctx.state;

  while (true) {
    // 1. Find matching rules
    const { mandatory, optional } = findMatchingRules(state, ctx);

    // 2. Nothing matches -> done
    if (mandatory.length === 0 && optional.length === 0) {
      return state;
    }

    // 3. Auto-resolve single mandatory with no choices
    let selectedRule: Rule;
    if (mandatory.length === 1 && optional.length === 0) {
      selectedRule = mandatory[0];
    } else {
      // 4. Present to player
      const allOptions: MatchedRule[] = [
        ...mandatory.map(r => ({ rule: r, mandatory: true })),
        ...optional.map(r => ({ rule: r, mandatory: false })),
      ];
      const canPass = mandatory.length === 0;

      const choice = await ctx.playerChoice(allOptions, canPass, state);

      if (choice.type === 'pass') {
        return state;
      }

      if (choice.type === 'editState') {
        // Apply edit and re-evaluate
        if (choice.editPath && choice.editValue !== undefined) {
          state = setPath(state, choice.editPath, choice.editValue);
        }
        continue;
      }

      selectedRule = choice.rule!;
    }

    // 8. Snapshot for undo
    ctx.snapshots.push({
      state: deepClone(state),
      rngState: ctx.rng.getState(),
      firedOnRules: new Set(ctx.firedOnRules),
    });

    // 9. Deduct costs
    if (selectedRule.costs) {
      state = deductCosts(state, selectedRule.costs);
    }

    // 10. Execute effects
    const effectCtx: EffectContext = {
      state,
      rng: ctx.rng,
      objects: ctx.objects,
      selectors: ctx.selectors,
      derived: ctx.derived,
      log: ctx.log,
      currentEvent: ctx.currentEvent,
      derivedEvaluator: (name, unitPath, s) => evaluateDerived(name, ctx.derived, s, unitPath),
    };

    const result = executeEffects(selectedRule.effect, effectCtx);
    state = result.state;
    ctx.log.push(...result.logEntries);

    // Log the rule firing
    ctx.log.push({
      type: 'rule_fired',
      event: ctx.currentEvent,
      ruleId: selectedRule.id,
      message: selectedRule.label || selectedRule.id,
      timestamp: Date.now(),
    });

    // 11. Track 'on' rules
    if (usesOnCondition(selectedRule)) {
      ctx.firedOnRules.add(selectedRule.id);
    }

    // 12. Handle sub-sequence entry
    if (result.enterSequence) {
      const seqNames = Array.isArray(result.enterSequence)
        ? result.enterSequence
        : [result.enterSequence];

      for (const seqName of seqNames) {
        state = await processSubSequence(seqName, state, ctx);
      }
    }

    // Loop back to step 1
  }
}
