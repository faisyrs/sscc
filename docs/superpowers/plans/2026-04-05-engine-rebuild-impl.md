# SSCC Engine Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the SSCC engine from scratch to match the evaluation model in `docs/sscc-engine-evaluation-model.md`, with a working Wh40k core rules pack covering all game phases.

**Architecture:** YAML-based pack loader feeds a rule loop engine. The engine walks sequences, evaluates conditions against state, fires effects one rule at a time with player ordering. CLI provides interactive play. Pack files use `.rules` and `.army` extensions (YAML under the hood).

**Tech Stack:** TypeScript, Vitest, js-yaml, Node.js (ES2022 modules)

**Key References:**
- Engine spec: `docs/sscc-engine-evaluation-model.md`
- Design spec: `docs/superpowers/specs/2026-04-04-engine-rebuild-design.md`
- Example pack (old format, for game logic reference): `docs/examples/wh40k-10e/`

---

## File Structure

```text
engine/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    types.ts              # All type definitions
    state.ts              # State read/write/path resolution, expiration
    rng.ts                # Seeded PRNG (Mulberry32)
    loader.ts             # YAML file parsing, classification, merging
    sequencer.ts          # Sequence walking, event processing
    conditions.ts         # Condition evaluation (is/on/all/any/not/path/selector)
    effects.ts            # Effect execution (set/unset/sequence/test/setSeed/log)
    derived.ts            # Derived state evaluation
    rule-loop.ts          # The core rule loop
    engine.ts             # Top-level SSCCEngine class (orchestrator)
    index.ts              # Public API exports
  tests/
    state.test.ts
    rng.test.ts
    loader.test.ts
    sequencer.test.ts
    conditions.test.ts
    effects.test.ts
    derived.test.ts
    rule-loop.test.ts
    engine.test.ts
cli/
  package.json
  tsconfig.json
  src/
    index.ts              # CLI entry point, argument parsing
    game-loop.ts          # Interactive game loop (readline)
    renderer.ts           # State/choice display formatting
  tests/
    renderer.test.ts
packs/
  wh40k-10e/
    core.rules            # Timeline, objects, macros, derived, includes
    rules/
      turn-entry.rules
      command-phase.rules
      battleshock.rules
      movement-phase.rules
      shooting-phase.rules
      charge-phase.rules
      fight-phase.rules
      stratagems.rules
    orks/
      ork-army.rules
      units/
        boyz.rules
        warboss.rules
    space-marines/
      sm-army.rules
      units/
        intercessors.rules
        captain.rules
    games/
      test-game-orks.army
      test-game-sm.army
```

---

## Phase 1: Scaffold and Core Types

**Commit message:** `feat: scaffold engine project with core types`

### Task 1.1: Delete old directories and scaffold project

**Files:**
- Delete: `spec/`, `engine/`, `cli/`, `packs/`
- Create: `engine/package.json`, `engine/tsconfig.json`, `engine/vitest.config.ts`

- [ ] **Step 1: Delete old directories**

```bash
rm -rf spec/ engine/ cli/ packs/
```

- [ ] **Step 2: Create engine/package.json**

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
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 3: Create engine/tsconfig.json**

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

- [ ] **Step 4: Create engine/vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Install dependencies**

```bash
cd engine && npm install
```

- [ ] **Step 6: Verify setup compiles**

Create a minimal `engine/src/index.ts` with `export {}` and run `npx tsc --noEmit`.

### Task 1.2: Core type definitions

**Files:**
- Create: `engine/src/types.ts`

All types for the engine in one file. These are the data structures the loader produces and the engine consumes.

- [ ] **Step 1: Write types.ts**

```ts
// ---- State ----
export type State = Record<string, unknown>;

// ---- Sequences ----
export interface EventStep {
  event: true; // literal marker
}

export interface SequenceRefStep {
  sequence: string;
}

export interface RepeatStep {
  ref: string;     // sequence name
  repeat: number;
}

export type SequenceStep = string | EventStep | SequenceRefStep | RepeatStep;

// A named sequence is an ordered list of steps
export type SequenceMap = Map<string, SequenceStep[]>;

// ---- Conditions ----
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
  object: string;       // object type name (e.g., "unit")
  where?: Condition;    // filter condition using $entity
  id?: string;          // named selector reference
}

// ---- Effects ----
export type SetValue =
  | { value: unknown }
  | { add: number }
  | { path: string }
  | { random: { min: number; max: number } };

export interface SetEffect {
  set: string;                    // state path or flag name
  value?: unknown;                // literal value, or object with add/path/random
  expiresOn?: string;             // event name that triggers expiry
  valueFromChoice?: string;       // player selects from matched objects
}

export interface UnsetEffect {
  unset: string | {
    key: string;
    target: SelectorDef;
  };
}

export interface SequenceEffect {
  sequence: string | string[];    // named sub-sequence or inline event list
}

export interface TestEffect {
  test: {
    roll?: { count: number; sides: number };
    usePool?: string;
    compare: 'gte' | 'lte' | 'eq';
    target: { derived?: string; unit?: { path: string }; value?: number; path?: string };
    pass: Effect[];
    fail: Effect[];
  };
}

export interface SetSeedEffect {
  setSeed: number;
}

export interface AppendLogNoteEffect {
  appendLogNote: string;
}

export type Effect =
  | SetEffect
  | UnsetEffect
  | SequenceEffect
  | TestEffect
  | SetSeedEffect
  | AppendLogNoteEffect;

// ---- Rules ----
export interface Rule {
  id: string;
  when: Condition;
  effect: Effect[];
  label?: string;
  choice?: string;            // player path — presence makes rule optional
  costs?: Record<string, number>;  // resource costs (e.g., { cp: 1 })
  provenance?: Record<string, string>;
}

// ---- Objects ----
// Maps object type name to state path pattern (e.g., "unit" -> "$.players.*.units")
export type ObjectMap = Map<string, string>;

// ---- Macros ----
export interface MacroDef {
  params: string[];
  expands: {
    repeat?: string;
    as?: string;
    effects: Effect[];
  };
}
export type MacroMap = Map<string, MacroDef>;

// ---- Derived State ----
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

// ---- Templates ----
export interface TemplateDef {
  template: string;            // object type
  params: string[];
  state: {
    path: string;              // with {param} placeholders
    value: unknown;
  };
}
export type TemplateMap = Map<string, TemplateDef>;

// ---- Named Selectors (from glossary) ----
export type SelectorMap = Map<string, SelectorDef>;

// ---- Loaded Pack (output of loader) ----
export interface LoadedPack {
  sequences: SequenceMap;
  rules: Rule[];
  objects: ObjectMap;
  macros: MacroMap;
  derived: DerivedStateMap;
  templates: TemplateMap;
  selectors: SelectorMap;
  initialState: State;
  ruleIndex: Map<string, Rule[]>;  // event name -> rules that reference it
}

// ---- Engine types ----
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

// ---- Army file ----
export interface ArmyUnit {
  template: string;
  bind: Record<string, string>;
}

export interface ArmyFile {
  include: string[];
  units: ArmyUnit[];
}

// ---- Player interaction callback ----
export type PlayerChoiceFn = (
  options: MatchedRule[],
  canPass: boolean,
  state: State,
) => Promise<RuleLoopChoice>;
```

- [ ] **Step 2: Create engine/src/index.ts**

```ts
export * from './types.js';
```

- [ ] **Step 3: Verify types compile**

```bash
cd engine && npx tsc --noEmit
```

---

