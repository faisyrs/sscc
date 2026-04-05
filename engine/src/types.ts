// State - plain object tree
export type State = Record<string, unknown>;

// Sequences - named ordered lists of steps
// Step types: bare string (reference), { sequence: X } (explicit ref), X: { repeat: N }, "event" (leaf)
export type SequenceStep = string | { sequence: string } | { [name: string]: { repeat: number } };
export type SequenceMap = Map<string, SequenceStep[]>;

// Conditions - composable predicates
// is, on, all, any, not, pathEquals, pathAtLeast, pathAtLeastPath, pathMissing, pathIn
// selector, tagPresent, playerChoice, manual
export type Condition =
  | { is: string }
  | { on: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { pathEquals: { path: string; value: unknown } }
  | { pathAtLeast: { path: string; value: number } }
  | { pathAtLeastPath: { path: string; otherPath: string } }
  | { pathMissing: string }
  | { pathIn: { path: string; values: unknown[] } }
  | { selector: SelectorDef }
  | { tagPresent: { target: { path: string }; tag: string } }
  | { playerChoice: { player: string } }
  | { manual: string };

export interface SelectorDef {
  object: string;
  where?: Condition;
  id?: string;
}

// Effects - 6 primitives: set, unset, sequence, test, setSeed, appendLogNote
// set: path + value/add/path/random + optional expiresOn + optional valueFromChoice
// unset: simple path or selector-based bulk unset
// sequence: enter sub-sequence by name or inline event list
// test: roll/usePool + compare + target (derived/value/path) + pass/fail branches
// setSeed: number
// appendLogNote: string

export interface SetEffect {
  set: string;
  value?: unknown;
  expiresOn?: string;
  valueFromChoice?: string;
}

export interface UnsetEffect {
  unset: string | { key: string; target: SelectorDef };
}

export interface SequenceEffect {
  sequence: string | string[];
}

export interface TestEffect {
  test: {
    roll?: { count: number | { path: string }; sides: number };
    usePool?: string;
    compare: 'gte' | 'lte' | 'eq';
    target: { derived?: string; unit?: { path: string }; value?: number; path?: string };
    pass: Effect[];
    fail: Effect[];
  };
}

export interface SetSeedEffect { setSeed: number; }
export interface AppendLogNoteEffect { appendLogNote: string; }
export interface ManualEffect { manual: string; }

export type Effect = SetEffect | UnsetEffect | SequenceEffect | TestEffect | SetSeedEffect | AppendLogNoteEffect | ManualEffect;

// Rules
export interface Rule {
  id: string;
  when: Condition;
  effect: Effect[];
  label?: string;
  choice?: string;           // player path - presence makes rule optional
  costs?: Record<string, number>;
  provenance?: Record<string, string>;
}

// Objects - type name to path pattern
export type ObjectMap = Map<string, string>;

// Macros
export interface MacroDef {
  params: string[];
  expands: {
    repeat?: string;
    as?: string;
    effects: Effect[];
  };
}
export type MacroMap = Map<string, MacroDef>;

// Derived state
export interface DerivedStateDef {
  base: { path: string };
  modifiers: { match: string };
  aggregate: 'sum' | 'min' | 'max';
  clamp?: {
    min?: { offset: number };
    max?: { offset: number };
  };
}
export type DerivedStateMap = Map<string, DerivedStateDef>;

// Templates
export interface TemplateDef {
  template: string;
  params: string[];
  state: { path: string; value: unknown };
}
export type TemplateMap = Map<string, TemplateDef>;

// Selectors (named, from glossary)
export type SelectorMap = Map<string, SelectorDef>;

// Loaded pack (output of loader)
export interface LoadedPack {
  sequences: SequenceMap;
  rules: Rule[];
  objects: ObjectMap;
  macros: MacroMap;
  derived: DerivedStateMap;
  templates: TemplateMap;
  selectors: SelectorMap;
  initialState: State;
  ruleIndex: Map<string, Rule[]>;
}

// Engine runtime types
export interface MatchedRule {
  rule: Rule;
  mandatory: boolean;
}

export interface RuleLoopChoice {
  type: 'rule' | 'editState' | 'pass';
  rule?: Rule;
  editPath?: string;
  editValue?: unknown;
}

export interface LogEntry {
  type: string;
  event?: string;
  ruleId?: string;
  message?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface Snapshot {
  state: State;
  rngState: number;
  firedOnRules: Set<string>;
}

// Army file
export interface ArmyUnit {
  template: string;
  bind: Record<string, string>;
}

export interface ArmyFile {
  include: string[];
  units: ArmyUnit[];
}

// Player interaction callback
export type PlayerChoiceFn = (
  options: MatchedRule[],
  canPass: boolean,
  state: State,
) => Promise<RuleLoopChoice>;
