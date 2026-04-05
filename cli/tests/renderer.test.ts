import { describe, it, expect } from 'vitest';
import { renderEventBanner, renderChoices, renderState, renderLog } from '../src/renderer.js';
import type { MatchedRule, State, LogEntry } from '@sscc/engine';

describe('renderEventBanner', () => {
  it('includes the event name', () => {
    const result = renderEventBanner('command-phase');
    expect(result).toContain('EVENT: command-phase');
  });

  it('includes separator lines', () => {
    const result = renderEventBanner('movement-phase');
    expect(result).toContain('='.repeat(50));
  });
});

describe('renderChoices', () => {
  const options: MatchedRule[] = [
    {
      rule: { id: 'r1', label: 'Fire Overwatch', when: { is: 'test' }, effect: [], costs: { cp: 1 } },
      mandatory: false,
    },
    {
      rule: { id: 'r2', label: 'Advance', when: { is: 'test' }, effect: [] },
      mandatory: true,
    },
  ];

  it('numbers each option starting at 1', () => {
    const result = renderChoices(options, false);
    expect(result).toContain('[1]');
    expect(result).toContain('[2]');
  });

  it('shows MUST tag for mandatory rules', () => {
    const result = renderChoices(options, false);
    expect(result).toContain('Advance (MUST)');
  });

  it('shows OPT tag for optional rules', () => {
    const result = renderChoices(options, false);
    expect(result).toContain('Fire Overwatch (OPT)');
  });

  it('shows costs when present', () => {
    const result = renderChoices(options, false);
    expect(result).toContain('[1 CP]');
  });

  it('shows pass option when canPass is true', () => {
    const result = renderChoices(options, true);
    expect(result).toContain('[P] Pass');
  });

  it('omits pass option when canPass is false', () => {
    const result = renderChoices(options, false);
    expect(result).not.toContain('[P] Pass');
  });

  it('always shows Edit State and Undo options', () => {
    const result = renderChoices(options, false);
    expect(result).toContain('[E] Edit State');
    expect(result).toContain('[U] Undo');
  });

  it('falls back to rule id when label is missing', () => {
    const noLabel: MatchedRule[] = [
      { rule: { id: 'rule-no-label', when: { is: 'x' }, effect: [] }, mandatory: false },
    ];
    const result = renderChoices(noLabel, false);
    expect(result).toContain('rule-no-label');
  });
});

describe('renderState', () => {
  it('shows turn player when present', () => {
    const state: State = { turnPlayer: 'player1' };
    const result = renderState(state);
    expect(result).toContain('Turn Player: player1');
  });

  it('shows player CP values', () => {
    const state: State = {
      players: {
        player1: { cp: 3 },
        player2: { cp: 1 },
      },
    };
    const result = renderState(state);
    expect(result).toContain('player1 CP: 3');
    expect(result).toContain('player2 CP: 1');
  });

  it('shows unit names and statuses', () => {
    const state: State = {
      players: {
        player1: {
          cp: 0,
          units: {
            squad1: { name: 'Intercessors', battleshocked: true },
          },
        },
      },
    };
    const result = renderState(state);
    expect(result).toContain('player1/squad1: Intercessors [BATTLESHOCKED]');
  });

  it('shows active flags', () => {
    const state: State = {
      flags: { 'command-phase': true, 'shooting-phase': false },
    };
    const result = renderState(state);
    expect(result).toContain('Active flags: command-phase');
    expect(result).not.toContain('shooting-phase');
  });

  it('handles empty state gracefully', () => {
    const result = renderState({});
    expect(result).toContain('State Summary');
  });
});

describe('renderLog', () => {
  it('shows recent entries', () => {
    const log: LogEntry[] = [
      { type: 'rule', ruleId: 'r1', message: 'applied', timestamp: 1 },
      { type: 'event', message: 'phase started', timestamp: 2 },
    ];
    const result = renderLog(log);
    expect(result).toContain('[rule] r1: applied');
    expect(result).toContain('[event] phase started');
  });

  it('limits to requested count', () => {
    const log: LogEntry[] = Array.from({ length: 20 }, (_, i) => ({
      type: 'rule',
      ruleId: `r${i}`,
      message: `msg${i}`,
      timestamp: i,
    }));
    const result = renderLog(log, 3);
    expect(result).toContain('r17');
    expect(result).toContain('r18');
    expect(result).toContain('r19');
    expect(result).not.toContain('r16');
  });

  it('returns placeholder for empty log', () => {
    const result = renderLog([]);
    expect(result).toContain('no log entries');
  });
});
