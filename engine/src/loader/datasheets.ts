import type { State } from "../types/index.js";
import type { ValidationError } from "../types/index.js";

export interface Datasheet {
  name: string;
  keywords: string[];
  stats: Record<string, number>;
  profiles?: Record<string, Record<string, unknown>>;
}

export function parseDatasheets(data: unknown): Map<string, Datasheet> {
  if (data === null || data === undefined) return new Map();
  const raw = data as Record<string, unknown>;
  const sheets = raw.datasheets as Record<string, unknown> | undefined;
  if (!sheets) return new Map();

  const result = new Map<string, Datasheet>();
  for (const [id, def] of Object.entries(sheets)) {
    result.set(id, def as Datasheet);
  }
  return result;
}

export function mergeDatasheets(
  state: State,
  datasheets: Map<string, Datasheet>,
): { state: State; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const units = (state as Record<string, unknown>).units as Record<string, Record<string, unknown>> | undefined;
  if (!units) return { state, errors };

  const newUnits: Record<string, unknown> = {};
  for (const [unitId, unit] of Object.entries(units)) {
    const dsId = unit.datasheet as string | undefined;
    if (!dsId) {
      newUnits[unitId] = unit;
      continue;
    }

    const ds = datasheets.get(dsId);
    if (!ds) {
      errors.push({
        code: "DATASHEET_NOT_FOUND",
        message: `Unit "${unitId}" references datasheet "${dsId}" which does not exist`,
      });
      newUnits[unitId] = unit;
      continue;
    }

    const { datasheet: _, ...unitWithoutDs } = unit;
    const merged = {
      name: ds.name,
      keywords: [...ds.keywords],
      stats: { ...ds.stats },
      ...(ds.profiles ? { profiles: { ...ds.profiles } } : {}),
      ...unitWithoutDs,
    };
    newUnits[unitId] = merged;
  }

  return {
    state: { ...state, units: newUnits } as State,
    errors,
  };
}
