import type {
  State,
  GameEvent,
  Rule,
  Glossary,
  LoadedPack,
  TimelineNode,
  SubSequence,
} from "../types/index.js";
import type { ChoiceInstance, ChoiceSnapshot, UndoCheck, UndoResult } from "../types/index.js";
import { get, set, expireStatuses } from "../state/index.js";
import { evaluate, executeEffect, type ResolvedEffect } from "../rules/index.js";
import { SeededRNG } from "../rng/index.js";
import { readDiePool, dieMatchesFilter } from "../rules/pool-helpers.js";
import {
  addChoice,
  selectChoice,
  resolveChoice,
  getActiveChoices,
  hasUnresolvedChoices,
  cancelOfferedChoices,
} from "../choices/index.js";
import { walkTimeline } from "../sequencer/index.js";
import { Logger, type LogEntry } from "../logger/index.js";

/**
 * Check if a player can afford the costs of a choice.
 * Looks up $.resources.<playerId>.<resourceKey> for each cost entry.
 */
function canAffordCosts(
  state: State,
  playerId: string,
  costs: Record<string, number>,
): boolean {
  for (const [resource, amount] of Object.entries(costs)) {
    const current = get(state, `$.resources.${playerId}.${resource}`);
    if (typeof current !== "number" || current < amount) {
      return false;
    }
  }
  return true;
}

/**
 * Deduct costs from a player's resources. Returns new state.
 * Caller must verify affordability first.
 */
function deductCosts(
  state: State,
  playerId: string,
  costs: Record<string, number>,
): State {
  let s = state;
  for (const [resource, amount] of Object.entries(costs)) {
    const current = get(s, `$.resources.${playerId}.${resource}`) as number;
    s = set(s, `$.resources.${playerId}.${resource}`, current - amount);
  }
  return s;
}

export interface AdvanceResult {
  state: State;
  event: GameEvent;
  paused: boolean;
}

/**
 * SSCC Engine -- top-level orchestrator.
 */
export class SSCCEngine {
  private pack: LoadedPack;
  private state: State;
  private logger: Logger;
  private sequencer: Generator<GameEvent> | null = null;
  private lastTimelineEvent: GameEvent | null = null;
  private rng: SeededRNG;
  private choiceHistory: ChoiceSnapshot[] = [];
  private _rngUsedDuringChoice = false;

  constructor(pack: LoadedPack, options?: { seed?: number }) {
    this.pack = pack;
    this.state = { ...pack.initialState, _choices: [] };
    this.logger = new Logger();
    const seed = options?.seed ?? Date.now();
    this.rng = new SeededRNG(seed);
    this.logger.log("note", `Engine initialized with seed ${seed}`);
  }

  /**
   * Initialize the sequencer. Call before advancing.
   */
  initialize(): void {
    this.sequencer = walkTimeline(
      this.pack.timeline,
      this.pack.subSequences,
      () => this.state,
    );
  }

  /**
   * Get the current state.
   */
  getState(): State {
    return this.state;
  }

  /**
   * Get all log entries.
   */
  getLog(): readonly LogEntry[] {
    return this.logger.getEntries();
  }

  /**
   * Get currently active choices.
   */
  enumerateChoices(): ChoiceInstance[] {
    return getActiveChoices(this.state);
  }

  /**
   * Check if engine is paused waiting for choices.
   */
  isPaused(): boolean {
    return hasUnresolvedChoices(this.state);
  }

