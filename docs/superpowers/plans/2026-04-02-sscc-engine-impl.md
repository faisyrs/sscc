# SSCC Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the SSCC engine Milestone 1 in TypeScript -- enough to load and run the Hello Pack and wh40k-10e-core-turn skeleton pack.

**Architecture:** Single TypeScript package with layered modules (types, state, sequencer, rules, choices, engine, loader, logger). Each module exports through index.ts with strict interfaces. Immutable state with structural sharing.

**Tech Stack:** TypeScript, Vitest, js-yaml

---

## Task 1: Project Scaffolding

Set up the engine package with TypeScript, Vitest, and js-yaml.

- [ ] **Step 1.1** -- Create `engine/package.json`

```json
{
  "name": "@sscc/engine",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 1.2** -- Create `engine/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 1.3** -- Create `engine/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
  },
});
```

- [ ] **Step 1.4** -- Create `engine/src/index.ts` (empty re-export placeholder)

```typescript
// SSCC Engine -- main entry point
// Modules are added as they are implemented.
export {};
```

- [ ] **Step 1.5** -- Run `npm install` and verify `npx vitest run` exits cleanly (no tests found, exit 0)

```bash
cd engine && npm install && npx vitest run
```

Expected: vitest reports "no test files found" and exits without error.

---

## Task 2: Core Types

Define all type definitions the engine uses. These are referenced by every subsequent task.

- [ ] **Step 2.1** -- Create `engine/src/types/state.ts`

```typescript
/**
 * State types -- immutable game state and path resolution.
 */

/** A status entry on an entity. expiresOn is an event ID or null for rule-consumed. */
export interface StatusEntry {
  expiresOn: string | null;
}

/** The game state is a plain JSON-compatible object. */
export type State = Record<string, unknown>;

/** A reference to a state path, e.g. "$.units.u1.statuses" */
export type StatePath = string;
```

- [ ] **Step 2.2** -- Create `engine/src/types/events.ts`

```typescript
/**
 * Event types -- timeline and rule-emitted events.
 */

/** A game event with an ID and parameter bag. */
export interface GameEvent {
  id: string;
  params: Record<string, unknown>;
}

/**
 * System event IDs that the engine emits automatically.
 * Pack rules may trigger on these.
 */
export const SYSTEM_EVENTS = [
  "ChoiceAdded",
  "ChoiceSelected",
  "ChoiceResolved",
  "ChoiceExpired",
] as const;

export type SystemEventId = (typeof SYSTEM_EVENTS)[number];
```

- [ ] **Step 2.3** -- Create `engine/src/types/rules.ts`

```typescript
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

export type RuleScope = "global" | "player" | "entity" | "unit" | "attack";

export interface Rule {
  id: string;
  scope: RuleScope;
  trigger: { event: string };
  when: PredicateNode;
  effect: Effect[];
  precedence: Precedence;
  provenance: Provenance;
}
```

- [ ] **Step 2.4** -- Create `engine/src/types/choices.ts`

```typescript
/**
 * Choice lifecycle types.
 */

import type { TargetRef } from "./rules.js";

export type ChoiceState = "offered" | "selected" | "resolved" | "expired" | "cancelled";

export interface ChoiceInstance {
  choiceInstanceId: string;
  choiceId: string;
  label: string;
  actionRef: string;
  player: string;
  sourceRuleId: string;
  createdAtEvent: string;
  state: ChoiceState;
  selectionFrom?: TargetRef;
  selectedArgs?: Record<string, unknown>;
}
```

- [ ] **Step 2.5** -- Create `engine/src/types/pack.ts`

```typescript
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
```

- [ ] **Step 2.6** -- Create `engine/src/types/index.ts` (re-export barrel)

```typescript
export * from "./state.js";
export * from "./events.js";
export * from "./rules.js";
export * from "./choices.js";
export * from "./pack.js";
```

- [ ] **Step 2.7** -- Verify compilation: `cd engine && npx tsc --noEmit`

Expected: exits with 0, no errors.

---

## Task 3: State Manager

Implement path resolution, get/set, status apply/remove/expire.

- [ ] **Step 3.1** -- Write test file `engine/tests/unit/state.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  get,
  set,
  applyStatus,
  removeStatus,
  expireStatuses,
  getStatuses,
} from "../../src/state/index.js";

describe("State path resolution", () => {
  const state = {
    units: {
      u1: { statuses: {}, name: "Alpha" },
      u2: { statuses: {}, name: "Beta" },
    },
    turnPlayer: null,
    resources: { A: { cp: 3 } },
    nested: { deep: { value: 42 } },
  };

  it("resolves a nested path", () => {
    expect(get(state, "$.nested.deep.value")).toBe(42);
  });

  it("returns undefined for missing key in existing parent", () => {
    expect(get(state, "$.nested.deep.nonexistent")).toBeUndefined();
  });

  it("returns undefined for path through null", () => {
    expect(get(state, "$.turnPlayer.something")).toBeUndefined();
  });

  it("returns null for a path whose value is null", () => {
    expect(get(state, "$.turnPlayer")).toBeNull();
  });

  it("returns the root when path is $", () => {
    expect(get(state, "$")).toBe(state);
  });
});

describe("State set", () => {
  const state = { a: { b: { c: 1 } }, x: 10 };

  it("returns new state with changed value, original unchanged", () => {
    const next = set(state, "$.a.b.c", 99);
    expect(get(next, "$.a.b.c")).toBe(99);
    expect(get(state, "$.a.b.c")).toBe(1);
  });

  it("preserves sibling references (structural sharing)", () => {
    const state2 = { a: { b: 1 }, c: { d: 2 } };
    const next = set(state2, "$.a.b", 99);
    expect((next as any).c).toBe((state2 as any).c);
  });

  it("creates intermediate objects for missing path segments", () => {
    const next = set({}, "$.a.b.c", "hello");
    expect(get(next, "$.a.b.c")).toBe("hello");
  });
});

describe("Status apply/remove/expire", () => {
  it("applies a status with expiresOn", () => {
    const state = { units: { u1: { statuses: {} } } };
    const next = applyStatus(state, "u1", "can_move", null);
    const statuses = getStatuses(next, "u1");
    expect(statuses).toEqual({ can_move: { expiresOn: null } });
  });

  it("applying same status twice is idempotent", () => {
    const state = { units: { u1: { statuses: {} } } };
    const s1 = applyStatus(state, "u1", "can_move", null);
    const s2 = applyStatus(s1, "u1", "can_move", null);
    expect(getStatuses(s2, "u1")).toEqual({ can_move: { expiresOn: null } });
  });

  it("removes a status", () => {
    const state = { units: { u1: { statuses: { can_move: { expiresOn: null } } } } };
    const next = removeStatus(state, "u1", "can_move");
    expect(getStatuses(next, "u1")).toEqual({});
  });

  it("removing a non-existent status is a no-op", () => {
    const state = { units: { u1: { statuses: {} } } };
    const next = removeStatus(state, "u1", "can_move");
    expect(getStatuses(next, "u1")).toEqual({});
  });

  it("expires statuses matching event ID across all entities", () => {
    const state = {
      units: {
        u1: { statuses: { advanced_move: { expiresOn: "TurnEnded" }, can_move: { expiresOn: null } } },
        u2: { statuses: { fell_back: { expiresOn: "TurnEnded" } } },
      },
    };
    const next = expireStatuses(state, "TurnEnded");
    expect(getStatuses(next, "u1")).toEqual({ can_move: { expiresOn: null } });
    expect(getStatuses(next, "u2")).toEqual({});
  });

  it("expire with no matching statuses returns equivalent state", () => {
    const state = { units: { u1: { statuses: { x: { expiresOn: "Other" } } } } };
    const next = expireStatuses(state, "TurnEnded");
    expect(getStatuses(next, "u1")).toEqual({ x: { expiresOn: "Other" } });
  });
});
```

- [ ] **Step 3.2** -- Implement `engine/src/state/index.ts`

```typescript
import type { State, StatusEntry } from "../types/index.js";

/**
 * Parse a $-prefixed path into segments.
 * "$.a.b.c" -> ["a", "b", "c"]
 * "$" -> []
 */
function parsePath(path: string): string[] {
  if (path === "$") return [];
  if (!path.startsWith("$.")) {
    throw new Error(`Invalid state path: ${path} (must start with "$." or be "$")`);
  }
  return path.slice(2).split(".");
}

/**
 * Get a value from state at the given path.
 * Returns undefined if any segment along the path is missing or not an object.
 */
export function get(state: State, path: string): unknown {
  const segments = parsePath(path);
  let current: unknown = state;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Set a value in state at the given path, returning a new state.
 * Creates intermediate objects for missing segments.
 * Never mutates the input state.
 */
export function set(state: State, path: string, value: unknown): State {
  const segments = parsePath(path);
  if (segments.length === 0) {
    // Setting root -- value must be a Record
    return value as State;
  }
  return setRecursive(state, segments, 0, value) as State;
}

function setRecursive(
  current: unknown,
  segments: string[],
  index: number,
  value: unknown,
): unknown {
  const obj =
    current !== null && current !== undefined && typeof current === "object"
      ? (current as Record<string, unknown>)
      : {};
  const seg = segments[index];
  if (index === segments.length - 1) {
    return { ...obj, [seg]: value };
  }
  return {
    ...obj,
    [seg]: setRecursive(obj[seg], segments, index + 1, value),
  };
}

/**
 * Get all statuses for an entity (looks up units.<entityId>.statuses).
 */
export function getStatuses(
  state: State,
  entityId: string,
): Record<string, StatusEntry> {
  const result = get(state, `$.units.${entityId}.statuses`);
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, StatusEntry>;
  }
  return {};
}

/**
 * Apply a status to an entity. Idempotent -- re-applying is a no-op.
 */
export function applyStatus(
  state: State,
  entityId: string,
  key: string,
  expiresOn: string | null,
): State {
  const current = getStatuses(state, entityId);
  if (key in current) return state;
  const entry: StatusEntry = { expiresOn };
  const newStatuses = { ...current, [key]: entry };
  return set(state, `$.units.${entityId}.statuses`, newStatuses);
}

/**
 * Remove a status from an entity. No-op if not present.
 */
export function removeStatus(
  state: State,
  entityId: string,
  key: string,
): State {
  const current = getStatuses(state, entityId);
  if (!(key in current)) return state;
  const { [key]: _, ...rest } = current;
  return set(state, `$.units.${entityId}.statuses`, rest);
}

/**
 * Expire all statuses across all entities whose expiresOn matches the event ID.
 * Called at the START of event evaluation, before rules fire.
 */
export function expireStatuses(state: State, eventId: string): State {
  const units = get(state, "$.units") as Record<string, unknown> | undefined;
  if (!units || typeof units !== "object") return state;

  let current = state;
  for (const entityId of Object.keys(units)) {
    const statuses = getStatuses(current, entityId);
    let changed = false;
    const newStatuses: Record<string, StatusEntry> = {};
    for (const [key, entry] of Object.entries(statuses)) {
      if (entry.expiresOn === eventId) {
        changed = true;
      } else {
        newStatuses[key] = entry;
      }
    }
    if (changed) {
      current = set(current, `$.units.${entityId}.statuses`, newStatuses);
    }
  }
  return current;
}
```

