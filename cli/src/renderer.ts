import type { State, GameEvent, ChoiceInstance } from "../../engine/src/types/index.js";
import { get } from "../../engine/src/state/index.js";

const PHASE_NAMES: Record<string, string> = {
  CommandPhaseStart: "Command Phase",
  MovementPhaseStart: "Movement Phase",
  ShootingPhaseStart: "Shooting Phase",
  ChargePhaseStart: "Charge Phase",
  FightPhaseStart: "Fight Phase",
  BattleRoundStart: "Battle Round Start",
  BattleRoundEnd: "Battle Round End",
};

export function renderHeader(state: State, event: GameEvent): string {
  const round = get(state, "$.battleRound");
  const roundStr = typeof round === "number" ? `Battle Round ${round}` : "";
  const phase = PHASE_NAMES[event.id] ?? event.id;
  const player = typeof event.params.player === "string" ? event.params.player : "";
  const parts = [roundStr, phase, player].filter(Boolean);
  return `=== ${parts.join(" | ")} ===`;
}

export function renderUnits(state: State): string {
  const units = get(state, "$.units") as Record<string, Record<string, unknown>> | undefined;
  if (!units || typeof units !== "object") return "";

  const byOwner = new Map<string, Array<{ id: string; keywords: string[]; statuses: string[] }>>();
  for (const [id, unit] of Object.entries(units)) {
    const owner = (unit.owner as string) ?? "unknown";
    const keywords = Array.isArray(unit.keywords) ? (unit.keywords as string[]) : [];
    const statuses = unit.statuses && typeof unit.statuses === "object"
      ? Object.keys(unit.statuses as Record<string, unknown>)
      : [];
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push({ id, keywords, statuses });
  }

  const lines: string[] = [];
  for (const [owner, unitList] of byOwner) {
    lines.push(`-- Units (${owner}) --`);
    for (const u of unitList) {
      const kw = u.keywords.length > 0 ? ` [${u.keywords.join(", ")}]` : "";
      const st = u.statuses.length > 0 ? ` Statuses: ${u.statuses.join(", ")}` : " Statuses: -";
      lines.push(`  ${u.id}${kw}${st}`);
    }
  }
  return lines.join("\n");
}

export function renderDicePool(state: State): string {
  const pools = findDicePools(state as Record<string, unknown>, "$");
  if (pools.length === 0) return "";

  const lines: string[] = [];
  for (const { path, count, dice } of pools) {
    lines.push(`-- Dice Pool: ${path} --`);
    const diceStrs = dice.map((d) => {
      const spent = d.spent ? "*" : "";
      return `[${d.index}] ${d.value}${spent}`;
    });
    lines.push(`  ${diceStrs.join("   ")}`);
    const spentCount = dice.filter((d) => d.spent).length;
    lines.push(`  (${count} dice, ${spentCount} spent${spentCount > 0 ? ", * = spent" : ""})`);
  }
  return lines.join("\n");
}

interface FoundPool {
  path: string;
  count: number;
  dice: Array<{ index: number; value: number; spent: boolean }>;
}

function findDicePools(obj: Record<string, unknown>, prefix: string): FoundPool[] {
  const pools: FoundPool[] = [];
  if (typeof obj.count === "number" && obj.d0 !== undefined && typeof obj.d0 === "object") {
    const count = obj.count as number;
    const dice: FoundPool["dice"] = [];
    for (let i = 0; i < count; i++) {
      const d = obj[`d${i}`] as Record<string, unknown> | undefined;
      if (d && typeof d === "object") {
        dice.push({ index: i, value: d.value as number, spent: (d.spent as boolean) ?? false });
      }
    }
    pools.push({ path: prefix, count, dice });
    return pools;
  }
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("_")) continue;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      pools.push(...findDicePools(val as Record<string, unknown>, `${prefix}.${key}`));
    }
  }
  return pools;
}

export function renderChoices(choices: ChoiceInstance[]): string {
  if (choices.length === 0) return "";
  const lines: string[] = ["-- Choices --", "  0. Pass"];
  for (let i = 0; i < choices.length; i++) {
    const c = choices[i];
    const pickNote = c.pick ? `  [pick ${c.pick} dice]` : "";
    lines.push(`  ${i + 1}. ${c.label}${pickNote}`);
  }
  return lines.join("\n");
}

export function renderEventLine(event: GameEvent, notes?: string[]): string {
  let line = `  > ${event.id}`;
  const params = Object.entries(event.params)
    .filter(([_, v]) => v !== undefined)
    .map(([_, v]) => `${v}`)
    .join(", ");
  if (params) line += ` (${params})`;
  if (notes && notes.length > 0) {
    line += ` -- ${notes.join("; ")}`;
  }
  return line;
}

export function renderFullDisplay(
  state: State,
  lastEvent: GameEvent,
  choices: ChoiceInstance[],
): string {
  const sections: string[] = [];
  sections.push(renderHeader(state, lastEvent));
  sections.push("");
  const units = renderUnits(state);
  if (units) { sections.push(units); sections.push(""); }
  const pool = renderDicePool(state);
  if (pool) { sections.push(pool); sections.push(""); }
  const choiceDisplay = renderChoices(choices);
  if (choiceDisplay) { sections.push(choiceDisplay); sections.push(""); }
  return sections.join("\n");
}
