# Milestone 5B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement command phase (battleshock + stratagems), minimal movement phase gating, datasheet layer, and `computePoolSum` engine effect.

**Architecture:** Two engine additions (computePoolSum effect, datasheet merging in loader) plus a new 40k pack that exercises the full command + movement flow. All battleshock/stratagem logic lives in pack rules using existing engine primitives.

**Tech Stack:** TypeScript, vitest, YAML/JSON packs, SSCC engine

---

### Task 1: Add `computePoolSum` Effect Type

**Files:**
- Modify: `engine/src/types/rules.ts:41-61`

- [ ] **Step 1: Add the new union member to the Effect type**

In `engine/src/types/rules.ts`, add a new member to the `Effect` type union at line 61, before the closing semicolon:

```typescript
export type Effect =
  | { applyStatus: { target: TargetRef; key: string; expiresOn?: string } }
  | { removeStatus: { target: TargetRef; key: string } }
  | { setValue: { path: string; value?: unknown; valueFromPath?: string; valueFromEventParam?: string } }
  | { modifyCounter: { path: string; delta?: number; deltaFromPath?: string } }
  | { addProhibition: { target: TargetRef; action: string; reason: string } }
  | { removeProhibition: { target: TargetRef; action: string; reason: string } }
  | { addChoice: { id: string; label: string; actionRef: string; limits?: Record<string, unknown>; costs?: Record<string, unknown>; selectionFrom?: TargetRef; selectionFilter?: Record<string, unknown>; pick?: number } }
  | { consumeUsage: { scope: string; key: string } }
  | { resetUsage: { scope: string; keys: string[] } }
  | { emit: { eventId: string; params?: Record<string, unknown> } }
  | { award: { target: PlayerRef; resource: string; amount: number } }
  | { spendResource: { target: PlayerRef; resource: string; amount: number } }
  | { appendLogNote: { message: string } }
  | { ensureExists: { path: string; defaultValue: unknown } }
  | { mergeInto: { path: string; value: Record<string, unknown> } }
  | { roll: { count: number | { path: string }; sides?: number; storePath: string; defaults?: Record<string, unknown> } }
  | { rerollDie: { poolPath: string; dieIndex: number | { path: string }; sides?: number } }
  | { rerollPool: { poolPath: string; sides?: number } }
  | { spendDice: { poolPath: string; dieIndices: number[] | { fromChoice: string } } }
  | { setSeed: { seed: number } }
  | { computePoolSum: { poolPath: string; targetPath: string; skipSpent?: boolean } };
```

No other file changes needed -- `EffectVerb` auto-derives from the union.

- [ ] **Step 2: Verify the project still compiles**

Run: `cd engine && npx tsc --noEmit`
Expected: Clean compile (0 errors). The new type is added but not yet handled in `executeEffect`, which is fine -- TypeScript won't error because `executeEffect` uses if-else chains, not exhaustive switch.

- [ ] **Step 3: Commit**

```bash
git add engine/src/types/rules.ts
git commit -m "feat(m5b): add computePoolSum to Effect type union"
```

---

### Task 2: Implement `computePoolSum` Effect Handler (TDD)

**Files:**
- Create: `engine/tests/unit/effects-pool-sum.test.ts`
- Modify: `engine/src/rules/effects.ts:342-357`

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/unit/effects-pool-sum.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executeEffect } from "../../src/rules/effects.js";
import type { Effect, GameEvent, State, Glossary } from "../../src/types/index.js";
import { get } from "../../src/state/index.js";

const glossary: Glossary = { keywords: [], selectors: {} };
const baseEvent: GameEvent = { id: "BattleshockTestResolve", params: { player: "A" } };

function exec(effect: Effect, state: State) {
  return executeEffect(state, effect, baseEvent, "test-rule", glossary);
}