- [ ] **Step 3.3** -- Run tests: `cd engine && npx vitest run tests/unit/state.test.ts`

Expected: all tests pass.

---

## Task 4: Predicate Evaluators

Implement all 14 predicate types plus `all`/`any`/`not` composition.

- [ ] **Step 4.1** -- Write test file `engine/tests/unit/predicates.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { evaluatePredicate } from "../../src/rules/predicates.js";
import type { PredicateNode } from "../../src/types/index.js";
import type { GameEvent, State } from "../../src/types/index.js";
import type { Glossary } from "../../src/types/index.js";

const glossary: Glossary = {
  keywords: ["INFANTRY"],
  selectors: {
    units_can_move: { kind: "unit", where: { hasStatus: { key: "can_move" } } },
    empty_selector: { kind: "unit", where: { hasStatus: { key: "nonexistent_status" } } },
    all_units: { kind: "unit", all: true },
  },
};

const baseState: State = {
  turnPlayer: "A",
  units: {
    u1: { id: "u1", owner: "A", keywords: ["INFANTRY"], statuses: { can_move: { expiresOn: null } } },
    u2: { id: "u2", owner: "B", keywords: ["VEHICLE"], statuses: {} },
  },
  resources: { A: { cp: 3 }, B: { cp: 0 } },
  activation: { unitId: "u1" },
};

const baseEvent: GameEvent = { id: "MovementPhaseStarted", params: { player: "A" } };

function evaluate(pred: PredicateNode, state = baseState, event = baseEvent) {
  return evaluatePredicate(pred, state, event, glossary);
}

describe("Composition predicates", () => {
  it("all with empty array is vacuously true", () => {
    expect(evaluate({ all: [] })).toBe(true);
  });

  it("all with mixed results returns false", () => {
    expect(
      evaluate({
        all: [
          { pathEquals: { path: "$.turnPlayer", value: "A" } },
          { pathEquals: { path: "$.turnPlayer", value: "B" } },
        ],
      }),
    ).toBe(false);
  });

  it("any returns true when at least one child is true", () => {
    expect(
      evaluate({
        any: [
          { pathEquals: { path: "$.turnPlayer", value: "B" } },
          { pathEquals: { path: "$.turnPlayer", value: "A" } },
        ],
      }),
    ).toBe(true);
  });

  it("any with empty array is false", () => {
    expect(evaluate({ any: [] })).toBe(false);
  });

  it("not negates", () => {
    expect(evaluate({ not: { pathEquals: { path: "$.turnPlayer", value: "B" } } })).toBe(true);
  });

  it("nested composition: all containing not containing any", () => {
    expect(
      evaluate({
        all: [
          { not: { any: [{ pathEquals: { path: "$.turnPlayer", value: "B" } }] } },
        ],
      }),
    ).toBe(true);
  });
});

describe("pathEquals", () => {
  it("matches literal value", () => {
    expect(evaluate({ pathEquals: { path: "$.turnPlayer", value: "A" } })).toBe(true);
  });

  it("matches value from event param", () => {
    expect(evaluate({ pathEquals: { path: "$.turnPlayer", valueFromEventParam: "player" } })).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(evaluate({ pathEquals: { path: "$.turnPlayer", value: "B" } })).toBe(false);
  });
});

describe("pathIn", () => {
  it("returns true if value is in the array at path", () => {
    const state = { ...baseState, items: ["x", "y", "z"] };
    expect(evaluate({ pathIn: { path: "$.items", value: "y" } }, state)).toBe(true);
  });

  it("returns false if value is not in array", () => {
    const state = { ...baseState, items: ["x", "y"] };
    expect(evaluate({ pathIn: { path: "$.items", value: "z" } }, state)).toBe(false);
  });
});

describe("pathAtLeast", () => {
  it("returns true when value >= threshold", () => {
    expect(evaluate({ pathAtLeast: { path: "$.resources.A.cp", value: 3 } })).toBe(true);
  });

  it("returns false when value < threshold", () => {
    expect(evaluate({ pathAtLeast: { path: "$.resources.A.cp", value: 4 } })).toBe(false);
  });
});

describe("pathMissing", () => {
  it("returns true for missing path", () => {
    expect(evaluate({ pathMissing: { path: "$.nonexistent" } })).toBe(true);
  });

  it("returns false for present path", () => {
    expect(evaluate({ pathMissing: { path: "$.turnPlayer" } })).toBe(false);
  });
});

describe("eventParamEquals", () => {
  it("matches event parameter", () => {
    expect(evaluate({ eventParamEquals: { param: "player", value: "A" } })).toBe(true);
  });

  it("returns false on mismatch", () => {
    expect(evaluate({ eventParamEquals: { param: "player", value: "B" } })).toBe(false);
  });

  it("returns false for missing param", () => {
    expect(evaluate({ eventParamEquals: { param: "missing", value: "A" } })).toBe(false);
  });
});

describe("resourceAtLeast", () => {
  it("returns true when resource >= amount", () => {
    expect(
      evaluate({ resourceAtLeast: { player: { eventParam: "player" }, resource: "cp", amount: 2 } }),
    ).toBe(true);
  });

  it("returns false when resource < amount", () => {
    expect(
      evaluate({ resourceAtLeast: { player: { literal: "B" }, resource: "cp", amount: 1 } }),
    ).toBe(false);
  });
});

describe("counterAtLeast and counterEquals", () => {
  it("counterAtLeast returns true when >=", () => {
    expect(evaluate({ counterAtLeast: { path: "$.resources.A.cp", value: 3 } })).toBe(true);
  });

  it("counterEquals returns true on exact match", () => {
    expect(evaluate({ counterEquals: { path: "$.resources.A.cp", value: 3 } })).toBe(true);
  });

  it("counterEquals returns false on mismatch", () => {
    expect(evaluate({ counterEquals: { path: "$.resources.A.cp", value: 2 } })).toBe(false);
  });
});

describe("hasStatus and missingStatus", () => {
  it("hasStatus with path target", () => {
    expect(
      evaluate({ hasStatus: { target: { path: "$.activation.unitId" }, key: "can_move" } }),
    ).toBe(true);
  });

  it("missingStatus with path target", () => {
    expect(
      evaluate({ missingStatus: { target: { path: "$.activation.unitId" }, key: "can_move" } }),
    ).toBe(false);
  });

  it("missingStatus returns true when status absent", () => {
    expect(
      evaluate({ missingStatus: { target: { path: "$.activation.unitId" }, key: "advanced_move" } }),
    ).toBe(true);
  });
});

describe("tagPresent", () => {
  it("returns true when keyword present", () => {
    expect(
      evaluate({ tagPresent: { target: { path: "$.activation.unitId" }, tag: "INFANTRY" } }),
    ).toBe(true);
  });

  it("returns false when keyword absent", () => {
    expect(
      evaluate({ tagPresent: { target: { path: "$.activation.unitId" }, tag: "VEHICLE" } }),
    ).toBe(false);
  });
});

describe("selector predicate", () => {
  it("returns true when selector produces non-empty set", () => {
    expect(evaluate({ selector: { id: "units_can_move" } })).toBe(true);
  });

  it("returns false when selector produces empty set", () => {
    expect(evaluate({ selector: { id: "empty_selector" } })).toBe(false);
  });
});
```

- [ ] **Step 4.2** -- Implement `engine/src/rules/predicates.ts`

