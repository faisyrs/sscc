import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/wh40k-10e-ms5b");

describe("wh40k-10e-ms5b command phase", () => {
  it("loads successfully with datasheets merged", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const u1 = get(result.pack.initialState, "$.units.u1") as any;
    expect(u1.name).toBe("Intercessor Squad");
    expect(u1.stats.Ld).toBe(6);
    // datasheet key should be removed after merge
    expect(u1.datasheet).toBeUndefined();
  });

  it("awards CP after command phase when passing all choices", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    // Advance through StartOfGame, RoundStarted, TurnStarted, CommandPhaseStarted
    while (advance !== null && safetyCounter < 500) {
      if (advance.paused) {
        engine.passAllChoices();
      }
      advance = engine.advanceToNextEvent();
      safetyCounter++;
      // Stop after we reach MovementPhaseStarted (past command phase)
      if (advance?.event?.id === "MovementPhaseStarted") break;
    }

    // Player A should have 1 CP from command phase
    const cpA = get(engine.getState(), "$.resources.A.cp") as number;
    expect(cpA).toBe(1);
  });

  it("fires battleshock roll for below-half-strength unit when selected", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;
    let sawBattleshockResult = false;

    while (advance !== null && safetyCounter < 500) {
      safetyCounter++;

      if (advance.paused) {
        const choices = engine.enumerateChoices();
        const battleshockChoice = choices.find(
          (c) => c.choiceId === "select_battleshock_unit",
        );
        if (battleshockChoice) {
          // Select the first available unit for battleshock
          engine.applyChoice(battleshockChoice.choiceInstanceId, {
            selectedUnitId: "u2",
          });
        } else {
          engine.passAllChoices();
        }
      }

      advance = engine.advanceToNextEvent();
      if (advance?.event?.id === "MovementPhaseStarted") break;
    }

    // Check the log for battleshock test result
    const log = engine.getLog();
    const battleshockEntries = log.filter(
      (e) =>
        e.type === "event_fired" &&
        (e.eventId === "BattleshockTestResult"),
    );
    sawBattleshockResult = battleshockEntries.length > 0;
    expect(sawBattleshockResult).toBe(true);
  });

  it("applies battleshocked status when roll fails", async () => {
    // Find a seed where 2d6 < 6 (the Ld of u2)
    // 2d6 minimum is 2, so we need sum of 2-5
    // Try seeds until we find one where the first 2d6 roll sums < 6
    const { SeededRNG } = await import("../../src/rng/index.js");
    let failSeed = 0;
    for (let s = 0; s < 10000; s++) {
      const rng = new SeededRNG(s);
      const d1 = rng.nextInt(1, 6);
      const d2 = rng.nextInt(1, 6);
      if (d1 + d2 < 6) {
        failSeed = s;
        break;
      }
    }

    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: failSeed });
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    while (advance !== null && safetyCounter < 500) {
      safetyCounter++;

      if (advance.paused) {
        const choices = engine.enumerateChoices();
        const battleshockChoice = choices.find(
          (c) => c.choiceId === "select_battleshock_unit",
        );
        if (battleshockChoice) {
          engine.applyChoice(battleshockChoice.choiceInstanceId, {
            selectedUnitId: "u2",
          });
        } else {
          engine.passAllChoices();
        }
      }

      advance = engine.advanceToNextEvent();
      if (advance?.event?.id === "MovementPhaseStarted") break;
    }

    const state = engine.getState();
    const u2Statuses = get(state, "$.units.u2.statuses") as Record<string, unknown>;
    expect(u2Statuses).toHaveProperty("battleshocked");
    // needs_battleshock_test should have been removed
    expect(u2Statuses).not.toHaveProperty("needs_battleshock_test");
  });

  it("does not apply battleshocked when roll passes", async () => {
    // Find a seed where 2d6 >= 6
    const { SeededRNG } = await import("../../src/rng/index.js");
    let passSeed = 0;
    for (let s = 0; s < 10000; s++) {
      const rng = new SeededRNG(s);
      const d1 = rng.nextInt(1, 6);
      const d2 = rng.nextInt(1, 6);
      if (d1 + d2 >= 6) {
        passSeed = s;
        break;
      }
    }

    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: passSeed });
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    while (advance !== null && safetyCounter < 500) {
      safetyCounter++;

      if (advance.paused) {
        const choices = engine.enumerateChoices();
        const battleshockChoice = choices.find(
          (c) => c.choiceId === "select_battleshock_unit",
        );
        if (battleshockChoice) {
          engine.applyChoice(battleshockChoice.choiceInstanceId, {
            selectedUnitId: "u2",
          });
        } else {
          engine.passAllChoices();
        }
      }

      advance = engine.advanceToNextEvent();
      if (advance?.event?.id === "MovementPhaseStarted") break;
    }

    const state = engine.getState();
    const u2Statuses = get(state, "$.units.u2.statuses") as Record<string, unknown>;
    expect(u2Statuses).not.toHaveProperty("battleshocked");
    expect(u2Statuses).not.toHaveProperty("needs_battleshock_test");
  });

  it("awards CP to both players across their command phases", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    // Advance through both players' full turns in round 1
    while (advance !== null && safetyCounter < 2000) {
      safetyCounter++;
      if (advance.paused) {
        engine.passAllChoices();
      }
      advance = engine.advanceToNextEvent();
      // Stop after round 1 ends
      if (advance?.event?.id === "RoundEnded") break;
    }

    const state = engine.getState();
    const cpA = get(state, "$.resources.A.cp") as number;
    const cpB = get(state, "$.resources.B.cp") as number;
    expect(cpA).toBe(1);
    expect(cpB).toBe(1);
  });
});
