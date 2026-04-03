# Milestone 5a Implementation Plan: CLI Playtesting Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a text-based CLI for playtesting SSCC game packs, with a 40k-themed display showing units, dice pools, phases, and choices.

**Architecture:** New `cli/` directory alongside `engine/`. Four source files: entry point, game loop, renderer, command parser. Imports engine source via relative paths, runs with `tsx`. Renderer is a pure function returning strings (testable). Game loop drives engine via `advanceToNextEvent` / `applyChoice` / `undoChoice`. A `cli-demo` pack provides enough rules to exercise all UI sections.

**Tech Stack:** TypeScript, tsx (runtime), node:readline (input), Vitest (renderer/command tests)

**Design Spec:** `docs/superpowers/specs/2026-04-03-milestone5a-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `engine/src/engine/index.ts` | Modify | Add `passAllChoices()` method |
| `engine/src/index.ts` | Modify | Export `passAllChoices` (already re-exported via SSCCEngine) |
| `cli/package.json` | Create | Package config with tsx dependency |
| `cli/tsconfig.json` | Create | TypeScript config |
| `cli/src/index.ts` | Create | Entry point: args, load, start |
| `cli/src/game-loop.ts` | Create | State machine: advance, prompt, apply |
| `cli/src/renderer.ts` | Create | Pure functions: format display sections |
| `cli/src/commands.ts` | Create | Parse and execute debug commands |
| `cli/tests/renderer.test.ts` | Create | Renderer unit tests |
| `cli/tests/commands.test.ts` | Create | Command parser unit tests |
| `packs/cli-demo/manifest.yaml` | Create | Demo pack manifest |
| `packs/cli-demo/initial_state.json` | Create | Demo initial state |
| `packs/cli-demo/timeline.yaml` | Create | Demo timeline |
| `packs/cli-demo/glossary.yaml` | Create | Demo glossary |
| `packs/cli-demo/rules.json` | Create | Demo rules |

---

## Task 1: Engine Change — passAllChoices

**Files:**
- Modify: `engine/src/engine/index.ts`
- Modify: `engine/tests/unit/undo.test.ts` (add test)

- [ ] **Step 1.1 — Write failing test**

Add this test at the end of `engine/tests/unit/undo.test.ts`, inside a new describe block:

```typescript
describe("passAllChoices", () => {
  it("cancels all offered choices and allows advancing", async () => {
    const engine = await setupBlessingsEngine(findSeedWithHighPair());
    expect(engine.isPaused()).toBe(true);
    const choicesBefore = engine.enumerateChoices();
    expect(choicesBefore.length).toBeGreaterThan(0);

    engine.passAllChoices();

    expect(engine.enumerateChoices()).toHaveLength(0);
    expect(engine.isPaused()).toBe(false);
  });
});
```

Note: `findSeedWithHighPair` and `setupBlessingsEngine` are already defined at the top of this test file from Task 4.

- [ ] **Step 1.2 — Run test to verify it fails**

Run: `cd engine && npx vitest run tests/unit/undo.test.ts`
Expected: FAIL — passAllChoices is not a function

- [ ] **Step 1.3 — Implement passAllChoices**

In `engine/src/engine/index.ts`, add this method to the `SSCCEngine` class, after `undoChoice`:

```typescript
  /**
   * Cancel all currently offered choices (pass/decline).
   * Allows the engine to advance past a choice point.
   */
  passAllChoices(): State {
    this.state = cancelOfferedChoices(this.state);
    this.logger.log("note", "All offered choices passed");
    return this.state;
  }
```

`cancelOfferedChoices` is already imported at the top of the file.

- [ ] **Step 1.4 — Run test to verify it passes**

Run: `cd engine && npx vitest run tests/unit/undo.test.ts`
Expected: All tests PASS

- [ ] **Step 1.5 — Run full engine suite**

Run: `cd engine && npx vitest run`
Expected: All 185 tests PASS

- [ ] **Step 1.6 — Commit**

```bash
git add engine/src/engine/index.ts engine/tests/unit/undo.test.ts
git commit -m "feat(m5a): add passAllChoices method to SSCCEngine"
```

---

## Task 2: CLI Package Scaffold

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`

- [ ] **Step 2.1 — Create cli/package.json**

```json
{
  "name": "@sscc/cli",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2.2 — Create cli/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
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

- [ ] **Step 2.3 — Install dependencies**

Run: `cd cli && npm install`
Expected: node_modules created, no errors

- [ ] **Step 2.4 — Commit**

```bash
git add cli/package.json cli/tsconfig.json cli/package-lock.json
git commit -m "feat(m5a): scaffold CLI package"
```

---

## Task 3: Renderer — Pure Display Functions

**Files:**
- Create: `cli/src/renderer.ts`
- Create: `cli/tests/renderer.test.ts`

The renderer is pure functions that take engine state and return formatted strings. No I/O.

- [ ] **Step 3.1 — Write failing tests**

Create `cli/tests/renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  renderHeader,
  renderUnits,
  renderDicePool,
  renderChoices,
  renderEventLine,
} from "../src/renderer.js";
import type { State, GameEvent, ChoiceInstance } from "../../engine/src/types/index.js";

