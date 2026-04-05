import type { Rule, MatchedRule, State, LogEntry } from '@sscc/engine';

export function renderEventBanner(event: string): string {
  return `\n${'='.repeat(50)}\n  EVENT: ${event}\n${'='.repeat(50)}`;
}

export function renderChoices(options: MatchedRule[], canPass: boolean): string {
  const lines: string[] = ['\n--- Choose an action ---'];
  options.forEach((opt, i) => {
    const tag = opt.mandatory ? 'MUST' : 'OPT';
    const costStr = opt.rule.costs
      ? ` [${Object.entries(opt.rule.costs).map(([k, v]) => `${v} ${k.toUpperCase()}`).join(', ')}]`
      : '';
    lines.push(`  [${i + 1}] ${opt.rule.label || opt.rule.id} (${tag})${costStr}`);
  });
  if (canPass) lines.push('  [P] Pass');
  lines.push('  [E] Edit State');
  lines.push('  [U] Undo');
  return lines.join('\n');
}

export function renderState(state: State): string {
  const lines: string[] = ['\n--- State Summary ---'];

  // Show turn player info
  const turnPlayer = (state as Record<string, unknown>).turnPlayer;
  const opponent = (state as Record<string, unknown>).opponent;
  if (turnPlayer) lines.push(`  Turn Player: ${turnPlayer}`);
  if (opponent) lines.push(`  Opponent: ${opponent}`);

  // Show player CPs
  const players = (state as Record<string, unknown>).players;
  if (players && typeof players === 'object') {
    for (const [pid, pdata] of Object.entries(players as Record<string, unknown>)) {
      const pd = pdata as Record<string, unknown>;
      if (pd.cp !== undefined) {
        lines.push(`  ${pid} CP: ${pd.cp}`);
      }
    }
  }

  // Show units
  if (players && typeof players === 'object') {
    for (const [pid, pdata] of Object.entries(players as Record<string, unknown>)) {
      const pd = pdata as Record<string, unknown>;
      if (pd.units && typeof pd.units === 'object') {
        for (const [uid, udata] of Object.entries(pd.units as Record<string, unknown>)) {
          const u = udata as Record<string, unknown>;
          const name = u.name || uid;
          const statuses: string[] = [];
          if (u.battleshocked) statuses.push('BATTLESHOCKED');
          if (u['not-battleshocked']) statuses.push('OK');
          if (u.movementType) statuses.push(`moved:${u.movementType}`);
          if (u.hasShotThisPhase) statuses.push('shot');
          if (u.charged) statuses.push('charged');
          if (u.hasFoughtThisPhase) statuses.push('fought');
          const statusStr = statuses.length ? ` [${statuses.join(', ')}]` : '';
          lines.push(`  ${pid}/${uid}: ${name}${statusStr}`);
        }
      }
    }
  }

  // Show active flags
  const flags = (state as Record<string, unknown>).flags;
  if (flags && typeof flags === 'object') {
    const flagNames = Object.keys(flags as Record<string, unknown>).filter(
      k => (flags as Record<string, unknown>)[k],
    );
    if (flagNames.length > 0) {
      lines.push(`  Active flags: ${flagNames.join(', ')}`);
    }
  }

  return lines.join('\n');
}

export function renderLog(log: LogEntry[], count: number = 10): string {
  const recent = log.slice(-count);
  if (recent.length === 0) return '  (no log entries)';
  return recent
    .map(e => {
      if (e.ruleId) return `  [${e.type}] ${e.ruleId}: ${e.message || ''}`;
      return `  [${e.type}] ${e.message || ''}`;
    })
    .join('\n');
}
