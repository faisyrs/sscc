/**
 * Choice lifecycle types.
 */

import type { TargetRef } from "./rules.js";

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
}
