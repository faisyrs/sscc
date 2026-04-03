import type { TimelineNode, SubSequence } from "../types/index.js";

export interface ParsedTimeline {
  timeline: TimelineNode[];
  subSequences: Record<string, SubSequence>;
}

/**
 * Parse raw timeline YAML data into typed structures.
 */
export function parseTimeline(data: unknown): ParsedTimeline {
  const raw = data as Record<string, unknown>;
  const timeline = (raw.timeline ?? []) as TimelineNode[];
  const subSequences = (raw.subSequences ?? {}) as Record<string, SubSequence>;
  return { timeline, subSequences };
}
