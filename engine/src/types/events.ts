/**
 * Event types -- timeline and rule-emitted events.
 */

/** A game event with an ID and parameter bag. */
export interface GameEvent {
  id: string;
  params: Record<string, unknown>;
}

/**
 * System event IDs that the engine emits automatically.
 * Pack rules may trigger on these.
 */
export const SYSTEM_EVENTS = [
  "ChoiceAdded",
  "ChoiceSelected",
  "ChoiceResolved",
  "ChoiceExpired",
] as const;

export type SystemEventId = (typeof SYSTEM_EVENTS)[number];
