/**
 * Pack file schema types -- what the loader produces.
 */

import type { State } from "./state.js";
import type { Rule } from "./rules.js";
import type { PredicateNode } from "./rules.js";

// --- Manifest ---

export interface Manifest {
  id: string;
  name: string;
  version: string;
  engine_version: string;
  dependencies: string[];
}

// --- Timeline Nodes ---

export type TimelineNode =
  | EventNode
  | SequenceNode
  | RepeatNode
  | ForEachNode
  | SubSequenceRefNode;

export interface EventNode {
  event: string;
  params?: string[];
}

export interface SequenceNode {
  sequence: TimelineNode[];
}

export interface RepeatNode {
  repeat: {
    count: number | { path: string };
    indexParam: string;
    body: TimelineNode[];
  };
}

export interface ForEachNode {
  forEach: {
    over: { kind: string; from: string };
    bindParam: string;
    body: TimelineNode[];
  };
}

export interface SubSequenceRefNode {
  subSequence: string;
  params?: string[];
}

// --- Sub-Sequences ---

export interface SubSequence {
  params: string[];
  body: TimelineNode[];
}

// --- Glossary ---

export interface SelectorDef {
  kind: string;
  byEventParam?: string;
  where?: PredicateNode;
  all?: boolean;
}

export interface Glossary {
  keywords: string[];
  statuses?: Record<string, { description: string }>;
  reason_keys?: Record<string, string[]>;
  selectors: Record<string, SelectorDef>;
}

// --- Loaded Pack ---

export interface LoadedPack {
  manifest: Manifest;
  timeline: TimelineNode[];
  subSequences: Record<string, SubSequence>;
  glossary: Glossary;
  rules: Rule[];
  rulesByEvent: Map<string, Rule[]>;
  initialState: State;
  allEventIds: Set<string>;
}

// --- Validation ---

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
  ruleId?: string;
}

export type LoadResult =
  | { ok: true; pack: LoadedPack }
  | { ok: false; errors: ValidationError[] };
