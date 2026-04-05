import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';
import { setPath } from './state.js';
import type {
  Condition,
  DerivedStateDef,
  Effect,
  LoadedPack,
  MacroDef,
  Rule,
  SelectorDef,
  SequenceStep,
  State,
  TemplateDef,
  ArmyUnit,
} from './types.js';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type KeyClass = 'include' | 'objects' | 'macros' | 'derived' | 'selectors' | 'keywords' | 'sequence' | 'rule' | 'template';

const RESERVED: ReadonlySet<string> = new Set(['include', 'objects', 'macros', 'derived', 'selectors', 'keywords']);

export function classifyKey(key: string, value: unknown): KeyClass {
  if (RESERVED.has(key)) return key as KeyClass;
  if (Array.isArray(value)) return 'sequence';
  if (typeof value === 'object' && value !== null) {
    if ('when' in value) return 'rule';
    if ('template' in value) return 'template';
  }
  throw new Error(`Cannot classify top-level key: "${key}"`);
}

// ---------------------------------------------------------------------------
// Parsed file types
// ---------------------------------------------------------------------------

export interface ParsedRulesFile {
  sequences: Map<string, SequenceStep[]>;
  rules: Rule[];
  templates: Map<string, TemplateDef>;
  objects: Map<string, string>;
  macros: Map<string, MacroDef>;
  derived: Map<string, DerivedStateDef>;
  selectors: Map<string, SelectorDef>;
  includes: string[];
  filePath: string;
}

export interface ParsedArmyFile {
  includes: string[];
  units: ArmyUnit[];
}

// ---------------------------------------------------------------------------
// Sequence step parsing
// ---------------------------------------------------------------------------

function parseSequenceStep(item: unknown): SequenceStep {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    const obj = item as Record<string, unknown>;
    // { sequence: "name" }
    if ('sequence' in obj && typeof obj['sequence'] === 'string') {
      return { sequence: obj['sequence'] };
    }
    // { someName: { repeat: N } }
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const name = keys[0];
      const inner = obj[name];
      if (typeof inner === 'object' && inner !== null && 'repeat' in (inner as Record<string, unknown>)) {
        return { [name]: { repeat: (inner as Record<string, unknown>)['repeat'] as number } };
      }
    }
  }
  throw new Error(`Cannot parse sequence step: ${JSON.stringify(item)}`);
}

// ---------------------------------------------------------------------------
// Rule parsing
// ---------------------------------------------------------------------------

function parseRule(id: string, raw: Record<string, unknown>): Rule {
  if (!raw['when']) throw new Error(`Rule "${id}" missing "when"`);
  if (!raw['effect']) throw new Error(`Rule "${id}" missing "effect"`);

  const when = raw['when'] as Condition;
  const effect = raw['effect'] as Effect[];
  const rule: Rule = { id, when, effect };

  if (raw['label']) rule.label = raw['label'] as string;
  if (raw['choice']) rule.choice = raw['choice'] as string;
  if (raw['costs']) rule.costs = raw['costs'] as Record<string, number>;
  if (raw['provenance']) rule.provenance = raw['provenance'] as Record<string, string>;

  // Also detect playerChoice in the condition tree
  if (!rule.choice) {
    const playerPath = findPlayerChoice(when);
    if (playerPath) rule.choice = playerPath;
  }

  return rule;
}