## Phase 2: State Management and RNG

**Commit message:** `feat: add state management and seeded RNG`

### Task 2.1: State module

**Files:**
- Create: `engine/src/state.ts`
- Create: `engine/tests/state.test.ts`

The state module provides path-based get/set/unset on a plain object tree, plus flag expiration. All operations return new state (immutable).

- [ ] **Step 1: Write state.test.ts**

Test cases:
- `getPath(state, "$.foo.bar")` returns nested value
- `getPath` with wildcard `"$.players.*.units"` returns all matching entries
- `getPath` returns `undefined` for missing path
- `setPath(state, "$.foo.bar", 42)` creates nested structure and sets value
- `setPath` with `{ add: 1 }` increments numeric value
- `setPath` with `{ path: "$.other" }` copies from another path
- `unsetPath(state, "$.foo.bar")` removes the key
- `setFlag(state, "commandPhase")` sets `$.flags.commandPhase = true`
- `unsetFlag(state, "commandPhase")` removes the flag
- `hasFlag(state, "commandPhase")` returns boolean
- `setWithExpiry(state, "myFlag", "endOfPhase")` stores flag + expiry metadata
- `expireFlags(state, "endOfPhase")` removes all flags whose expiresOn matches
- Immutability: original state not modified by any operation

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd engine && npx vitest run tests/state.test.ts
```

- [ ] **Step 3: Implement state.ts**

Key functions:
- `getPath(state: State, path: string): unknown` — resolve `$.` paths, support `*` wildcard
- `setPath(state: State, path: string, value: unknown): State` — deep clone + set
- `unsetPath(state: State, path: string): State` — deep clone + delete
- `hasFlag(state: State, name: string): boolean` — check `$.flags.<name>`
- `setFlag(state: State, name: string, expiresOn?: string): State`
- `unsetFlag(state: State, name: string): State`
- `expireFlags(state: State, eventName: string): State` — remove all flags with matching expiresOn
- `deepClone(state: State): State` — structured clone
- `resolveValue(state: State, valueDef: unknown): unknown` — handle `{ add }`, `{ path }`, `{ random }` value types

Path resolution rules:
- `$.` prefix means root of state tree, strip it for property access
- Dot-separated segments (e.g., `$.players.p1.cp` → `state.players.p1.cp`)
- `*` wildcard matches all keys at that level, returns array of results
- Short flag names without `$.` prefix mean `$.flags.<name>` (for `is`/`on` conditions)

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Verify types compile**

### Task 2.2: Seeded RNG

**Files:**
- Create: `engine/src/rng.ts`
- Create: `engine/tests/rng.test.ts`

Mulberry32 PRNG with state capture/restore for undo.

- [ ] **Step 1: Write rng.test.ts**

Test cases:
- Same seed produces same sequence
- Different seeds produce different sequences
- `rollDie(sides)` returns value in range [1, sides]
- `getState()` / `setState()` enables save/restore for undo
- Distribution is reasonable over 1000 rolls (not all the same value)

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement rng.ts**

```ts
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  rollDie(sides: number): number {
    return Math.floor(this.next() * sides) + 1;
  }

  getState(): number { return this.state; }
  setState(s: number): void { this.state = s; }
}
```

- [ ] **Step 4: Run tests, verify they pass**

---

## Phase 3: YAML Loader

**Commit message:** `feat: add YAML pack loader with file classification`

### Task 3.1: Loader — parse and classify .rules files

**Files:**
- Create: `engine/src/loader.ts`
- Create: `engine/tests/loader.test.ts`
- Create: `engine/tests/fixtures/` (test .rules and .army files)

The loader reads YAML files, classifies top-level keys by the rules in the design spec, follows includes, merges definitions, expands templates, and indexes rules.

- [ ] **Step 1: Create test fixtures**

Create `engine/tests/fixtures/simple.rules`:
```yaml
# Simple test pack with one sequence and one rule
startOfGame:
  - event

game:
  - startOfGame

CORE.TestRule:
  when:
    on: startOfGame
  effect:
    - set: "$.testFlag"
      value: true
  label: "Test rule"
```

Create `engine/tests/fixtures/with-include.rules`:
```yaml
include:
  - included.rules

game:
  - startOfGame
  - endOfGame

endOfGame:
  - event
```

Create `engine/tests/fixtures/included.rules`:
```yaml
startOfGame:
  - event

INCLUDED.Rule:
  when:
    on: startOfGame
  effect:
    - set: "$.included"
      value: true
  label: "Included rule"
```

Create `engine/tests/fixtures/with-objects.rules`:
```yaml
objects:
  player: "$.players"
  unit: "$.players.*.units"

game:
  - event
```

Create `engine/tests/fixtures/with-template.rules`:
```yaml
objects:
  unit: "$.players.*.units"

testUnit:
  template: unit
  params: [owner, id]
  state:
    path: "$.players.{owner}.units.{id}"
    value:
      name: "Test Unit"
      stats: { M: 6, T: 4, Sv: 3 }
      keywords: [INFANTRY]
```

Create `engine/tests/fixtures/simple.army`:
```yaml
include:
  - with-template.rules

units:
  - template: testUnit
    bind: { owner: player1, id: unit_1 }
  - template: testUnit
    bind: { owner: player1, id: unit_2 }
```

- [ ] **Step 2: Write loader.test.ts**

Test cases:
- `parseRulesFile("simple.rules")` extracts 1 sequence (`game`), 1 event (`startOfGame`), 1 rule
- Classification: list value → sequence, mapping with `when` → rule, mapping with `template` → template
- Reserved keys: `include`, `objects`, `macros`, `derived` recognized correctly
- Include resolution: `with-include.rules` loads `included.rules`, merges definitions
- Circular include detection: throws error
- Duplicate rule ID detection: throws error
- Object parsing: `with-objects.rules` produces correct ObjectMap
- Template parsing: `with-template.rules` produces correct TemplateMap
- Army file parsing: `simple.army` produces ArmyFile with includes and units
- Template expansion: army units get stamped into state correctly
- Rule indexing: rules indexed by their `on`/`is` event references

- [ ] **Step 3: Run tests, verify they fail**

- [ ] **Step 4: Implement loader.ts**

Key functions:
- `loadPack(coreRulesPath: string, armyPaths: string[]): Promise<LoadedPack>` — main entry
- `parseRulesFile(filePath: string): ParsedFile` — read YAML, classify top-level keys
- `classifyKey(key: string, value: unknown): Classification` — determine if sequence/rule/template/reserved
- `resolveIncludes(file: ParsedFile, basePath: string, visited: Set<string>): void` — depth-first include
- `mergeDefinitions(files: ParsedFile[]): MergedDefs` — combine all definitions, detect duplicates
- `expandTemplates(templates: TemplateMap, armyUnits: ArmyUnit[], objects: ObjectMap): State` — stamp into state
- `indexRules(rules: Rule[]): Map<string, Rule[]>` — index by `on`/`is` keys in conditions
- `parseArmyFile(filePath: string): ArmyFile` — read army YAML

Classification logic (from design spec):
```ts
function classifyKey(key: string, value: unknown): string {
  if (['include', 'objects', 'macros', 'derived', 'selectors', 'keywords'].includes(key)) return key;
  if (Array.isArray(value)) return 'sequence';
  if (typeof value === 'object' && value !== null) {
    if ('when' in value) return 'rule';
    if ('template' in value) return 'template';
  }
  throw new Error(`Cannot classify top-level key: ${key}`);
}
```

- [ ] **Step 5: Run tests, verify they pass**

---

## Phase 4: Sequencer

**Commit message:** `feat: add sequence walker and event processing`

### Task 4.1: Sequencer

**Files:**
- Create: `engine/src/sequencer.ts`
- Create: `engine/tests/sequencer.test.ts`

The sequencer walks sequence definitions, resolving references, handling repeats, and yielding events. It does NOT run the rule loop — it just produces the stream of event names.

- [ ] **Step 1: Write sequencer.test.ts**

Test cases:
- Simple sequence: `game: [- event]` yields `["game"]`
- Nested reference: `game: [- startOfGame]` where `startOfGame: [- event]` yields `["startOfGame"]`
- Multi-step: `game: [- a, - b]` with events yields `["a", "b"]`
- Repeat: `game: [- round: { repeat: 3 }]` with `round: [- event]` yields `["round", "round", "round"]`
- Deep nesting: game → battleRound → attackerTurn → commandPhase(event)
- Sequence reference: `{ sequence: X }` resolves correctly
- Unknown reference: throws error
- `enterSubSequence(name)` pushes onto sequence stack, yields events, pops back

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement sequencer.ts**

The sequencer is a generator that maintains a stack of active sequences. The engine calls it to get the next event, and can push sub-sequences onto the stack (when a rule's effect enters a sub-sequence).

```ts
export class Sequencer {
  private sequences: SequenceMap;
  private stack: { steps: SequenceStep[]; index: number }[];

