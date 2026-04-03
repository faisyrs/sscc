import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { SeededRNG } from "../../src/rng/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

function findBlessingsSeed(): number {
  for (let seed = 0; seed < 10000; seed++) {
    const rng = new SeededRNG(seed);
    const values: number[] = [];
    for (let i = 0; i < 8; i++) values.push(rng.nextInt(1, 6));
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    let highPairs = 0;
    let totalPairs = 0;
    for (const [val, count] of counts) {
      const pairs = Math.floor(count / 2);
      totalPairs += pairs;
      if (val >= 5) highPairs += pairs;
    }
    if (highPairs >= 1 && totalPairs >= 2) return seed;
  }
  throw new Error("No suitable seed found");
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

describe("Blessings of Khorne — Undo Workflow", () => {
  const blessingsSeed = findBlessingsSeed();

  it("full undo cycle: activate, undo, re-activate differently", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    // Snapshot the pool values for comparison
    const poolBefore = readDiePool(engine.getState(), "$.blessingsRoll").map((d) => d.value);

    // Activate Warp Blades
    const choices1 = engine.enumerateChoices();
    const warpBlades = choices1.find((c) => c.choiceId === "warp_blades")!;
    const pair1 = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair1 });

    expect(get(engine.getState(), "$.blessingsActivated")).toBe(1);
    expect(get(engine.getState(), "$.blessings.warpBlades")).toBe(true);

    // Undo
    const undoResult = engine.undoChoice(warpBlades.choiceInstanceId);
    expect(undoResult.success).toBe(true);

    // Pool should be restored exactly
    const poolAfter = readDiePool(engine.getState(), "$.blessingsRoll").map((d) => d.value);
    expect(poolAfter).toEqual(poolBefore);
    expect(get(engine.getState(), "$.blessingsActivated")).toBe(0);
    expect(get(engine.getState(), "$.blessings.warpBlades")).toBeUndefined();

    // Choices should be re-offered
    const choices2 = engine.enumerateChoices();
    expect(choices2.find((c) => c.choiceId === "warp_blades")).toBeDefined();
    expect(choices2.find((c) => c.choiceId === "wrathful_devotion")).toBeDefined();

    // Can now activate a different blessing instead
    const wrathful = choices2.find((c) => c.choiceId === "wrathful_devotion")!;
    const dice = readDiePool(engine.getState(), "$.blessingsRoll");
    const groups = new Map<number, number[]>();
    for (const d of dice) {
      if (d.spent === false) {
        const v = d.value as number;
        if (!groups.has(v)) groups.set(v, []);
        groups.get(v)!.push(d.index);
      }
    }
    let pair2: number[] = [];
    for (const indices of groups.values()) {
      if (indices.length >= 2) { pair2 = [indices[0], indices[1]]; break; }
    }
    expect(pair2.length).toBe(2);
    engine.applyChoice(wrathful.choiceInstanceId, { selectedDice: pair2 });

    expect(get(engine.getState(), "$.blessingsActivated")).toBe(1);
    expect(get(engine.getState(), "$.blessings.wrathfulDevotion")).toBe(true);
  });

  it("RNG state is preserved through undo", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    // Apply and undo a choice
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    const pair = findPair(engine, "$.blessingsRoll", 5);
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pair });
    engine.undoChoice(warpBlades.choiceInstanceId);

    // The pool values should be identical (RNG state restored)
    const dice = readDiePool(engine.getState(), "$.blessingsRoll");
    expect(dice.every((d) => d.spent === false)).toBe(true);
  });
});
