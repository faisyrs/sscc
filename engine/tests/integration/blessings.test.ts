import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { SeededRNG } from "../../src/rng/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

/**
 * Find a seed that produces a pool containing at least one double 5+
 * and one other double (for testing two blessings).
 */
function findBlessingsSeed(): { seed: number; values: number[] } {
  for (let seed = 0; seed < 10000; seed++) {
    const rng = new SeededRNG(seed);
    const values: number[] = [];
    for (let i = 0; i < 8; i++) values.push(rng.nextInt(1, 6));
    // Count by value
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    // Need: at least one pair with value >= 5, and another pair of any value
    let highPairs = 0;
    let totalPairs = 0;
    for (const [val, count] of counts) {
      const pairs = Math.floor(count / 2);
      totalPairs += pairs;
      if (val >= 5) highPairs += pairs;
    }
    if (highPairs >= 1 && totalPairs >= 2) {
      return { seed, values };
    }
  }
  throw new Error("No suitable seed found");
}

describe("Blessings of Khorne", () => {
  const { seed: blessingsSeed, values: expectedValues } = findBlessingsSeed();

  it("rolls 8d6 pool with spent tracking", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();

    // BattleRoundStart
    engine.advanceToNextEvent();

    // BlessingsOfKhorne — triggers roll + choice offers via emitted BlessingsChoices
    const advance = engine.advanceToNextEvent();
    expect(advance?.paused).toBe(true);

    const state = engine.getState();
    expect(get(state, "$.blessingsRoll.count")).toBe(8);

    const dice = readDiePool(state, "$.blessingsRoll");
    expect(dice.map((d) => d.value)).toEqual(expectedValues);
    expect(dice.every((d) => d.spent === false)).toBe(true);
    expect(dice.every((d) => d.rerolled === false)).toBe(true);
  });

  it("offers blessing choices based on pool patterns", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();

    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    const choices = engine.enumerateChoices();
    expect(choices.length).toBeGreaterThanOrEqual(1);

    const warpBlades = choices.find((c) => c.choiceId === "warp_blades");
    expect(warpBlades).toBeDefined();
    expect(warpBlades!.pick).toBe(2);
    expect(warpBlades!.selectionFilter).toEqual({ spent: false });
  });

  it("spending dice marks them spent and increments counter", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: blessingsSeed });
    engine.initialize();

    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    // Find a valid double 5+ in the pool
    const dice = readDiePool(engine.getState(), "$.blessingsRoll");
    const highDice = dice.filter((d) => (d.value as number) >= 5);
    const counts = new Map<number, number[]>();
    for (const d of highDice) {
      const v = d.value as number;
      if (!counts.has(v)) counts.set(v, []);
      counts.get(v)!.push(d.index);
    }
    let pairIndices: number[] = [];
    for (const indices of counts.values()) {
      if (indices.length >= 2) {
        pairIndices = [indices[0], indices[1]];
        break;
      }
    }
    expect(pairIndices.length).toBe(2);

    // Select Warp Blades with the found pair
    const choices = engine.enumerateChoices();
    const warpBlades = choices.find((c) => c.choiceId === "warp_blades")!;
    engine.applyChoice(warpBlades.choiceInstanceId, { selectedDice: pairIndices });

    const state = engine.getState();
    // Dice should be spent
    for (const idx of pairIndices) {
      expect((get(state, `$.blessingsRoll.d${idx}`) as any).spent).toBe(true);
    }
    // Counter incremented
    expect(get(state, "$.blessingsActivated")).toBe(1);
    // Blessing activated
    expect(get(state, "$.blessings.warpBlades")).toBe(true);
  });
});