describe("renderHeader", () => {
  it("formats round, phase, and player", () => {
    const event: GameEvent = { id: "ShootingPhaseStart", params: { player: "attacker" } };
    const state: State = { battleRound: 2 };
    const output = renderHeader(state, event);
    expect(output).toContain("Battle Round 2");
    expect(output).toContain("Shooting");
    expect(output).toContain("attacker");
  });

  it("handles missing battleRound gracefully", () => {
    const event: GameEvent = { id: "StartOfGame", params: {} };
    const state: State = {};
    const output = renderHeader(state, event);
    expect(output).toContain("StartOfGame");
  });
});

describe("renderUnits", () => {
  it("lists units grouped by owner", () => {
    const state: State = {
      units: {
        tactical_squad: {
          id: "tactical_squad",
          owner: "attacker",
          keywords: ["INFANTRY"],
          statuses: {},
        },
        intercessors: {
          id: "intercessors",
          owner: "defender",
          keywords: ["INFANTRY", "PRIMARIS"],
          statuses: { overwatchReady: { expiresOn: null } },
        },
      },
    };
    const output = renderUnits(state);
    expect(output).toContain("attacker");
    expect(output).toContain("tactical_squad");
    expect(output).toContain("INFANTRY");
    expect(output).toContain("defender");
    expect(output).toContain("intercessors");
    expect(output).toContain("overwatchReady");
  });

  it("returns empty string when no units", () => {
    const output = renderUnits({});
    expect(output).toBe("");
  });
});

describe("renderDicePool", () => {
  it("formats dice with indices and spent markers", () => {
    const state: State = {
      blessingsRoll: {
        count: 4,
        d0: { value: 1, rerolled: false, spent: false },
        d1: { value: 6, rerolled: false, spent: true },
        d2: { value: 6, rerolled: false, spent: false },
        d3: { value: 3, rerolled: true, spent: false },
      },
    };
    const output = renderDicePool(state);
    expect(output).toContain("[0] 1");
    expect(output).toContain("[1] 6*");
    expect(output).toContain("[2] 6");
    expect(output).toContain("[3] 3");
    expect(output).toContain("* = spent");
  });

  it("returns empty string when no pools found", () => {
    const output = renderDicePool({ someValue: 42 });
    expect(output).toBe("");
  });
});

describe("renderChoices", () => {
  it("formats choices with pass option", () => {
    const choices: ChoiceInstance[] = [
      {
        choiceInstanceId: "ci_1",
        choiceId: "warp_blades",
        label: "Warp Blades (double 5+ or triple)",
        actionRef: "doWarpBlades",
        player: "attacker",
        sourceRuleId: "r1",
        createdAtEvent: "Blessings",
        state: "offered",
        pick: 2,
      },
      {
        choiceInstanceId: "ci_2",
        choiceId: "wrathful",
        label: "Wrathful Devotion (any double)",
        actionRef: "doWrathful",
        player: "attacker",
        sourceRuleId: "r2",
        createdAtEvent: "Blessings",
        state: "offered",
        pick: 2,
      },
    ];
    const output = renderChoices(choices);
    expect(output).toContain("0. Pass");
    expect(output).toContain("1. Warp Blades");
    expect(output).toContain("[pick 2 dice]");
    expect(output).toContain("2. Wrathful Devotion");
  });

  it("returns empty string for no choices", () => {
    const output = renderChoices([]);
    expect(output).toBe("");
  });
});

describe("renderEventLine", () => {
  it("formats a simple event", () => {
    const event: GameEvent = { id: "SetupAttack", params: { player: "attacker" } };
    const output = renderEventLine(event);
    expect(output).toContain("SetupAttack");
  });

  it("includes log notes if provided", () => {
    const event: GameEvent = { id: "RollToHit", params: {} };
    const notes = ["roll: 4d6 -> [2, 6, 4, 1] at $.currentAttack.hitRolls"];
    const output = renderEventLine(event, notes);
    expect(output).toContain("4d6");
    expect(output).toContain("[2, 6, 4, 1]");
  });
});
```

- [ ] **Step 3.2 — Run tests to verify they fail**

Run: `cd cli && npx vitest run tests/renderer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3.3 — Implement renderer**

Create `cli/src/renderer.ts`:

