import type {
  Rule,
  Effect,
  State,
  GameEvent,
  Glossary,
  PredicateNode,
} from "../types/index.js";
import { evaluatePredicate } from "./predicates.js";
import { resolveConflicts, type ResolvedEffect } from "./conflicts.js";

export interface EvaluationResult {
  matchedRules: Rule[];
  resolvedEffects: ResolvedEffect[];
  predicateResults: Map<string, boolean>;
}

/**
 * Evaluate rules for a given event against current state.
 *
 * 1. Filter rules by trigger.event match (already done via rulesByEvent index)
 * 2. Evaluate predicates to find matching rules
 * 3. Resolve conflicts
 * 4. Return ordered effects
 */
export function evaluate(
  state: State,
  event: GameEvent,
  rules: Rule[],
  glossary: Glossary,
): EvaluationResult {
  const predicateResults = new Map<string, boolean>();
  const matchedRules: Rule[] = [];

  for (const rule of rules) {
    const result = evaluatePredicate(rule.when, state, event, glossary);
    predicateResults.set(rule.id, result);
    if (result) {
      matchedRules.push(rule);
    }
  }

  // Sort matched rules by ascending priority before conflict resolution
  matchedRules.sort((a, b) => a.precedence.priority - b.precedence.priority);

  const resolvedEffects = resolveConflicts(matchedRules);

  return { matchedRules, resolvedEffects, predicateResults };
}

// Re-export sub-modules
export { evaluatePredicate } from "./predicates.js";
export { executeEffect, type EffectResult, type LogEntry } from "./effects.js";
export { resolveConflicts, getConflictDomain, type ResolvedEffect } from "./conflicts.js";
export { resolveTargetEntityIds, evaluateSelector, resolvePlayer } from "./predicates.js";