  constructor(sequences: SequenceMap, entryPoint: string) {
    // Find the entry sequence and push it onto the stack
  }

  // Get the next event name, or null if done
  nextEvent(): string | null {
    // Walk current stack frame, resolve references, handle repeats
    // When a step is 'event', return the parent sequence name as event
    // When a step is a reference, push new frame
    // When frame exhausted, pop stack
  }

  // Push a sub-sequence onto the stack (called by effect executor)
  enterSubSequence(name: string): void {
    // Look up sequence, push new frame
  }
}
```

Key detail: when a step is the literal string `"event"`, the event name is the **name of the sequence containing it**. So if `commandPhase: [- event]`, the event name is `"commandPhase"`.

- [ ] **Step 4: Run tests, verify they pass**

---

## Phase 5: Conditions and Effects

**Commit message:** `feat: add condition evaluator and effect executor`

### Task 5.1: Condition evaluator

**Files:**
- Create: `engine/src/conditions.ts`
- Create: `engine/tests/conditions.test.ts`

- [ ] **Step 1: Write conditions.test.ts**

Test cases for each condition type:
- `is`: `{ is: "commandPhase" }` → true when flag set, false when not
- `on`: `{ on: "commandPhase" }` → true when flag was just set AND rule hasn't fired
- `all`: all children must be true
- `any`: at least one child true
- `not`: inverts child
- `pathEquals`: `{ pathEquals: { path: "$.turnPlayer.cp", value: 5 } }` → matches
- `pathEquals` with `{ value: { path: "$.other" } }` → compares two paths
- `pathAtLeast`: `{ pathAtLeast: { path: "$.cp", value: 3 } }` → true when >= 3
- `pathAtLeastPath`: compares two state paths
- `pathMissing`: true when path doesn't exist
- `pathIn`: value is in set
- `selector`: returns true when at least one object matches
- `selector` with `$entity` substitution in where clause
- `tagPresent`: checks keywords array on object
- `playerChoice`: always evaluates to true (signals optionality, checked separately)
- `manual`: always evaluates to true (asked at selection time)
- Nested composition: `{ all: [{ is: "X" }, { not: { pathMissing: "$.Y" } }] }`

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement conditions.ts**

```ts
export interface EvalContext {
  state: State;
  objects: ObjectMap;
  selectors: SelectorMap;
  firedOnRules: Set<string>;     // rules that have fired 'on' this event
  currentEvent: string;          // the event that triggered step 1
  entityPath?: string;           // set during selector evaluation ($entity)
}

export function evaluateCondition(condition: Condition, ctx: EvalContext): boolean {
  // Pattern-match on condition type and evaluate
}

// Returns true if the rule's condition tree contains a playerChoice node
export function isOptionalRule(rule: Rule): boolean { ... }

// Returns the player path from a playerChoice condition, or null
export function getChoicePlayer(rule: Rule): string | null { ... }

// Extracts all 'on' and 'is' event references from a condition tree
export function extractEventRefs(condition: Condition): { on: string[]; is: string[] } { ... }
```

Selector evaluation:
1. Look up object type in ObjectMap to get path pattern
2. Enumerate all instances matching the pattern (using `getPath` with wildcards)
3. For each instance, set `ctx.entityPath` to that instance's path
4. Evaluate the `where` condition with `$entity` replaced by the instance path
5. Return true if any instance matches

- [ ] **Step 4: Run tests, verify they pass**

### Task 5.2: Effect executor

**Files:**
- Create: `engine/src/effects.ts`
- Create: `engine/tests/effects.test.ts`

- [ ] **Step 1: Write effects.test.ts**

Test cases:
- `set` with literal value: sets path in state
- `set` with `{ add: N }`: increments numeric value
- `set` with `{ path: "$.other" }`: copies from another path
- `set` with `expiresOn`: stores expiry metadata
- `set` flag (short path without `$.`): sets `$.flags.<name>`
- `unset` simple path: removes from state
- `unset` with selector: bulk removes matching key from all matching objects
- `sequence`: returns sequence name for sequencer to enter
- `test` with `roll`: rolls dice, compares to target, executes pass/fail branch
- `test` with `usePool`: reads existing pool, compares sum
- `test` with derived target: evaluates derived state
- `setSeed`: updates RNG seed
- `appendLogNote`: adds to log

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement effects.ts**

```ts
export interface EffectResult {
  state: State;
  enterSequence?: string | string[];  // sub-sequence to enter
  logEntries: LogEntry[];
}

export interface EffectContext {
  state: State;
  rng: SeededRNG;
  objects: ObjectMap;
  selectors: SelectorMap;
  derived: DerivedStateMap;
  sequencer: Sequencer;
  log: LogEntry[];
}

export function executeEffect(effect: Effect, ctx: EffectContext): EffectResult {
  if ('set' in effect) return executeSet(effect as SetEffect, ctx);
  if ('unset' in effect) return executeUnset(effect as UnsetEffect, ctx);
  if ('sequence' in effect) return executeSequence(effect as SequenceEffect, ctx);
  if ('test' in effect) return executeTest(effect as TestEffect, ctx);
  if ('setSeed' in effect) return executeSetSeed(effect as SetSeedEffect, ctx);
  if ('appendLogNote' in effect) return executeAppendLogNote(effect as AppendLogNoteEffect, ctx);
  throw new Error(`Unknown effect type: ${JSON.stringify(effect)}`);
}