```typescript
import type { State, GameEvent, ChoiceInstance } from "../../engine/src/types/index.js";
import { get } from "../../engine/src/state/index.js";
import { readDiePool } from "../../engine/src/rules/pool-helpers.js";

/**
 * Map event IDs to human-readable phase names.
 */
const PHASE_NAMES: Record<string, string> = {
  CommandPhaseStart: "Command Phase",
  MovementPhaseStart: "Movement Phase",
  ShootingPhaseStart: "Shooting Phase",
  ChargePhaseStart: "Charge Phase",
  FightPhaseStart: "Fight Phase",
  BattleRoundStart: "Battle Round Start",
  BattleRoundEnd: "Battle Round End",
};

/**
 * Render the header bar showing round, phase, and active player.
 */
export function renderHeader(state: State, event: GameEvent): string {
  const round = get(state, "$.battleRound");
  const roundStr = typeof round === "number" ? `Battle Round ${round}` : "";
  const phase = PHASE_NAMES[event.id] ?? event.id;
  const player = typeof event.params.player === "string" ? event.params.player : "";

  const parts = [roundStr, phase, player].filter(Boolean);
  return `=== ${parts.join(" | ")} ===`;
}

/**
 * Render all units grouped by owner.
 */
export function renderUnits(state: State): string {
  const units = get(state, "$.units") as Record<string, Record<string, unknown>> | undefined;
  if (!units || typeof units !== "object") return "";

  // Group by owner
  const byOwner = new Map<string, Array<{ id: string; keywords: string[]; statuses: string[] }>>();

  for (const [id, unit] of Object.entries(units)) {
    const owner = (unit.owner as string) ?? "unknown";
    const keywords = Array.isArray(unit.keywords) ? (unit.keywords as string[]) : [];
    const statuses = unit.statuses && typeof unit.statuses === "object"
      ? Object.keys(unit.statuses as Record<string, unknown>)
      : [];

    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push({ id, keywords, statuses });
  }

  const lines: string[] = [];
  for (const [owner, unitList] of byOwner) {
    lines.push(`-- Units (${owner}) --`);
    for (const u of unitList) {
      const kw = u.keywords.length > 0 ? ` [${u.keywords.join(", ")}]` : "";
      const st = u.statuses.length > 0 ? ` Statuses: ${u.statuses.join(", ")}` : " Statuses: -";
      lines.push(`  ${u.id}${kw}${st}`);
    }
  }

  return lines.join("\n");
}

/**
 * Find and render all dice pools in state.
 * A dice pool is any object with a numeric `count` and `d0` child.
 */
export function renderDicePool(state: State): string {
  const pools = findDicePools(state as Record<string, unknown>, "$");
  if (pools.length === 0) return "";

  const lines: string[] = [];
  for (const { path, count, dice } of pools) {
    lines.push(`-- Dice Pool: ${path} --`);
    const diceStrs = dice.map((d) => {
      const spent = d.spent ? "*" : "";
      return `[${d.index}] ${d.value}${spent}`;
    });
    lines.push(`  ${diceStrs.join("   ")}`);
    const spentCount = dice.filter((d) => d.spent).length;
    lines.push(`  (${count} dice, ${spentCount} spent${spentCount > 0 ? ", * = spent" : ""})`);
  }

  return lines.join("\n");
}

interface FoundPool {
  path: string;
  count: number;
  dice: Array<{ index: number; value: number; spent: boolean }>;
}

/**
 * Recursively scan state for dice pool objects.
 */
function findDicePools(obj: Record<string, unknown>, prefix: string): FoundPool[] {
  const pools: FoundPool[] = [];

  if (
    typeof obj.count === "number" &&
    obj.d0 !== undefined &&
    typeof obj.d0 === "object"
  ) {
    const count = obj.count as number;
    const dice: FoundPool["dice"] = [];
    for (let i = 0; i < count; i++) {
      const d = obj[`d${i}`] as Record<string, unknown> | undefined;
      if (d && typeof d === "object") {
        dice.push({
          index: i,
          value: d.value as number,
          spent: (d.spent as boolean) ?? false,
        });
      }
    }
    pools.push({ path: prefix, count, dice });
    return pools;
  }

  // Recurse into child objects (skip internal keys)
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("_")) continue;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      pools.push(...findDicePools(val as Record<string, unknown>, `${prefix}.${key}`));
    }
  }

  return pools;
}

/**
 * Render the choice list with a pass option.
 */
export function renderChoices(choices: ChoiceInstance[]): string {
  if (choices.length === 0) return "";

  const lines: string[] = ["-- Choices --", "  0. Pass"];
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const pickNote = c.pick ? `  [pick ${c.pick} dice]` : "";
    lines.push(`  ${i + 1}. ${c.label}${pickNote}`);
  }

  return lines.join("\n");
}

/**
 * Render a condensed event line for auto-advance mode.
 */
export function renderEventLine(event: GameEvent, notes?: string[]): string {
  let line = `  > ${event.id}`;
  const params = Object.entries(event.params)
    .filter(([_, v]) => v !== undefined)
    .map(([k, v]) => `${v}`)
    .join(", ");
  if (params) line += ` (${params})`;
  if (notes && notes.length > 0) {
    line += ` -- ${notes.join("; ")}`;
  }
  return line;
}

/**
 * Render the full display at a choice point.
 */
export function renderFullDisplay(
  state: State,
  lastEvent: GameEvent,
  choices: ChoiceInstance[],
): string {
  const sections: string[] = [];

  sections.push(renderHeader(state, lastEvent));
  sections.push("");

  const units = renderUnits(state);
  if (units) {
    sections.push(units);
    sections.push("");
  }

  const pool = renderDicePool(state);
  if (pool) {
    sections.push(pool);
    sections.push("");
  }

  const choiceDisplay = renderChoices(choices);
  if (choiceDisplay) {
    sections.push(choiceDisplay);
    sections.push("");
  }

  return sections.join("\n");
}
```

- [ ] **Step 3.4 — Run tests**

Run: `cd cli && npx vitest run tests/renderer.test.ts`
Expected: All tests PASS

