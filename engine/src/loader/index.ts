import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import type { LoadResult, LoadedPack, Manifest, ValidationError } from "../types/index.js";
import { parseTimeline } from "./timeline.js";
import { parseGlossary } from "./glossary.js";
import { parseRules, indexRulesByEvent } from "./rules.js";
import { parseInitialState } from "./state.js";
import { validatePack } from "./validation.js";
import { collectEventIds } from "../sequencer/index.js";
import { SYSTEM_EVENTS } from "../types/index.js";

/**
 * Load a pack from a directory path.
 * Reads all files, parses, validates, and returns a LoadedPack or errors.
 */
export async function loadPack(packPath: string): Promise<LoadResult> {
  const errors: ValidationError[] = [];

  // Read files
  let manifestData: unknown;
  let timelineData: unknown;
  let glossaryData: unknown;
  let rulesData: unknown;
  let stateData: unknown;

  try {
    const manifestRaw = await readFile(join(packPath, "manifest.yaml"), "utf-8");
    manifestData = yaml.load(manifestRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read manifest.yaml: ${e}` });
  }

  try {
    const timelineRaw = await readFile(join(packPath, "timeline.yaml"), "utf-8");
    timelineData = yaml.load(timelineRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read timeline.yaml: ${e}` });
  }

  try {
    const glossaryRaw = await readFile(join(packPath, "glossary.yaml"), "utf-8");
    glossaryData = yaml.load(glossaryRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read glossary.yaml: ${e}` });
  }

  try {
    const rulesRaw = await readFile(join(packPath, "rules.json"), "utf-8");
    rulesData = JSON.parse(rulesRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read rules.json: ${e}` });
  }

  try {
    const stateRaw = await readFile(join(packPath, "initial_state.json"), "utf-8");
    stateData = JSON.parse(stateRaw);
  } catch (e) {
    errors.push({ code: "FILE_READ_ERROR", message: `Cannot read initial_state.json: ${e}` });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Parse
  const manifest = manifestData as Manifest;
  const { timeline, subSequences } = parseTimeline(timelineData);
  const glossary = parseGlossary(glossaryData);
  const rules = parseRules(rulesData);
  const initialState = parseInitialState(stateData);

  // Validate cross-references
  const validationErrors = validatePack(rules, glossary, timeline, subSequences);
  if (validationErrors.length > 0) {
    return { ok: false, errors: validationErrors };
  }

  // Index rules by event
  const rulesByEvent = indexRulesByEvent(rules);

  // Collect all event IDs
  const timelineEventIds = collectEventIds(timeline, subSequences);
  const emitEventIds = new Set<string>();
  for (const rule of rules) {
    for (const effect of rule.effect) {
      if ("emit" in effect) {
        emitEventIds.add(effect.emit.eventId);
      }
    }
  }
  const allEventIds = new Set([
    ...timelineEventIds,
    ...emitEventIds,
    ...SYSTEM_EVENTS,
  ]);

  const pack: LoadedPack = {
    manifest,
    timeline,
    subSequences,
    glossary,
    rules,
    rulesByEvent,
    initialState,
    allEventIds,
  };

  return { ok: true, pack };
}
