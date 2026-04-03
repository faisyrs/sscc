export type LogEntryType =
  | "event_fired"
  | "rules_matched"
  | "effect_applied"
  | "choice_offered"
  | "choice_selected"
  | "choice_resolved"
  | "choice_expired"
  | "status_expired"
  | "note"
  | "error";

export interface LogEntry {
  timestamp: number;
  type: LogEntryType;
  eventId?: string;
  ruleId?: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only logger for engine explainability.
 */
export class Logger {
  private entries: LogEntry[] = [];
  private counter = 0;

  log(
    type: LogEntryType,
    message: string,
    details?: { eventId?: string; ruleId?: string; data?: Record<string, unknown> },
  ): void {
    this.entries.push({
      timestamp: this.counter++,
      type,
      message,
      eventId: details?.eventId,
      ruleId: details?.ruleId,
      data: details?.data,
    });
  }

  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
    this.counter = 0;
  }
}
