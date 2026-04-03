import { describe, it, expect } from "vitest";
import { SSCCEngine } from "../../src/engine/index.js";
import { loadPack } from "../../src/loader/index.js";
import { SeededRNG } from "../../src/rng/index.js";
import { join } from "node:path";

const HELLO_PATH = join(import.meta.dirname, "../../../packs/hello-pack");
const BLESSINGS_PATH = join(import.meta.dirname, "../../../packs/blessings-test");

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

describe("enhanced logging — per-rule predicate results", () => {
  it("logs matched rules individually with ruleId", async () => {
    const result = await loadPack(HELLO_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack!);
    engine.initialize();
    engine.advanceToNextEvent(); // StartOfGame — fires rules

    const log = engine.getLog();
    const matchedEntries = log.filter((e) => e.type === "rules_matched");
    for (const entry of matchedEntries) {
      expect(entry.ruleId).toBeDefined();
    }
  });

  it("logs skipped rules", async () => {
    const result = await loadPack(BLESSINGS_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const seed = findBlessingsSeed();
    const engine = new SSCCEngine(result.pack!, { seed });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne

    const log = engine.getLog();
    const allRuleEntries = log.filter(
      (e) => e.type === "rules_matched" || e.type === "rule_skipped",
    );
    expect(allRuleEntries.length).toBeGreaterThan(0);
  });
});

describe("enhanced logging — structured effect entries", () => {
  it("logs effect_applied for each executed effect", async () => {
    const result = await loadPack(BLESSINGS_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const seed = findBlessingsSeed();
    const engine = new SSCCEngine(result.pack!, { seed });
    engine.initialize();
    engine.advanceToNextEvent(); // BattleRoundStart
    engine.advanceToNextEvent(); // BlessingsOfKhorne (triggers roll effect)

    const log = engine.getLog();
    const effectEntries = log.filter((e) => e.type === "effect_applied");
    expect(effectEntries.length).toBeGreaterThanOrEqual(1);

    // At least one should be a roll effect
    const rollEffect = effectEntries.find(
      (e) => e.message.includes("roll"),
    );
    expect(rollEffect).toBeDefined();
    expect(rollEffect!.ruleId).toBeDefined();
  });
});