  /**
   * Apply a player's choice selection.
   * Returns the updated state. Engine may pause again if new choices are created.
   */
  applyChoice(
    choiceInstanceId: string,
    args?: Record<string, unknown>,
  ): State {
    // Snapshot before choice for undo support
    const preChoiceState = this.state;
    const preChoiceRng = this.rng.captureState();

    // Find the choice and verify costs are still affordable
    const activeChoices = getActiveChoices(this.state);
    const choice = activeChoices.find((c) => c.choiceInstanceId === choiceInstanceId);
    if (!choice) {
      throw new Error(`Choice instance not found or not active: ${choiceInstanceId}`);
    }

    // Reset RNG tracking flag
    this._rngUsedDuringChoice = false;

    // Deduct costs before selection
    if (choice.costs && Object.keys(choice.costs).length > 0) {
      if (!canAffordCosts(this.state, choice.player, choice.costs)) {
        throw new Error(
          `Player ${choice.player} cannot afford choice ${choice.choiceId}: ` +
          `costs ${JSON.stringify(choice.costs)}`
        );
      }
      this.state = deductCosts(this.state, choice.player, choice.costs);
      this.logger.log("cost_deducted", `Costs deducted for ${choice.choiceId}`, {
        data: {
          choiceId: choice.choiceId,
          player: choice.player,
          costs: choice.costs,
        },
      });
    }

    // Validate multi-die selection if applicable
    if (choice.pick && choice.selectionFrom && "path" in choice.selectionFrom) {
      const selectedDice = args?.selectedDice as number[] | undefined;
      if (!selectedDice) {
        throw new Error(`Choice ${choice.choiceId} requires ${choice.pick} dice selection`);
      }
      validateDieSelection(
        this.state,
        choice.selectionFrom.path,
        selectedDice,
        choice.selectionFilter,
        choice.pick,
      );
    }

    const { state: newState, event } = selectChoice(
      this.state,
      choiceInstanceId,
      args,
    );
    this.state = newState;

    this.logger.log("choice_selected", `Choice selected: ${event.params.choiceId}`, {
      eventId: event.id,
      data: event.params,
    });

    // Evaluate the ChoiceSelected event (recursive, depth-first)
    this.state = this.evaluateEvent(this.state, event);

    // Resolve the choice after its action completes
    this.state = resolveChoice(this.state, choiceInstanceId);

    // Push snapshot to undo stack
    this.choiceHistory.push({
      choiceInstanceId,
      state: preChoiceState,
      rngState: preChoiceRng,
      choiceId: choice.choiceId,
      args,
      usedRNG: this._rngUsedDuringChoice,
    });

    return this.state;
  }

  /**
   * Check if a choice can be undone and what confirmation is needed.
   */
  canUndoChoice(choiceInstanceId: string): UndoCheck | null {
    const idx = this.choiceHistory.findIndex(
      (s) => s.choiceInstanceId === choiceInstanceId,
    );
    if (idx === -1) return null;

    const cascadeCount = this.choiceHistory.length - idx;
    const anyUsedRNG = this.choiceHistory
      .slice(idx)
      .some((s) => s.usedRNG);

    return {
      requiresConfirm: anyUsedRNG,
      reason: anyUsedRNG ? "RNG effects will be reverted" : undefined,
      cascadeCount,
    };
  }

  /**
   * Undo a choice and all choices made after it.
   */
  undoChoice(
    choiceInstanceId: string,
    options?: { confirm?: boolean },
  ): UndoResult {
    const check = this.canUndoChoice(choiceInstanceId);
    if (!check) {
      throw new Error(`Cannot undo choice: ${choiceInstanceId} not in undo history`);
    }

    if (check.requiresConfirm && !options?.confirm) {
      throw new Error(
        "Undo involves RNG effects — pass { confirm: true } to proceed",
      );
    }

    const idx = this.choiceHistory.findIndex(
      (s) => s.choiceInstanceId === choiceInstanceId,
    );
    const snapshot = this.choiceHistory[idx];

    // Collect undone choice IDs
    const undoneChoices = this.choiceHistory
      .slice(idx)
      .map((s) => s.choiceInstanceId);

    // Restore state and RNG
    this.state = snapshot.state;
    this.rng.restoreState(snapshot.rngState);

    // Truncate history
    this.choiceHistory = this.choiceHistory.slice(0, idx);

    // Log the undo
    this.logger.log("choice_undone", `Undo: reverted to before ${snapshot.choiceId}, undid ${undoneChoices.length} choice(s)`, {
      data: {
        undoneChoices,
        targetChoiceId: snapshot.choiceId,
      },
    });

    return {
      success: true,
      undoneChoices,
      state: this.state,
    };
  }

  /**
   * Cancel all currently offered choices (pass/decline).
   * Allows the engine to advance past a choice point.
   */
  passAllChoices(): State {
    this.state = cancelOfferedChoices(this.state);
    this.logger.log("note", "All offered choices passed");
    return this.state;
  }

  /**
   * Advance to the next timeline event.
   * Returns null if timeline is exhausted.
   * If choices are active, returns the paused state without advancing.
   */
  advanceToNextEvent(): AdvanceResult | null {
    if (!this.sequencer) {
      throw new Error("Engine not initialized. Call initialize() first.");
    }

    // If paused on choices, do not advance
    if (hasUnresolvedChoices(this.state)) {
      return {
        state: this.state,
        event: this.lastTimelineEvent!,
        paused: true,
      };
    }

    const next = this.sequencer.next();
    if (next.done) return null;

    const event = next.value;
    this.lastTimelineEvent = event;

    this.state = this.evaluateEvent(this.state, event);

    // Clear undo stack when advancing past a resolved pause point
    if (!hasUnresolvedChoices(this.state)) {
      this.choiceHistory = [];
    }

    return {
      state: this.state,
      event,
      paused: hasUnresolvedChoices(this.state),
    };
  }