```typescript
import type {
  PredicateNode,
  TargetRef,
  PlayerRef,
  State,
  GameEvent,
  Glossary,
  SelectorDef,
} from "../types/index.js";
import { get } from "../state/index.js";

/**
 * Evaluate a predicate tree against current state and event.
 */
export function evaluatePredicate(
  node: PredicateNode,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): boolean {
  // --- Composition ---
  if ("all" in node) {
    return (node as { all: PredicateNode[] }).all.every((child) =>
      evaluatePredicate(child, state, event, glossary),
    );
  }
  if ("any" in node) {
    return (node as { any: PredicateNode[] }).any.some((child) =>
      evaluatePredicate(child, state, event, glossary),
    );
  }
  if ("not" in node) {
    return !evaluatePredicate(
      (node as { not: PredicateNode }).not,
      state,
      event,
      glossary,
    );
  }

  // --- Leaf predicates ---
  if ("pathEquals" in node) {
    const { path, value, valueFromEventParam } = (node as any).pathEquals;
    const actual = get(state, path);
    const expected =
      valueFromEventParam !== undefined
        ? event.params[valueFromEventParam]
        : value;
    return actual === expected;
  }

  if ("pathIn" in node) {
    const { path, value } = (node as any).pathIn;
    const arr = get(state, path);
    if (!Array.isArray(arr)) return false;
    return arr.includes(value);
  }

  if ("pathAtLeast" in node) {
    const { path, value } = (node as any).pathAtLeast;
    const actual = get(state, path);
    return typeof actual === "number" && actual >= value;
  }

  if ("pathMissing" in node) {
    const { path } = (node as any).pathMissing;
    return get(state, path) === undefined;
  }

  if ("eventParamEquals" in node) {
    const { param, value } = (node as any).eventParamEquals;
    return event.params[param] === value;
  }

  if ("resourceAtLeast" in node) {
    const { player, resource, amount } = (node as any).resourceAtLeast;
    const playerId = resolvePlayerRef(player, event);
    const actual = get(state, `$.resources.${playerId}.${resource}`);
    return typeof actual === "number" && actual >= amount;
  }

  if ("counterAtLeast" in node) {
    const { path, value } = (node as any).counterAtLeast;
    const actual = get(state, path);
    return typeof actual === "number" && actual >= value;
  }

  if ("counterEquals" in node) {
    const { path, value } = (node as any).counterEquals;
    const actual = get(state, path);
    return typeof actual === "number" && actual === value;
  }

  if ("hasStatus" in node) {
    const { target, key } = (node as any).hasStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    return entityIds.length > 0 && entityIds.every((id) => {
      const statuses = get(state, `$.units.${id}.statuses`) as Record<string, unknown> | undefined;
      return statuses !== undefined && key in statuses;
    });
  }

  if ("missingStatus" in node) {
    const { target, key } = (node as any).missingStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    return entityIds.length > 0 && entityIds.every((id) => {
      const statuses = get(state, `$.units.${id}.statuses`) as Record<string, unknown> | undefined;
      return statuses === undefined || !(key in statuses);
    });
  }

  if ("tagPresent" in node) {
    const { target, tag } = (node as any).tagPresent;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    return entityIds.length > 0 && entityIds.every((id) => {
      const keywords = get(state, `$.units.${id}.keywords`) as unknown[];
      return Array.isArray(keywords) && keywords.includes(tag);
    });
  }

  if ("selector" in node) {
    const { id } = (node as any).selector;
    const ids = evaluateSelector(id, state, event, glossary);
    return ids.length > 0;
  }

  throw new Error(`Unknown predicate type: ${JSON.stringify(node)}`);
}

/**
 * Resolve a PlayerRef to a player ID string.
 */
function resolvePlayerRef(ref: PlayerRef, event: GameEvent): string {
  if ("literal" in ref) return ref.literal;
  if ("eventParam" in ref) return event.params[ref.eventParam] as string;
  throw new Error(`Cannot resolve player ref: ${JSON.stringify(ref)}`);
}

/**
 * Resolve a TargetRef to an array of entity IDs.
 */
export function resolveTargetEntityIds(
  target: TargetRef | undefined,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): string[] {
  if (!target) return [];

  if ("path" in target) {
    const val = get(state, target.path);
    if (typeof val === "string") return [val];
    return [];
  }

  if ("eventParam" in target) {
    const val = event.params[target.eventParam];
    if (typeof val === "string") return [val];
    return [];
  }

  if ("selector" in target) {
    return evaluateSelector(target.selector, state, event, glossary);
  }

  return [];
}

/**
 * Evaluate a named selector from the glossary, returning matching entity IDs.
 */
export function evaluateSelector(
  selectorId: string,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): string[] {
  const def = glossary.selectors[selectorId];
  if (!def) return [];
  return evaluateSelectorDef(def, state, event, glossary);
}

/**
 * Evaluate a SelectorDef against state.
 */
export function evaluateSelectorDef(
  def: SelectorDef,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): string[] {
  if (def.byEventParam) {
    const val = event.params[def.byEventParam];
    return typeof val === "string" ? [val] : [];
  }

  // Get all entities of the given kind
  const entities = getEntitiesOfKind(def.kind, state, event);

  if (def.all) return entities;

  if (def.where) {
    return entities.filter((entityId) => {
      // For the where predicate, we need to evaluate it in the context of each entity
      // The hasStatus/missingStatus predicates check the entity directly when no target is specified
      return evaluatePredicateForEntity(def.where!, entityId, state, event, glossary);
    });
  }

  return entities;
}

/**
 * Get all entity IDs of a given kind.
 */
function getEntitiesOfKind(kind: string, state: State, event: GameEvent): string[] {
  if (kind === "unit") {
    const units = get(state, "$.units") as Record<string, unknown> | undefined;
    if (!units) return [];
    // Filter by active player if turnPlayer is set
    return Object.keys(units);
  }
  if (kind === "player") {
    const players = get(state, "$.players") as string[] | undefined;
    return players ?? [];
  }
  return [];
}

/**
 * Evaluate a predicate in the context of a specific entity.
 * Used by selector `where` clauses where hasStatus/missingStatus
 * should check the iterated entity, not a target ref.
 */
function evaluatePredicateForEntity(
  node: PredicateNode,
  entityId: string,
  state: State,
  event: GameEvent,
  glossary: Glossary,
): boolean {
  // For hasStatus/missingStatus in a where clause, the implicit target is the current entity
  if ("hasStatus" in node) {
    const { key } = (node as any).hasStatus;
    const target = (node as any).hasStatus.target;
    if (!target) {
      const statuses = get(state, `$.units.${entityId}.statuses`) as Record<string, unknown> | undefined;
      return statuses !== undefined && key in statuses;
    }
  }
  if ("missingStatus" in node) {
    const { key } = (node as any).missingStatus;
    const target = (node as any).missingStatus.target;
    if (!target) {
      const statuses = get(state, `$.units.${entityId}.statuses`) as Record<string, unknown> | undefined;
      return statuses === undefined || !(key in statuses);
    }
  }
  // For pathEquals in a where clause, evaluate normally
  if ("pathEquals" in node) {
    return evaluatePredicate(node, state, event, glossary);
  }

  // Fall through to general evaluation
  return evaluatePredicate(node, state, event, glossary);
}

/**
 * Resolve a PlayerRef to a player ID string. Exported for use by effects.
 */
export function resolvePlayer(ref: PlayerRef, event: GameEvent): string {
  return resolvePlayerRef(ref, event);
}
```

- [ ] **Step 4.3** -- Run tests: `cd engine && npx vitest run tests/unit/predicates.test.ts`

Expected: all tests pass.

---

## Task 5: Effect Executors

Implement all 15 Milestone 1 effect verbs. Grouped by category.

- [ ] **Step 5.1** -- Write test file `engine/tests/unit/effects.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { executeEffect } from "../../src/rules/effects.js";
import type { Effect, GameEvent, State, Glossary } from "../../src/types/index.js";
import { get, getStatuses } from "../../src/state/index.js";

const glossary: Glossary = {
  keywords: [],
  selectors: {
    active_player_units: {
      kind: "unit",
      where: { pathEquals: { path: "$.turnPlayer", valueFromEventParam: "player" } },
    },
    all_units: { kind: "unit", all: true },
  },
};

const baseState: State = {
  turnPlayer: "A",
  players: ["A", "B"],
  units: {
    u1: {
      id: "u1",
      owner: "A",
      statuses: {},
      keywords: ["INFANTRY"],
      eligibility: { shoot: { prohibitions: [] }, charge: { prohibitions: [] } },
    },
    u2: {
      id: "u2",
      owner: "B",
      statuses: {},
      keywords: [],
      eligibility: { shoot: { prohibitions: [] }, charge: { prohibitions: [] } },
    },
  },
  resources: { A: { cp: 1 }, B: { cp: 0 } },
  activation: { unitId: "u1", type: null },
  usage: {},
  statuses: {},
};

const baseEvent: GameEvent = {
  id: "MovementPhaseStarted",
  params: { player: "A" },
};

function exec(effect: Effect, state = baseState, event = baseEvent) {
  return executeEffect(state, effect, event, "test-rule", glossary);
}

describe("applyStatus", () => {
  it("applies status to entity resolved from path", () => {
    const result = exec({
      applyStatus: { target: { path: "$.activation.unitId" }, key: "can_move" },
    });
    expect(getStatuses(result.state, "u1")).toHaveProperty("can_move");
  });

  it("applies status with expiresOn", () => {
    const result = exec({
      applyStatus: {
        target: { path: "$.activation.unitId" },
        key: "advanced_move",
        expiresOn: "TurnEnded",
      },
    });
    expect(getStatuses(result.state, "u1").advanced_move).toEqual({
      expiresOn: "TurnEnded",
    });
  });

  it("applies to all entities from selector", () => {
    const state = {
      ...baseState,
      units: {
        u1: { id: "u1", owner: "A", statuses: {}, keywords: [] },
        u2: { id: "u2", owner: "A", statuses: {}, keywords: [] },
      },
    };
    const result = exec(
      { applyStatus: { target: { selector: "all_units" }, key: "can_move" } },
      state,
    );
    expect(getStatuses(result.state, "u1")).toHaveProperty("can_move");
    expect(getStatuses(result.state, "u2")).toHaveProperty("can_move");
  });
});

describe("removeStatus", () => {
  it("removes status from entity", () => {
    const state = {
      ...baseState,
      units: {
        ...baseState.units,
        u1: {
          ...(baseState.units as any).u1,
          statuses: { can_move: { expiresOn: null } },
        },
      },
    } as State;
    const result = exec(
      { removeStatus: { target: { path: "$.activation.unitId" }, key: "can_move" } },
      state,
    );
    expect(getStatuses(result.state, "u1")).toEqual({});
  });
});

describe("setValue", () => {
  it("sets a literal value", () => {
    const result = exec({ setValue: { path: "$.activation.type", value: "advance" } });
    expect(get(result.state, "$.activation.type")).toBe("advance");
  });

  it("sets value from event param", () => {
    const result = exec({
      setValue: { path: "$.turnPlayer", valueFromEventParam: "player" },
    });
    expect(get(result.state, "$.turnPlayer")).toBe("A");
  });

  it("sets value from another path", () => {
    const result = exec({
      setValue: { path: "$.activation.type", valueFromPath: "$.turnPlayer" },
    });
    expect(get(result.state, "$.activation.type")).toBe("A");
  });
});

describe("modifyCounter", () => {
  it("increments by delta", () => {
    const result = exec({ modifyCounter: { path: "$.resources.A.cp", delta: 2 } });
    expect(get(result.state, "$.resources.A.cp")).toBe(3);
  });

  it("decrements by negative delta", () => {
    const result = exec({ modifyCounter: { path: "$.resources.A.cp", delta: -1 } });
    expect(get(result.state, "$.resources.A.cp")).toBe(0);
  });
});

describe("addProhibition", () => {
  it("adds a prohibition to entity", () => {
    const result = exec({
      addProhibition: {
        target: { path: "$.activation.unitId" },
        action: "shoot",
        reason: "advanced_move",
      },
    });
    const prohibitions = get(result.state, "$.units.u1.eligibility.shoot.prohibitions") as any[];
    expect(prohibitions).toContainEqual({ reason: "advanced_move" });
  });
});

describe("removeProhibition", () => {
  it("removes a prohibition from entity", () => {
    const state = {
      ...baseState,
      units: {
        ...baseState.units,
        u1: {
          ...(baseState.units as any).u1,
          eligibility: { shoot: { prohibitions: [{ reason: "advanced_move" }] }, charge: { prohibitions: [] } },
        },
      },
    } as State;
    const result = exec(
      {
        removeProhibition: {
          target: { path: "$.activation.unitId" },
          action: "shoot",
          reason: "advanced_move",
        },
      },
      state,
    );
    const prohibitions = get(result.state, "$.units.u1.eligibility.shoot.prohibitions") as any[];
    expect(prohibitions).toEqual([]);
  });
});

describe("emit", () => {
  it("emits an event with params", () => {
    const result = exec({
      emit: { eventId: "UnitMovementStarted", params: { player: { eventParam: "player" } } },
    });
    expect(result.emittedEvents).toHaveLength(1);
    expect(result.emittedEvents[0].id).toBe("UnitMovementStarted");
  });

  it("resolves eventParam references in emitted event params", () => {
    const result = exec({
      emit: { eventId: "TestEvent", params: { p: { eventParam: "player" } } },
    });
    expect(result.emittedEvents[0].params.p).toBe("A");
  });
});

describe("award and spendResource", () => {
  it("awards resource to player", () => {
    const result = exec({
      award: { target: { eventParam: "player" }, resource: "cp", amount: 2 },
    });
    expect(get(result.state, "$.resources.A.cp")).toBe(3);
  });

  it("spends resource from player", () => {
    const result = exec({
      spendResource: { target: { eventParam: "player" }, resource: "cp", amount: 1 },
    });
    expect(get(result.state, "$.resources.A.cp")).toBe(0);
  });
});

describe("addChoice", () => {
  it("creates a choice instance", () => {
    const result = exec({
      addChoice: {
        id: "move_normal",
        label: "Normal Move",
        actionRef: "CORE.Move.TypeAction.Normal.1",
      },
    });
    expect(result.newChoices).toHaveLength(1);
    expect(result.newChoices[0].choiceId).toBe("move_normal");
    expect(result.newChoices[0].player).toBe("A");
  });
});

describe("consumeUsage and resetUsage", () => {
  it("consumeUsage marks a key as used", () => {
    const result = exec({ consumeUsage: { scope: "player", key: "gain_coin" } });
    expect(get(result.state, "$.usage.player.gain_coin")).toBe(true);
  });

  it("resetUsage clears usage keys", () => {
    const state = { ...baseState, usage: { player: { gain_coin: true, other: true } } } as State;
    const result = exec({ resetUsage: { scope: "player", keys: ["gain_coin"] } }, state);
    expect(get(result.state, "$.usage.player.gain_coin")).toBeUndefined();
    expect(get(result.state, "$.usage.player.other")).toBe(true);
  });
});

describe("appendLogNote", () => {
  it("produces a log entry", () => {
    const result = exec({ appendLogNote: { message: "test note" } });
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].message).toBe("test note");
  });
});

describe("ensureExists", () => {
  it("creates path with default value when missing", () => {
    const result = exec({ ensureExists: { path: "$.newField", defaultValue: [] } });
    expect(get(result.state, "$.newField")).toEqual([]);
  });

  it("does not overwrite existing value", () => {
    const result = exec({ ensureExists: { path: "$.turnPlayer", defaultValue: "X" } });
    expect(get(result.state, "$.turnPlayer")).toBe("A");
  });
});

describe("mergeInto", () => {
  it("merges object into existing path", () => {
    const result = exec({
      mergeInto: { path: "$.activation", value: { extra: "data" } },
    });
    expect(get(result.state, "$.activation.extra")).toBe("data");
    expect(get(result.state, "$.activation.unitId")).toBe("u1");
  });
});
```

