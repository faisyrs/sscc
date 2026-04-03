import type { SSCCEngine } from "../../engine/src/engine/index.js";
import type { LogEntry } from "../../engine/src/logger/index.js";
import { get } from "../../engine/src/state/index.js";

export type ParsedInput =
  | { type: "choice"; index: number }
  | { type: "pass" }
  | { type: "dice"; indices: number[] }
  | { type: "advance" }
  | { type: "undo" }
  | { type: "log"; count: number }
  | { type: "rules" }
  | { type: "state"; path: string }
  | { type: "step" }
  | { type: "help" }
  | { type: "quit" }
  | { type: "unknown"; raw: string };

export function parseInput(raw: string): ParsedInput {
  const trimmed = raw.trim();

  if (trimmed === "") return { type: "advance" };
  if (trimmed === "f") return { type: "pass" };
  if (trimmed === "undo") return { type: "undo" };
  if (trimmed === "rules") return { type: "rules" };
  if (trimmed === "step") return { type: "step" };
  if (trimmed === "help") return { type: "help" };
  if (trimmed === "quit") return { type: "quit" };

  if (trimmed.startsWith("log")) {
    const parts = trimmed.split(/\s+/);
    const count = parts.length > 1 ? parseInt(parts[1], 10) : 20;
    return { type: "log", count: isNaN(count) ? 20 : count };
  }

  if (trimmed.startsWith("state ")) {
    const path = trimmed.slice(6).trim();
    return { type: "state", path };
  }

  if (/^\d+(\s+\d+)*$/.test(trimmed)) {
    const nums = trimmed.split(/\s+/).map(Number);
    if (nums.length === 1) {
      if (nums[0] === 0) return { type: "pass" };
      return { type: "choice", index: nums[0] };
    }
    return { type: "dice", indices: nums };
  }

  return { type: "unknown", raw: trimmed };
}

export function executeCommand(
  input: ParsedInput,
  engine: SSCCEngine,
  lastEvent: { id: string } | null,
): string | null {
  switch (input.type) {
    case "log": {
      const entries = engine.getLog();
      const recent = entries.slice(-input.count);
      if (recent.length === 0) return "  (no log entries)";
      return recent
        .map((e: LogEntry) => {
          const parts = [`[${e.type}]`, e.message];
          if (e.ruleId) parts.push(`(${e.ruleId})`);
          return `  ${parts.join(" ")}`;
        })
        .join("\n");
    }

    case "rules": {
      if (!lastEvent) return "  No events have fired yet.";
      const entries = engine.getLog();
      const ruleEntries = entries.filter(
        (e: LogEntry) =>
          (e.type === "rules_matched" || e.type === "rule_skipped") &&
          e.eventId === lastEvent.id,
      );
      if (ruleEntries.length === 0) return `  No rules evaluated for ${lastEvent.id}`;
      return ruleEntries
        .map((e: LogEntry) => `  ${e.message}`)
        .join("\n");
    }

    case "state": {
      const val = get(engine.getState(), input.path);
      if (val === undefined) return `  ${input.path} = undefined`;
      return `  ${input.path} = ${JSON.stringify(val, null, 2)}`;
    }

    case "help":
      return [
        "Commands:",
        "  0 / f          Pass on all choices",
        "  1-N            Select choice by number",
        "  undo           Undo last choice",
        "  log [N]        Show last N log entries (default 20)",
        "  rules          Show rules that fired on last event",
        "  state <path>   Inspect state at path (e.g. state $.units)",
        "  step           Toggle step-by-step mode",
        "  help           Show this help",
        "  quit           Exit",
      ].join("\n");

    default:
      return null;
  }
}