/** Recursively search condition tree for playerChoice nodes. */
function findPlayerChoice(cond: Condition): string | undefined {
  if ('playerChoice' in cond) {
    return (cond as { playerChoice: { player: string } }).playerChoice.player;
  }
  if ('all' in cond) {
    for (const c of (cond as { all: Condition[] }).all) {
      const found = findPlayerChoice(c);
      if (found) return found;
    }
  }
  if ('any' in cond) {
    for (const c of (cond as { any: Condition[] }).any) {
      const found = findPlayerChoice(c);
      if (found) return found;
    }
  }
  if ('not' in cond) {
    return findPlayerChoice((cond as { not: Condition }).not);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Condition event extraction (for rule indexing)
// ---------------------------------------------------------------------------

export function extractEventRefs(condition: Condition): { on: string[]; is: string[] } {
  const ons: string[] = [];
  const iss: string[] = [];
  walkCondition(condition, ons, iss);
  return { on: ons, is: iss };
}

function walkCondition(cond: Condition, ons: string[], iss: string[]): void {
  if ('on' in cond) ons.push((cond as { on: string }).on);
  if ('is' in cond) iss.push((cond as { is: string }).is);
  if ('all' in cond) (cond as { all: Condition[] }).all.forEach(c => walkCondition(c, ons, iss));
  if ('any' in cond) (cond as { any: Condition[] }).any.forEach(c => walkCondition(c, ons, iss));
  if ('not' in cond) walkCondition((cond as { not: Condition }).not, ons, iss);
}

// ---------------------------------------------------------------------------
// Rule indexing
// ---------------------------------------------------------------------------

export function indexRules(rules: Rule[]): Map<string, Rule[]> {
  const index = new Map<string, Rule[]>();
  for (const rule of rules) {
    const refs = extractEventRefs(rule.when);
    for (const eventName of [...refs.on, ...refs.is]) {
      if (!index.has(eventName)) index.set(eventName, []);
      index.get(eventName)!.push(rule);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Parse a single .rules file (no include resolution)
// ---------------------------------------------------------------------------

export async function parseRulesFile(filePath: string): Promise<ParsedRulesFile> {
  const content = await readFile(filePath, 'utf-8');
  const doc = yaml.load(content) as Record<string, unknown>;

  const result: ParsedRulesFile = {
    sequences: new Map(),
    rules: [],
    templates: new Map(),
    objects: new Map(),
    macros: new Map(),
    derived: new Map(),
    selectors: new Map(),
    includes: [],
    filePath,
  };

  if (!doc || typeof doc !== 'object') return result;

  for (const [key, value] of Object.entries(doc)) {
    const kind = classifyKey(key, value);

    switch (kind) {
      case 'include':
        result.includes = (value as string[]).slice();
        break;

      case 'objects':
        for (const [typeName, pattern] of Object.entries(value as Record<string, string>)) {
          result.objects.set(typeName, pattern);
        }
        break;

      case 'macros':
        for (const [name, def] of Object.entries(value as Record<string, MacroDef>)) {
          result.macros.set(name, def);
        }
        break;

      case 'derived':
        for (const [name, def] of Object.entries(value as Record<string, DerivedStateDef>)) {
          result.derived.set(name, def);
        }
        break;

      case 'selectors':
        for (const [name, def] of Object.entries(value as Record<string, SelectorDef>)) {
          result.selectors.set(name, def);
        }
        break;

      case 'keywords':
        // Store for reference but not used directly yet
        break;

      case 'sequence':
        result.sequences.set(key, (value as unknown[]).map(parseSequenceStep));
        break;

      case 'rule':
        result.rules.push(parseRule(key, value as Record<string, unknown>));
        break;

      case 'template':
        result.templates.set(key, value as TemplateDef);
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Recursive include resolution
// ---------------------------------------------------------------------------

async function resolveIncludes(
  filePath: string,
  visited: Set<string>,
): Promise<ParsedRulesFile[]> {
  const absPath = resolve(filePath);
  if (visited.has(absPath)) {
    throw new Error(`Circular include detected: "${absPath}"`);
  }
  visited.add(absPath);

  const parsed = await parseRulesFile(absPath);
  const results: ParsedRulesFile[] = [];

  // Depth-first: load includes first
  for (const inc of parsed.includes) {
    const incPath = resolve(dirname(absPath), inc);
    const subResults = await resolveIncludes(incPath, visited);
    results.push(...subResults);
  }

  results.push(parsed);
  return results;
}

// ---------------------------------------------------------------------------
// Merge parsed files
// ---------------------------------------------------------------------------

function mergeRulesFiles(files: ParsedRulesFile[]): {
  sequences: Map<string, SequenceStep[]>;
  rules: Rule[];
  templates: Map<string, TemplateDef>;
  objects: Map<string, string>;
  macros: Map<string, MacroDef>;
  derived: Map<string, DerivedStateDef>;
  selectors: Map<string, SelectorDef>;
} {
  const sequences = new Map<string, SequenceStep[]>();
  const rules: Rule[] = [];
  const ruleIds = new Set<string>();
  const templates = new Map<string, TemplateDef>();
  const objects = new Map<string, string>();
  const macros = new Map<string, MacroDef>();
  const derived = new Map<string, DerivedStateDef>();
  const selectors = new Map<string, SelectorDef>();

  for (const file of files) {
    for (const [name, steps] of file.sequences) sequences.set(name, steps);
    for (const rule of file.rules) {
      if (ruleIds.has(rule.id)) {
        throw new Error(`Duplicate rule ID: "${rule.id}"`);
      }
      ruleIds.add(rule.id);
      rules.push(rule);
    }
    for (const [name, def] of file.templates) templates.set(name, def);
    for (const [name, pattern] of file.objects) objects.set(name, pattern);
    for (const [name, def] of file.macros) macros.set(name, def);
    for (const [name, def] of file.derived) derived.set(name, def);
    for (const [name, def] of file.selectors) selectors.set(name, def);
  }

  return { sequences, rules, templates, objects, macros, derived, selectors };
}

// ---------------------------------------------------------------------------
// Army file parsing
// ---------------------------------------------------------------------------

export async function parseArmyFile(filePath: string): Promise<ParsedArmyFile> {
  const content = await readFile(filePath, 'utf-8');
  const doc = yaml.load(content) as Record<string, unknown>;

  return {
    includes: (doc['include'] as string[] | undefined) ?? [],
    units: (doc['units'] as ArmyUnit[] | undefined) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Template expansion
// ---------------------------------------------------------------------------

function substituteParams(value: unknown, bindings: Record<string, string>): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const [param, replacement] of Object.entries(bindings)) {
      result = result.replaceAll(`{${param}}`, replacement);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map(v => substituteParams(v, bindings));
  }
  if (typeof value === 'object' && value !== null) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = substituteParams(v, bindings);
    }
    return obj;
  }
  return value;
}

function expandTemplates(
  units: ArmyUnit[],
  templates: Map<string, TemplateDef>,
  state: State,
): State {
  let current = state;
  for (const unit of units) {
    const tmpl = templates.get(unit.template);
    if (!tmpl) throw new Error(`Unknown template: "${unit.template}"`);

    const expandedPath = substituteParams(tmpl.state.path, unit.bind) as string;
    const expandedValue = substituteParams(tmpl.state.value, unit.bind);

    current = setPath(current, expandedPath, expandedValue);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function loadPack(coreRulesPath: string, armyPaths: string[]): Promise<LoadedPack> {
  // Load core rules with include resolution
  const visited = new Set<string>();
  const coreFiles = await resolveIncludes(coreRulesPath, visited);

  // Load army files and their included rules
  const armyFiles: ParsedArmyFile[] = [];
  for (const armyPath of armyPaths) {
    armyFiles.push(await parseArmyFile(armyPath));
  }

  // Load army-included rules files
  const allRulesFiles = [...coreFiles];
  for (const army of armyFiles) {
    for (const inc of army.includes) {
      const incPath = resolve(dirname(armyPaths[armyFiles.indexOf(army)]), inc);
      const absPath = resolve(incPath);
      if (!visited.has(absPath)) {
        const subFiles = await resolveIncludes(incPath, visited);
        allRulesFiles.push(...subFiles);
      }
    }
  }

  // Merge all rules files
  const merged = mergeRulesFiles(allRulesFiles);

  // Build initial state
  let initialState: State = {};

  // Set up player containers
  const playerIds = armyPaths.map((_, i) => `player${i + 1}`);
  for (const pid of playerIds) {
    initialState = setPath(initialState, `$.players.${pid}`, {});
    initialState = setPath(initialState, `$.players.${pid}.cp`, 0);
  }
  if (playerIds.length >= 2) {
    initialState = setPath(initialState, '$.attacker', playerIds[0]);
    initialState = setPath(initialState, '$.defender', playerIds[1]);
  }

  // Expand army templates
  for (const army of armyFiles) {
    initialState = expandTemplates(army.units, merged.templates, initialState);
  }

  // Index rules
  const ruleIndex = indexRules(merged.rules);

  return {
    sequences: merged.sequences,
    rules: merged.rules,
    objects: merged.objects,
    macros: merged.macros,
    derived: merged.derived,
    templates: merged.templates,
    selectors: merged.selectors,
    initialState,
    ruleIndex,
  };
}
