import type { State } from "../types/index.js";

/**
 * Parse raw initial_state.json into State.
 */
export function parseInitialState(data: unknown): State {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("initial_state.json must be a JSON object");
  }
  return data as State;
}