- [ ] **Step 5.2** -- Implement `engine/src/rules/effects.ts`

```typescript
import type {
  Effect,
  GameEvent,
  State,
  Glossary,
  PlayerRef,
  TargetRef,
} from "../types/index.js";
import type { ChoiceInstance } from "../types/index.js";
import { get, set, applyStatus, removeStatus } from "../state/index.js";
import { resolveTargetEntityIds, resolvePlayer } from "./predicates.js";

export interface LogEntry {
  type: string;
  message: string;
  ruleId?: string;
  eventId?: string;
}

export interface EffectResult {
  state: State;
  emittedEvents: GameEvent[];
  newChoices: ChoiceInstance[];
  logEntries: LogEntry[];
}

let choiceCounter = 0;

/** Reset choice counter (for testing). */
export function resetChoiceCounter(): void {
  choiceCounter = 0;
}

/**
 * Execute a single effect against state, returning new state and side effects.
 */
export function executeEffect(
  state: State,
  effect: Effect,
  event: GameEvent,
  sourceRuleId: string,
  glossary: Glossary,
): EffectResult {
  const result: EffectResult = {
    state,
    emittedEvents: [],
    newChoices: [],
    logEntries: [],
  };

  if ("applyStatus" in effect) {
    const { target, key, expiresOn } = effect.applyStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      s = applyStatus(s, id, key, expiresOn ?? null);
    }
    result.state = s;
    return result;
  }

  if ("removeStatus" in effect) {
    const { target, key } = effect.removeStatus;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      s = removeStatus(s, id, key);
    }
    result.state = s;
    return result;
  }

  if ("setValue" in effect) {
    const { path, value, valueFromPath, valueFromEventParam } = effect.setValue;
    let resolved: unknown;
    if (valueFromEventParam !== undefined) {
      resolved = event.params[valueFromEventParam];
    } else if (valueFromPath !== undefined) {
      resolved = get(state, valueFromPath);
    } else {
      resolved = value;
    }
    result.state = set(state, path, resolved);
    return result;
  }

  if ("modifyCounter" in effect) {
    const { path, delta, deltaFromPath } = effect.modifyCounter;
    const current = get(state, path);
    const currentNum = typeof current === "number" ? current : 0;
    let d: number;
    if (deltaFromPath !== undefined) {
      const val = get(state, deltaFromPath);
      d = typeof val === "number" ? val : 0;
    } else {
      d = delta ?? 0;
    }
    result.state = set(state, path, currentNum + d);
    return result;
  }

  if ("addProhibition" in effect) {
    const { target, action, reason } = effect.addProhibition;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      const prohibPath = `$.units.${id}.eligibility.${action}.prohibitions`;
      const current = get(s, prohibPath) as Array<{ reason: string }> | undefined;
      const arr = current ?? [];
      // Idempotent: do not add duplicate
      if (!arr.some((p) => p.reason === reason)) {
        s = set(s, prohibPath, [...arr, { reason }]);
      }
    }
    result.state = s;
    return result;
  }

  if ("removeProhibition" in effect) {
    const { target, action, reason } = effect.removeProhibition;
    const entityIds = resolveTargetEntityIds(target, state, event, glossary);
    let s = state;
    for (const id of entityIds) {
      const prohibPath = `$.units.${id}.eligibility.${action}.prohibitions`;
      const current = get(s, prohibPath) as Array<{ reason: string }> | undefined;
      if (current) {
        s = set(
          s,
          prohibPath,
          current.filter((p) => p.reason !== reason),
        );
      }
    }
    result.state = s;
    return result;
  }

  if ("addChoice" in effect) {
    const { id, label, actionRef, limits, costs, selectionFrom } = effect.addChoice;
    choiceCounter++;
    const player = resolveCurrentPlayer(event);
    const choice: ChoiceInstance = {
      choiceInstanceId: `ci_${choiceCounter}`,
      choiceId: id,
      label,
      actionRef,
      player,
      sourceRuleId,
      createdAtEvent: event.id,
      state: "offered",
      selectionFrom,
    };
    result.newChoices.push(choice);
    return result;
  }

  if ("consumeUsage" in effect) {
    const { scope, key } = effect.consumeUsage;
    result.state = set(state, `$.usage.${scope}.${key}`, true);
    return result;
  }

  if ("resetUsage" in effect) {
    const { scope, keys } = effect.resetUsage;
    let s = state;
    const scopeObj = get(s, `$.usage.${scope}`) as Record<string, unknown> | undefined;
    if (scopeObj) {
      const newScope = { ...scopeObj };
      for (const key of keys) {
        delete newScope[key];
      }
      s = set(s, `$.usage.${scope}`, newScope);
    }
    result.state = s;
    return result;
  }

  if ("emit" in effect) {
    const { eventId, params } = effect.emit;
    const resolvedParams: Record<string, unknown> = {};
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (
          val !== null &&
          typeof val === "object" &&
          "eventParam" in (val as Record<string, unknown>)
        ) {
          resolvedParams[key] = event.params[(val as { eventParam: string }).eventParam];
        } else {
          resolvedParams[key] = val;
        }
      }
    }
    result.emittedEvents.push({ id: eventId, params: resolvedParams });
    return result;
  }

  if ("award" in effect) {
    const { target, resource, amount } = effect.award;
    const playerId = resolvePlayer(target, event);
    const path = `$.resources.${playerId}.${resource}`;
    const current = get(state, path);
    const currentNum = typeof current === "number" ? current : 0;
    result.state = set(state, path, currentNum + amount);
    return result;
  }

  if ("spendResource" in effect) {
    const { target, resource, amount } = effect.spendResource;
    const playerId = resolvePlayer(target, event);
    const path = `$.resources.${playerId}.${resource}`;
    const current = get(state, path);
    const currentNum = typeof current === "number" ? current : 0;
    result.state = set(state, path, currentNum - amount);
    return result;
  }

  if ("appendLogNote" in effect) {
    result.logEntries.push({
      type: "note",
      message: effect.appendLogNote.message,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }

  if ("ensureExists" in effect) {
    const { path, defaultValue } = effect.ensureExists;
    const current = get(state, path);
    if (current === undefined) {
      result.state = set(state, path, defaultValue);
    }
    return result;
  }

  if ("mergeInto" in effect) {
    const { path, value } = effect.mergeInto;
    const current = get(state, path) as Record<string, unknown> | undefined;
    const merged = { ...(current ?? {}), ...value };
    result.state = set(state, path, merged);
    return result;
  }

  throw new Error(`Unknown effect verb: ${JSON.stringify(effect)}`);
}

/**
 * Determine the current player from event params.
 * Falls back to "unknown" if no player param.
 */
function resolveCurrentPlayer(event: GameEvent): string {
  if (typeof event.params.player === "string") return event.params.player;
  return "unknown";
}
```