- [ ] **Step 3.5 — Commit**

```bash
git add cli/src/renderer.ts cli/tests/renderer.test.ts
git commit -m "feat(m5a): implement CLI renderer with 40k-themed display"
```

---

## Task 4: Command Parser

**Files:**
- Create: `cli/src/commands.ts`
- Create: `cli/tests/commands.test.ts`

- [ ] **Step 4.1 — Write failing tests**

Create `cli/tests/commands.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseInput, type ParsedInput } from "../src/commands.js";

describe("parseInput", () => {
  it("parses choice selection", () => {
    expect(parseInput("1")).toEqual({ type: "choice", index: 1 });
    expect(parseInput("3")).toEqual({ type: "choice", index: 3 });
  });

  it("parses 0 as pass", () => {
    expect(parseInput("0")).toEqual({ type: "pass" });
  });

  it("parses f as pass", () => {
    expect(parseInput("f")).toEqual({ type: "pass" });
  });

  it("parses dice selection (space-separated)", () => {
    expect(parseInput("5 6")).toEqual({ type: "dice", indices: [5, 6] });
    expect(parseInput("0 1 2")).toEqual({ type: "dice", indices: [0, 1, 2] });
  });

  it("parses empty input as advance", () => {
    expect(parseInput("")).toEqual({ type: "advance" });
  });

  it("parses undo", () => {
    expect(parseInput("undo")).toEqual({ type: "undo" });
  });

  it("parses log with default count", () => {
    expect(parseInput("log")).toEqual({ type: "log", count: 20 });
  });

  it("parses log with custom count", () => {
    expect(parseInput("log 50")).toEqual({ type: "log", count: 50 });
  });

  it("parses rules command", () => {
    expect(parseInput("rules")).toEqual({ type: "rules" });
  });

  it("parses state with path", () => {
    expect(parseInput("state $.units.foo")).toEqual({ type: "state", path: "$.units.foo" });
  });

  it("parses step toggle", () => {
    expect(parseInput("step")).toEqual({ type: "step" });
  });

  it("parses help", () => {
    expect(parseInput("help")).toEqual({ type: "help" });
  });

  it("parses quit", () => {
    expect(parseInput("quit")).toEqual({ type: "quit" });
  });

  it("returns unknown for unrecognized input", () => {
    expect(parseInput("xyzzy")).toEqual({ type: "unknown", raw: "xyzzy" });
  });
});
```

- [ ] **Step 4.2 — Run tests to verify they fail**

Run: `cd cli && npx vitest run tests/commands.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4.3 — Implement command parser**

Create `cli/src/commands.ts`:

```typescript
import type { SSCCEngine } from "../../engine/src/engine/index.js";
import type { LogEntry } from "../../engine/src/logger/index.js";
import { get } from "../../engine/src/state/index.js";

export type ParsedInput =
  | { type: "choice"; index: number }
  | { type: "pass" }
  | { type: "dice"; indices: number[] }
  | { type: "advance" }
  | { type: "undo" }
  | { type: "log"; count: number }
  | { type: "rules" }
  | { type: "state"; path: string }
  | { type: "step" }
  | { type: "help" }
  | { type: "quit" }
  | { type: "unknown"; raw: string };

/**
 * Parse a line of user input into a structured command.
 */
export function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();

  if (trimmed === "") return { type: "advance" };
  if (trimmed === "f") return { type: "pass" };
  if (trimmed === "undo") return { type: "undo" };
  if (trimmed === "rules") return { type: "rules" };
  if (trimmed === "step") return { type: "step" };
  if (trimmed === "help") return { type: "help" };
  if (trimmed === "quit") return { type: "quit" };

  if (trimmed.startsWith("log")) {
    const parts = trimmed.split(/\s+/);
    const count = parts.length > 1 ? parseInt(parts[1], 10) : 20;
    return { type: "log", count: isNaN(count) ? 20 : count };
  }

  if (trimmed.startsWith("state ")) {
    const path = trimmed.slice(6).trim();
    return { type: "state", path };
  }

  // Check if it's all digits and spaces (dice selection or choice)
  if (/^\d+(\s+\d+)*$/.test(trimmed)) {
    const nums = trimmed.split(/\s+/).map(Number);
    if (nums.length === 1) {
      if (nums[0] === 0) return { type: "pass" };
      return { type: "choice", index: nums[0] };
    }
    return { type: "dice", indices: nums };
  }

  return { type: "unknown", raw: trimmed };
}

/**
 * Execute a debug command and return output to display.
 */
