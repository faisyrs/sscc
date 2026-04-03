import * as readline from "node:readline";
import type { SSCCEngine } from "../../engine/src/engine/index.js";
import type { GameEvent, ChoiceInstance } from "../../engine/src/types/index.js";
import { renderFullDisplay, renderEventLine } from "./renderer.js";
import { parseInput, executeCommand } from "./commands.js";

export interface GameLoopOptions {
  stepMode: boolean;
}

export async function runGameLoop(
  engine: SSCCEngine,
  options: GameLoopOptions,
): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let stepMode = options.stepMode;
  let lastEvent: GameEvent | null = null;
  let lastLogIndex = 0;

  const prompt = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  try {
    while (true) {
      const advanceResult = engine.advanceToNextEvent();
      if (advanceResult === null) {
        console.log("\n=== Game Over ===");
        break;
      }

      lastEvent = advanceResult.event;

      // Collect log notes from this event
      const fullLog = engine.getLog();
      const newEntries = fullLog.slice(lastLogIndex);
      lastLogIndex = fullLog.length;
      const notes = newEntries
        .filter((e) => e.type === "note" && e.eventId === lastEvent!.id)
        .map((e) => e.message);

      if (advanceResult.paused) {
        // Choice point — full display
        const choices = engine.enumerateChoices();
        console.log("\n" + renderFullDisplay(engine.getState(), lastEvent, choices));
        await handleChoiceLoop(engine, choices, lastEvent, prompt);
        lastLogIndex = engine.getLog().length;
      } else if (stepMode) {
        // Step mode — show event, wait
        console.log(renderEventLine(lastEvent, notes));
        const input = await prompt("> ");
        const parsed = parseInput(input);

        if (parsed.type === "quit") break;
        if (parsed.type === "step") {
          stepMode = !stepMode;
          console.log(`  Step mode: ${stepMode ? "ON" : "OFF"}`);
        } else if (
          parsed.type === "help" ||
          parsed.type === "log" ||
          parsed.type === "rules" ||
          parsed.type === "state"
        ) {
          const output = executeCommand(parsed, engine, lastEvent);
          if (output) console.log(output);
        }
      } else {
        // Auto-advance — condensed line
        console.log(renderEventLine(lastEvent, notes));
      }
    }
  } finally {
    rl.close();
  }
}

async function handleChoiceLoop(
  engine: SSCCEngine,
  _choices: ChoiceInstance[],
  lastEvent: GameEvent,
  prompt: (q: string) => Promise<string>,
): Promise<void> {
  while (engine.isPaused()) {
    const input = await prompt("> ");
    const parsed = parseInput(input);

    switch (parsed.type) {
      case "pass": {
        engine.passAllChoices();
        console.log("  Passed on all choices.");
        return;
      }

      case "choice": {
        const currentChoices = engine.enumerateChoices();
        const idx = parsed.index - 1;
        if (idx < 0 || idx >= currentChoices.length) {
          console.log(`  Invalid choice. Enter 1-${currentChoices.length} or 0 to pass.`);
          break;
        }
        const choice = currentChoices[idx];

        if (choice.pick) {
          const diceInput = await prompt(`  Select ${choice.pick} dice: `);
          const diceParsed = parseInput(diceInput);
          if (diceParsed.type !== "dice") {
            console.log(`  Enter ${choice.pick} space-separated dice indices.`);
            break;
          }
          try {
            engine.applyChoice(choice.choiceInstanceId, {
              selectedDice: diceParsed.indices,
            });
            console.log(`  Applied: ${choice.label}`);
          } catch (err: unknown) {
            console.log(`  Error: ${(err as Error).message}`);
            break;
          }
        } else {
          try {
            engine.applyChoice(choice.choiceInstanceId);
            console.log(`  Applied: ${choice.label}`);
          } catch (err: unknown) {
            console.log(`  Error: ${(err as Error).message}`);
            break;
          }
        }

        // Re-render if still paused
        if (engine.isPaused()) {
          const newChoices = engine.enumerateChoices();
          if (newChoices.length > 0) {
            console.log(
              "\n" + renderFullDisplay(engine.getState(), lastEvent, newChoices),
            );
          }
        }
        break;
      }

      case "undo": {
        const lastChoiceId = getLastAppliedChoiceId(engine);
        if (!lastChoiceId) {
          console.log("  Nothing to undo.");
          break;
        }
        const check = engine.canUndoChoice(lastChoiceId);
        if (!check) {
          console.log("  Nothing to undo.");
          break;
        }
        if (check.requiresConfirm) {
          const confirm = await prompt(
            "  Undo involves RNG effects. Confirm? (y/n): ",
          );
          if (confirm.trim().toLowerCase() !== "y") {
            console.log("  Undo cancelled.");
            break;
          }
          engine.undoChoice(lastChoiceId, { confirm: true });
        } else {
          engine.undoChoice(lastChoiceId);
        }
        console.log("  Undo applied.");

        const newChoices = engine.enumerateChoices();
        if (newChoices.length > 0) {
          console.log(
            "\n" + renderFullDisplay(engine.getState(), lastEvent, newChoices),
          );
        }
        break;
      }

      case "quit":
        process.exit(0);

      case "step":
        console.log("  (step mode changes take effect after this choice point)");
        break;

      default: {
        const output = executeCommand(parsed, engine, lastEvent);
        if (output) {
          console.log(output);
        } else if (parsed.type === "unknown") {
          console.log(
            `  Unknown command: ${parsed.raw}. Type 'help' for commands.`,
          );
        }
      }
    }
  }
}

function getLastAppliedChoiceId(engine: SSCCEngine): string {
  const log = engine.getLog();
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === "choice_selected" && log[i].data) {
      const data = log[i].data as Record<string, unknown>;
      if (typeof data.choiceInstanceId === "string") {
        return data.choiceInstanceId;
      }
    }
  }
  return "";
}