export function executeEffects(effects: Effect[], ctx: EffectContext): EffectResult {
  // Execute effects in order, threading state through
  // If any effect returns enterSequence, the sequencer enters it
  // Returns combined result
}
```

- [ ] **Step 4: Run tests, verify they pass**

---

## Phase 6: Rule Loop and Engine

**Commit message:** `feat: add rule loop, undo, and engine orchestrator`

### Task 6.1: Rule loop

**Files:**
- Create: `engine/src/rule-loop.ts`
- Create: `engine/tests/rule-loop.test.ts`

- [ ] **Step 1: Write rule-loop.test.ts**

Test cases:
- No matching rules → returns immediately (no-op event)
- Single mandatory rule, no choices → auto-resolved
- Multiple mandatory rules → calls playerChoiceFn
- Optional rules only → pass is available
- Mandatory + optional → no pass, all presented
- `on` rule fires once per event, even if re-evaluated
- `is` rule fires repeatedly while condition matches
- Cost checking: optional rule with insufficient resources not presented
- Cost deduction: costs deducted when optional rule selected
- Effects that enter sub-sequence: sequencer handles it
- Rule loop terminates when no more rules match

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement rule-loop.ts**

```ts
export interface RuleLoopContext {
  state: State;
  rules: Rule[];
  ruleIndex: Map<string, Rule[]>;
  objects: ObjectMap;
  selectors: SelectorMap;
  derived: DerivedStateMap;
  rng: SeededRNG;
  sequencer: Sequencer;
  log: LogEntry[];
  playerChoice: PlayerChoiceFn;
  firedOnRules: Set<string>;
  currentEvent: string;
}

export async function runRuleLoop(ctx: RuleLoopContext): Promise<State> {
  // Implementation of the rule loop from the evaluation model spec:
  // 1. Find all matching rules (mandatory and optional)
  //    - Use ruleIndex to get candidate rules for current event
  //    - Evaluate each rule's condition tree
  //    - Separate into mandatory and optional (has playerChoice)
  //    - Filter optional by cost affordability
  // 2. If nothing matches, return state
  // 3. If one mandatory, no optional → auto-resolve
  // 4. Otherwise → call playerChoiceFn
  // 5. Deduct costs
  // 6. Execute effects
  // 7. If effect entered sub-sequence, process it (recursive)
  // 8. Go to step 1
}

function findMatchingRules(ctx: RuleLoopContext): { mandatory: Rule[]; optional: Rule[] } {
  // Get candidate rules from index
  // Evaluate conditions
  // Separate by playerChoice presence
  // Filter optional by affordability
}

function canAfford(state: State, costs: Record<string, number>): boolean {
  // Check each cost path has sufficient value
}

function deductCosts(state: State, costs: Record<string, number>): State {
  // Subtract each cost from state
}
```

- [ ] **Step 4: Run tests, verify they pass**

### Task 6.2: Derived state evaluator

**Files:**
- Create: `engine/src/derived.ts`
- Create: `engine/tests/derived.test.ts`

- [ ] **Step 1: Write derived.test.ts**

Test cases:
- Base value only (no modifiers): returns base
- Base + one modifier: returns sum
- Base + multiple modifiers: returns sum of all
- Clamp: base 7, modifier +3, clamp { min: -1, max: +1 } → result 8 (capped)
- Clamp: base 7, modifier -5, clamp { min: -1, max: +1 } → result 6 (capped)
- No clamp: modifier applied without limit
- Wildcard modifier matching: `$.unit.CurrentX.modifier*` finds all modifier entries

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement derived.ts**

```ts
export function evaluateDerived(
  name: string,
  definitions: DerivedStateMap,
  state: State,
  unitPath?: string,
): number {
  const def = definitions.get(name);
  if (!def) throw new Error(`Unknown derived state: ${name}`);

  // Resolve base path (substitute unit path if provided)
  const basePath = unitPath ? def.base.path.replace('$.selectedUnit', unitPath) : def.base.path;
  const base = getPath(state, basePath) as number;

  // Find all modifiers matching the glob pattern
  const modPattern = unitPath ? def.modifiers.match.replace('$.selectedUnit', unitPath) : def.modifiers.match;
  const modifiers = getPath(state, modPattern) as number[] ?? [];

  // Aggregate
  let total: number;
  switch (def.aggregate) {
    case 'sum': total = base + modifiers.reduce((a, b) => a + b, 0); break;
    case 'min': total = Math.min(base, ...modifiers); break;
    case 'max': total = Math.max(base, ...modifiers); break;
  }

  // Clamp
  if (def.clamp) {
    if (def.clamp.min) total = Math.max(total, base + def.clamp.min.offset);
    if (def.clamp.max) total = Math.min(total, base + def.clamp.max.offset);
  }

  return total;
}
```

- [ ] **Step 4: Run tests, verify they pass**

### Task 6.3: Engine orchestrator

**Files:**
- Create: `engine/src/engine.ts`
- Create: `engine/tests/engine.test.ts`

- [ ] **Step 1: Write engine.test.ts**

Integration tests using a simple in-memory pack:
- Engine loads pack with one sequence and one rule
- `advanceToNextEvent()` processes the event (sets flag, runs rule loop, unsets flag)
- Rule fires and modifies state
- `on` rule fires once even across re-evaluations
- `is` rule fires repeatedly until condition changes
- Sub-sequence entry and return
- Undo: restores state to before last rule
- Full command phase walkthrough (from spec example) with mock playerChoice

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement engine.ts**

```ts
export class SSCCEngine {
  private state: State;
  private pack: LoadedPack;
  private rng: SeededRNG;
  private sequencer: Sequencer;
  private log: LogEntry[];
  private snapshots: Snapshot[];
  private playerChoice: PlayerChoiceFn;

  constructor(pack: LoadedPack, playerChoice: PlayerChoiceFn, seed?: number) {
    this.pack = pack;
    this.state = deepClone(pack.initialState);
    this.rng = new SeededRNG(seed ?? Date.now());
    this.sequencer = new Sequencer(pack.sequences, 'game');
    this.log = [];
    this.snapshots = [];
    this.playerChoice = playerChoice;
  }

  async advanceToNextEvent(): Promise<{ event: string; state: State } | null> {
    const eventName = this.sequencer.nextEvent();
    if (!eventName) return null;

    // Step 1: Set event flag, expire matching flags
    this.state = expireFlags(this.state, eventName);
    this.state = setFlag(this.state, eventName);

    // Step 2: Run rule loop
    const firedOnRules = new Set<string>();
    this.state = await runRuleLoop({
      state: this.state,
      rules: this.pack.rules,
      ruleIndex: this.pack.ruleIndex,
      objects: this.pack.objects,
      selectors: this.pack.selectors,
      derived: this.pack.derived,
      rng: this.rng,
      sequencer: this.sequencer,
      log: this.log,
      playerChoice: this.playerChoice,
      firedOnRules,
      currentEvent: eventName,
    });

    // Step 3: Unset event flag
    this.state = unsetFlag(this.state, eventName);

    return { event: eventName, state: this.state };
  }

  undo(): State | null {
    const snapshot = this.snapshots.pop();
    if (!snapshot) return null;
    this.state = snapshot.state;
    this.rng.setState(snapshot.rngState);
    return this.state;
  }

  getState(): State { return this.state; }
  getLog(): LogEntry[] { return this.log; }
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Update engine/src/index.ts exports**

Export all public modules.

---

## Phase 7: CLI

**Commit message:** `feat: add interactive CLI`

### Task 7.1: CLI scaffold and renderer

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`
- Create: `cli/src/index.ts`, `cli/src/game-loop.ts`, `cli/src/renderer.ts`
- Create: `cli/tests/renderer.test.ts`

- [ ] **Step 1: Create cli/package.json**

```json
{
  "name": "@sscc/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "sscc": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "start": "node --loader ts-node/esm src/index.ts"
  },
  "dependencies": {
    "@sscc/engine": "file:../engine",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0",
    "ts-node": "^10.9.0"
  }
}
```

- [ ] **Step 2: Create cli/tsconfig.json**

Same as engine but with `rootDir: "src"` and reference to engine.

- [ ] **Step 3: Write renderer.ts**

```ts
export function renderEventBanner(event: string): string {
  // "=== EVENT: commandPhase ==="
}