export function executeCommand(
  input: ParsedInput,
  engine: SSCCEngine,
  lastEvent: { id: string } | null,
): string | null {
  switch (input.type) {
    case "log": {
      const entries = engine.getLog();
      const recent = entries.slice(-input.count);
      if (recent.length === 0) return "  (no log entries)";
      return recent
        .map((e: LogEntry) => {
          const parts = [`[${e.type}]`, e.message];
          if (e.ruleId) parts.push(`(${e.ruleId})`);
          return `  ${parts.join(" ")}`;
        })
        .join("\n");
    }

    case "rules": {
      if (!lastEvent) return "  No events have fired yet.";
      const entries = engine.getLog();
      const ruleEntries = entries.filter(
        (e: LogEntry) =>
          (e.type === "rules_matched" || e.type === "rule_skipped") &&
          e.eventId === lastEvent.id,
      );
      if (ruleEntries.length === 0) return `  No rules evaluated for ${lastEvent.id}`;
      return ruleEntries
        .map((e: LogEntry) => `  ${e.message}`)
        .join("\n");
    }

    case "state": {
      const val = get(engine.getState(), input.path);
      if (val === undefined) return `  ${input.path} = undefined`;
      return `  ${input.path} = ${JSON.stringify(val, null, 2)}`;
    }

    case "help":
      return [
        "Commands:",
        "  0 / f          Pass on all choices",
        "  1-N            Select choice by number",
        "  undo           Undo last choice",
        "  log [N]        Show last N log entries (default 20)",
        "  rules          Show rules that fired on last event",
        "  state <path>   Inspect state at path (e.g. state $.units)",
        "  step           Toggle step-by-step mode",
        "  help           Show this help",
        "  quit           Exit",
      ].join("\n");

    default:
      return null;
  }
}
```

- [ ] **Step 4.4 — Run tests**

Run: `cd cli && npx vitest run tests/commands.test.ts`
Expected: All tests PASS

- [ ] **Step 4.5 — Commit**

```bash
git add cli/src/commands.ts cli/tests/commands.test.ts
git commit -m "feat(m5a): implement CLI command parser"
```

---

## Task 5: Game Loop

**Files:**
- Create: `cli/src/game-loop.ts`

This is the interactive loop. It uses `node:readline` for input and drives the engine.

- [ ] **Step 5.1 — Implement game loop**

Create `cli/src/game-loop.ts`:

```typescript
import * as readline from "node:readline";
import type { SSCCEngine } from "../../engine/src/engine/index.js";
import type { GameEvent, ChoiceInstance } from "../../engine/src/types/index.js";
import { renderFullDisplay, renderEventLine } from "./renderer.js";
import { parseInput, executeCommand } from "./commands.js";

export interface GameLoopOptions {
  stepMode: boolean;
}

/**
 * Run the interactive game loop.
 */
