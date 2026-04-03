import { describe, it, expect } from "vitest";
import { loadPack } from "../../src/loader/index.js";
import { SSCCEngine } from "../../src/engine/index.js";
import { get } from "../../src/state/index.js";
import { join } from "node:path";

const PACK_PATH = join(import.meta.dirname, "../../../packs/hello-pack");

describe("Hello Pack end-to-end", () => {
  it("loads successfully", async () => {
    const result = await loadPack(PACK_PATH);
    expect(result.ok).toBe(true);
  });

  it("runs 3 rounds, each player gains 1 coin per round", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let eventCount = 0;
    const maxEvents = 200;

    while (advance !== null && eventCount < maxEvents) {
      eventCount++;

      if (advance.paused) {
        // Select the gain_coin choice
        const choices = engine.enumerateChoices();
        const coinChoice = choices.find((c) => c.choiceId === "gain_coin");
        if (coinChoice) {
          engine.applyChoice(coinChoice.choiceInstanceId);
        }
      }

      advance = engine.advanceToNextEvent();
    }

    // After 3 rounds x 2 players = 6 turns, each player should have 3 coins
    const state = engine.getState();
    expect(get(state, "$.resources.A.coin")).toBe(3);
    expect(get(state, "$.resources.B.coin")).toBe(3);
  });

  it("log contains expected events", async () => {
    const result = await loadPack(PACK_PATH);
    if (!result.ok) throw new Error(`Load failed: ${JSON.stringify(result.errors)}`);

    const engine = new SSCCEngine(result.pack);
    engine.initialize();

    let advance = engine.advanceToNextEvent();
    let safetyCounter = 0;

    while (advance !== null && safetyCounter < 200) {
      safetyCounter++;
      if (advance.paused) {
        const choices = engine.enumerateChoices();
        if (choices.length > 0) {
          engine.applyChoice(choices[0].choiceInstanceId);
        }
      }
      advance = engine.advanceToNextEvent();
    }

    const log = engine.getLog();
    const eventsFired = log.filter((e) => e.type === "event_fired");
    const startEvents = eventsFired.filter((e) => e.eventId === "StartOfGame");
    const endEvents = eventsFired.filter((e) => e.eventId === "EndOfGame");
    expect(startEvents.length).toBe(1);
    expect(endEvents.length).toBe(1);
  });
});