export function renderChoices(mandatory: Rule[], optional: Rule[], canPass: boolean): string {
  // Numbered list:
  // [1] Gain 1 CP (mandatory)
  // [2] Insane Bravery - 1 CP (optional)
  // [P] Pass
  // [E] Edit State
  // [U] Undo
}

export function renderState(state: State): string {
  // Compact state display: turn player, CP, units with statuses
}

export function renderLog(log: LogEntry[], count: number): string {
  // Last N log entries
}
```

- [ ] **Step 4: Write renderer.test.ts**

Test that renderChoices formats correctly with mandatory/optional/pass options.

- [ ] **Step 5: Write game-loop.ts**

```ts
import * as readline from 'readline';

export async function runGameLoop(engine: SSCCEngine): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>(resolve => rl.question(q, resolve));

  // Wire up playerChoice callback
  const playerChoice: PlayerChoiceFn = async (options, canPass, state) => {
    console.log(renderState(state));
    console.log(renderChoices(
      options.filter(o => o.mandatory).map(o => o.rule!),
      options.filter(o => !o.mandatory).map(o => o.rule!),
      canPass,
    ));

    while (true) {
      const input = await ask('> ');
      const trimmed = input.trim().toLowerCase();

      if (trimmed === 'p' && canPass) return { type: 'pass' };
      if (trimmed === 'e') {
        // Edit state flow
        const path = await ask('Path: ');
        const value = await ask('Value (JSON): ');
        return { type: 'editState', editPath: path, editValue: JSON.parse(value) };
      }
      if (trimmed === 'u') {
        // Signal undo (engine handles)
        return { type: 'undo' as any };
      }

      const num = parseInt(trimmed, 10);
      if (num >= 1 && num <= options.length) {
        return { type: 'rule', rule: options[num - 1].rule };
      }

      console.log('Invalid input. Try again.');
    }
  };

  // Main loop
  while (true) {
    const result = await engine.advanceToNextEvent();
    if (!result) {
      console.log('=== GAME OVER ===');
      break;
    }
    console.log(renderEventBanner(result.event));
  }

  rl.close();
}
```

- [ ] **Step 6: Write index.ts (CLI entry point)**

```ts
#!/usr/bin/env node
import { loadPack, SSCCEngine } from '@sscc/engine';
import { runGameLoop } from './game-loop.js';

const args = process.argv.slice(2);
const seedIdx = args.indexOf('--seed');
let seed: number | undefined;
if (seedIdx !== -1) {
  seed = parseInt(args[seedIdx + 1], 10);
  args.splice(seedIdx, 2);
}

if (args.length < 3) {
  console.error('Usage: sscc <core.rules> <army1.army> <army2.army> [--seed N]');
  process.exit(1);
}

const [coreRules, ...armyFiles] = args;
const pack = await loadPack(coreRules, armyFiles);
const engine = new SSCCEngine(pack, async () => ({ type: 'pass' }), seed);
await runGameLoop(engine);
```

- [ ] **Step 7: Install CLI dependencies and verify compilation**

```bash
cd cli && npm install && npx tsc --noEmit
```

---

## Phase 8: Wh40k Core Rules Pack

**Commit message:** `feat: add wh40k 10e core rules pack with all phases`

### Task 8.1: Core rules entry point and timeline

**Files:**
- Create: `packs/wh40k-10e/core.rules`

- [ ] **Step 1: Write core.rules**

```yaml
# Warhammer 40,000 10th Edition — Core Rules

include:
  - rules/turn-entry.rules
  - rules/command-phase.rules
  - rules/battleshock.rules
  - rules/movement-phase.rules
  - rules/shooting-phase.rules
  - rules/charge-phase.rules
  - rules/fight-phase.rules
  - rules/stratagems.rules

objects:
  player: "$.players"
  unit: "$.players.*.units"
  model: "$.players.*.units.*.models"
  die: "$.pools.*.dice"

macros:
  roll:
    params: [poolPath, count, sides]
    expands:
      repeat: "{count}"
      as: "i"
      effects:
        - set: "{poolPath}.dice.{i}.value"
          value: { random: { min: 1, max: "{sides}" } }
        - set: "{poolPath}.dice.{i}.sides"
          value: "{sides}"
  rerollDie:
    params: [poolPath, dieIndex]
    expands:
      effects:
        - set: "{poolPath}.dice.{dieIndex}.value"
          value: { random: { min: 1, max: { path: "{poolPath}.dice.{dieIndex}.sides" } } }
        - set: "{poolPath}.dice.{dieIndex}.rerolled"
          value: true

derived:
  CurrentLeadership:
    base: { path: "$.selectedUnit.BaseLeadership" }
    modifiers: { match: "$.selectedUnit.CurrentLeadership.modifier*" }
    aggregate: sum
    clamp: { min: { offset: -1 }, max: { offset: +1 } }
  CurrentMove:
    base: { path: "$.selectedUnit.BaseMove" }
    modifiers: { match: "$.selectedUnit.CurrentMove.modifier*" }
    aggregate: sum
  CurrentToughness:
    base: { path: "$.selectedUnit.BaseToughness" }
    modifiers: { match: "$.selectedUnit.CurrentToughness.modifier*" }
    aggregate: sum
    clamp: { min: { offset: -1 }, max: { offset: +1 } }
  CurrentSave:
    base: { path: "$.selectedUnit.BaseSave" }
    modifiers: { match: "$.selectedUnit.CurrentSave.modifier*" }
    aggregate: sum
    clamp: { min: { offset: -1 }, max: { offset: +1 } }

selectors:
  turnPlayer_all_units:
    object: unit
    where:
      pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
  turnPlayer_untested_units:
    object: unit
    where:
      all:
        - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
        - not: { is: "$entity.battleshocked" }
        - not: { is: "$entity.not-battleshocked" }
  opponent_all_units:
    object: unit
    where:
      pathEquals: { path: "$entity.owner", value: { path: "$.opponent" } }

# ---- Timeline ----

game:
  - startOfGame
  - battleRound:
      repeat: 5
  - endOfGame

battleRound:
  - { sequence: attackerTurn }
  - { sequence: defenderTurn }

attackerTurn:
  - { sequence: playerTurn }

defenderTurn:
  - { sequence: playerTurn }

playerTurn:
  - { sequence: commandPhase }
  - { sequence: movementPhase }
  - { sequence: shootingPhase }
  - { sequence: chargePhase }
  - { sequence: fightPhase }
  - endOfTurn

commandPhase:
  - commandPhase
  - endOfPhase

movementPhase:
  - movementPhase
  - endOfPhase

shootingPhase:
  - shootingPhase
  - endOfPhase

chargePhase:
  - chargePhase
  - endOfPhase

fightPhase:
  - fightPhase
  - endOfPhase

# Event leaf nodes
startOfGame:
  - event
endOfGame:
  - event
commandPhaseEvent:
  - event
endOfPhase:
  - event
endOfTurn:
  - event

# Sub-sequences invoked by rules
battleshockTest:
  - battleshockRoll
  - battleshockCompare

battleshockRoll:
  - event
battleshockCompare:
  - event