describe("computePoolSum effect", () => {
  it("sums all dice values in pool and writes to targetPath", () => {
    const state: State = {
      battleshock: {
        rollResult: {
          count: 2,
          d0: { value: 3, rerolled: false },
          d1: { value: 5, rerolled: false },
        },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.battleshock.rollResult", targetPath: "$.battleshock.sum" } },
      state,
    );
    expect(get(result.state, "$.battleshock.sum")).toBe(8);
  });

  it("skips spent dice when skipSpent is true", () => {
    const state: State = {
      pool: {
        count: 3,
        d0: { value: 4, rerolled: false, spent: false },
        d1: { value: 2, rerolled: false, spent: true },
        d2: { value: 6, rerolled: false, spent: false },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.pool", targetPath: "$.poolTotal", skipSpent: true } },
      state,
    );
    expect(get(result.state, "$.poolTotal")).toBe(10);
  });

  it("includes spent dice when skipSpent is false/absent", () => {
    const state: State = {
      pool: {
        count: 2,
        d0: { value: 3, rerolled: false, spent: true },
        d1: { value: 4, rerolled: false, spent: false },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.pool", targetPath: "$.total" } },
      state,
    );
    expect(get(result.state, "$.total")).toBe(7);
  });

  it("writes 0 for empty pool", () => {
    const state: State = {
      pool: { count: 0 },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.pool", targetPath: "$.total" } },
      state,
    );
    expect(get(result.state, "$.total")).toBe(0);
  });

  it("throws when pool has no count", () => {
    const state: State = { pool: {} };
    expect(() =>
      exec(
        { computePoolSum: { poolPath: "$.pool", targetPath: "$.total" } },
        state,
      ),
    ).toThrow();
  });

  it("logs the sum result", () => {
    const state: State = {
      roll: {
        count: 2,
        d0: { value: 1, rerolled: false },
        d1: { value: 6, rerolled: false },
      },
    };
    const result = exec(
      { computePoolSum: { poolPath: "$.roll", targetPath: "$.sum" } },
      state,
    );
    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0].message).toContain("7");
    expect(result.logEntries[0].message).toContain("$.roll");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/effects-pool-sum.test.ts`
Expected: All 6 tests FAIL -- "Unknown effect verb" error thrown at line 357 of effects.ts.

- [ ] **Step 3: Implement the handler**

In `engine/src/rules/effects.ts`, add the following block before the `throw new Error` at line 357 (after the `setSeed` handler that ends at line 355):

```typescript
  if ("computePoolSum" in effect) {
    const { poolPath, targetPath, skipSpent } = effect.computePoolSum;
    const count = get(state, `${poolPath}.count`);
    if (typeof count !== "number") throw new Error(`No pool count at ${poolPath}`);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const die = get(state, `${poolPath}.d${i}`) as Record<string, unknown> | undefined;
      if (!die) continue;
      if (skipSpent && die.spent === true) continue;
      sum += die.value as number;
    }
    result.state = set(state, targetPath, sum);
    result.logEntries.push({
      type: "note",
      message: `computePoolSum: ${poolPath} -> ${sum} at ${targetPath}`,
      ruleId: sourceRuleId,
      eventId: event.id,
    });
    return result;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/effects-pool-sum.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `cd engine && npx vitest run`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add engine/tests/unit/effects-pool-sum.test.ts engine/src/rules/effects.ts
git commit -m "feat(m5b): implement computePoolSum effect handler"
```

---

### Task 3: Create Datasheet Parser Module (TDD)

**Files:**
- Create: `engine/src/loader/datasheets.ts`
- Create: `engine/tests/unit/datasheets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `engine/tests/unit/datasheets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDatasheets, mergeDatasheets } from "../../src/loader/datasheets.js";
import type { State } from "../../src/types/index.js";

describe("parseDatasheets", () => {
  it("parses a valid datasheets object", () => {
    const raw = {
      datasheets: {
        intercessor_squad: {
          name: "Intercessor Squad",
          keywords: ["INFANTRY"],
          stats: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
          profiles: {
            ranged: { id: "wp_bolt", name: "Bolt Rifle", A: 2, BS: 3, S: 4, AP: -1, D: 1, keywords: [] },
          },
        },
      },
    };
    const result = parseDatasheets(raw);
    expect(result.get("intercessor_squad")).toBeDefined();
    expect(result.get("intercessor_squad")!.name).toBe("Intercessor Squad");
    expect(result.get("intercessor_squad")!.stats.Ld).toBe(6);
  });

  it("returns empty map for undefined input", () => {
    const result = parseDatasheets(undefined);
    expect(result.size).toBe(0);
  });

  it("returns empty map for null input", () => {
    const result = parseDatasheets(null);
    expect(result.size).toBe(0);
  });
});

describe("mergeDatasheets", () => {
  const datasheets = new Map([
    [
      "intercessor_squad",
      {
        name: "Intercessor Squad",
        keywords: ["INFANTRY"],
        stats: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
        profiles: {
          ranged: { id: "wp_bolt", name: "Bolt Rifle", A: 2, BS: 3, S: 4, AP: -1, D: 1, keywords: [] as string[] },
        },
      },
    ],
  ]);

  it("merges datasheet fields into unit state", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          datasheet: "intercessor_squad",
          models: { total: 5, remaining: 5 },
          statuses: {},
        },
      },
    };
    const { state: merged, errors } = mergeDatasheets(state, datasheets);
    expect(errors).toHaveLength(0);
    const u1 = (merged as any).units.u1;
    expect(u1.name).toBe("Intercessor Squad");
    expect(u1.keywords).toEqual(["INFANTRY"]);
    expect(u1.stats.Ld).toBe(6);
    expect(u1.profiles.ranged.id).toBe("wp_bolt");
    expect(u1.datasheet).toBeUndefined();
  });

  it("unit-level fields override datasheet fields", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          datasheet: "intercessor_squad",
          name: "Custom Name",
          models: { total: 5, remaining: 5 },
          statuses: {},
        },
      },
    };
    const { state: merged } = mergeDatasheets(state, datasheets);
    expect((merged as any).units.u1.name).toBe("Custom Name");
  });

  it("returns error for missing datasheet reference", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          datasheet: "nonexistent",
          models: { total: 5, remaining: 5 },
          statuses: {},
        },
      },
    };
    const { errors } = mergeDatasheets(state, datasheets);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("DATASHEET_NOT_FOUND");
    expect(errors[0].message).toContain("nonexistent");
  });

  it("skips units without datasheet field", () => {
    const state: State = {
      units: {
        u1: {
          id: "u1",
          owner: "A",
          name: "Manual Unit",
          keywords: ["VEHICLE"],
          stats: { M: 10, T: 8, Sv: 2, W: 12, Ld: 7, OC: 4 },
          models: { total: 1, remaining: 1 },
          statuses: {},
        },
      },
    };
    const { state: merged, errors } = mergeDatasheets(state, datasheets);
    expect(errors).toHaveLength(0);
    expect((merged as any).units.u1.name).toBe("Manual Unit");
  });

  it("works when datasheets map is empty", () => {
    const state: State = {
      units: {
        u1: { id: "u1", owner: "A", models: { total: 5, remaining: 5 }, statuses: {} },
      },
    };
    const { state: merged, errors } = mergeDatasheets(state, new Map());
    expect(errors).toHaveLength(0);
    expect(merged).toEqual(state);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/datasheets.test.ts`
Expected: FAIL -- cannot import `parseDatasheets` / `mergeDatasheets` (module does not exist).

- [ ] **Step 3: Implement the datasheet module**

Create `engine/src/loader/datasheets.ts`:

```typescript
import type { State } from "../types/index.js";
import type { ValidationError } from "../types/index.js";

export interface Datasheet {
  name: string;
  keywords: string[];
  stats: Record<string, number>;
  profiles?: Record<string, Record<string, unknown>>;
}

/**
 * Parse raw YAML data into a datasheet map.
 * Returns empty map if input is undefined/null (file not found).
 */
export function parseDatasheets(data: unknown): Map<string, Datasheet> {
  if (data === null || data === undefined) return new Map();
  const raw = data as Record<string, unknown>;
  const sheets = raw.datasheets as Record<string, unknown> | undefined;
  if (!sheets) return new Map();

  const result = new Map<string, Datasheet>();
  for (const [id, def] of Object.entries(sheets)) {
    result.set(id, def as Datasheet);
  }
  return result;
}

/**
 * Merge datasheet definitions into unit state entries.
 * For each unit with a `datasheet` field, look up the datasheet and
 * merge name, keywords, stats, profiles. Unit-level fields win on conflict.
 * Strips the `datasheet` field after merging.
 */
export function mergeDatasheets(
  state: State,
  datasheets: Map<string, Datasheet>,
): { state: State; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const units = (state as Record<string, unknown>).units as Record<string, Record<string, unknown>> | undefined;
  if (!units) return { state, errors };

  const newUnits: Record<string, unknown> = {};
  for (const [unitId, unit] of Object.entries(units)) {
    const dsId = unit.datasheet as string | undefined;
    if (!dsId) {
      newUnits[unitId] = unit;
      continue;
    }

    const ds = datasheets.get(dsId);
    if (!ds) {
      errors.push({
        code: "DATASHEET_NOT_FOUND",
        message: `Unit "${unitId}" references datasheet "${dsId}" which does not exist`,
      });
      newUnits[unitId] = unit;
      continue;
    }

    // Merge: datasheet first, then unit overrides
    const { datasheet: _, ...unitWithoutDs } = unit;
    const merged = {
      name: ds.name,
      keywords: [...ds.keywords],
      stats: { ...ds.stats },
      ...(ds.profiles ? { profiles: { ...ds.profiles } } : {}),
      ...unitWithoutDs,
    };
    newUnits[unitId] = merged;
  }

  return {
    state: { ...state, units: newUnits } as State,
    errors,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/datasheets.test.ts`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add engine/src/loader/datasheets.ts engine/tests/unit/datasheets.test.ts
git commit -m "feat(m5b): implement datasheet parser and merger"
```

---

### Task 4: Integrate Datasheets into Pack Loader

**Files:**
- Modify: `engine/src/loader/index.ts`
- Create: `engine/tests/unit/loader-datasheets.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `engine/tests/unit/loader-datasheets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import yaml from "js-yaml";

const TMP_DIR = join(import.meta.dirname, "../tmp-datasheet-test");

async function writePack(opts: { datasheets?: unknown; units: Record<string, unknown> }) {
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(join(TMP_DIR, "manifest.yaml"), yaml.dump({
    id: "ds-test", name: "Datasheet Test", version: "0.1.0", engine_version: "^0.2.0", dependencies: [],
  }));
  await writeFile(join(TMP_DIR, "timeline.yaml"), yaml.dump({
    timeline: [{ event: "StartOfGame" }], subSequences: {},
  }));
  await writeFile(join(TMP_DIR, "glossary.yaml"), yaml.dump({
    keywords: ["INFANTRY"], selectors: {},
  }));
  await writeFile(join(TMP_DIR, "rules.json"), "[]");
  await writeFile(join(TMP_DIR, "initial_state.json"), JSON.stringify({ units: opts.units }));
  if (opts.datasheets) {
    await writeFile(join(TMP_DIR, "datasheets.yaml"), yaml.dump(opts.datasheets));
  }
}

async function cleanup() {
  await rm(TMP_DIR, { recursive: true, force: true });
}

describe("loadPack with datasheets", () => {
  it("merges datasheet into unit state", async () => {
    await writePack({
      datasheets: {
        datasheets: {
          marine: {
            name: "Space Marine",
            keywords: ["INFANTRY"],
            stats: { M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 },
          },
        },
      },
      units: {
        u1: { id: "u1", owner: "A", datasheet: "marine", models: { total: 5, remaining: 5 }, statuses: {} },
      },
    });
    const result = await loadPack(TMP_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const u1 = (result.pack.initialState as any).units.u1;
    expect(u1.name).toBe("Space Marine");
    expect(u1.stats.Ld).toBe(6);
    expect(u1.datasheet).toBeUndefined();
    await cleanup();
  });

  it("loads successfully without datasheets.yaml", async () => {
    await writePack({
      units: {
        u1: { id: "u1", owner: "A", name: "Manual", models: { total: 1, remaining: 1 }, statuses: {} },
      },
    });
    const result = await loadPack(TMP_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.pack.initialState as any).units.u1.name).toBe("Manual");
    await cleanup();
  });

  it("returns error for missing datasheet reference", async () => {
    await writePack({
      datasheets: { datasheets: {} },
      units: {
        u1: { id: "u1", owner: "A", datasheet: "ghost", models: { total: 1, remaining: 1 }, statuses: {} },
      },
    });
    const result = await loadPack(TMP_DIR);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "DATASHEET_NOT_FOUND")).toBe(true);
    await cleanup();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && npx vitest run tests/unit/loader-datasheets.test.ts`
Expected: First test FAILS -- units won't have `name` or `stats` because the loader doesn't read datasheets yet.

- [ ] **Step 3: Integrate datasheets into the loader**

In `engine/src/loader/index.ts`, add the import at the top (after existing imports):

```typescript
import { parseDatasheets, mergeDatasheets } from "./datasheets.js";
```

Then modify the `loadPack` function. After the existing file reads (after `stateData`), add the datasheets read:

```typescript
  let datasheetsData: unknown = undefined;
  try {
    const datasheetsRaw = await readFile(join(packPath, "datasheets.yaml"), "utf-8");
    datasheetsData = yaml.load(datasheetsRaw);
  } catch {
    // Optional file -- ignore if not found
  }
```

After `const initialState = parseInitialState(stateData);` (around line 71), add:

```typescript
  // Merge datasheets into initial state
  const datasheets = parseDatasheets(datasheetsData);
  const { state: mergedState, errors: dsErrors } = mergeDatasheets(initialState, datasheets);
  if (dsErrors.length > 0) {
    return { ok: false, errors: dsErrors };
  }
```

Then replace `initialState` with `mergedState` in the `pack` object that's returned. Change:

```typescript
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
```

to:

```typescript
  const pack: LoadedPack = {
    manifest,
    timeline,
    subSequences,
    glossary,
    rules,
    rulesByEvent,
    initialState: mergedState,
    allEventIds,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && npx vitest run tests/unit/loader-datasheets.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite to check nothing broke**

Run: `cd engine && npx vitest run`
Expected: All existing tests still pass (existing packs don't have datasheets.yaml, loader silently skips).

- [ ] **Step 6: Commit**

```bash
git add engine/src/loader/index.ts engine/src/loader/datasheets.ts engine/tests/unit/loader-datasheets.test.ts
git commit -m "feat(m5b): integrate datasheet loading into pack loader"
```

---

### Task 5: Create MS 5B Pack -- Datasheets and Initial State

**Files:**
- Create: `packs/wh40k-10e-ms5b/manifest.yaml`
- Create: `packs/wh40k-10e-ms5b/datasheets.yaml`
- Create: `packs/wh40k-10e-ms5b/initial_state.json`

- [ ] **Step 1: Create manifest**

Create `packs/wh40k-10e-ms5b/manifest.yaml`:

```yaml
id: wh40k-10e-ms5b
name: "Warhammer 40,000 10th Edition - MS 5B Command & Movement"
version: 0.1.0
engine_version: "^0.2.0"
dependencies: []
```

- [ ] **Step 2: Create datasheets**

Create `packs/wh40k-10e-ms5b/datasheets.yaml`:

```yaml
datasheets:
  intercessor_squad:
    name: "Intercessor Squad"
    keywords: [INFANTRY, IMPERIUM, ADEPTUS ASTARTES]
    stats:
      M: 6
      T: 4
      Sv: 3
      W: 2
      Ld: 6
      OC: 2
    profiles:
      ranged:
        id: wp_bolt_rifle
        name: "Bolt Rifle"
        A: 2
        BS: 3
        S: 4
        AP: -1
        D: 1
        keywords: [RAPID FIRE 1]
      melee:
        id: wp_close_combat
        name: "Close Combat Weapon"
        A: 3
        WS: 3
        S: 4
        AP: 0
        D: 1
        keywords: []

  hellblaster_squad:
    name: "Hellblaster Squad"
    keywords: [INFANTRY, IMPERIUM, ADEPTUS ASTARTES]
    stats:
      M: 6
      T: 4
      Sv: 3
      W: 2
      Ld: 6
      OC: 2
    profiles:
      ranged:
        id: wp_plasma_incinerator
        name: "Plasma Incinerator"
        A: 2
        BS: 3
        S: 8
        AP: -3
        D: 2
        keywords: [HEAVY]
      melee:
        id: wp_close_combat
        name: "Close Combat Weapon"
        A: 3
        WS: 3
        S: 4
        AP: 0
        D: 1
        keywords: []

  ork_boyz:
    name: "Ork Boyz"
    keywords: [INFANTRY, ORK]
    stats:
      M: 6
      T: 5
      Sv: 5
      W: 1
      Ld: 7
      OC: 2
    profiles:
      ranged:
        id: wp_slugga
        name: "Slugga"
        A: 1
        BS: 5
        S: 4
        AP: 0
        D: 1
        keywords: [PISTOL]
      melee:
        id: wp_choppa
        name: "Choppa"
        A: 3
        WS: 3
        S: 4
        AP: -1
        D: 1
        keywords: []

  lootas:
    name: "Lootas"
    keywords: [INFANTRY, ORK]
    stats:
      M: 6
      T: 5
      Sv: 5
      W: 1
      Ld: 7
      OC: 1
    profiles:
      ranged:
        id: wp_deffgun
        name: "Deffgun"
        A: 3
        BS: 5
        S: 7
        AP: -1
        D: 2
        keywords: [HEAVY]
      melee:
        id: wp_close_combat
        name: "Close Combat Weapon"
        A: 2
        WS: 4
        S: 4
        AP: 0
        D: 1
        keywords: []
```

- [ ] **Step 3: Create initial state**

Create `packs/wh40k-10e-ms5b/initial_state.json`:

```json
{
  "totalRounds": 5,
  "round": 1,
  "turnPlayer": null,
  "players": ["A", "B"],
  "resources": {
    "A": { "cp": 0 },
    "B": { "cp": 0 }
  },
  "activation": {
    "unitId": null,
    "type": null
  },
  "units": {
    "u1": {
      "id": "u1",
      "owner": "A",
      "datasheet": "intercessor_squad",
      "models": { "total": 5, "remaining": 5 },
      "statuses": {},
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    },
    "u2": {
      "id": "u2",
      "owner": "A",
      "datasheet": "hellblaster_squad",
      "models": { "total": 5, "remaining": 2 },
      "statuses": { "below_half_strength": {} },
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    },
    "u3": {
      "id": "u3",
      "owner": "B",
      "datasheet": "ork_boyz",
      "models": { "total": 10, "remaining": 10 },
      "statuses": {},
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    },
    "u4": {
      "id": "u4",
      "owner": "B",
      "datasheet": "lootas",
      "models": { "total": 5, "remaining": 1 },
      "statuses": { "below_half_strength": {} },
      "eligibility": {
        "shoot": { "prohibitions": [] },
        "charge": { "prohibitions": [] }
      }
    }
  },
  "battleshock": {
    "pendingUnits": [],
    "pendingIndex": 0,
    "currentUnitId": null,
    "rollResult": null,
    "sum": null,
    "autoPass": false
  },
  "charge": {
    "targetUnitId": null,
    "rollResult": null,
    "distance": null
  },
  "usage": {},
  "statuses": {}
}
```

- [ ] **Step 4: Commit**

```bash
git add packs/wh40k-10e-ms5b/manifest.yaml packs/wh40k-10e-ms5b/datasheets.yaml packs/wh40k-10e-ms5b/initial_state.json
git commit -m "feat(m5b): add ms5b pack datasheets and initial state"
```

---

### Task 6: Create MS 5B Pack -- Timeline and Glossary

**Files:**
- Create: `packs/wh40k-10e-ms5b/timeline.yaml`
- Create: `packs/wh40k-10e-ms5b/glossary.yaml`

- [ ] **Step 1: Create timeline**

Create `packs/wh40k-10e-ms5b/timeline.yaml` (identical structure to `wh40k-10e-core-turn`):

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

              - subSequence: commandPhase
                params: [player]

              - subSequence: movementPhase
                params: [player]

              - subSequence: shootingPhase
                params: [player]

              - subSequence: chargePhase
                params: [player]

              - subSequence: fightPhase
                params: [player]

              - subSequence: endPhase
                params: [player]

              - event: TurnEnded
                params: [player]

        - event: RoundEnded
          params: [round]

  - event: EndOfGame

subSequences:
  commandPhase:
    params: [player]
    body:
      - event: CommandPhaseStarted
        params: [player]
      - event: CommandPhaseEnded
        params: [player]

  movementPhase:
    params: [player]
    body:
      - event: MovementPhaseStarted
        params: [player]
      - event: MovementPhaseEnded
        params: [player]

  shootingPhase:
    params: [player]
    body:
      - event: ShootingPhaseStarted
        params: [player]
      - event: ShootingPhaseEnded
        params: [player]

  chargePhase:
    params: [player]
    body:
      - event: ChargePhaseStarted
        params: [player]
      - event: ChargePhaseEnded
        params: [player]

  fightPhase:
    params: [player]
    body:
      - event: FightPhaseStarted
        params: [player]
      - event: FightPhaseEnded
        params: [player]

  endPhase:
    params: [player]
    body:
      - event: EndPhaseStarted
        params: [player]
      - event: EndPhaseEnded
        params: [player]
```

- [ ] **Step 2: Create glossary**

Create `packs/wh40k-10e-ms5b/glossary.yaml`:

```yaml
keywords:
  - INFANTRY
  - VEHICLE
  - CHARACTER
  - MONSTER
  - IMPERIUM
  - ADEPTUS ASTARTES
  - ORK

statuses:
  can_move:
    description: "Unit is eligible to activate in the Movement phase"
  can_shoot:
    description: "Unit is eligible to activate in the Shooting phase"
  can_charge:
    description: "Unit is eligible to activate in the Charge phase"
  can_fight:
    description: "Unit is eligible to activate in the Fight phase"
  advanced_move:
    description: "Unit advanced this turn"
  fell_back:
    description: "Unit fell back this turn"
  remained_stationary:
    description: "Unit remained stationary this turn"
  charged:
    description: "Unit successfully charged this turn"
  battleshocked:
    description: "Unit failed its Battleshock test"
  below_half_strength:
    description: "Unit has lost more than half its models"
  in_engagement_range:
    description: "Unit is within engagement range of an enemy unit"

reason_keys:
  shoot:
    - advanced_move
    - fell_back
  charge:
    - advanced_move
    - fell_back

selectors:
  active_player_units:
    kind: unit
    where:
      pathEquals:
        path: "$.turnPlayer"
        valueFromEventParam: player

  units_can_move:
    kind: unit
    where:
      hasStatus: can_move

  units_can_shoot:
    kind: unit
    where:
      hasStatus: can_shoot

  units_can_charge:
    kind: unit
    where:
      hasStatus: can_charge

  units_can_fight:
    kind: unit
    where:
      hasStatus: can_fight

  units_advanced:
    kind: unit
    where:
      hasStatus: advanced_move

  units_fell_back:
    kind: unit
    where:
      hasStatus: fell_back

  units_battleshocked:
    kind: unit
    where:
      hasStatus: battleshocked

  units_below_half_strength:
    kind: unit
    where:
      hasStatus: below_half_strength

  active_player_below_half:
    kind: unit
    where:
      all:
        - hasStatus: below_half_strength
        - pathEquals:
            path: "$.turnPlayer"
            valueFromEventParam: player
```

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-ms5b/timeline.yaml packs/wh40k-10e-ms5b/glossary.yaml
git commit -m "feat(m5b): add ms5b pack timeline and glossary"
```

---

### Task 7: Create MS 5B Pack -- Movement Rules

**Files:**
- Create: `packs/wh40k-10e-ms5b/rules.json` (start with movement + turn setup rules)

- [ ] **Step 1: Create rules.json with turn setup and movement rules**

Create `packs/wh40k-10e-ms5b/rules.json`. This is the full rules file -- we'll add battleshock rules to it in the next task.

Start with these rules (carried from `wh40k-10e-core-turn` with one modification -- Fall Back gated behind `in_engagement_range`):

```json
[
  {
    "id": "CORE.Turn.SetPlayer.1",
    "scope": "global",
    "trigger": { "event": "TurnStarted" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.turnPlayer", "valueFromEventParam": "player" } }
    ],
    "precedence": { "priority": 1, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set turnPlayer so selectors can identify active player units" }
  },
  {
    "id": "CORE.Turn.ClearActivation.1",
    "scope": "global",
    "trigger": { "event": "TurnStarted" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.activation.unitId", "value": null } },
      { "setValue": { "path": "$.activation.type", "value": null } }
    ],
    "precedence": { "priority": 2, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Clear activation context at start of each turn" }
  },
  {
    "id": "CORE.Move.Grant.1",
    "scope": "global",
    "trigger": { "event": "MovementPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "applyStatus": { "target": { "selector": "active_player_units" }, "key": "can_move" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Grant can_move to all active player units" }
  },
  {
    "id": "CORE.Move.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "MovementPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_can_move" } }] },
    "effect": [
      { "addChoice": { "id": "select_unit_to_move", "label": "Select a unit to move", "actionRef": "CORE.Move.SelectAction.1", "selectionFrom": { "selector": "units_can_move" } } }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection at start of movement phase" }
  },
  {
    "id": "CORE.Move.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_move" } }] },
    "effect": [
      { "addChoice": { "id": "select_unit_to_move", "label": "Select a unit to move", "actionRef": "CORE.Move.SelectAction.1", "selectionFrom": { "selector": "units_can_move" } } }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer unit selection after each activation" }
  },
  {
    "id": "CORE.Move.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_move" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.unitId", "valueFromEventParam": "selectedUnitId" } },
      { "emit": { "eventId": "UnitMovementStarted", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and emit UnitMovementStarted" }
  },
  {
    "id": "CORE.Move.OfferTypes.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementStarted" },
    "when": { "all": [] },
    "effect": [
      { "addChoice": { "id": "move_normal", "label": "Normal Move", "actionRef": "CORE.Move.TypeAction.Normal.1" } },
      { "addChoice": { "id": "move_advance", "label": "Advance", "actionRef": "CORE.Move.TypeAction.Advance.1" } },
      { "addChoice": { "id": "move_stationary", "label": "Remain Stationary", "actionRef": "CORE.Move.TypeAction.Stationary.1" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer Normal, Advance, Stationary. Fall Back offered separately only when in engagement range." }
  },
  {
    "id": "CORE.Move.OfferFallBack.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementStarted" },
    "when": { "all": [{ "hasStatus": { "target": { "path": "$.activation.unitId" }, "key": "in_engagement_range" } }] },
    "effect": [
      { "addChoice": { "id": "move_fall_back", "label": "Fall Back", "actionRef": "CORE.Move.TypeAction.FallBack.1" } }
    ],
    "precedence": { "priority": 11, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Fall Back only available to units in engagement range" }
  },
  {
    "id": "CORE.Move.TypeAction.Normal.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "move_normal" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.type", "value": "normal_move" } },
      { "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Normal move -- no status applied" }
  },
  {
    "id": "CORE.Move.TypeAction.Advance.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "move_advance" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.type", "value": "advance" } },
      { "applyStatus": { "target": { "path": "$.activation.unitId" }, "key": "advanced_move", "expiresOn": "TurnEnded" } },
      { "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Advance -- apply advanced_move status" }
  },
  {
    "id": "CORE.Move.TypeAction.FallBack.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "move_fall_back" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.type", "value": "fall_back" } },
      { "applyStatus": { "target": { "path": "$.activation.unitId" }, "key": "fell_back", "expiresOn": "TurnEnded" } },
      { "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Fall Back -- apply fell_back status" }
  },
  {
    "id": "CORE.Move.TypeAction.Stationary.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "move_stationary" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.type", "value": "remain_stationary" } },
      { "applyStatus": { "target": { "path": "$.activation.unitId" }, "key": "remained_stationary", "expiresOn": "TurnEnded" } },
      { "emit": { "eventId": "UnitMovementEnded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Remain Stationary -- apply remained_stationary status" }
  },
  {
    "id": "CORE.Move.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitMovementEnded" },
    "when": { "all": [] },
    "effect": [
      { "removeStatus": { "target": { "path": "$.activation.unitId" }, "key": "can_move" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_move from activated unit" }
  },
  {
    "id": "CORE.Shoot.Prohibit.Advanced.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_advanced" } }] },
    "effect": [
      { "addProhibition": { "target": { "selector": "units_advanced" }, "action": "shoot", "reason": "advanced_move" } }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that advanced cannot shoot" }
  },
  {
    "id": "CORE.Shoot.Prohibit.FellBack.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_fell_back" } }] },
    "effect": [
      { "addProhibition": { "target": { "selector": "units_fell_back" }, "action": "shoot", "reason": "fell_back" } }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that fell back cannot shoot" }
  },
  {
    "id": "CORE.Shoot.Grant.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "applyStatus": { "target": { "selector": "active_player_units" }, "key": "can_shoot" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Grant can_shoot to active player units" }
  },
  {
    "id": "CORE.Shoot.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "ShootingPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_can_shoot" } }] },
    "effect": [
      { "addChoice": { "id": "select_unit_to_shoot", "label": "Select a unit to shoot with", "actionRef": "CORE.Shoot.SelectAction.1", "selectionFrom": { "selector": "units_can_shoot" } } }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection for shooting" }
  },
  {
    "id": "CORE.Shoot.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitShootingEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_shoot" } }] },
    "effect": [
      { "addChoice": { "id": "select_unit_to_shoot", "label": "Select a unit to shoot with", "actionRef": "CORE.Shoot.SelectAction.1", "selectionFrom": { "selector": "units_can_shoot" } } }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer unit selection after each shooting activation" }
  },
  {
    "id": "CORE.Shoot.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_shoot" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.unitId", "valueFromEventParam": "selectedUnitId" } },
      { "setValue": { "path": "$.activation.type", "value": "shoot" } },
      { "emit": { "eventId": "UnitShootingStarted", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and begin shooting activation" }
  },
  {
    "id": "CORE.Shoot.PassThrough.1",
    "scope": "global",
    "trigger": { "event": "UnitShootingStarted" },
    "when": { "all": [] },
    "effect": [
      { "appendLogNote": { "message": "Shooting activation -- attack pipeline not implemented (MS 5C)" } },
      { "emit": { "eventId": "UnitShootingEnded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton pass-through. MS 5C adds attack resolution." }
  },
  {
    "id": "CORE.Shoot.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitShootingEnded" },
    "when": { "all": [] },
    "effect": [
      { "removeStatus": { "target": { "path": "$.activation.unitId" }, "key": "can_shoot" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_shoot from activated unit" }
  },
  {
    "id": "CORE.Charge.Prohibit.Advanced.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_advanced" } }] },
    "effect": [
      { "addProhibition": { "target": { "selector": "units_advanced" }, "action": "charge", "reason": "advanced_move" } }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that advanced cannot charge" }
  },
  {
    "id": "CORE.Charge.Prohibit.FellBack.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_fell_back" } }] },
    "effect": [
      { "addProhibition": { "target": { "selector": "units_fell_back" }, "action": "charge", "reason": "fell_back" } }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 15, "note": "Units that fell back cannot charge" }
  },
  {
    "id": "CORE.Charge.Grant.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "applyStatus": { "target": { "selector": "active_player_units" }, "key": "can_charge" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Grant can_charge to active player units" }
  },
  {
    "id": "CORE.Charge.OfferSelect.1",
    "scope": "global",
    "trigger": { "event": "ChargePhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_can_charge" } }] },
    "effect": [
      { "addChoice": { "id": "select_unit_to_charge", "label": "Select a unit to charge with", "actionRef": "CORE.Charge.SelectAction.1", "selectionFrom": { "selector": "units_can_charge" } } }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer unit selection for charging" }
  },
  {
    "id": "CORE.Charge.ReofferSelect.1",
    "scope": "global",
    "trigger": { "event": "UnitChargeEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_charge" } }] },
    "effect": [
      { "addChoice": { "id": "select_unit_to_charge", "label": "Select a unit to charge with", "actionRef": "CORE.Charge.SelectAction.1", "selectionFrom": { "selector": "units_can_charge" } } }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Re-offer charge unit selection after each activation" }
  },
  {
    "id": "CORE.Charge.SelectAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "select_unit_to_charge" } }] },
    "effect": [
      { "setValue": { "path": "$.activation.unitId", "valueFromEventParam": "selectedUnitId" } },
      { "setValue": { "path": "$.activation.type", "value": "charge" } },
      { "emit": { "eventId": "UnitChargeStarted", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set activation context and begin charge activation" }
  },
  {
    "id": "CORE.Charge.PassThrough.1",
    "scope": "global",
    "trigger": { "event": "UnitChargeStarted" },
    "when": { "all": [] },
    "effect": [
      { "appendLogNote": { "message": "Charge activation -- not implemented (MS 5D)" } },
      { "emit": { "eventId": "UnitChargeEnded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton pass-through. MS 5D adds charge resolution." }
  },
  {
    "id": "CORE.Charge.Consume.1",
    "scope": "global",
    "trigger": { "event": "UnitChargeEnded" },
    "when": { "all": [] },
    "effect": [
      { "removeStatus": { "target": { "path": "$.activation.unitId" }, "key": "can_charge" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Remove can_charge from activated unit" }
  },
  {
    "id": "CORE.Fight.Grant.1",
    "scope": "global",
    "trigger": { "event": "FightPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "appendLogNote": { "message": "Fight phase -- not implemented (MS 5D)" } }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skeleton placeholder for fight phase" }
  },
  {
    "id": "CORE.Cleanup.Safety.Move.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_move" } }] },
    "effect": [
      { "appendLogNote": { "message": "WARNING: units still had can_move at TurnEnded" } },
      { "removeStatus": { "target": { "selector": "units_can_move" }, "key": "can_move" } }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_move" }
  },
  {
    "id": "CORE.Cleanup.Safety.Shoot.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_shoot" } }] },
    "effect": [
      { "appendLogNote": { "message": "WARNING: units still had can_shoot at TurnEnded" } },
      { "removeStatus": { "target": { "selector": "units_can_shoot" }, "key": "can_shoot" } }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_shoot" }
  },
  {
    "id": "CORE.Cleanup.Safety.Charge.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_charge" } }] },
    "effect": [
      { "appendLogNote": { "message": "WARNING: units still had can_charge at TurnEnded" } },
      { "removeStatus": { "target": { "selector": "units_can_charge" }, "key": "can_charge" } }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_charge" }
  },
  {
    "id": "CORE.Cleanup.Safety.Fight.1",
    "scope": "global",
    "trigger": { "event": "TurnEnded" },
    "when": { "all": [{ "selector": { "id": "units_can_fight" } }] },
    "effect": [
      { "appendLogNote": { "message": "WARNING: units still had can_fight at TurnEnded" } },
      { "removeStatus": { "target": { "selector": "units_can_fight" }, "key": "can_fight" } }
    ],
    "precedence": { "priority": 100, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Safety cleanup for can_fight" }
  }
]
```

Note: This does NOT yet include the command phase rules. Those are added in Task 8.

- [ ] **Step 2: Verify the pack loads**

Run: `cd engine && npx vitest run -t "loads successfully" 2>&1 | head -20`

We'll write a proper load test in Task 9. For now, verify manually:

Run: `cd engine && node -e "import('./src/loader/index.js').then(m => m.loadPack('../packs/wh40k-10e-ms5b')).then(r => console.log(r.ok ? 'OK' : JSON.stringify(r.errors, null, 2)))"`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-ms5b/rules.json
git commit -m "feat(m5b): add ms5b pack movement and skeleton phase rules"
```