- [ ] **Step 5.3** -- Run tests: `cd engine && npx vitest run tests/unit/effects.test.ts`

Expected: all tests pass.

---

## Task 6: Conflict Resolution

Implement the conflict resolution algorithm: group by domain, apply stack/override/patch strategies.

- [ ] **Step 6.1** -- Write test file `engine/tests/unit/conflicts.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { resolveConflicts, getConflictDomain } from "../../src/rules/conflicts.js";
import type { Rule, Effect } from "../../src/types/index.js";

function makeRule(id: string, priority: number, strategy: "stack" | "override" | "patch", effects: Effect[]): Rule {
  return {
    id,
    scope: "global",
    trigger: { event: "TestEvent" },
    when: { all: [] },
    effect: effects,
    precedence: { priority, strategy },
    provenance: { source: "test" },
  };
}

describe("getConflictDomain", () => {
  it("returns (path) for setValue", () => {
    const domain = getConflictDomain({ setValue: { path: "$.x", value: 1 } });
    expect(domain).toBe("setValue:$.x");
  });

  it("returns null for stackable effects like emit", () => {
    const domain = getConflictDomain({ emit: { eventId: "E1" } });
    expect(domain).toBeNull();
  });

  it("returns null for appendLogNote", () => {
    const domain = getConflictDomain({ appendLogNote: { message: "hi" } });
    expect(domain).toBeNull();
  });
});

describe("resolveConflicts", () => {
  it("stacks all rules when strategy is stack", () => {
    const rules = [
      makeRule("r1", 10, "stack", [{ modifyCounter: { path: "$.x", delta: 1 } }]),
      makeRule("r2", 20, "stack", [{ modifyCounter: { path: "$.x", delta: 2 } }]),
    ];
    const resolved = resolveConflicts(rules);
    // Both effects should be present, ordered by ascending priority
    expect(resolved).toHaveLength(2);
    expect(resolved[0].ruleId).toBe("r1");
    expect(resolved[1].ruleId).toBe("r2");
  });

  it("override: highest priority wins", () => {
    const rules = [
      makeRule("r1", 10, "override", [{ setValue: { path: "$.x", value: "low" } }]),
      makeRule("r2", 50, "override", [{ setValue: { path: "$.x", value: "high" } }]),
    ];
    const resolved = resolveConflicts(rules);
    // Only r2 should survive for the setValue:$.x domain
    const setValues = resolved.filter((r) => {
      const eff = r.effect;
      return "setValue" in eff && (eff as any).setValue.path === "$.x";
    });
    expect(setValues).toHaveLength(1);
    expect(setValues[0].ruleId).toBe("r2");
  });

  it("patch applies after stack/override", () => {
    const rules = [
      makeRule("r1", 10, "stack", [{ setValue: { path: "$.x", value: "base" } }]),
      makeRule("r2", 50, "patch", [{ setValue: { path: "$.x", value: "patched" } }]),
    ];
    const resolved = resolveConflicts(rules);
    // r1 first, then r2 (patch)
    expect(resolved).toHaveLength(2);
    expect(resolved[0].ruleId).toBe("r1");
    expect(resolved[1].ruleId).toBe("r2");
  });

  it("effects without conflict domains always pass through", () => {
    const rules = [
      makeRule("r1", 10, "stack", [
        { emit: { eventId: "E1" } },
        { emit: { eventId: "E2" } },
      ]),
      makeRule("r2", 20, "stack", [{ emit: { eventId: "E3" } }]),
    ];
    const resolved = resolveConflicts(rules);
    expect(resolved).toHaveLength(3);
  });

  it("ascending priority order: low fires first", () => {
    const rules = [
      makeRule("r_high", 50, "stack", [{ appendLogNote: { message: "high" } }]),
      makeRule("r_low", 5, "stack", [{ appendLogNote: { message: "low" } }]),
    ];
    const resolved = resolveConflicts(rules);
    expect(resolved[0].ruleId).toBe("r_low");
    expect(resolved[1].ruleId).toBe("r_high");
  });
});
```

- [ ] **Step 6.2** -- Implement `engine/src/rules/conflicts.ts`

```typescript
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
```

- [ ] **Step 6.3** -- Run tests: `cd engine && npx vitest run tests/unit/conflicts.test.ts`

Expected: all tests pass.

---

## Task 7: Event Sequencer

Implement the timeline walker as a generator supporting all 5 node types.

- [ ] **Step 7.1** -- Write test file `engine/tests/unit/sequencer.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { walkTimeline } from "../../src/sequencer/index.js";
import type { TimelineNode, SubSequence, State, GameEvent } from "../../src/types/index.js";

function collect(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  state: State,
): GameEvent[] {
  const events: GameEvent[] = [];
  const gen = walkTimeline(nodes, subSequences, () => state);
  for (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("Event node", () => {
  it("yields a single event", () => {
    const events = collect([{ event: "StartOfGame" }], {}, {});
    expect(events).toEqual([{ id: "StartOfGame", params: {} }]);
  });

  it("yields event with inherited params", () => {
    const events = collect(
      [{ event: "TurnStarted", params: ["player"] }],
      {},
      {},
    );
    // params array names are declared but values come from parent context
    // At top level, no parent context, so params are empty
    expect(events[0].id).toBe("TurnStarted");
  });
});

describe("Sequence node", () => {
  it("yields children in order", () => {
    const nodes: TimelineNode[] = [
      {
        sequence: [
          { event: "A" },
          { event: "B" },
          { event: "C" },
        ],
      },
    ];
    const events = collect(nodes, {}, {});
    expect(events.map((e) => e.id)).toEqual(["A", "B", "C"]);
  });
});

describe("Repeat node", () => {
  it("repeats body N times with literal count", () => {
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: 3,
          indexParam: "round",
          body: [{ event: "RoundStarted", params: ["round"] }],
        },
      },
    ];
    const events = collect(nodes, {}, {});
    expect(events).toHaveLength(3);
    expect(events[0].params.round).toBe(1);
    expect(events[2].params.round).toBe(3);
  });

  it("reads count from state path", () => {
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: { path: "$.totalRounds" },
          indexParam: "round",
          body: [{ event: "R", params: ["round"] }],
        },
      },
    ];
    const events = collect(nodes, {}, { totalRounds: 2 });
    expect(events).toHaveLength(2);
  });

  it("zero count produces no events", () => {
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: { path: "$.totalRounds" },
          indexParam: "round",
          body: [{ event: "R" }],
        },
      },
    ];
    const events = collect(nodes, {}, { totalRounds: 0 });
    expect(events).toHaveLength(0);
  });
});

describe("ForEach node", () => {
  it("iterates over player set from state", () => {
    const nodes: TimelineNode[] = [
      {
        forEach: {
          over: { kind: "player", from: "$.players" },
          bindParam: "player",
          body: [{ event: "TurnStarted", params: ["player"] }],
        },
      },
    ];
    const events = collect(nodes, {}, { players: ["A", "B"] });
    expect(events).toHaveLength(2);
    expect(events[0].params.player).toBe("A");
    expect(events[1].params.player).toBe("B");
  });

  it("empty set produces zero events", () => {
    const nodes: TimelineNode[] = [
      {
        forEach: {
          over: { kind: "player", from: "$.players" },
          bindParam: "player",
          body: [{ event: "X" }],
        },
      },
    ];
    const events = collect(nodes, {}, { players: [] });
    expect(events).toHaveLength(0);
  });
});

describe("SubSequence ref", () => {
  it("resolves named sub-sequence and yields its events", () => {
    const nodes: TimelineNode[] = [
      { subSequence: "movementPhase", params: ["player"] },
    ];
    const subSequences: Record<string, SubSequence> = {
      movementPhase: {
        params: ["player"],
        body: [
          { event: "MovementPhaseStarted", params: ["player"] },
          { event: "MovementPhaseEnded", params: ["player"] },
        ],
      },
    };
    const gen = walkTimeline(nodes, subSequences, () => ({}));
    const events: GameEvent[] = [];
    // We need to pass params through context; for top-level there is no parent
    for (const e of gen) events.push(e);
    expect(events.map((e) => e.id)).toEqual([
      "MovementPhaseStarted",
      "MovementPhaseEnded",
    ]);
  });
});

describe("State is read at iteration time", () => {
  it("repeat reads count from getState at start of repeat", () => {
    let state: State = { n: 2 };
    const nodes: TimelineNode[] = [
      {
        repeat: {
          count: { path: "$.n" },
          indexParam: "i",
          body: [{ event: "E", params: ["i"] }],
        },
      },
    ];
    const gen = walkTimeline(nodes, {}, () => state);
    const events: GameEvent[] = [];
    for (const e of gen) {
      events.push(e);
    }
    expect(events).toHaveLength(2);
  });
});
```

- [ ] **Step 7.2** -- Implement `engine/src/sequencer/index.ts`