```

**Note:** There's a naming conflict — `commandPhase` is both a sequence name and an event name inside it. The evaluation model spec does this (see `docs/examples/wh40k-10e/timeline.yaml` line 39-41). The sequence `commandPhase` contains an event also called `commandPhase`. This works because the sequence is walked to produce events — when the sequencer reaches the `commandPhase` entry inside the sequence, it looks it up and finds... itself recursively? No — in the original spec format, the event and sequence share the name. In our new format, the `commandPhase` sequence contains a bare string `commandPhase` which would resolve to itself. We need to handle this.

**Resolution:** The bare string `commandPhase` inside the `commandPhase` sequence should be treated as an event (not a self-reference). Since `commandPhase` is defined as a sequence, not as `- event`, we need a different approach. Looking at the original spec, the phase sequence contains an event with the same name as the phase. In our format, we can either:
1. Use `- event` directly in the phase sequences (the phase name IS the event name)
2. Use distinct event names

Option 1 is cleaner. Revise the phase sequences:

```yaml
commandPhase:
  - event      # fires rule loop as "commandPhase"
  - endOfPhase

movementPhase:
  - event      # fires rule loop as "movementPhase"
  - endOfPhase
```

But wait — `endOfPhase` is also referenced as a bare string AND defined as a sequence with `- event`. That makes `endOfPhase` a sequence reference, not an event. The sequencer would enter the `endOfPhase` sequence, which contains `- event`, firing the event named `endOfPhase`. That's correct!

So the fix is: phase sequences have `- event` as their first step (the phase event), then `endOfPhase` (reference to the endOfPhase sequence/event).

### Task 8.2: Turn entry and command phase rules

**Files:**
- Create: `packs/wh40k-10e/rules/turn-entry.rules`
- Create: `packs/wh40k-10e/rules/command-phase.rules`
- Create: `packs/wh40k-10e/rules/battleshock.rules`

- [ ] **Step 1: Write turn-entry.rules**

```yaml
CORE.AttackerTurn.SetPlayer:
  when:
    on: attackerTurn
  effect:
    - set: "$.turnPlayer"
      value: { path: "$.attacker" }
    - set: "$.opponent"
      value: { path: "$.defender" }
  label: "Set active player (attacker)"

CORE.DefenderTurn.SetPlayer:
  when:
    on: defenderTurn
  effect:
    - set: "$.turnPlayer"
      value: { path: "$.defender" }
    - set: "$.opponent"
      value: { path: "$.attacker" }
  label: "Set active player (defender)"
```

- [ ] **Step 2: Write command-phase.rules**

```yaml
CORE.Command.ClearBattleshock:
  when:
    on: commandPhase
  effect:
    - unset:
        key: battleshocked
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
    - unset:
        key: not-battleshocked
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
  label: "Clear battleshock state from previous round"

CORE.Command.GainCP:
  when:
    on: commandPhase
  effect:
    - set: "$.turnPlayer.cp"
      value: { add: 1 }
  label: "Gain 1 CP"

CORE.Command.BattleshockEligible:
  when:
    all:
      - is: commandPhase
      - selector:
          object: unit
          where:
            all:
              - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
              - not: { is: "$entity.battleshocked" }
              - not: { is: "$entity.not-battleshocked" }
  effect:
    - set: "$.battleshock.selectedUnit"
      valueFromChoice: selectedUnitId
    - sequence: battleshockTest
  label: "Battleshock test (select unit)"
```

- [ ] **Step 3: Write battleshock.rules**

```yaml
CORE.Battleshock.Roll:
  when:
    on: battleshockRoll
  effect:
    - roll: { count: 2, sides: 6, storePath: "$.battleshock.rollResult" }
  label: "Roll battleshock test"

CORE.Battleshock.Compare:
  when:
    on: battleshockCompare
  effect:
    - test:
        usePool: "$.battleshock.rollResult"
        compare: gte
        target:
          derived: CurrentLeadership
          unit: { path: "$.battleshock.selectedUnit" }
        pass:
          - set: "$.battleshock.selectedUnit.not-battleshocked"
            value: true
        fail:
          - set: "$.battleshock.selectedUnit.battleshocked"
            value: true
  label: "Resolve battleshock test"
```

### Task 8.3: Movement phase rules (abstract)

**Files:**
- Create: `packs/wh40k-10e/rules/movement-phase.rules`

Movement is abstract: for each unit, the player picks a movement type (Normal, Advance, Remain Stationary, Fall Back). The choice sets a flag on the unit.

- [ ] **Step 1: Write movement-phase.rules**

```yaml
# Movement is abstract — player selects movement type per unit.
# The engine does not track positions; physical movement is manual.

CORE.Movement.SelectUnit:
  when:
    all:
      - is: movementPhase
      - selector:
          object: unit
          where:
            all:
              - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
              - pathMissing: "$entity.movementType"
  effect:
    - set: "$.movement.selectedUnit"
      valueFromChoice: selectedUnitId
    - sequence: movementChoice
  label: "Select unit to move"

# Sub-sequence for movement type selection
movementChoice:
  - movementTypeSelect
movementTypeSelect:
  - event

CORE.Movement.NormalMove:
  when:
    all:
      - is: movementTypeSelect
      - playerChoice: { player: "$.turnPlayer" }
  effect:
    - set: "$.movement.selectedUnit.movementType"
      value: "normal"
    - appendLogNote: "Unit moved (Normal Move)"
  label: "Normal Move"

CORE.Movement.Advance:
  when:
    all:
      - is: movementTypeSelect
      - playerChoice: { player: "$.turnPlayer" }
  effect:
    - set: "$.movement.selectedUnit.movementType"
      value: "advance"
    - set: "$.movement.selectedUnit.advanced"
      value: true
    - appendLogNote: "Unit advanced"
  label: "Advance"

CORE.Movement.RemainStationary:
  when:
    all:
      - is: movementTypeSelect
      - playerChoice: { player: "$.turnPlayer" }
  effect:
    - set: "$.movement.selectedUnit.movementType"
      value: "stationary"
    - set: "$.movement.selectedUnit.remainedStationary"
      value: true
    - appendLogNote: "Unit remained stationary"
  label: "Remain Stationary"

CORE.Movement.FallBack:
  when:
    all:
      - is: movementTypeSelect
      - playerChoice: { player: "$.turnPlayer" }
  effect:
    - set: "$.movement.selectedUnit.movementType"
      value: "fallBack"
    - set: "$.movement.selectedUnit.fellBack"
      value: true
    - appendLogNote: "Unit fell back"
  label: "Fall Back"

# Clear movement state at end of phase
CORE.Movement.ClearMovement:
  when:
    on: endOfPhase
  effect:
    - unset:
        key: movementType
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
  label: "Clear movement flags"
```

### Task 8.4: Shooting phase rules

**Files:**
- Create: `packs/wh40k-10e/rules/shooting-phase.rules`

Shooting: select unit, select target, roll to hit, roll to wound, save rolls, allocate damage.

- [ ] **Step 1: Write shooting-phase.rules**

```yaml
# Shooting Phase — select attacker, select target, resolve attacks

CORE.Shooting.SelectAttacker:
  when:
    all:
      - is: shootingPhase
      - selector:
          object: unit
          where:
            all:
              - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
              - pathMissing: "$entity.hasShotThisPhase"
              - not:
                  pathEquals: { path: "$entity.fellBack", value: true }
  effect:
    - set: "$.shooting.attacker"
      valueFromChoice: selectedUnitId
    - sequence: shootingAttack
  label: "Select unit to shoot"

# Sub-sequences for shooting
shootingAttack:
  - selectShootingTarget
  - hitRolls
  - woundRolls
  - saveRolls
  - shootingDamage

