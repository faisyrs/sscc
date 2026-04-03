import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/overwatch-test");

describe("Overwatch with choice costs", () => {
  it("loads the overwatch test pack", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
  });

  it("offers overwatch when player has 1+ CP, deducts on selection", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    // Advance through StartOfGame, TurnStarted, ChargePhaseStarted
    let advance = engine.advanceToNextEvent();
    while (advance !== null && !advance.paused) {
      advance = engine.advanceToNextEvent();
    }

    // Should be paused at ChargeDeclarationsEnded with overwatch offered
    expect(advance).not.toBeNull();
    expect(advance!.paused).toBe(true);
    expect(advance!.event.id).toBe("ChargeDeclarationsEnded");

    const choices = engine.enumerateChoices();
    expect(choices.length).toBe(1);
    expect(choices[0].choiceId).toBe("overwatch");
    expect(choices[0].costs).toEqual({ cp: 1 });

    // Select overwatch
    engine.applyChoice(choices[0].choiceInstanceId);

    // CP should be deducted
    const state = engine.getState();
    expect(get(state, "$.resources.A.cp")).toBe(0);

    // Usage should be consumed
    expect(get(state, "$.usage.player.overwatch_used_this_phase")).toBe(true);

    // Log should contain overwatch fired
    const log = engine.getLog();
    const notes = log.filter((e) => e.type === "note");
    expect(notes.some((n) => n.message.includes("Overwatch fired"))).toBe(true);
  });

  it("does not offer overwatch when player has 0 CP", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    // Override initial state to 0 CP
    const pack = {
      ...result.pack,
      initialState: {
        ...result.pack.initialState,
        resources: { A: { cp: 0 } },
      },
    };

    const engine = new SSCCEngine(pack);
    engine.initialize();

    // Advance through all events -- should never pause
    let advance = engine.advanceToNextEvent();
    let pausedAtCharge = false;
    while (advance !== null) {
      if (advance.paused && advance.event.id === "ChargeDeclarationsEnded") {
        pausedAtCharge = true;
        break;
      }
      advance = engine.advanceToNextEvent();
    }

    // The engine should NOT pause at ChargeDeclarationsEnded
    // because the resourceAtLeast predicate prevents the rule from matching,
    // AND cost pre-computation would suppress the choice even if offered
    expect(pausedAtCharge).toBe(false);

    // Verify suppression or no-match in log
    const state = engine.getState();
    expect(get(state, "$.resources.A.cp")).toBe(0);
  });
});