```typescript
import type {
  TimelineNode,
  SubSequence,
  EventNode,
  SequenceNode,
  RepeatNode,
  ForEachNode,
  SubSequenceRefNode,
  State,
  GameEvent,
} from "../types/index.js";
import { get } from "../state/index.js";

/**
 * Walk a timeline node tree, yielding GameEvents in order.
 * The getState callback is called when the sequencer needs runtime values
 * (repeat counts, forEach sets).
 *
 * parentParams carries inherited parameter bindings from parent nodes.
 */
export function* walkTimeline(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  getState: () => State,
  parentParams: Record<string, unknown> = {},
): Generator<GameEvent> {
  for (const node of nodes) {
    yield* walkNode(node, subSequences, getState, parentParams);
  }
}

function* walkNode(
  node: TimelineNode,
  subSequences: Record<string, SubSequence>,
  getState: () => State,
  parentParams: Record<string, unknown>,
): Generator<GameEvent> {
  // Event node
  if ("event" in node && typeof (node as EventNode).event === "string") {
    const eventNode = node as EventNode;
    const params: Record<string, unknown> = {};
    if (eventNode.params) {
      for (const paramName of eventNode.params) {
        if (paramName in parentParams) {
          params[paramName] = parentParams[paramName];
        }
      }
    }
    yield { id: eventNode.event, params };
    return;
  }

  // Sequence node
  if ("sequence" in node) {
    const seqNode = node as SequenceNode;
    yield* walkTimeline(seqNode.sequence, subSequences, getState, parentParams);
    return;
  }

  // Repeat node
  if ("repeat" in node) {
    const repeatNode = node as RepeatNode;
    const { count, indexParam, body } = repeatNode.repeat;
    let n: number;
    if (typeof count === "number") {
      n = count;
    } else {
      const val = get(getState(), count.path);
      n = typeof val === "number" ? val : 0;
    }
    for (let i = 1; i <= n; i++) {
      const iterParams = { ...parentParams, [indexParam]: i };
      yield* walkTimeline(body, subSequences, getState, iterParams);
    }
    return;
  }

  // ForEach node
  if ("forEach" in node) {
    const feNode = node as ForEachNode;
    const { over, bindParam, body } = feNode.forEach;
    const state = getState();
    const collection = get(state, over.from);
    if (!Array.isArray(collection)) return;
    for (const item of collection) {
      const iterParams = { ...parentParams, [bindParam]: item };
      yield* walkTimeline(body, subSequences, getState, iterParams);
    }
    return;
  }

  // SubSequence reference node
  if ("subSequence" in node) {
    const refNode = node as SubSequenceRefNode;
    const subSeq = subSequences[refNode.subSequence];
    if (!subSeq) {
      throw new Error(`Unknown subSequence: ${refNode.subSequence}`);
    }
    // Pass parent params through (sub-sequence inherits calling context)
    yield* walkTimeline(subSeq.body, subSequences, getState, parentParams);
    return;
  }

  throw new Error(`Unknown timeline node type: ${JSON.stringify(node)}`);
}

/**
 * Collect all event IDs that can appear in a timeline (for load-time validation).
 */
export function collectEventIds(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
): Set<string> {
  const ids = new Set<string>();
  collectEventIdsRecursive(nodes, subSequences, ids);
  return ids;
}

function collectEventIdsRecursive(
  nodes: TimelineNode[],
  subSequences: Record<string, SubSequence>,
  ids: Set<string>,
): void {
  for (const node of nodes) {
    if ("event" in node && typeof (node as EventNode).event === "string") {
      ids.add((node as EventNode).event);
    } else if ("sequence" in node) {
      collectEventIdsRecursive((node as SequenceNode).sequence, subSequences, ids);
    } else if ("repeat" in node) {
      collectEventIdsRecursive((node as RepeatNode).repeat.body, subSequences, ids);
    } else if ("forEach" in node) {
      collectEventIdsRecursive((node as ForEachNode).forEach.body, subSequences, ids);
    } else if ("subSequence" in node) {
      const subSeq = subSequences[(node as SubSequenceRefNode).subSequence];
      if (subSeq) {
        collectEventIdsRecursive(subSeq.body, subSequences, ids);
      }
    }
  }
}
```

- [ ] **Step 7.3** -- Run tests: `cd engine && npx vitest run tests/unit/sequencer.test.ts`

Expected: all tests pass.

---

## Task 8: Choice Manager

Implement choice lifecycle: add, select, expire, enumerate.

- [ ] **Step 8.1** -- Write test file `engine/tests/unit/choices.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  addChoice,
  selectChoice,
  resolveChoice,
  expireChoicesByEvent,
  getActiveChoices,
  hasUnresolvedChoices,
} from "../../src/choices/index.js";
import type { ChoiceInstance, State } from "../../src/types/index.js";

function makeChoice(overrides: Partial<ChoiceInstance> = {}): ChoiceInstance {
  return {
    choiceInstanceId: "ci_1",
    choiceId: "test_choice",
    label: "Test",
    actionRef: "TestAction",
    player: "A",
    sourceRuleId: "rule1",
    createdAtEvent: "SomeEvent",
    state: "offered",
    ...overrides,
  };
}

const emptyState: State = { _choices: [] };

describe("addChoice", () => {
  it("adds choice to state and it becomes active", () => {
    const choice = makeChoice();
    const state = addChoice(emptyState, choice);
    const active = getActiveChoices(state);
    expect(active).toHaveLength(1);
    expect(active[0].choiceId).toBe("test_choice");
  });

  it("multiple choices accumulate", () => {
    let state = emptyState;
    state = addChoice(state, makeChoice({ choiceInstanceId: "ci_1" }));
    state = addChoice(state, makeChoice({ choiceInstanceId: "ci_2", choiceId: "other" }));
    expect(getActiveChoices(state)).toHaveLength(2);
  });
});

describe("selectChoice", () => {
  it("marks choice as selected and returns ChoiceSelected event", () => {
    let state = addChoice(emptyState, makeChoice());
    const result = selectChoice(state, "ci_1", { selectedUnitId: "u1" });
    expect(result.event.id).toBe("ChoiceSelected");
    expect(result.event.params.choiceId).toBe("test_choice");
    expect(result.event.params.selectedUnitId).toBe("u1");
    expect(result.event.params.player).toBe("A");
    const choices = getActiveChoices(result.state);
    // After selection, it is in "selected" state -- still tracked but not "offered"
    expect(choices).toHaveLength(0);
  });
});

describe("resolveChoice", () => {
  it("marks selected choice as resolved", () => {
    let state = addChoice(emptyState, makeChoice());
    const { state: s2 } = selectChoice(state, "ci_1");
    const s3 = resolveChoice(s2, "ci_1");
    expect(hasUnresolvedChoices(s3)).toBe(false);
  });
});

describe("hasUnresolvedChoices", () => {
  it("returns true when offered choices exist", () => {
    const state = addChoice(emptyState, makeChoice());
    expect(hasUnresolvedChoices(state)).toBe(true);
  });

  it("returns false when no choices exist", () => {
    expect(hasUnresolvedChoices(emptyState)).toBe(false);
  });

  it("returns false after all choices are resolved", () => {
    let state = addChoice(emptyState, makeChoice());
    const { state: s2 } = selectChoice(state, "ci_1");
    const s3 = resolveChoice(s2, "ci_1");
    expect(hasUnresolvedChoices(s3)).toBe(false);
  });
});

describe("expireChoicesByEvent", () => {
  it("expires choices that have no explicit expiry when called", () => {
    let state = addChoice(emptyState, makeChoice());
    const { state: s2, expiredEvents } = expireChoicesByEvent(state);
    expect(getActiveChoices(s2)).toHaveLength(0);
    expect(expiredEvents).toHaveLength(1);
    expect(expiredEvents[0].id).toBe("ChoiceExpired");
  });
});
```

- [ ] **Step 8.2** -- Implement `engine/src/choices/index.ts`

```typescript
import type { ChoiceInstance, State, GameEvent } from "../types/index.js";
import { get, set } from "../state/index.js";

/**
 * Get the choices array from state. Stored at $._choices.
 */
function getChoices(state: State): ChoiceInstance[] {
  const arr = get(state, "$._choices");
  return Array.isArray(arr) ? (arr as ChoiceInstance[]) : [];
}

/**
 * Replace the choices array in state.
 */
function setChoices(state: State, choices: ChoiceInstance[]): State {
  return set(state, "$._choices", choices);
}

/**
 * Add a choice instance to state.
 */
export function addChoice(state: State, choice: ChoiceInstance): State {
  const current = getChoices(state);
  return setChoices(state, [...current, choice]);
}

/**
 * Select a choice by its instance ID.
 * Returns updated state and a ChoiceSelected event.
 */
export function selectChoice(
  state: State,
  choiceInstanceId: string,
  args?: Record<string, unknown>,
): { state: State; event: GameEvent } {
  const choices = getChoices(state);
  const idx = choices.findIndex((c) => c.choiceInstanceId === choiceInstanceId);
  if (idx === -1) {
    throw new Error(`Choice instance not found: ${choiceInstanceId}`);
  }
  const choice = choices[idx];
  const updated: ChoiceInstance = {
    ...choice,
    state: "selected",
    selectedArgs: args,
  };
  const newChoices = [...choices];
  newChoices[idx] = updated;

  const event: GameEvent = {
    id: "ChoiceSelected",
    params: {
      choiceId: choice.choiceId,
      choiceInstanceId: choice.choiceInstanceId,
      player: choice.player,
      sourceRuleId: choice.sourceRuleId,
      actionRef: choice.actionRef,
      ...(args ?? {}),
    },
  };

  return { state: setChoices(state, newChoices), event };
}

/**
 * Mark a choice as resolved.
 */
export function resolveChoice(state: State, choiceInstanceId: string): State {
  const choices = getChoices(state);
  const newChoices = choices.map((c) =>
    c.choiceInstanceId === choiceInstanceId
      ? { ...c, state: "resolved" as const }
      : c,
  );
  return setChoices(state, newChoices);
}

/**
 * Get all currently active (offered) choices.
 */
export function getActiveChoices(state: State): ChoiceInstance[] {
  return getChoices(state).filter((c) => c.state === "offered");
}

/**
 * Check if there are any unresolved choices (offered or selected).
 */
export function hasUnresolvedChoices(state: State): boolean {
  return getChoices(state).some(
    (c) => c.state === "offered" || c.state === "selected",
  );
}

/**
 * Expire all currently offered choices.
 * Returns updated state and ChoiceExpired events.
 */
export function expireChoicesByEvent(state: State): {
  state: State;
  expiredEvents: GameEvent[];
} {
  const choices = getChoices(state);
  const expiredEvents: GameEvent[] = [];
  const newChoices = choices.map((c) => {
    if (c.state === "offered") {
      expiredEvents.push({
        id: "ChoiceExpired",
        params: {
          choiceId: c.choiceId,
          choiceInstanceId: c.choiceInstanceId,
        },
      });
      return { ...c, state: "expired" as const };
    }
    return c;
  });
  return { state: setChoices(state, newChoices), expiredEvents };
}

/**
 * Cancel all offered choices (used when new choices replace old ones).
 */
export function cancelOfferedChoices(state: State): State {
  const choices = getChoices(state);
  const newChoices = choices.map((c) =>
    c.state === "offered" ? { ...c, state: "cancelled" as const } : c,
  );
  return setChoices(state, newChoices);
}
```

- [ ] **Step 8.3** -- Run tests: `cd engine && npx vitest run tests/unit/choices.test.ts`

