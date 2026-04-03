import type { Glossary } from "../types/index.js";

/**
 * Parse raw glossary YAML data into typed Glossary.
 */
export function parseGlossary(data: unknown): Glossary {
  const raw = data as Record<string, unknown>;
  return {
    keywords: (raw.keywords ?? []) as string[],
    statuses: raw.statuses as Record<string, { description: string }> | undefined,
    reason_keys: raw.reason_keys as Record<string, string[]> | undefined,
    selectors: (raw.selectors ?? {}) as Glossary["selectors"],
  };
}