---

### Task 8: Add Command Phase Rules (Battleshock + Stratagems)

**Files:**
- Modify: `packs/wh40k-10e-ms5b/rules.json`

- [ ] **Step 1: Add command phase rules to rules.json**

Append the following rules to the JSON array in `packs/wh40k-10e-ms5b/rules.json` (before the closing `]`):

```json
  ,
  {
    "id": "CORE.Command.ClearBattleshock.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "units_battleshocked" } }] },
    "effect": [
      { "removeStatus": { "target": { "selector": "units_battleshocked" }, "key": "battleshocked" } }
    ],
    "precedence": { "priority": 5, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Clear battleshocked from previous round" }
  },
  {
    "id": "CORE.Command.ResetPhaseUsage.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "resetUsage": { "scope": "player", "keys": ["command_reroll_phase"] } }
    ],
    "precedence": { "priority": 6, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Reset once-per-phase stratagem usage" }
  },
  {
    "id": "CORE.Command.Battleshock.ResetScratch.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [] },
    "effect": [
      { "setValue": { "path": "$.battleshock.pendingUnits", "value": [] } },
      { "setValue": { "path": "$.battleshock.pendingIndex", "value": 0 } },
      { "setValue": { "path": "$.battleshock.currentUnitId", "value": null } },
      { "setValue": { "path": "$.battleshock.rollResult", "value": null } },
      { "setValue": { "path": "$.battleshock.sum", "value": null } },
      { "setValue": { "path": "$.battleshock.autoPass", "value": false } }
    ],
    "precedence": { "priority": 8, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Reset battleshock scratch state" }
  },
  {
    "id": "CORE.Command.Battleshock.BuildPending.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "active_player_below_half" } }] },
    "effect": [
      { "appendLogNote": { "message": "Building battleshock pending list for below-half-strength units" } },
      { "emit": { "eventId": "BattleshockTestBegin", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "If active player has below-half-strength units, begin battleshock loop. The pending list is populated by the BuildPendingList rule." }
  },
  {
    "id": "CORE.Command.Battleshock.BuildPendingList.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "all": [{ "selector": { "id": "active_player_below_half" } }] },
    "effect": [
      { "setValue": { "path": "$.battleshock.pendingUnits", "value": { "selectorIds": "active_player_below_half" } } }
    ],
    "precedence": { "priority": 9, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Populate pending list with IDs of below-half-strength units belonging to active player. NOTE: This requires setValue to support selectorIds resolution -- if not supported, the integration test will reveal this and we will use an alternative approach." }
  },
  {
    "id": "CORE.Command.Battleshock.NoBattleshock.1",
    "scope": "global",
    "trigger": { "event": "CommandPhaseStarted" },
    "when": { "not": { "selector": { "id": "active_player_below_half" } } },
    "effect": [
      { "emit": { "eventId": "CommandPointsAwarded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 50, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Skip battleshock if no below-half-strength units, go straight to CP" }
  },
  {
    "id": "CORE.Command.Battleshock.SetCurrent.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestBegin" },
    "when": { "all": [] },
    "effect": [
      { "appendLogNote": { "message": "Beginning battleshock test for next pending unit" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set current unit from pending list. NOTE: The actual index-based lookup may need engine support for reading array elements by index path. Integration testing will validate this." }
  },
  {
    "id": "CORE.Command.Battleshock.OfferInsaneBravery.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestBegin" },
    "when": { "all": [] },
    "effect": [
      {
        "addChoice": {
          "id": "insane_bravery",
          "label": "Insane Bravery (auto-pass battleshock, 1 CP, once per battle)",
          "actionRef": "CORE.Command.Battleshock.InsaneBraveryAction.1",
          "costs": { "cp": 1 }
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer Insane Bravery before roll. Blind commitment -- player spends CP without seeing dice." }
  },
  {
    "id": "CORE.Command.Battleshock.InsaneBraveryAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "insane_bravery" } }] },
    "effect": [
      { "setValue": { "path": "$.battleshock.autoPass", "value": true } },
      { "consumeUsage": { "scope": "global", "key": "insane_bravery" } },
      { "appendLogNote": { "message": "Insane Bravery used -- battleshock auto-pass" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Set autoPass flag. consumeUsage prevents reuse (once per battle)." }
  },
  {
    "id": "CORE.Command.Battleshock.EmitRoll.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestBegin" },
    "when": { "all": [] },
    "effect": [
      { "emit": { "eventId": "BattleshockTestRoll", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Emit roll event after Insane Bravery window closes" }
  },
  {
    "id": "CORE.Command.Battleshock.Roll.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestRoll" },
    "when": { "all": [] },
    "effect": [
      { "roll": { "count": 2, "sides": 6, "storePath": "$.battleshock.rollResult", "defaults": { "rerolled": false, "spent": false } } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Roll 2D6 for battleshock test" }
  },
  {
    "id": "CORE.Command.Battleshock.OfferCommandReroll.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestRoll" },
    "when": { "not": { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } } },
    "effect": [
      {
        "addChoice": {
          "id": "command_reroll_battleshock",
          "label": "Command Re-roll (reroll 1 battleshock die, 1 CP)",
          "actionRef": "CORE.Command.Battleshock.CommandRerollAction.1",
          "costs": { "cp": 1 },
          "pick": 1
        }
      }
    ],
    "precedence": { "priority": 20, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Offer Command Re-roll after seeing dice. Not offered if auto-passing." }
  },
  {
    "id": "CORE.Command.Battleshock.CommandRerollAction.1",
    "scope": "global",
    "trigger": { "event": "ChoiceSelected" },
    "when": { "all": [{ "eventParamEquals": { "param": "choiceId", "value": "command_reroll_battleshock" } }] },
    "effect": [
      { "rerollDie": { "poolPath": "$.battleshock.rollResult", "dieIndex": { "path": "$.battleshock.rollResult" } } },
      { "consumeUsage": { "scope": "player", "key": "command_reroll_phase" } },
      { "appendLogNote": { "message": "Command Re-roll used on battleshock die" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Reroll selected die. dieIndex comes from the choice selection. consumeUsage prevents reuse this phase." }
  },
  {
    "id": "CORE.Command.Battleshock.EmitResolve.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestRoll" },
    "when": { "all": [] },
    "effect": [
      { "emit": { "eventId": "BattleshockTestResolve", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 30, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Emit resolve event after Command Re-roll window closes" }
  },
  {
    "id": "CORE.Command.Battleshock.Resolve.AutoPass.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestResolve" },
    "when": { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } },
    "effect": [
      { "appendLogNote": { "message": "Battleshock auto-passed (Insane Bravery)" } },
      { "setValue": { "path": "$.battleshock.autoPass", "value": false } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "If autoPass is set, skip Ld check and pass" }
  },
  {
    "id": "CORE.Command.Battleshock.Resolve.ComputeSum.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestResolve" },
    "when": { "not": { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } } },
    "effect": [
      { "computePoolSum": { "poolPath": "$.battleshock.rollResult", "targetPath": "$.battleshock.sum" } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Sum the 2D6 roll for comparison against Ld" }
  },
  {
    "id": "CORE.Command.Battleshock.Resolve.Fail.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestResolve" },
    "when": {
      "all": [
        { "not": { "pathEquals": { "path": "$.battleshock.autoPass", "value": true } } }
      ]
    },
    "effect": [
      { "appendLogNote": { "message": "Battleshock test -- checking sum vs Ld (fail/pass resolved by subsequent rules based on state)" } }
    ],
    "precedence": { "priority": 15, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "Placeholder: the actual pass/fail comparison needs to read $.battleshock.sum and compare to $.units[currentUnitId].stats.Ld. This will be validated in integration testing and may need a pathComparison predicate or be split into emit-based resolution." }
  },
  {
    "id": "CORE.Command.Battleshock.EmitNext.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestResolve" },
    "when": { "all": [] },
    "effect": [
      { "emit": { "eventId": "BattleshockTestNext", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 50, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "After resolution, check if more pending units" }
  },
  {
    "id": "CORE.Command.Battleshock.LoopOrDone.1",
    "scope": "global",
    "trigger": { "event": "BattleshockTestNext" },
    "when": { "all": [] },
    "effect": [
      { "emit": { "eventId": "CommandPointsAwarded", "params": { "player": { "eventParam": "player" } } } }
    ],
    "precedence": { "priority": 50, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "note": "For now, emit CP awarded after each test. Multi-unit iteration will be refined in integration testing -- may need pendingIndex check to loop back to BattleshockTestBegin or proceed to CP." }
  },
  {
    "id": "CORE.Command.CP.Award.1",
    "scope": "player",
    "trigger": { "event": "CommandPointsAwarded" },
    "when": { "all": [] },
    "effect": [
      { "award": { "target": { "eventParam": "player" }, "resource": "cp", "amount": 1 } }
    ],
    "precedence": { "priority": 10, "strategy": "stack" },
    "provenance": { "source": "Core Rules", "page": 8, "note": "Active player gains 1 CP at start of Command phase" }
  }
```