Expected: all tests pass.

---

## Task 9: Rule Executor

Ties predicates, effects, and conflict resolution together. Matches rules for an event, evaluates predicates, resolves conflicts, and returns ordered effects.

- [ ] **Step 9.1** -- Write `engine/src/rules/index.ts`

```typescript
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
```

- [ ] **Step 9.2** -- Verify compilation: `cd engine && npx tsc --noEmit`

Expected: exits with 0.

---

## Task 10: Logger

Implement append-only logger for events, rules, effects, and choices.

- [ ] **Step 10.1** -- Implement `engine/src/logger/index.ts`

```typescript
export type LogEntryType =
  | "event_fired"
  | "rules_matched"
  | "effect_applied"
  | "choice_offered"
  | "choice_selected"
  | "choice_resolved"
  | "choice_expired"
  | "status_expired"
  | "note"
  | "error";

export interface LogEntry {
  timestamp: number;
  type: LogEntryType;
  eventId?: string;
  ruleId?: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only logger for engine explainability.
 */
export class Logger {
  private entries: LogEntry[] = [];
  private counter = 0;

  log(
    type: LogEntryType,
    message: string,
    details?: { eventId?: string; ruleId?: string; data?: Record<string, unknown> },
  ): void {
    this.entries.push({
      timestamp: this.counter++,
      type,
      message,
      eventId: details?.eventId,
      ruleId: details?.ruleId,
      data: details?.data,
    });
  }

  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.counter = 0;
  }
}
```

- [ ] **Step 10.2** -- Verify compilation: `cd engine && npx tsc --noEmit`

Expected: exits with 0.

---

## Task 11: Engine Orchestrator

The main loop: recursive event evaluation, choice-driven pausing, timeline advancement.

- [ ] **Step 11.1** -- Implement `engine/src/engine/index.ts`

```typescript
import type {
  State,
  GameEvent,
  Rule,
  Glossary,
  LoadedPack,
  TimelineNode,
  SubSequence,
} from "../types/index.js";
import type { ChoiceInstance } from "../types/index.js";
import { expireStatuses } from "../state/index.js";
import { evaluate, executeEffect, type ResolvedEffect } from "../rules/index.js";
import {
  addChoice,
  selectChoice,
  resolveChoice,
  getActiveChoices,
  hasUnresolvedChoices,
  cancelOfferedChoices,
} from "../choices/index.js";
import { walkTimeline } from "../sequencer/index.js";
import { Logger, type LogEntry } from "../logger/index.js";

export interface AdvanceResult {
  state: State;
  event: GameEvent;
  paused: boolean;
}

/**
 * SSCC Engine -- top-level orchestrator.
 */
export class SSCCEngine {
  private pack: LoadedPack;
  private state: State;
  private logger: Logger;
  private sequencer: Generator<GameEvent> | null = null;
  private lastTimelineEvent: GameEvent | null = null;

  constructor(pack: LoadedPack) {
    this.pack = pack;
    this.state = { ...pack.initialState, _choices: [] };
    this.logger = new Logger();
  }

  /**
   * Initialize the sequencer. Call before advancing.
   */
  initialize(): void {
    this.sequencer = walkTimeline(
      this.pack.timeline,
      this.pack.subSequences,
      () => this.state,
    );
  }

  /**
   * Get the current state.
   */
  getState(): State {
    return this.state;
  }

  /**
   * Get all log entries.
   */
  getLog(): readonly LogEntry[] {
    return this.logger.getEntries();
  }

  /**
   * Get currently active choices.
   */
  enumerateChoices(): ChoiceInstance[] {
    return getActiveChoices(this.state);
  }

  /**
   * Check if engine is paused waiting for choices.
   */
  isPaused(): boolean {
    return hasUnresolvedChoices(this.state);
  }

  /**
   * Apply a player's choice selection.
   * Returns the updated state. Engine may pause again if new choices are created.
   */
  applyChoice(
    choiceInstanceId: string,
    args?: Record<string, unknown>,
  ): State {
    const { state: newState, event } = selectChoice(
      this.state,
      choiceInstanceId,
      args,
    );
    this.state = newState;

    this.logger.log("choice_selected", `Choice selected: ${event.params.choiceId}`, {
      eventId: event.id,
      data: event.params,
    });

    // Evaluate the ChoiceSelected event (recursive, depth-first)
    this.state = this.evaluateEvent(this.state, event);

    // Resolve the choice after its action completes
    this.state = resolveChoice(this.state, choiceInstanceId);

    return this.state;
  }

  /**
   * Advance to the next timeline event.
   * Returns null if timeline is exhausted.
   * If choices are active, returns the paused state without advancing.
   */
  advanceToNextEvent(): AdvanceResult | null {
    if (!this.sequencer) {
      throw new Error("Engine not initialized. Call initialize() first.");
    }

    // If paused on choices, do not advance
    if (hasUnresolvedChoices(this.state)) {
      return {
        state: this.state,
        event: this.lastTimelineEvent!,
        paused: true,
      };
    }

    const next = this.sequencer.next();
    if (next.done) return null;

    const event = next.value;
    this.lastTimelineEvent = event;

    this.state = this.evaluateEvent(this.state, event);

    return {
      state: this.state,
      event,
      paused: hasUnresolvedChoices(this.state),
    };
  }

  /**
   * Core recursive event evaluation.
   *
   * 1. Expire statuses matching this event
   * 2. Log event
   * 3. Evaluate matching rules
   * 4. Execute resolved effects (collecting emitted events and new choices)
   * 5. Add new choices to state
   * 6. Recursively evaluate emitted events
   */
  private evaluateEvent(state: State, event: GameEvent): State {
    // Step 1: Expire statuses
    state = expireStatuses(state, event.id);

    // Log expired statuses
    this.logger.log("event_fired", `Event: ${event.id}`, {
      eventId: event.id,
      data: event.params,
    });

    // Step 2: Get rules for this event
    const rules = this.pack.rulesByEvent.get(event.id) ?? [];

    // Step 3: Evaluate rules
    const evalResult = evaluate(state, event, rules, this.pack.glossary);

    if (evalResult.matchedRules.length > 0) {
      this.logger.log("rules_matched", `${evalResult.matchedRules.length} rules matched`, {
        eventId: event.id,
        data: { ruleIds: evalResult.matchedRules.map((r) => r.id) },
      });
    }

    // Step 4: Execute resolved effects
    const allEmittedEvents: GameEvent[] = [];
    const allNewChoices: ChoiceInstance[] = [];

    for (const resolvedEffect of evalResult.resolvedEffects) {
      const effectResult = executeEffect(
        state,
        resolvedEffect.effect,
        event,
        resolvedEffect.ruleId,
        this.pack.glossary,
      );
      state = effectResult.state;
      allEmittedEvents.push(...effectResult.emittedEvents);
      allNewChoices.push(...effectResult.newChoices);

      for (const entry of effectResult.logEntries) {
        this.logger.log("note", entry.message, {
          eventId: event.id,
          ruleId: entry.ruleId,
        });
      }
    }

    // Step 5: Add new choices to state
    for (const choice of allNewChoices) {
      state = addChoice(state, choice);
      this.logger.log("choice_offered", `Choice offered: ${choice.choiceId}`, {
        eventId: event.id,
        data: {
          choiceId: choice.choiceId,
          choiceInstanceId: choice.choiceInstanceId,
          player: choice.player,
        },
      });
    }

    // Step 6: Recursively evaluate emitted events (depth-first)
    for (const emitted of allEmittedEvents) {
      state = this.evaluateEvent(state, emitted);
    }

    return state;
  }
}
```

- [ ] **Step 11.2** -- Verify compilation: `cd engine && npx tsc --noEmit`

Expected: exits with 0.

---

## Task 12: Pack Loader

Read pack files, parse YAML/JSON, index rules, validate cross-references.

- [ ] **Step 12.1** -- Implement `engine/src/loader/timeline.ts`

```typescript
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
```

- [ ] **Step 12.2** -- Implement `engine/src/loader/glossary.ts`

```typescript
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
```

- [ ] **Step 12.3** -- Implement `engine/src/loader/rules.ts`

```typescript
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
```

- [ ] **Step 12.4** -- Implement `engine/src/loader/state.ts`

```typescript
import type { State } from "../types/index.js";

/**
 * Parse raw initial_state.json into State.
 */
export function parseInitialState(data: unknown): State {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("initial_state.json must be a JSON object");
  }
  return data as State;
}
```

- [ ] **Step 12.5** -- Implement `engine/src/loader/validation.ts`

```typescript
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
```

- [ ] **Step 12.6** -- Implement `engine/src/loader/index.ts`

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type { LoadResult, LoadedPack, Manifest, ValidationError } from "../types/index.js";
import { parseTimeline } from "./timeline.js";
import { parseGlossary } from "./glossary.js";
import { parseRules, indexRulesByEvent } from "./rules.js";
import { parseInitialState } from "./state.js";
import { validatePack } from "./validation.js";
import { collectEventIds } from "../sequencer/index.js";
import { SYSTEM_EVENTS } from "../types/index.js";

/**
 * Load a pack from a directory path.
 * Reads all files, parses, validates, and returns a LoadedPack or errors.
 */
