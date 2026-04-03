import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { SeededRNG } from "../../src/rng/index.js";
import { join } from "node:path";

const BLESSINGS_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

/**
 * Find the first seed that produces a pool with at least one pair >= 5.
 */
function findSeedWithHighPair(): number {
  for (let seed = 0; seed < 10000; seed++) {
    const rng = new SeededRNG(seed);
    const values: number[] = [];
    for (let i = 0; i < 8; i++) values.push(rng.nextInt(1, 6));
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [val, count] of counts) {
      if (val >= 5 && count >= 2) return seed;
    }
  }
  throw new Error("No suitable seed found");
}

const GOOD_SEED = findSeedWithHighPair();

async function setupBlessingsEngine(seed: number) {
  const result = await loadPack(BLESSINGS_PATH);
  if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);
  const engine = new SSCCEngine(result.pack!, { seed });
  engine.initialize();
  engine.advanceToNextEvent(); // BattleRoundStart
  engine.advanceToNextEvent(); // BlessingsOfKhorne (rolls + offers)
  return engine;
}

function findPair(engine: SSCCEngine, poolPath: string, minVal: number): number[] {
  const dice = readDiePool(engine.getState(), poolPath);
  const groups = new Map<number, number[]>();
  for (const d of dice) {
    if ((d.value as number) >= minVal && d.spent === false) {
      const v = d.value as number;
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(d.index);
    }
  }
  for (const indices of groups.values()) {
    if (indices.length >= 2) return [indices[0], indices[1]];
  }
  throw new Error(`No pair >= ${minVal} found`);
}

describe("canUndoChoice", () => {
  it("returns null for unknown choice", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);
    expect(engine.canUndoChoice("nonexistent")).toBeNull();
  });

  it("returns requiresConfirm: false for non-RNG choice", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    const check = engine.canUndoChoice(warpBlades.choiceInstanceId);
    expect(check).not.toBeNull();
    expect(check!.requiresConfirm).toBe(false);
    expect(check!.cascadeCount).toBe(1);
  });
});

describe("undoChoice", () => {
  it("restores state to before the choice", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);

    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    expect((get(engine.getState(), `$.blessingsRoll.d${pair[0]}`) as any).spent).toBe(true);

    const result = engine.undoChoice(warpBlades.choiceInstanceId);
    expect(result.success).toBe(true);
    expect(result.undoneChoices).toContain(warpBlades.choiceInstanceId);
    expect((get(engine.getState(), `$.blessingsRoll.d${pair[0]}`) as any).spent).toBe(false);
    expect(get(engine.getState(), "$.blessingsActivated")).toBe(0);
  });

  it("throws for unknown choice", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);
    expect(() => engine.undoChoice("nonexistent")).toThrow();
  });

  it("re-offers choices after undo", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);

    const choices1 = engine.enumerateChoices();
    const warpBlades = choices1.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });

    engine.undoChoice(warpBlades.choiceInstanceId);

    const choices2 = engine.enumerateChoices();
    expect(choices2.find((c) => c.choiceId === "warp_blades")).toBeDefined();
  });

  it("logs undo events", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);

    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });
    engine.undoChoice(warpBlades.choiceInstanceId);

    const undoLogs = engine.getLog().filter((e) => e.type === "choice_undone");
    expect(undoLogs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("undo stack lifecycle", () => {
  it("canUndoChoice returns null before any choices are made", async () => {
    const engine = await setupBlessingsEngine(GOOD_SEED);
    expect(engine.canUndoChoice("ci_1")).toBeNull();
  });
});
