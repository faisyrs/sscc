import type {
  State,
  GameEvent,
  Rule,
  Glossary,
  LoadedPack,
  TimelineNode,
  SubSequence,
} from "../types/index.js";
import type { ChoiceInstance } from "../types/index.js";
import { get, set, expireStatuses } from "../state/index.js";
import { evaluate, executeEffect, type ResolvedEffect } from "../rules/index.js";
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

  constructor(pack: LoadedPack) {
    this.pack = pack;
    this.state = { ...pack.initialState, _choices: [] };
    this.logger = new Logger();
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
    // Find the choice and verify costs are still affordable
    const activeChoices = getActiveChoices(this.state);
    const choice = activeChoices.find((c) => c.choiceInstanceId === choiceInstanceId);
    if (!choice) {
      throw new Error(`Choice instance not found or not active: ${choiceInstanceId}`);
    }

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

    if (evalResult.matchedRules.length > 0) {
      this.logger.log("rules_matched", `${evalResult.matchedRules.length} rules matched`, {
        eventId: event.id,
        data: { ruleIds: evalResult.matchedRules.map((r) => r.id) },
      });
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
      );
      state = effectResult.state;
      allEmittedEvents.push(...effectResult.emittedEvents);
      allNewChoices.push(...effectResult.newChoices);

      for (const entry of effectResult.logEntries) {
        this.logger.log("note", entry.message, {
          eventId: event.id,
          ruleId: entry.ruleId,
        });
      }
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
