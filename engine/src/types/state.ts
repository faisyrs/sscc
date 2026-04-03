/**
 * State types -- immutable game state and path resolution.
 */

/** A status entry on an entity. expiresOn is an event ID or null for rule-consumed. */
export interface StatusEntry {
  expiresOn: string | null;
}

/** The game state is a plain JSON-compatible object. */
export type State = Record<string, unknown>;

/** A reference to a state path, e.g. "$.units.u1.statuses" */
export type StatePath = string;
