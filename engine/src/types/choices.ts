/**
 * Choice lifecycle types.
 */

import type { TargetRef } from "./rules.js";
import type { State } from "./state.js";
import type { RNGSnapshot } from "../rng/index.js";

export type ChoiceState = "offered" | "selected" | "resolved" | "expired" | "cancelled";

export interface ChoiceInstance {
  choiceInstanceId: string;
  choiceId: string;
  label: string;
  actionRef: string;
  player: string;
  sourceRuleId: string;
  createdAtEvent: string;
  state: ChoiceState;
  selectionFrom?: TargetRef;
  selectedArgs?: Record<string, unknown>;
  costs?: Record<string, number>;
  selectionFilter?: Record<string, unknown>;
  pick?: number;
}

export interface ChoiceSnapshot {
  choiceInstanceId: string;
  state: State;
  rngState: RNGSnapshot;
  choiceId: string;
  args?: Record<string, unknown>;
  usedRNG: boolean;
}

export interface UndoCheck {
  requiresConfirm: boolean;
  reason?: string;
  cascadeCount: number;
}

export interface UndoResult {
  success: boolean;
  undoneChoices: string[];
  state: State;
}