**Implementation note:** Several rules (BuildPendingList, SetCurrent, Resolve.Fail, LoopOrDone) contain placeholder logic flagged with notes. These rules involve array indexing and cross-path comparison that may need adjustment during integration testing. The structure and event flow is correct; the exact effect parameters will be validated and fixed in Task 9.

- [ ] **Step 2: Verify the pack still loads**

Run: `cd engine && node -e "import('./src/loader/index.js').then(m => m.loadPack('../packs/wh40k-10e-ms5b')).then(r => console.log(r.ok ? 'OK' : JSON.stringify(r.errors, null, 2)))"`

Expected: `OK` (pack loads without validation errors)

- [ ] **Step 3: Commit**

```bash
git add packs/wh40k-10e-ms5b/rules.json
git commit -m "feat(m5b): add command phase battleshock and stratagem rules"
```

---

### Task 9: Integration Test -- Pack Load and Command Phase Flow

**Files:**
- Create: `engine/tests/integration/ms5b-command.test.ts`

- [ ] **Step 1: Write integration test for pack loading and datasheet merge**

Create `engine/tests/integration/ms5b-command.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get, getStatuses } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/wh40k-10e-ms5b");

describe("wh40k-10e-ms5b pack", () => {
  it("loads successfully with datasheets merged", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify datasheets merged into units
    const u1 = get(result.pack.initialState, "$.units.u1") as any;
    expect(u1.name).toBe("Intercessor Squad");
    expect(u1.stats.Ld).toBe(6);
    expect(u1.keywords).toContain("INFANTRY");
    expect(u1.datasheet).toBeUndefined();

    // Verify below-half-strength units
    const u2 = get(result.pack.initialState, "$.units.u2") as any;
    expect(u2.statuses.below_half_strength).toBeDefined();
    expect(u2.models.remaining).toBe(2);
    expect(u2.models.total).toBe(5);
  });

  it("runs command phase: CP awarded when no below-half units", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    // Advance through StartOfGame, RoundStarted, TurnStarted for player A
    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    while (advance !== null && safetyCounter < 500) {
      if (advance.paused) {
        // At command phase -- pass all choices to advance through
        engine.passAllChoices();
      }
      advance = engine.advanceToNextEvent();
      safetyCounter++;

      // Check if CP was awarded after command phase
      const cpA = get(engine.getState(), "$.resources.A.cp") as number;
      if (cpA > 0) break;
    }

    // Player A should have gained 1 CP
    const cpA = get(engine.getState(), "$.resources.A.cp") as number;
    expect(cpA).toBe(1);
  });

  it("runs command phase: battleshock roll happens for below-half unit", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    // Advance to first pause point
    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;
    let sawBattleshockRoll = false;

    while (advance !== null && safetyCounter < 500) {
      if (advance.event?.id === "BattleshockTestRoll") {
        sawBattleshockRoll = true;
      }
      if (advance.paused) {
        // Pass all choices to advance
        engine.passAllChoices();
      }
      advance = engine.advanceToNextEvent();
      safetyCounter++;

      // Stop after command phase ends
      if (advance?.event?.id === "MovementPhaseStarted") break;
    }

    expect(sawBattleshockRoll).toBe(true);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `cd engine && npx vitest run tests/integration/ms5b-command.test.ts`

Expected: Tests may fail if the rule event flow has issues (e.g., array indexing, selectorIds resolution). This is expected -- the tests exist to validate and debug the rule interactions.

- [ ] **Step 3: Fix any rule issues discovered**

Debug failures by examining:
1. Engine log (`engine.getLog()`) to trace which rules fired
2. State at pause points to verify battleshock scratch data
3. Adjust rule effects/predicates as needed

Common issues to watch for:
- `setValue` may not support `selectorIds` -- replace with a manual approach using emit + per-unit event
- Array index access in paths (`$.battleshock.pendingUnits.0`) may not work -- use modifyCounter approach
- `rerollDie` dieIndex resolution from choice selection args

Fix each issue, re-run tests until all pass.

- [ ] **Step 4: Run full test suite**

Run: `cd engine && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add engine/tests/integration/ms5b-command.test.ts packs/wh40k-10e-ms5b/rules.json
git commit -m "test(m5b): add integration tests for command phase flow"
```

---

### Task 10: Integration Test -- Movement Phase Flow

**Files:**
- Create: `engine/tests/integration/ms5b-movement.test.ts`

- [ ] **Step 1: Write integration tests for movement**

Create `engine/tests/integration/ms5b-movement.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get, getStatuses } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/wh40k-10e-ms5b");