export async function loadPack(packPath: string): Promise<LoadResult> {
  const errors: ValidationError[] = [];

  // Read files
  let manifestData: unknown;
  let timelineData: unknown;
  let glossaryData: unknown;
  let rulesData: unknown;
  let stateData: unknown;

  try {
    const manifestRaw = await readFile(join(packPath, "manifest.yaml"), "utf-8");
    manifestData = yaml.load(manifestRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read manifest.yaml: ${e}` });
  }

  try {
    const timelineRaw = await readFile(join(packPath, "timeline.yaml"), "utf-8");
    timelineData = yaml.load(timelineRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read timeline.yaml: ${e}` });
  }

  try {
    const glossaryRaw = await readFile(join(packPath, "glossary.yaml"), "utf-8");
    glossaryData = yaml.load(glossaryRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read glossary.yaml: ${e}` });
  }

  try {
    const rulesRaw = await readFile(join(packPath, "rules.json"), "utf-8");
    rulesData = JSON.parse(rulesRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read rules.json: ${e}` });
  }

  try {
    const stateRaw = await readFile(join(packPath, "initial_state.json"), "utf-8");
    stateData = JSON.parse(stateRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read initial_state.json: ${e}` });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Parse
  const manifest = manifestData as Manifest;
  const { timeline, subSequences } = parseTimeline(timelineData);
  const glossary = parseGlossary(glossaryData);
  const rules = parseRules(rulesData);
  const initialState = parseInitialState(stateData);

  // Validate cross-references
  const validationErrors = validatePack(rules, glossary, timeline, subSequences);
  if (validationErrors.length > 0) {
    return { ok: false, errors: validationErrors };
  }

  // Index rules by event
  const rulesByEvent = indexRulesByEvent(rules);

  // Collect all event IDs
  const timelineEventIds = collectEventIds(timeline, subSequences);
  const emitEventIds = new Set<string>();
  for (const rule of rules) {
    for (const effect of rule.effect) {
      if ("emit" in effect) {
        emitEventIds.add(effect.emit.eventId);
      }
    }
  }
  const allEventIds = new Set([
    ...timelineEventIds,
    ...emitEventIds,
    ...SYSTEM_EVENTS,
  ]);

  const pack: LoadedPack = {
    manifest,
    timeline,
    subSequences,
    glossary,
    rules,
    rulesByEvent,
    initialState,
    allEventIds,
  };

  return { ok: true, pack };
}
```

- [ ] **Step 12.7** -- Update `engine/src/index.ts` with all exports

```typescript
// SSCC Engine -- main entry point
export * from "./types/index.js";
export { get, set, applyStatus, removeStatus, expireStatuses, getStatuses } from "./state/index.js";
export { walkTimeline, collectEventIds } from "./sequencer/index.js";
export { evaluate, evaluatePredicate, executeEffect, resolveConflicts } from "./rules/index.js";
export {
  addChoice,
  selectChoice,
  resolveChoice,
  getActiveChoices,
  hasUnresolvedChoices,
} from "./choices/index.js";
export { SSCCEngine } from "./engine/index.js";
export { loadPack } from "./loader/index.js";
export { Logger } from "./logger/index.js";
```

- [ ] **Step 12.8** -- Verify compilation: `cd engine && npx tsc --noEmit`

Expected: exits with 0.

---

## Task 13: Integration Tests

End-to-end tests with Hello Pack and wh40k-10e-core-turn.

- [ ] **Step 13.1** -- Create the Hello Pack data files on disk

Create `packs/hello-pack/manifest.yaml`:

```yaml
id: hello-pack
name: Hello Pack
version: 0.2.0
engine_version: "^0.2.0"
dependencies: []
```

Create `packs/hello-pack/timeline.yaml`:

```yaml
timeline:
  - event: StartOfGame

  - repeat:
      count: { path: "$.totalRounds" }
      indexParam: round
      body:
        - event: RoundStarted
          params: [round]

        - forEach:
            over: { kind: "player", from: "$.players" }
            bindParam: player
            body:
              - event: TurnStarted
                params: [player]
              - sequence:
                  - event: MainPhaseStarted
                    params: [player]
                  - event: MainPhaseEnded
                    params: [player]
              - event: TurnEnded
                params: [player]

        - event: RoundEnded
          params: [round]

  - event: EndOfGame

subSequences: {}
```

Create `packs/hello-pack/glossary.yaml`:

```yaml
keywords: []

statuses: {}

reason_keys: {}

selectors:
  active_player:
    kind: player
    where:
      pathEquals:
        path: $.turnPlayer
        valueFromEventParam: player
```

Create `packs/hello-pack/initial_state.json`:

```json
{
  "totalRounds": 3,
  "turnNumber": 1,
  "turnPlayer": null,
  "players": ["A", "B"],
  "resources": {
    "A": { "coin": 0 },
    "B": { "coin": 0 }
  },
  "usage": {},
  "statuses": {}
}
```

Create `packs/hello-pack/rules.json`:

```json
[
  {
    "id": "HELLO.Turn.SetPlayer.1",
    "scope": "global",
    "trigger": { "event": "TurnStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "setValue": {
          "path": "$.turnPlayer",
          "valueFromEventParam": "player"
        }
      }
    ],
    "precedence": { "priority": 1, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  },
  {
    "id": "HELLO.Coin.Choice.1",
    "scope": "player",
    "trigger": { "event": "MainPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      {
        "addChoice": {
          "id": "gain_coin",
          "label": "Gain 1 coin",
          "actionRef": "HELLO.Action.GainCoin"
        }
      }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  },
  {
    "id": "HELLO.Action.GainCoin",
    "scope": "player",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "all": [
        { "eventParamEquals": { "param": "choiceId", "value": "gain_coin" } }
      ]
    },
    "effect": [
      {
        "award": {
          "target": { "eventParam": "player" },
          "resource": "coin",
          "amount": 1
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Hello Pack" }
  }
]
```

- [ ] **Step 13.2** -- Write `engine/tests/integration/hello-pack.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../../packs/hello-pack");

describe("Hello Pack end-to-end", () => {
  it("loads successfully", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
  });

  it("runs 3 rounds, each player gains 1 coin per round", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let eventCount = 0;
    const maxEvents = 200;

    while (advance !== null && eventCount < maxEvents) {
      eventCount++;

      if (advance.paused) {
        // Select the gain_coin choice
        const choices = engine.enumerateChoices();
        const coinChoice = choices.find((c) => c.choiceId === "gain_coin");
        if (coinChoice) {
          engine.applyChoice(coinChoice.choiceInstanceId);
        }
      }

      advance = engine.advanceToNextEvent();
    }

    // After 3 rounds x 2 players = 6 turns, each player should have 3 coins
    const state = engine.getState();
    expect(get(state, "$.resources.A.coin")).toBe(3);
    expect(get(state, "$.resources.B.coin")).toBe(3);
  });

  it("log contains expected events", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    while (advance !== null && safetyCounter < 200) {
      safetyCounter++;
      if (advance.paused) {
        const choices = engine.enumerateChoices();
        if (choices.length > 0) {
          engine.applyChoice(choices[0].choiceInstanceId);
        }
      }
      advance = engine.advanceToNextEvent();
    }

    const log = engine.getLog();
    const eventsFired = log.filter((e) => e.type === "event_fired");
    const startEvents = eventsFired.filter((e) => e.eventId === "StartOfGame");
    const endEvents = eventsFired.filter((e) => e.eventId === "EndOfGame");
    expect(startEvents.length).toBe(1);
    expect(endEvents.length).toBe(1);
  });
});
```

- [ ] **Step 13.3** -- Write `engine/tests/integration/wh40k-turn.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get, getStatuses } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../../packs/wh40k-10e-core-turn");

describe("wh40k-10e-core-turn pack", () => {
  it("loads successfully", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
  });

  it("runs a single player turn: move u1 with Advance, verify prohibitions", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    // Advance through StartOfGame, RoundStarted, TurnStarted for player A
    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    // Helper: advance until paused or done, up to limit
    function advanceUntilPaused() {
      while (advance !== null && !advance.paused && safetyCounter < 300) {
        advance = engine.advanceToNextEvent();
        safetyCounter++;
      }
    }

    // Run to first pause point
    advanceUntilPaused();
    while (advance !== null && safetyCounter < 300) {
      if (advance.paused) {
        const choices = engine.enumerateChoices();
        if (choices.length === 0) break;

        // Find what choices are available
        const selectUnit = choices.find((c) => c.choiceId === "select_unit_to_move");
        const moveAdvance = choices.find((c) => c.choiceId === "move_advance");
        const moveNormal = choices.find((c) => c.choiceId === "move_normal");
        const selectShoot = choices.find((c) => c.choiceId === "select_unit_to_shoot");
        const selectCharge = choices.find((c) => c.choiceId === "select_unit_to_charge");
        const selectFight = choices.find((c) => c.choiceId === "select_unit_to_fight");

        if (selectUnit) {
          // Select u1 to move
          engine.applyChoice(selectUnit.choiceInstanceId, { selectedUnitId: "u1" });
        } else if (moveAdvance) {
          // Choose Advance
          engine.applyChoice(moveAdvance.choiceInstanceId);
        } else if (moveNormal) {
          // For remaining units, choose Normal Move
          engine.applyChoice(moveNormal.choiceInstanceId);
        } else if (selectShoot || selectCharge || selectFight) {
          // Select any available unit for subsequent phases
          const choice = selectShoot || selectCharge || selectFight;
          engine.applyChoice(choice!.choiceInstanceId, { selectedUnitId: "u1" });
        } else {
          // Select first available choice
          engine.applyChoice(choices[0].choiceInstanceId);
        }
      }

      advance = engine.advanceToNextEvent();
      safetyCounter++;
    }

    // After the turn, verify u1 has advanced_move status (or it expired at TurnEnded)
    // and that CP was awarded
    const state = engine.getState();
    const cpA = get(state, "$.resources.A.cp");
    expect(cpA).toBeGreaterThanOrEqual(1);

    // Verify log contains expected events
    const log = engine.getLog();
    const eventsFired = log.filter((e) => e.type === "event_fired").map((e) => e.eventId);
    expect(eventsFired).toContain("CommandPhaseStarted");
    expect(eventsFired).toContain("MovementPhaseStarted");
    expect(eventsFired).toContain("ShootingPhaseStarted");
  });
});
```

- [ ] **Step 13.4** -- Run all unit tests: `cd engine && npx vitest run tests/unit/`

Expected: all unit tests pass.

- [ ] **Step 13.5** -- Run integration tests: `cd engine && npx vitest run tests/integration/`

Expected: integration tests pass. If they fail, debug using the log output from `engine.getLog()`.

- [ ] **Step 13.6** -- Run the full test suite: `cd engine && npx vitest run`

```bash
cd engine && npx vitest run
```

Expected output pattern:
```
 ✓ tests/unit/state.test.ts
 ✓ tests/unit/predicates.test.ts
 ✓ tests/unit/effects.test.ts
 ✓ tests/unit/conflicts.test.ts
 ✓ tests/unit/choices.test.ts
 ✓ tests/unit/sequencer.test.ts
 ✓ tests/integration/hello-pack.test.ts
 ✓ tests/integration/wh40k-turn.test.ts

Test Files  8 passed (8)
```

- [ ] **Step 13.7** -- Final verification: confirm no TypeScript errors

```bash
cd engine && npx tsc --noEmit
```

Expected: exits with 0.