selectShootingTarget:
  - event
hitRolls:
  - event
woundRolls:
  - event
saveRolls:
  - event
shootingDamage:
  - event

CORE.Shooting.SelectTarget:
  when:
    on: selectShootingTarget
  effect:
    - set: "$.shooting.target"
      valueFromChoice: selectedUnitId
    - manual: "Confirm target is in range and line of sight"
  label: "Select target unit"

CORE.Shooting.HitRolls:
  when:
    on: hitRolls
  effect:
    - test:
        roll: { count: { path: "$.shooting.attacker.attacks" }, sides: 6 }
        compare: gte
        target: { derived: CurrentToHit, unit: { path: "$.shooting.attacker" } }
        pass:
          - set: "$.shooting.hits"
            value: { add: 1 }
        fail:
          - appendLogNote: "Miss"
  label: "Roll to hit"

CORE.Shooting.WoundRolls:
  when:
    on: woundRolls
  effect:
    - test:
        roll: { count: { path: "$.shooting.hits" }, sides: 6 }
        compare: gte
        target: { path: "$.shooting.woundTarget" }
        pass:
          - set: "$.shooting.wounds"
            value: { add: 1 }
        fail:
          - appendLogNote: "Failed to wound"
  label: "Roll to wound"

CORE.Shooting.SaveRolls:
  when:
    on: saveRolls
  effect:
    - test:
        roll: { count: { path: "$.shooting.wounds" }, sides: 6 }
        compare: gte
        target: { derived: CurrentSave, unit: { path: "$.shooting.target" } }
        pass:
          - appendLogNote: "Save successful"
        fail:
          - set: "$.shooting.unsavedWounds"
            value: { add: 1 }
  label: "Roll saves"

CORE.Shooting.ApplyDamage:
  when:
    on: shootingDamage
  effect:
    - set: "$.shooting.target.wounds"
      value: { add: { path: "$.shooting.unsavedWounds" } }
    - set: "$.shooting.attacker.hasShotThisPhase"
      value: true
    - appendLogNote: "Damage applied"
  label: "Apply damage to target"

# Clean up shooting state at end of phase
CORE.Shooting.Cleanup:
  when:
    on: endOfPhase
  effect:
    - unset: "$.shooting"
    - unset:
        key: hasShotThisPhase
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
  label: "Clear shooting state"
```

### Task 8.5: Charge and fight phase rules

**Files:**
- Create: `packs/wh40k-10e/rules/charge-phase.rules`
- Create: `packs/wh40k-10e/rules/fight-phase.rules`

- [ ] **Step 1: Write charge-phase.rules**

```yaml
# Charge Phase — select unit, declare charge target, roll charge

CORE.Charge.SelectCharger:
  when:
    all:
      - is: chargePhase
      - selector:
          object: unit
          where:
            all:
              - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
              - pathMissing: "$entity.hasChargedThisPhase"
              - not:
                  pathEquals: { path: "$entity.advanced", value: true }
              - not:
                  pathEquals: { path: "$entity.fellBack", value: true }
  effect:
    - set: "$.charge.charger"
      valueFromChoice: selectedUnitId
    - sequence: chargeAttempt
  label: "Select unit to charge"

chargeAttempt:
  - chargeRoll
  - chargeResult
chargeRoll:
  - event
chargeResult:
  - event

CORE.Charge.DeclareTarget:
  when:
    on: chargeRoll
  effect:
    - set: "$.charge.target"
      valueFromChoice: selectedUnitId
    - manual: "Confirm charge target is within 12\""
  label: "Declare charge target"

CORE.Charge.Roll:
  when:
    on: chargeRoll
  effect:
    - test:
        roll: { count: 2, sides: 6 }
        compare: gte
        target: { value: 0 }
        pass:
          - set: "$.charge.rollResult"
            value: { path: "$.lastRoll" }
        fail: []
    - manual: "Is the charge distance sufficient to reach the target?"
  label: "Roll charge distance (2D6)"

CORE.Charge.Success:
  when:
    all:
      - on: chargeResult
      - pathEquals: { path: "$.charge.success", value: true }
  effect:
    - set: "$.charge.charger.hasChargedThisPhase"
      value: true
    - set: "$.charge.charger.charged"
      value: true
    - appendLogNote: "Charge successful"
  label: "Charge succeeded"

CORE.Charge.Failure:
  when:
    all:
      - on: chargeResult
      - pathMissing: "$.charge.success"
  effect:
    - set: "$.charge.charger.hasChargedThisPhase"
      value: true
    - appendLogNote: "Charge failed"
  label: "Charge failed"

CORE.Charge.Cleanup:
  when:
    on: endOfPhase
  effect:
    - unset: "$.charge"
    - unset:
        key: hasChargedThisPhase
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
  label: "Clear charge state"
```

- [ ] **Step 2: Write fight-phase.rules**

```yaml
# Fight Phase — select unit, select target, roll melee attacks

CORE.Fight.SelectFighter:
  when:
    all:
      - is: fightPhase
      - selector:
          object: unit
          where:
            all:
              - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
              - pathMissing: "$entity.hasFoughtThisPhase"
              - any:
                  - pathEquals: { path: "$entity.charged", value: true }
                  - manual: "Is this unit within Engagement Range of an enemy?"
  effect:
    - set: "$.fight.attacker"
      valueFromChoice: selectedUnitId
    - sequence: meleeAttack
  label: "Select unit to fight"

meleeAttack:
  - selectMeleeTarget
  - meleeHitRolls
  - meleeWoundRolls
  - meleeSaveRolls
  - meleeDamage

selectMeleeTarget:
  - event
meleeHitRolls:
  - event
meleeWoundRolls:
  - event
meleeSaveRolls:
  - event
meleeDamage:
  - event

CORE.Fight.SelectTarget:
  when:
    on: selectMeleeTarget
  effect:
    - set: "$.fight.target"
      valueFromChoice: selectedUnitId
    - manual: "Confirm target is within Engagement Range"
  label: "Select melee target"

CORE.Fight.HitRolls:
  when:
    on: meleeHitRolls
  effect:
    - test:
        roll: { count: { path: "$.fight.attacker.meleeAttacks" }, sides: 6 }
        compare: gte
        target: { derived: CurrentToHit, unit: { path: "$.fight.attacker" } }
        pass:
          - set: "$.fight.hits"
            value: { add: 1 }
        fail:
          - appendLogNote: "Melee miss"
  label: "Roll to hit (melee)"

CORE.Fight.WoundRolls:
  when:
    on: meleeWoundRolls
  effect:
    - test:
        roll: { count: { path: "$.fight.hits" }, sides: 6 }
        compare: gte
        target: { path: "$.fight.woundTarget" }
        pass:
          - set: "$.fight.wounds"
            value: { add: 1 }
        fail:
          - appendLogNote: "Failed to wound (melee)"
  label: "Roll to wound (melee)"

CORE.Fight.SaveRolls:
  when:
    on: meleeSaveRolls
  effect:
    - test:
        roll: { count: { path: "$.fight.wounds" }, sides: 6 }
        compare: gte
        target: { derived: CurrentSave, unit: { path: "$.fight.target" } }
        pass:
          - appendLogNote: "Save successful"
        fail:
          - set: "$.fight.unsavedWounds"
            value: { add: 1 }
  label: "Roll saves (melee)"