function advanceToPhase(engine: SSCCEngine, phaseEvent: string) {
  let advance = engine.advanceToNextEvent();
  let safetyCounter = 0;
  while (advance !== null && safetyCounter < 1000) {
    if (advance.paused) {
      engine.passAllChoices();
    }
    if (advance.event?.id === phaseEvent) return advance;
    advance = engine.advanceToNextEvent();
    safetyCounter++;
  }
  return null;
}

describe("wh40k-10e-ms5b movement phase", () => {
  it("offers unit selection at MovementPhaseStarted", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    // Advance past command phase to movement
    advanceToPhase(engine, "MovementPhaseStarted");

    // Continue advancing -- should pause with unit selection
    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;
    while (advance !== null && !advance.paused && safetyCounter < 100) {
      advance = engine.advanceToNextEvent();
      safetyCounter++;
    }

    const choices = engine.enumerateChoices();
    const selectUnit = choices.find((c) => c.choiceId === "select_unit_to_move");
    expect(selectUnit).toBeDefined();
  });

  it("applies advanced_move status when Advance is chosen", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    // Advance past command phase to movement
    advanceToPhase(engine, "MovementPhaseStarted");

    // Advance to pause
    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;
    while (advance !== null && !advance.paused && safetyCounter < 100) {
      advance = engine.advanceToNextEvent();
      safetyCounter++;
    }

    // Select u1 to move
    let choices = engine.enumerateChoices();
    const selectUnit = choices.find((c) => c.choiceId === "select_unit_to_move");
    if (!selectUnit) throw new Error("No select_unit_to_move choice");
    engine.applyChoice(selectUnit.choiceInstanceId, { selectedUnitId: "u1" });

    // Advance to movement type choices
    advance = engine.advanceToNextEvent();
    while (advance !== null && !advance.paused && safetyCounter < 200) {
      advance = engine.advanceToNextEvent();
      safetyCounter++;
    }

    // Choose Advance
    choices = engine.enumerateChoices();
    const moveAdvance = choices.find((c) => c.choiceId === "move_advance");
    if (!moveAdvance) throw new Error("No move_advance choice");
    engine.applyChoice(moveAdvance.choiceInstanceId);

    // Verify advanced_move status
    const statuses = getStatuses(engine.getState(), "u1");
    expect(statuses).toHaveProperty("advanced_move");
  });

  it("does not offer Fall Back when no units in engagement range", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    // Advance past command phase to movement
    advanceToPhase(engine, "MovementPhaseStarted");

    // Advance to pause
    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;
    while (advance !== null && !advance.paused && safetyCounter < 100) {
      advance = engine.advanceToNextEvent();
      safetyCounter++;
    }

    // Select u1
    let choices = engine.enumerateChoices();
    const selectUnit = choices.find((c) => c.choiceId === "select_unit_to_move");
    if (!selectUnit) throw new Error("No select_unit_to_move choice");
    engine.applyChoice(selectUnit.choiceInstanceId, { selectedUnitId: "u1" });

    // Advance to movement type choices
    advance = engine.advanceToNextEvent();
    while (advance !== null && !advance.paused && safetyCounter < 200) {
      advance = engine.advanceToNextEvent();
      safetyCounter++;
    }

    // Verify Fall Back is NOT offered
    choices = engine.enumerateChoices();
    const fallBack = choices.find((c) => c.choiceId === "move_fall_back");
    expect(fallBack).toBeUndefined();

    // But Normal, Advance, Stationary ARE offered
    expect(choices.find((c) => c.choiceId === "move_normal")).toBeDefined();
    expect(choices.find((c) => c.choiceId === "move_advance")).toBeDefined();
    expect(choices.find((c) => c.choiceId === "move_stationary")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run movement integration tests**

Run: `cd engine && npx vitest run tests/integration/ms5b-movement.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 3: Fix any issues, then run full suite**

Run: `cd engine && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add engine/tests/integration/ms5b-movement.test.ts
git commit -m "test(m5b): add integration tests for movement phase flow"
```

---

### Task 11: CLI Smoke Test

**Files:** None modified -- manual verification

- [ ] **Step 1: Run the CLI with the MS 5B pack**

Run: `cd cli && npx tsx src/index.ts ../packs/wh40k-10e-ms5b --seed 42 --step`

Expected: The CLI starts, shows the seed, and begins stepping through events. Verify:
1. Command phase events appear (BattleshockTestBegin, BattleshockTestRoll)
2. Insane Bravery choice is offered before roll
3. Command Re-roll choice is offered after roll (with dice visible)
4. CP is awarded after battleshock
5. Movement phase offers unit selection
6. Movement type choices show (Normal, Advance, Stationary -- no Fall Back)
7. Statuses display correctly on units after movement

- [ ] **Step 2: Run without step mode to verify auto-advance**

Run: `cd cli && npx tsx src/index.ts ../packs/wh40k-10e-ms5b --seed 42`

Expected: Auto-advances through non-choice events, pauses at battleshock stratagems and movement choices.

- [ ] **Step 3: Commit any fixes found during smoke testing**

If the CLI smoke test reveals display issues or rule problems, fix them and commit:

```bash
git add -A
git commit -m "fix(m5b): fixes from CLI smoke testing"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full engine test suite**

Run: `cd engine && npx vitest run`
Expected: All tests pass (unit + integration).

- [ ] **Step 2: Run existing wh40k-turn tests to verify no regression**

Run: `cd engine && npx vitest run tests/integration/wh40k-turn.test.ts`
Expected: All existing tests still pass.

- [ ] **Step 3: Verify all existing packs still load**

Run: `cd engine && node -e "
const { loadPack } = await import('./src/loader/index.js');
for (const p of ['hello-pack', 'overwatch-test', 'attack-test', 'blessings-test', 'wh40k-10e-core-turn', 'cli-demo', 'wh40k-10e-ms5b']) {
  const r = await loadPack('../packs/' + p);
  console.log(p + ': ' + (r.ok ? 'OK' : 'FAIL: ' + JSON.stringify(r.errors)));
}
"`

Expected: All packs load with `OK`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(m5b): milestone 5b complete -- command phase and movement"
```
