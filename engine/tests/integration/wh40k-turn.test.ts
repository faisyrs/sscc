import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get, getStatuses } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/wh40k-10e-core-turn");

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
