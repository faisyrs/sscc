import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { getStatuses } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/wh40k-10e-ms5b");

/**
 * Advance through events, passing all choices, until MovementPhaseStarted fires.
 * Returns when MovementPhaseStarted is the current event. Does NOT pass the
 * choices queued by MovementPhaseStarted so the caller can interact with them.
 */
function advancePastCommandPhase(engine: SSCCEngine): void {
  let advance = engine.advanceToNextEvent();
  let safetyCounter = 0;
  while (advance !== null && safetyCounter < 1000) {
    if (advance.event?.id === "MovementPhaseStarted") return;
    if (advance.paused) engine.passAllChoices();
    advance = engine.advanceToNextEvent();
    safetyCounter++;
  }
  throw new Error("Never reached MovementPhaseStarted");
}

describe("wh40k-10e-ms5b movement phase", () => {
  it("unit selection is offered at MovementPhaseStarted", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    advancePastCommandPhase(engine);

    // Engine is paused at MovementPhaseStarted -- choices are already queued
    expect(engine.isPaused()).toBe(true);

    const choices = engine.enumerateChoices();
    const selectChoice = choices.find((c) => c.choiceId === "select_unit_to_move");
    expect(selectChoice).toBeDefined();
  });

  it("advanced_move status is applied when Advance is chosen", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    advancePastCommandPhase(engine);

    // Engine is paused with unit selection choice
    expect(engine.isPaused()).toBe(true);

    // Select u1 to move
    const selectChoice = engine
      .enumerateChoices()
      .find((c) => c.choiceId === "select_unit_to_move");
    expect(selectChoice).toBeDefined();
    engine.applyChoice(selectChoice!.choiceInstanceId, { selectedUnitId: "u1" });

    // Advance to process UnitMovementStarted (move type choices will be offered)
    const advance = engine.advanceToNextEvent();
    expect(advance?.paused).toBe(true);

    // Choose Advance
    const advanceChoice = engine
      .enumerateChoices()
      .find((c) => c.choiceId === "move_advance");
    expect(advanceChoice).toBeDefined();
    engine.applyChoice(advanceChoice!.choiceInstanceId);

    // Advance to process UnitMovementEnded
    engine.advanceToNextEvent();

    const statuses = getStatuses(engine.getState(), "u1");
    expect(statuses).toHaveProperty("advanced_move");
  });

  it("Fall Back is NOT offered when no units have in_engagement_range status", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    advancePastCommandPhase(engine);

    // Engine is paused with unit selection choice
    expect(engine.isPaused()).toBe(true);

    // Select a unit
    const selectChoice = engine
      .enumerateChoices()
      .find((c) => c.choiceId === "select_unit_to_move");
    expect(selectChoice).toBeDefined();
    engine.applyChoice(selectChoice!.choiceInstanceId, { selectedUnitId: "u1" });

    // Advance to get move type choices (UnitMovementStarted)
    const advance = engine.advanceToNextEvent();
    expect(advance?.paused).toBe(true);

    const choices = engine.enumerateChoices();
    const fallBackChoice = choices.find((c) => c.choiceId === "move_fall_back");
    expect(fallBackChoice).toBeUndefined();
  });

  it("Normal Move, Advance, and Remain Stationary are offered", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const engine = new SSCCEngine(result.pack, { seed: 42 });
    engine.initialize();

    advancePastCommandPhase(engine);

    // Engine is paused with unit selection choice
    expect(engine.isPaused()).toBe(true);

    // Select a unit
    const selectChoice = engine
      .enumerateChoices()
      .find((c) => c.choiceId === "select_unit_to_move");
    expect(selectChoice).toBeDefined();
    engine.applyChoice(selectChoice!.choiceInstanceId, { selectedUnitId: "u1" });

    // Advance to get move type choices (UnitMovementStarted)
    const advance = engine.advanceToNextEvent();
    expect(advance?.paused).toBe(true);

    const choiceIds = engine.enumerateChoices().map((c) => c.choiceId);
    expect(choiceIds).toContain("move_normal");
    expect(choiceIds).toContain("move_advance");
    expect(choiceIds).toContain("move_stationary");
  });
});
