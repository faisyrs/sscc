import type {
  Rule,
  Effect,
  LoadedPack,
  ValidationError,
  Glossary,
  TimelineNode,
  SubSequence,
} from "../types/index.js";
import { SYSTEM_EVENTS } from "../types/index.js";
import { collectEventIds } from "../sequencer/index.js";

/**
 * Perform all load-time cross-reference validation.
 * Returns an array of errors (empty = valid).
 */
export function validatePack(
  rules: Rule[],
  glossary: Glossary,
  timeline: TimelineNode[],
  subSequences: Record<string, SubSequence>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Collect all event IDs from timeline
  const timelineEventIds = collectEventIds(timeline, subSequences);

  // Collect event IDs from rule emit effects
  const emitEventIds = new Set<string>();
  for (const rule of rules) {
    for (const effect of rule.effect) {
      if ("emit" in effect) {
        emitEventIds.add(effect.emit.eventId);
      }
    }
  }

  // All known event IDs = timeline + emit + system events
  const allEventIds = new Set([
    ...timelineEventIds,
    ...emitEventIds,
    ...SYSTEM_EVENTS,
  ]);

  // 1. Check trigger events exist
  for (const rule of rules) {
    if (!allEventIds.has(rule.trigger.event)) {
      errors.push({
        code: "UNKNOWN_TRIGGER_EVENT",
        message: `Rule "${rule.id}" triggers on unknown event "${rule.trigger.event}"`,
        ruleId: rule.id,
      });
    }
  }

  // 2. Check for duplicate rule IDs
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) {
      errors.push({
        code: "DUPLICATE_RULE_ID",
        message: `Duplicate rule ID: "${rule.id}"`,
        ruleId: rule.id,
      });
    }
    ruleIds.add(rule.id);
  }

  // 3. Check selector references
  for (const rule of rules) {
    checkSelectorsInRule(rule, glossary, errors);
  }

  // 4. Check actionRef references in addChoice effects
  for (const rule of rules) {
    for (const effect of rule.effect) {
      if ("addChoice" in effect) {
        const actionRef = effect.addChoice.actionRef;
        if (!ruleIds.has(actionRef)) {
          errors.push({
            code: "UNKNOWN_ACTION_REF",
            message: `Rule "${rule.id}" has addChoice with unknown actionRef "${actionRef}"`,
            ruleId: rule.id,
          });
        }
      }
    }
  }

  // 5. Check override conflict detection
  checkOverrideConflicts(rules, errors);

  return errors;
}

function checkSelectorsInRule(
  rule: Rule,
  glossary: Glossary,
  errors: ValidationError[],
): void {
  // Check when clause for selector references
  checkPredicateSelectors(rule.when, rule.id, glossary, errors);

  // Check effect targets for selector references
  for (const effect of rule.effect) {
    checkEffectSelectors(effect, rule.id, glossary, errors);
  }
}

function checkPredicateSelectors(
  node: unknown,
  ruleId: string,
  glossary: Glossary,
  errors: ValidationError[],
): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  if ("selector" in obj) {
    const selectorNode = obj.selector as { id: string };
    if (!glossary.selectors[selectorNode.id]) {
      errors.push({
        code: "UNKNOWN_SELECTOR",
        message: `Rule "${ruleId}" references unknown selector "${selectorNode.id}"`,
        ruleId,
      });
    }
  }

  // Recurse into composition
  if ("all" in obj) {
    for (const child of obj.all as unknown[]) {
      checkPredicateSelectors(child, ruleId, glossary, errors);
    }
  }
  if ("any" in obj) {
    for (const child of obj.any as unknown[]) {
      checkPredicateSelectors(child, ruleId, glossary, errors);
    }
  }
  if ("not" in obj) {
    checkPredicateSelectors(obj.not, ruleId, glossary, errors);
  }
}

function checkEffectSelectors(
  effect: Effect,
  ruleId: string,
  glossary: Glossary,
  errors: ValidationError[],
): void {
  // Check target selectors in effects that have targets
  const targetEffects = [
    "applyStatus",
    "removeStatus",
    "addProhibition",
    "removeProhibition",
  ] as const;
  for (const verb of targetEffects) {
    if (verb in effect) {
      const eff = (effect as Record<string, unknown>)[verb] as Record<string, unknown>;
      const target = eff.target as Record<string, unknown> | undefined;
      if (target && "selector" in target) {
        const selectorId = target.selector as string;
        if (!glossary.selectors[selectorId]) {
          errors.push({
            code: "UNKNOWN_SELECTOR",
            message: `Rule "${ruleId}" effect "${verb}" references unknown selector "${selectorId}"`,
            ruleId,
          });
        }
      }
    }
  }

  // Check addChoice selectionFrom
  if ("addChoice" in effect) {
    const selFrom = effect.addChoice.selectionFrom as Record<string, unknown> | undefined;
    if (selFrom && "selector" in selFrom) {
      const selectorId = selFrom.selector as string;
      if (!glossary.selectors[selectorId]) {
        errors.push({
          code: "UNKNOWN_SELECTOR",
          message: `Rule "${ruleId}" addChoice selectionFrom references unknown selector "${selectorId}"`,
          ruleId,
        });
      }
    }
  }
}

function checkOverrideConflicts(
  rules: Rule[],
  errors: ValidationError[],
): void {
  // Group override rules by trigger event
  const overrideRules = rules.filter((r) => r.precedence.strategy === "override");
  const byEvent = new Map<string, Rule[]>();
  for (const rule of overrideRules) {
    const event = rule.trigger.event;
    let bucket = byEvent.get(event);
    if (!bucket) {
      bucket = [];
      byEvent.set(event, bucket);
    }
    bucket.push(rule);
  }

  // Within each event, check for same-priority conflicts
  for (const [eventId, eventRules] of byEvent) {
    const byPriority = new Map<number, Rule[]>();
    for (const rule of eventRules) {
      const p = rule.precedence.priority;
      let bucket = byPriority.get(p);
      if (!bucket) {
        bucket = [];
        byPriority.set(p, bucket);
      }
      bucket.push(rule);
    }
    for (const [priority, priorityRules] of byPriority) {
      if (priorityRules.length > 1) {
        errors.push({
          code: "OVERRIDE_PRIORITY_CONFLICT",
          message: `Override rules at same priority ${priority} on event "${eventId}": ${priorityRules.map((r) => r.id).join(", ")}`,
        });
      }
    }
  }
}