CORE.Fight.ApplyDamage:
  when:
    on: meleeDamage
  effect:
    - set: "$.fight.target.wounds"
      value: { add: { path: "$.fight.unsavedWounds" } }
    - set: "$.fight.attacker.hasFoughtThisPhase"
      value: true
    - appendLogNote: "Melee damage applied"
  label: "Apply melee damage"

CORE.Fight.Cleanup:
  when:
    on: endOfPhase
  effect:
    - unset: "$.fight"
    - unset:
        key: hasFoughtThisPhase
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
    - unset:
        key: charged
        target:
          object: unit
          where:
            pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
  label: "Clear fight state"
```

### Task 8.6: Core stratagems

**Files:**
- Create: `packs/wh40k-10e/rules/stratagems.rules`

- [ ] **Step 1: Write stratagems.rules**

```yaml
STRAT.InsaneBravery:
  when:
    all:
      - is: commandPhase
      - playerChoice: { player: "$.turnPlayer" }
      - not: { is: insaneBraveryUsed }
      - selector:
          object: unit
          where:
            all:
              - pathEquals: { path: "$entity.owner", value: { path: "$.turnPlayer" } }
              - not: { is: "$entity.battleshocked" }
              - not: { is: "$entity.not-battleshocked" }
  costs: { cp: 1 }
  effect:
    - set: "$.battleshock.selectedUnit"
      valueFromChoice: selectedUnitId
    - set: "$.battleshock.selectedUnit.not-battleshocked"
      value: true
    - set: insaneBraveryUsed
  label: "Insane Bravery (auto-pass battleshock, 1 CP)"

STRAT.CommandReroll:
  when:
    all:
      - is: battleshockRoll
      - playerChoice: { player: "$.turnPlayer" }
      - not: { is: commandRerollUsed }
  costs: { cp: 1 }
  effect:
    - rerollDie: { poolPath: "$.battleshock.rollResult", dieIndex: { pick: 1 } }
    - set: commandRerollUsed
      expiresOn: endOfPhase
  label: "Command Re-roll (reroll 1 battleshock die, 1 CP)"
```

### Task 8.7: Unit templates and army files

**Files:**
- Create: `packs/wh40k-10e/orks/ork-army.rules`
- Create: `packs/wh40k-10e/orks/units/boyz.rules`
- Create: `packs/wh40k-10e/orks/units/warboss.rules`
- Create: `packs/wh40k-10e/space-marines/sm-army.rules`
- Create: `packs/wh40k-10e/space-marines/units/intercessors.rules`
- Create: `packs/wh40k-10e/space-marines/units/captain.rules`
- Create: `packs/wh40k-10e/games/test-game-orks.army`
- Create: `packs/wh40k-10e/games/test-game-sm.army`

- [ ] **Step 1: Write ork army rules and unit templates**

`orks/ork-army.rules`:
```yaml
include:
  - units/boyz.rules
  - units/warboss.rules
```

`orks/units/boyz.rules`:
```yaml
boyz:
  template: unit
  params: [owner, id]
  state:
    path: "$.players.{owner}.units.{id}"
    value:
      name: "Boyz"
      owner: "{owner}"
      models: 10
      stats:
        M: 6
        T: 5
        Sv: 5
        W: 1
        Ld: 7
        OC: 2
      BaseLeadership: 7
      BaseToughness: 5
      BaseSave: 5
      attacks: 2
      meleeAttacks: 2
      BaseToHit: 4
      keywords: [INFANTRY, MOB, BATTLELINE, ORK]
```

`orks/units/warboss.rules`:
```yaml
warboss:
  template: unit
  params: [owner, id]
  state:
    path: "$.players.{owner}.units.{id}"
    value:
      name: "Warboss"
      owner: "{owner}"
      models: 1
      stats:
        M: 6
        T: 5
        Sv: 4
        W: 6
        Ld: 6
        OC: 1
      BaseLeadership: 6
      BaseToughness: 5
      BaseSave: 4
      attacks: 4
      meleeAttacks: 5
      BaseToHit: 2
      keywords: [INFANTRY, CHARACTER, ORK]
```

- [ ] **Step 2: Write Space Marine army rules and unit templates**

`space-marines/sm-army.rules`:
```yaml
include:
  - units/intercessors.rules
  - units/captain.rules
```

`space-marines/units/intercessors.rules`:
```yaml
intercessors:
  template: unit
  params: [owner, id]
  state:
    path: "$.players.{owner}.units.{id}"
    value:
      name: "Intercessor Squad"
      owner: "{owner}"
      models: 5
      stats:
        M: 6
        T: 4
        Sv: 3
        W: 2
        Ld: 6
        OC: 2
      BaseLeadership: 6
      BaseToughness: 4
      BaseSave: 3
      attacks: 2
      meleeAttacks: 3
      BaseToHit: 3
      keywords: [INFANTRY, BATTLELINE, IMPERIUM, ADEPTUS ASTARTES]
```

`space-marines/units/captain.rules`:
```yaml
captain:
  template: unit
  params: [owner, id]
  state:
    path: "$.players.{owner}.units.{id}"
    value:
      name: "Captain"
      owner: "{owner}"
      models: 1
      stats:
        M: 6
        T: 4
        Sv: 3
        W: 5
        Ld: 6
        OC: 1
      BaseLeadership: 6
      BaseToughness: 4
      BaseSave: 3
      attacks: 5
      meleeAttacks: 6
      BaseToHit: 2
      keywords: [INFANTRY, CHARACTER, IMPERIUM, ADEPTUS ASTARTES]
```

- [ ] **Step 3: Write army files**

`games/test-game-orks.army`:
```yaml
include:
  - ../orks/ork-army.rules

units:
  - template: boyz
    bind: { owner: player1, id: boyz_1 }
  - template: boyz
    bind: { owner: player1, id: boyz_2 }
  - template: warboss
    bind: { owner: player1, id: warboss_1 }
```

`games/test-game-sm.army`:
```yaml
include:
  - ../space-marines/sm-army.rules

units:
  - template: intercessors
    bind: { owner: player2, id: intercessors_1 }
  - template: intercessors
    bind: { owner: player2, id: intercessors_2 }
  - template: captain
    bind: { owner: player2, id: captain_1 }
```

### Task 8.8: Integration test — full game flow

**Files:**
- Create: `engine/tests/integration.test.ts`

- [ ] **Step 1: Write integration test**

Test that loads the wh40k pack and runs through a scripted game with mock player choices:
- Attacker turn starts, player set correctly
- Command phase: CP gained, battleshock tests run
- Movement phase: units get movement types assigned
- Shooting/charge/fight: sub-sequences entered and resolved
- End of turn cleanup

This test uses `loadPack()` with the actual pack files and a scripted `PlayerChoiceFn` that makes predetermined choices.

- [ ] **Step 2: Run integration test**

```bash
cd engine && npx vitest run tests/integration.test.ts
```

---

## Commit Schedule

| Phase | Commit message | What's testable |
|-------|---------------|-----------------|
| 1 | `feat: scaffold engine project with core types` | Types compile |
| 2 | `feat: add state management and seeded RNG` | Unit tests pass |
| 3 | `feat: add YAML pack loader with file classification` | Loader tests pass |
| 4 | `feat: add sequence walker and event processing` | Sequencer tests pass |
| 5 | `feat: add condition evaluator and effect executor` | Condition + effect tests pass |
| 6 | `feat: add rule loop, derived state, and engine orchestrator` | Engine integration tests pass |
| 7 | `feat: add interactive CLI` | CLI compiles, renderer tests pass |
| 8 | `feat: add wh40k 10e core rules pack with all phases` | Full integration test passes |
