import type { Rule, Effect } from "../types/index.js";

export interface ResolvedEffect {
  ruleId: string;
  priority: number;
  effect: Effect;
  isPatch: boolean;
}

/**
 * Determine the conflict domain for an effect.
 * Returns null for effects that are always stackable (emit, appendLogNote).
 */
export function getConflictDomain(effect: Effect): string | null {
  if ("applyStatus" in effect) {
    const { key } = effect.applyStatus;
    return `applyStatus:${key}`;
  }
  if ("removeStatus" in effect) {
    const { key } = effect.removeStatus;
    return `removeStatus:${key}`;
  }
  if ("setValue" in effect) {
    return `setValue:${effect.setValue.path}`;
  }
  if ("modifyCounter" in effect) {
    return `modifyCounter:${effect.modifyCounter.path}`;
  }
  if ("addProhibition" in effect) {
    const { action, reason } = effect.addProhibition;
    return `addProhibition:${action}:${reason}`;
  }
  if ("removeProhibition" in effect) {
    const { action, reason } = effect.removeProhibition;
    return `removeProhibition:${action}:${reason}`;
  }
  if ("addChoice" in effect) {
    return `addChoice:${effect.addChoice.id}`;
  }
  if ("consumeUsage" in effect) {
    return `consumeUsage:${effect.consumeUsage.scope}:${effect.consumeUsage.key}`;
  }
  if ("resetUsage" in effect) {
    return `resetUsage:${effect.resetUsage.scope}`;
  }
  if ("ensureExists" in effect) {
    return `ensureExists:${effect.ensureExists.path}`;
  }
  if ("mergeInto" in effect) {
    return `mergeInto:${effect.mergeInto.path}`;
  }
  if ("award" in effect) {
    return `award:${effect.award.resource}`;
  }
  if ("spendResource" in effect) {
    return `spendResource:${effect.spendResource.resource}`;
  }
  // emit and appendLogNote are always stackable -- no conflict domain
  if ("emit" in effect) return null;
  if ("appendLogNote" in effect) return null;

  return null;
}

/**
 * Resolve conflicts among matched rules, returning ordered effects to execute.
 *
 * Algorithm:
 * 1. Flatten all effects with metadata
 * 2. Group by conflict domain
 * 3. Within each domain, apply strategy (stack/override/patch)
 * 4. Return in ascending priority order, patches last within their priority
 */
export function resolveConflicts(matchedRules: Rule[]): ResolvedEffect[] {
  // Flatten effects with metadata
  const allEffects: ResolvedEffect[] = [];
  for (const rule of matchedRules) {
    for (const effect of rule.effect) {
      allEffects.push({
        ruleId: rule.id,
        priority: rule.precedence.priority,
        effect,
        isPatch: rule.precedence.strategy === "patch",
      });
    }
  }

  // Group by conflict domain
  const domainGroups = new Map<string, ResolvedEffect[]>();
  const noDomain: ResolvedEffect[] = [];

  for (const entry of allEffects) {
    const domain = getConflictDomain(entry.effect);
    if (domain === null) {
      noDomain.push(entry);
    } else {
      let group = domainGroups.get(domain);
      if (!group) {
        group = [];
        domainGroups.set(domain, group);
      }
      group.push(entry);
    }
  }

  // Resolve within each domain
  const resolved: ResolvedEffect[] = [...noDomain];

  for (const [_domain, group] of domainGroups) {
    const patches = group.filter((e) => e.isPatch);
    const nonPatches = group.filter((e) => !e.isPatch);

    // Check if any rule in this domain uses override
    const hasOverride = matchedRules.some(
      (r) =>
        r.precedence.strategy === "override" &&
        r.effect.some((eff) => {
          const d = getConflictDomain(eff);
          return d === _domain;
        }),
    );

    if (hasOverride) {
      // Override: highest priority wins among non-patch entries
      const overrideCandidates = nonPatches.filter((e) => {
        const rule = matchedRules.find((r) => r.id === e.ruleId);
        return rule?.precedence.strategy === "override";
      });
      const stackCandidates = nonPatches.filter((e) => {
        const rule = matchedRules.find((r) => r.id === e.ruleId);
        return rule?.precedence.strategy !== "override";
      });

      if (overrideCandidates.length > 0) {
        const maxPriority = Math.max(...overrideCandidates.map((e) => e.priority));
        const winners = overrideCandidates.filter((e) => e.priority === maxPriority);
        resolved.push(...winners);
      }
      // Stack candidates still apply alongside
      resolved.push(...stackCandidates);
    } else {
      // All stack: everything passes through
      resolved.push(...nonPatches);
    }

    // Patches always apply after
    resolved.push(...patches);
  }

  // Sort: ascending priority, patches after non-patches at same priority
  resolved.sort((a, b) => {
    if (a.isPatch !== b.isPatch) return a.isPatch ? 1 : -1;
    return a.priority - b.priority;
  });

  return resolved;
}
