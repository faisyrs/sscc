import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { get } from "../../src/state/index.js";
import { readDiePool } from "../../src/rules/pool-helpers.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/attack-test");

describe("Attack Pipeline (Section 13)", () => {
  it("rolls 4d6 hit dice with seed 668 producing [2, 6, 4, 1]", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: 668 });
    engine.initialize();

    // SetupAttack
    let advance = engine.advanceToNextEvent();
    expect(advance).not.toBeNull();
    expect(get(engine.getState(), "$.currentAttack.hits")).toBe(0);

    // RollToHit — triggers roll effect
    advance = engine.advanceToNextEvent();
    expect(advance).not.toBeNull();

    // Verify die pool
    const state = engine.getState();
    expect(get(state, "$.currentAttack.hitRolls.count")).toBe(4);

    const dice = readDiePool(state, "$.currentAttack.hitRolls");
    expect(dice.map((d) => d.value)).toEqual([2, 6, 4, 1]);
    expect(dice.every((d) => d.rerolled === false)).toBe(true);
  });

  it("each die is individually addressable via state paths", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!, { seed: 668 });
    engine.initialize();

    engine.advanceToNextEvent(); // SetupAttack
    engine.advanceToNextEvent(); // RollToHit

    const state = engine.getState();
    expect(get(state, "$.currentAttack.hitRolls.d0.value")).toBe(2);
    expect(get(state, "$.currentAttack.hitRolls.d1.value")).toBe(6);
    expect(get(state, "$.currentAttack.hitRolls.d2.value")).toBe(4);
    expect(get(state, "$.currentAttack.hitRolls.d3.value")).toBe(1);
  });

  it("seed determinism — same seed, same results", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine1 = new SSCCEngine(result.pack!, { seed: 668 });
    engine1.initialize();
    engine1.advanceToNextEvent();
    engine1.advanceToNextEvent();

    const engine2 = new SSCCEngine(result.pack!, { seed: 668 });
    engine2.initialize();
    engine2.advanceToNextEvent();
    engine2.advanceToNextEvent();

    const dice1 = readDiePool(engine1.getState(), "$.currentAttack.hitRolls");
    const dice2 = readDiePool(engine2.getState(), "$.currentAttack.hitRolls");
    expect(dice1.map((d) => d.value)).toEqual(dice2.map((d) => d.value));
  });
});