  /**
   * Core recursive event evaluation.
   *
   * 1. Expire statuses matching this event
   * 2. Log event
   * 3. Evaluate matching rules
   * 4. Execute resolved effects (collecting emitted events and new choices)
   * 5. Add new choices to state
   * 6. Recursively evaluate emitted events
   */
  private evaluateEvent(state: State, event: GameEvent): State {
    // Step 1: Expire statuses
    state = expireStatuses(state, event.id);

    // Log expired statuses
    this.logger.log("event_fired", `Event: ${event.id}`, {
      eventId: event.id,
      data: event.params,
    });

    // Step 2: Get rules for this event
    const rules = this.pack.rulesByEvent.get(event.id) ?? [];

    // Step 3: Evaluate rules
    const evalResult = evaluate(state, event, rules, this.pack.glossary);

    for (const [ruleId, matched] of evalResult.predicateResults) {
      this.logger.log(
        matched ? "rules_matched" : "rule_skipped",
        `Rule ${ruleId}: ${matched ? "matched" : "skipped"}`,
        { eventId: event.id, ruleId },
      );
    }

    // Step 4: Execute resolved effects
    const allEmittedEvents: GameEvent[] = [];
    const allNewChoices: ChoiceInstance[] = [];

    for (const resolvedEffect of evalResult.resolvedEffects) {
      const effectResult = executeEffect(
        state,
        resolvedEffect.effect,
        event,
        resolvedEffect.ruleId,
        this.pack.glossary,
        this.rng,
      );
      state = effectResult.state;
      allEmittedEvents.push(...effectResult.emittedEvents);
      allNewChoices.push(...effectResult.newChoices);
      if (effectResult.usedRNG) {
        this._rngUsedDuringChoice = true;
      }

      for (const entry of effectResult.logEntries) {
        this.logger.log("note", entry.message, {
          eventId: event.id,
          ruleId: entry.ruleId,
        });
      }
      this.logger.log("effect_applied", `Effect: ${Object.keys(resolvedEffect.effect)[0]}`, {
        eventId: event.id,
        ruleId: resolvedEffect.ruleId,
        data: { effect: resolvedEffect.effect },
      });
    }

    // Step 5: Add new choices to state (filter unaffordable)
    for (const choice of allNewChoices) {
      if (choice.costs && Object.keys(choice.costs).length > 0) {
        if (!canAffordCosts(state, choice.player, choice.costs)) {
          this.logger.log("choice_suppressed", `Choice suppressed (unaffordable): ${choice.choiceId}`, {
            eventId: event.id,
            data: {
              choiceId: choice.choiceId,
              player: choice.player,
              costs: choice.costs,
            },
          });
          continue;
        }
      }
      state = addChoice(state, choice);
      this.logger.log("choice_offered", `Choice offered: ${choice.choiceId}`, {
        eventId: event.id,
        data: {
          choiceId: choice.choiceId,
          choiceInstanceId: choice.choiceInstanceId,
          player: choice.player,
        },
      });
    }

    // Step 6: Recursively evaluate emitted events (depth-first)
    for (const emitted of allEmittedEvents) {
      state = this.evaluateEvent(state, emitted);
    }

    return state;
  }
}

/**
 * Validate a multi-die selection against pool state.
 */
export function validateDieSelection(
  state: State,
  poolPath: string,
  selectedIndices: number[],
  filter: Record<string, unknown> | undefined,
  expectedPick: number,
): void {
  if (selectedIndices.length !== expectedPick) {
    throw new Error(`Expected ${expectedPick} dice, got ${selectedIndices.length}`);
  }
  const dice = readDiePool(state, poolPath);
  for (const idx of selectedIndices) {
    const die = dice.find((d) => d.index === idx);
    if (!die) {
      throw new Error(`Die index ${idx} not found in pool at ${poolPath}`);
    }
    if (!dieMatchesFilter(die, filter)) {
      throw new Error(`Die ${idx} does not match filter at ${poolPath}`);
    }
  }
}
