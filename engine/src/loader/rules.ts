import type { Rule } from "../types/index.js";

/**
 * Parse raw rules JSON data into typed Rule[].
 */
export function parseRules(data: unknown): Rule[] {
  if (!Array.isArray(data)) {
    throw new Error("rules.json must be a JSON array");
  }
  return data as Rule[];
}

/**
 * Index rules by trigger event for fast lookup.
 */
export function indexRulesByEvent(rules: Rule[]): Map<string, Rule[]> {
  const index = new Map<string, Rule[]>();
  for (const rule of rules) {
    const event = rule.trigger.event;
    let bucket = index.get(event);
    if (!bucket) {
      bucket = [];
      index.set(event, bucket);
    }
    bucket.push(rule);
  }
  return index;
}