export async function runGameLoop(
  engine: SSCCEngine,
  options: GameLoopOptions,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let stepMode = options.stepMode;
  let lastEvent: GameEvent | null = null;
  let lastLogIndex = 0;

  const prompt = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  try {
    // Main loop
    while (true) {
      // Advance phase
      const advanceResult = engine.advanceToNextEvent();
      if (advanceResult === null) {
        console.log("\n=== Game Over ===");
        break;
      }

      lastEvent = advanceResult.event;

      // Collect log notes generated by this event
      const fullLog = engine.getLog();
      const newEntries = fullLog.slice(lastLogIndex);
      lastLogIndex = fullLog.length;
      const notes = newEntries
        .filter((e) => e.type === "note" && e.eventId === lastEvent!.id)
        .map((e) => e.message);

      if (advanceResult.paused) {
        // Choice point — full display
        const choices = engine.enumerateChoices();
        console.log("\n" + renderFullDisplay(engine.getState(), lastEvent, choices));
        await handleChoiceLoop(engine, choices, lastEvent, rl, prompt);
        // Update log index after choices
        lastLogIndex = engine.getLog().length;
      } else if (stepMode) {
        // Step mode — show event, wait for input
        console.log(renderEventLine(lastEvent, notes));
        const input = await prompt("> ");
        const parsed = parseInput(input);

        if (parsed.type === "quit") break;
        if (parsed.type === "step") {
          stepMode = !stepMode;
          console.log(`  Step mode: ${stepMode ? "ON" : "OFF"}`);
        } else if (parsed.type === "help" || parsed.type === "log" || parsed.type === "rules" || parsed.type === "state") {
          const output = executeCommand(parsed, engine, lastEvent);
          if (output) console.log(output);
        }
        // "advance" (Enter) just continues the loop
      } else {
        // Auto-advance — condensed line
        console.log(renderEventLine(lastEvent, notes));
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Handle the choice selection loop at a pause point.
 */
async function handleChoiceLoop(
  engine: SSCCEngine,
  choices: ChoiceInstance[],
  lastEvent: GameEvent,
  rl: readline.Interface,
  prompt: (q: string) => Promise<string>,
): Promise<void> {
  while (engine.isPaused()) {
    const input = await prompt("> ");
    const parsed = parseInput(input);

    switch (parsed.type) {
      case "pass": {
        engine.passAllChoices();
        console.log("  Passed on all choices.");
        return;
      }

      case "choice": {
        const currentChoices = engine.enumerateChoices();
        const idx = parsed.index - 1;
        if (idx < 0 || idx >= currentChoices.length) {
          console.log(`  Invalid choice. Enter 1-${currentChoices.length} or 0 to pass.`);
          break;
        }
        const choice = currentChoices[idx];

        if (choice.pick) {
          // Need dice selection
          const diceInput = await prompt(`  Select ${choice.pick} dice: `);
          const diceParsed = parseInput(diceInput);
          if (diceParsed.type !== "dice") {
            console.log(`  Enter ${choice.pick} space-separated dice indices.`);
            break;
          }
          try {
            engine.applyChoice(choice.choiceInstanceId, { selectedDice: diceParsed.indices });
            console.log(`  Applied: ${choice.label}`);
          } catch (err: unknown) {
            console.log(`  Error: ${(err as Error).message}`);
            break;
          }
        } else {
          try {
            engine.applyChoice(choice.choiceInstanceId);
            console.log(`  Applied: ${choice.label}`);
          } catch (err: unknown) {
            console.log(`  Error: ${(err as Error).message}`);
            break;
          }
        }

        // After applying, check if still paused and re-render if so
        if (engine.isPaused()) {
          const newChoices = engine.enumerateChoices();
          if (newChoices.length > 0) {
            console.log("\n" + renderFullDisplay(engine.getState(), lastEvent, newChoices));
          }
        }
        break;
      }

      case "undo": {
        const check = engine.canUndoChoice(
          // Find the most recent choice in history — use last applied
          // We need the choice instance ID. The engine doesn't expose
          // the history directly, so we try the last enumerated choice
          // that was resolved. For now, use a simple approach: the
          // engine's undo works on instance IDs. We'll track them.
          getLastAppliedChoiceId(engine),
        );
        if (!check) {
          console.log("  Nothing to undo.");
          break;
        }
        if (check.requiresConfirm) {
          const confirm = await prompt("  Undo involves RNG effects. Confirm? (y/n): ");
          if (confirm.trim().toLowerCase() !== "y") {
            console.log("  Undo cancelled.");
            break;
          }
          engine.undoChoice(getLastAppliedChoiceId(engine), { confirm: true });
        } else {
          engine.undoChoice(getLastAppliedChoiceId(engine));
        }
        console.log("  Undo applied.");

        // Re-render
        const newChoices = engine.enumerateChoices();
        if (newChoices.length > 0) {
          console.log("\n" + renderFullDisplay(engine.getState(), lastEvent, newChoices));
        }
        break;
      }

      case "quit":
        process.exit(0);

      case "step": {
        // Can't toggle step mode inside choice loop, but acknowledge
        console.log("  (step mode changes take effect after this choice point)");
        break;
      }

      default: {
        const output = executeCommand(parsed, engine, lastEvent);
        if (output) {
          console.log(output);
        } else if (parsed.type === "unknown") {
          console.log(`  Unknown command: ${parsed.raw}. Type 'help' for commands.`);
        }
      }
    }
  }
}

/**
 * Get the last applied choice instance ID from the engine log.
 * Scans backward for the most recent choice_selected entry.
 */
function getLastAppliedChoiceId(engine: SSCCEngine): string {
  const log = engine.getLog();
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === "choice_selected" && log[i].data) {
      const data = log[i].data as Record<string, unknown>;
      if (typeof data.choiceInstanceId === "string") {
        return data.choiceInstanceId;
      }
    }
  }
  return "";
}
```

- [ ] **Step 5.2 — Verify it compiles**

Run: `cd cli && npx tsx --eval "import './src/game-loop.js'" 2>&1 || true`
Expected: No syntax errors (may fail on runtime imports, that's OK)

- [ ] **Step 5.3 — Commit**

```bash
git add cli/src/game-loop.ts
git commit -m "feat(m5a): implement CLI game loop with auto-advance and step mode"
```

---

## Task 6: Entry Point

**Files:**
- Create: `cli/src/index.ts`

- [ ] **Step 6.1 — Implement entry point**

Create `cli/src/index.ts`:

```typescript
import { resolve } from "node:path";
import { loadPack } from "../../engine/src/loader/index.js";
import { SSCCEngine } from "../../engine/src/engine/index.js";
import { runGameLoop } from "./game-loop.js";

function printUsage(): void {
  console.log("Usage: sscc-cli <pack-path> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --seed <N>   Fixed RNG seed (default: random)");
  console.log("  --step       Start in step-by-step mode");
  console.log("  --help       Show this help");
}

function parseArgs(args: string[]): {
  packPath: string;
  seed: number | undefined;
  stepMode: boolean;
} {
  let packPath = "";
  let seed: number | undefined;
  let stepMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--seed" && i + 1 < args.length) {
      seed = parseInt(args[++i], 10);
      if (isNaN(seed)) {
        console.error("Error: --seed requires a numeric value");
        process.exit(1);
      }
    } else if (arg === "--step") {
      stepMode = true;
    } else if (arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      packPath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!packPath) {
    console.error("Error: pack path is required");
    printUsage();
    process.exit(1);
  }

  return { packPath, seed, stepMode };
}

async function main(): Promise<void> {
  const { packPath, seed, stepMode } = parseArgs(process.argv.slice(2));
  const resolvedPath = resolve(packPath);

  console.log(`Loading pack from: ${resolvedPath}`);
  const result = await loadPack(resolvedPath);

  if (!result.ok) {
    console.error("Pack validation failed:");
    for (const err of result.errors) {
      console.error(`  ${err.field}: ${err.message}`);
    }
    process.exit(1);
  }

  const actualSeed = seed ?? Math.floor(Math.random() * 100000);
  console.log(`Seed: ${actualSeed}`);

  const engine = new SSCCEngine(result.pack!, { seed: actualSeed });
  engine.initialize();

  console.log(`Pack loaded: ${result.pack!.manifest.name}`);
  console.log(stepMode ? "Mode: step-by-step" : "Mode: auto-advance");
  console.log("Type 'help' for commands.\n");

  await runGameLoop(engine, { stepMode });
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
```

- [ ] **Step 6.2 — Verify it runs (with missing pack, expect clean error)**

Run: `cd cli && npx tsx src/index.ts --help`
Expected: Prints usage and exits

Run: `cd cli && npx tsx src/index.ts /nonexistent 2>&1 || true`
Expected: Error about file not found or pack validation

- [ ] **Step 6.3 — Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(m5a): implement CLI entry point with arg parsing"
```

---

## Task 7: cli-demo Pack

**Files:**
- Create: `packs/cli-demo/manifest.yaml`
- Create: `packs/cli-demo/initial_state.json`
- Create: `packs/cli-demo/timeline.yaml`
- Create: `packs/cli-demo/glossary.yaml`
- Create: `packs/cli-demo/rules.json`

- [ ] **Step 7.1 — Create manifest**

Create `packs/cli-demo/manifest.yaml`:

```yaml
id: cli-demo
name: CLI Demo Pack
version: 0.1.0
engine_version: "^0.2.0"
dependencies: []
```

- [ ] **Step 7.2 — Create initial state**

Create `packs/cli-demo/initial_state.json`:

```json
{
  "players": ["attacker", "defender"],
  "turnPlayer": "attacker",
  "battleRound": 1,
  "resources": {
    "attacker": { "cp": 3 },
    "defender": { "cp": 2 }
  },
  "units": {
    "tactical_squad": {
      "id": "tactical_squad",
      "owner": "attacker",
      "keywords": ["INFANTRY", "IMPERIUM"],
      "statuses": {},
      "attacks": 4,
      "ws": 3
    },
    "khorne_berzerkers": {
      "id": "khorne_berzerkers",
      "owner": "attacker",
      "keywords": ["INFANTRY", "KHORNE"],
      "statuses": {},
      "attacks": 3,
      "ws": 3
    },
    "intercessor_squad": {
      "id": "intercessor_squad",
      "owner": "defender",
      "keywords": ["INFANTRY", "PRIMARIS"],
      "statuses": {},
      "attacks": 2,
      "ws": 3
    },
    "hellblaster_squad": {
      "id": "hellblaster_squad",
      "owner": "defender",
      "keywords": ["INFANTRY", "PRIMARIS"],
      "statuses": {},
      "attacks": 3,
      "ws": 3
    }
  },
  "currentAttack": {},
  "blessingsActivated": 0,
  "usage": {}
}
```

- [ ] **Step 7.3 — Create timeline**

Create `packs/cli-demo/timeline.yaml`:

```yaml
timeline:
  - event: StartOfGame

  - event: BattleRoundStart

  - event: CommandPhaseStart

  - event: ShootingPhaseStart

  - event: RollToHit

  - event: BlessingsOfKhorne

  - event: BlessingsChoices

  - event: EndOfGame

subSequences: {}
```

- [ ] **Step 7.4 — Create glossary**

Create `packs/cli-demo/glossary.yaml`:

```yaml
keywords:
  - INFANTRY
  - IMPERIUM
  - KHORNE
  - PRIMARIS

selectors:
  attacking_unit:
    kind: unit
    byEventParam: unitId
```

- [ ] **Step 7.5 — Create rules**

Create `packs/cli-demo/rules.json`:

```json
[
  {
    "id": "setup_attack",
    "scope": "attack",
    "trigger": { "event": "RollToHit" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.currentAttack.hits", "value": 0 } },
      { "roll": { "count": { "path": "$.units.tactical_squad.attacks" }, "sides": 6, "storePath": "$.currentAttack.hitRolls" } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "demo" }
  },
  {
    "id": "offer_stratagem_reroll",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStart" },
    "when": {
      "resourceAtLeast": { "player": { "literal": "attacker" }, "resource": "cp", "amount": 1 }
    },
    "effect": [
      { "addChoice": {
          "id": "command_reroll_stratagem",
          "label": "Command Re-roll Stratagem (1 CP)",
          "actionRef": "doCommandReroll",
          "costs": { "cp": 1 }
      } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "demo" }
  },
  {
    "id": "do_command_reroll",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "eventParamEquals": { "param": "choiceId", "value": "command_reroll_stratagem" }
    },
    "effect": [
      { "consumeUsage": { "scope": "turn", "key": "command_reroll" } },
      { "appendLogNote": { "message": "Command Re-roll Stratagem activated" } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "demo" }
  },
  {
    "id": "roll_blessings",
    "scope": "global",
    "trigger": { "event": "BlessingsOfKhorne" },
    "when": { "all": [] },
    "effect": [
      { "roll": { "count": 8, "sides": 6, "storePath": "$.blessingsRoll", "defaults": { "rerolled": false, "spent": false } } },
      { "emit": { "eventId": "BlessingsChoices" } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "World Eaters" }
  },
  {
    "id": "offer_warp_blades",
    "scope": "global",
    "trigger": { "event": "BlessingsChoices" },
    "when": {
      "all": [
        { "any": [
          { "poolContainsPattern": { "pool": "$.blessingsRoll", "filter": { "spent": false }, "pattern": { "kind": "double", "minValue": 5 } } },
          { "poolContainsPattern": { "pool": "$.blessingsRoll", "filter": { "spent": false }, "pattern": { "kind": "triple" } } }
        ] },
        { "not": { "counterAtLeast": { "path": "$.blessingsActivated", "value": 2 } } }
      ]
    },
    "effect": [
      { "addChoice": {
          "id": "warp_blades",
          "label": "Warp Blades (double 5+ or triple)",
          "actionRef": "doActivateWarpBlades",
          "selectionFrom": { "path": "$.blessingsRoll" },
          "selectionFilter": { "spent": false },
          "pick": 2
      } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "World Eaters" }
  },
  {
    "id": "offer_wrathful_devotion",
    "scope": "global",
    "trigger": { "event": "BlessingsChoices" },
    "when": {
      "all": [
        { "poolContainsPattern": { "pool": "$.blessingsRoll", "filter": { "spent": false }, "pattern": { "kind": "double" } } },
        { "not": { "counterAtLeast": { "path": "$.blessingsActivated", "value": 2 } } }
      ]
    },
    "effect": [
      { "addChoice": {
          "id": "wrathful_devotion",
          "label": "Wrathful Devotion (any double)",
          "actionRef": "doActivateWrathfulDevotion",
          "selectionFrom": { "path": "$.blessingsRoll" },
          "selectionFilter": { "spent": false },
          "pick": 2
      } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "World Eaters" }
  },
  {
    "id": "do_activate_warp_blades",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "eventParamEquals": { "param": "choiceId", "value": "warp_blades" }
    },
    "effect": [
      { "spendDice": { "poolPath": "$.blessingsRoll", "dieIndices": { "fromChoice": "selectedDice" } } },
      { "modifyCounter": { "path": "$.blessingsActivated", "delta": 1 } },
      { "setValue": { "path": "$.blessings.warpBlades", "value": true } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "World Eaters" }
  },
  {
    "id": "do_activate_wrathful_devotion",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": {
      "eventParamEquals": { "param": "choiceId", "value": "wrathful_devotion" }
    },
    "effect": [
      { "spendDice": { "poolPath": "$.blessingsRoll", "dieIndices": { "fromChoice": "selectedDice" } } },
      { "modifyCounter": { "path": "$.blessingsActivated", "delta": 1 } },
      { "setValue": { "path": "$.blessings.wrathfulDevotion", "value": true } }
    ],
    "precedence": { "priority": 0, "strategy": "stack" },
    "provenance": { "source": "World Eaters" }
  }
]
```

- [ ] **Step 7.6 — Verify pack loads**

Run: `cd engine && npx tsx -e "
import { loadPack } from './src/loader/index.js';
const r = await loadPack('../packs/cli-demo');
console.log(r.ok ? 'OK' : JSON.stringify(r.errors));
"`
Expected: `OK`

- [ ] **Step 7.7 — Commit**

```bash
git add packs/cli-demo/
git commit -m "feat(m5a): add cli-demo pack for playtesting"
```

---

## Task 8: Smoke Test — Run the CLI

- [ ] **Step 8.1 — Run the CLI against cli-demo**

Run: `cd cli && npx tsx src/index.ts ../packs/cli-demo --seed 668`

Expected: The CLI should:
1. Print "Loading pack..." and "Seed: 668"
2. Auto-advance through StartOfGame, BattleRoundStart
3. Pause at CommandPhaseStart with stratagem choice
4. Show the 40k display with units, choices

Interact: type `0` to pass, let it advance to dice rolls, verify pool displays.

- [ ] **Step 8.2 — Test step mode**

Run: `cd cli && npx tsx src/index.ts ../packs/cli-demo --seed 668 --step`

Expected: Pauses at each event, press Enter to advance.

- [ ] **Step 8.3 — Test undo**

At a blessings choice point, select a blessing, then type `undo`.
Expected: State reverts, choices re-offered.

- [ ] **Step 8.4 — Test debug commands**

Type `state $.units`, `log`, `rules`, `help`.
Expected: Each produces appropriate output.

- [ ] **Step 8.5 — Fix any issues found during smoke testing**

If anything doesn't work, fix it and re-test.

- [ ] **Step 8.6 — Commit any fixes**

```bash
git add -A
git commit -m "fix(m5a): CLI smoke test fixes"
```

(Skip this commit if no fixes were needed.)

---

## Task 9: Final Validation

- [ ] **Step 9.1 — Run engine tests**

Run: `cd engine && npx vitest run`
Expected: All 186+ tests PASS

- [ ] **Step 9.2 — Run CLI tests**

Run: `cd cli && npx vitest run`
Expected: All renderer and command tests PASS

- [ ] **Step 9.3 — TypeScript check on engine**

Run: `cd engine && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9.4 — Verify clean working tree**

Run: `git status`
Expected: Clean
