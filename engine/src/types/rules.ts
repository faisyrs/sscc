/**
 * Rule, Predicate, and Effect types.
 */

// --- Target References ---

/** A reference to a target entity or set. */
export type TargetRef =
  | { selector: string }
  | { path: string }
  | { eventParam: string };

/** A reference to a player. */
export type PlayerRef =
  | { literal: string }
  | { eventParam: string };

// --- Predicates ---

export type PredicateNode =
  | { all: PredicateNode[] }
  | { any: PredicateNode[] }
  | { not: PredicateNode }
  | { hasStatus: { target?: TargetRef; key: string } }
  | { missingStatus: { target?: TargetRef; key: string } }
  | { pathEquals: { path: string; value?: unknown; valueFromEventParam?: string } }
  | { pathIn: { path: string; value: unknown } }
  | { pathAtLeast: { path: string; value: number } }
  | { pathMissing: { path: string } }
  | { resourceAtLeast: { player: PlayerRef; resource: string; amount: number } }
  | { eventParamEquals: { param: string; value: unknown } }
  | { counterAtLeast: { path: string; value: number } }
  | { counterEquals: { path: string; value: number } }
  | { tagPresent: { target: TargetRef; tag: string } }
  | { selector: { id: string } };

// --- Effects ---

export type Effect =
  | { applyStatus: { target: TargetRef; key: string; expiresOn?: string } }
  | { removeStatus: { target: TargetRef; key: string } }
  | { setValue: { path: string; value?: unknown; valueFromPath?: string; valueFromEventParam?: string } }
  | { modifyCounter: { path: string; delta?: number; deltaFromPath?: string } }
  | { addProhibition: { target: TargetRef; action: string; reason: string } }
  | { removeProhibition: { target: TargetRef; action: string; reason: string } }
  | { addChoice: { id: string; label: string; actionRef: string; limits?: Record<string, unknown>; costs?: Record<string, unknown>; selectionFrom?: TargetRef } }
  | { consumeUsage: { scope: string; key: string } }
  | { resetUsage: { scope: string; keys: string[] } }
  | { emit: { eventId: string; params?: Record<string, unknown> } }
  | { award: { target: PlayerRef; resource: string; amount: number } }
  | { spendResource: { target: PlayerRef; resource: string; amount: number } }
  | { appendLogNote: { message: string } }
  | { ensureExists: { path: string; defaultValue: unknown } }
  | { mergeInto: { path: string; value: Record<string, unknown> } };

/** The single key that identifies which verb an effect uses. */
export type EffectVerb = Effect extends infer E
  ? E extends Record<string, unknown>
    ? keyof E & string
    : never
  : never;

// --- Precedence ---

export type ConflictStrategy = "stack" | "override" | "patch";

export interface Precedence {
  priority: number;
  strategy: ConflictStrategy;
}

// --- Provenance ---

export interface Provenance {
  source: string;
  page?: number;
  note?: string;
}

// --- Rule ---

export type RuleScope = "global" | "player" | "entity" | "unit" | "attack" | "window";

export interface Rule {
  id: string;
  scope: RuleScope;
  trigger: { event: string };
  when: PredicateNode;
  effect: Effect[];
  precedence: Precedence;
  provenance: Provenance;
}
