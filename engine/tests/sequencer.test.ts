import { describe, it, expect } from 'vitest';
import { Sequencer } from '../src/sequencer.js';
import type { SequenceMap, SequenceStep } from '../src/types.js';

/** Helper: build a SequenceMap from a plain object. */
function seqMap(obj: Record<string, SequenceStep[]>): SequenceMap {
  return new Map(Object.entries(obj));
}

/** Helper: drain all events from a sequencer into an array. */
function drainEvents(seq: Sequencer): string[] {
  const events: string[] = [];
  let ev: string | null;
  while ((ev = seq.nextEvent()) !== null) {
    events.push(ev);
  }
  return events;
}

describe('Sequencer', () => {
  it('single event sequence', () => {
    const sequences = seqMap({ a: ['event'] });
    const seq = new Sequencer(sequences, 'a');
    expect(seq.nextEvent()).toBe('a');
    expect(seq.nextEvent()).toBeNull();
  });

  it('two events via parent sequence', () => {
    const sequences = seqMap({
      a: ['event'],
      b: ['event'],
      game: ['a', 'b'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['a', 'b']);
  });

  it('nested reference', () => {
    const sequences = seqMap({
      game: ['phase'],
      phase: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['phase']);
  });

  it('explicit reference with { sequence: name }', () => {
    const sequences = seqMap({
      game: [{ sequence: 'phase' }],
      phase: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['phase']);
  });

  it('repeat step', () => {
    const sequences = seqMap({
      game: [{ round: { repeat: 3 } }],
      round: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['round', 'round', 'round']);
  });

  it('deep nesting: game → battleRound → turn → phase', () => {
    const sequences = seqMap({
      game: ['battleRound'],
      battleRound: ['turn'],
      turn: ['phase'],
      phase: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['phase']);
  });

  it('enterSubSequence interrupts current sequence', () => {
    const sequences = seqMap({
      game: ['a', 'b'],
      a: ['event'],
      b: ['event'],
      sub: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    // First event from 'a'
    expect(seq.nextEvent()).toBe('a');
    // Now inject a sub-sequence
    seq.enterSubSequence('sub');
    // Next event should come from the sub-sequence
    expect(seq.nextEvent()).toBe('sub');
    // Then continue with 'b'
    expect(seq.nextEvent()).toBe('b');
    expect(seq.nextEvent()).toBeNull();
  });

  it('throws on unknown sequence reference', () => {
    const sequences = seqMap({
      game: ['nonexistent'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(() => seq.nextEvent()).toThrow('Unknown sequence: "nonexistent"');
  });

  it('throws on unknown entry point', () => {
    const sequences = seqMap({});
    expect(() => new Sequencer(sequences, 'missing')).toThrow('Unknown sequence: "missing"');
  });

  it('multiple events in one sequence', () => {
    const sequences = seqMap({
      phase: ['event', 'endOfPhase'],
      endOfPhase: ['event'],
    });
    const seq = new Sequencer(sequences, 'phase');
    expect(drainEvents(seq)).toEqual(['phase', 'endOfPhase']);
  });

  it('complex timeline: 5 battle rounds × 2 turns × 3 phases', () => {
    const sequences = seqMap({
      game: [{ battleRound: { repeat: 5 } }],
      battleRound: [{ turn: { repeat: 2 } }],
      turn: ['commandPhase', 'movementPhase', 'shootingPhase'],
      commandPhase: ['event'],
      movementPhase: ['event'],
      shootingPhase: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    const events = drainEvents(seq);
    // 5 rounds × 2 turns × 3 phases = 30 events
    expect(events).toHaveLength(30);
    // First three should be the phases of round 1, turn 1
    expect(events.slice(0, 3)).toEqual(['commandPhase', 'movementPhase', 'shootingPhase']);
    // Every group of 3 should be the same phase pattern
    for (let i = 0; i < 30; i += 3) {
      expect(events.slice(i, i + 3)).toEqual(['commandPhase', 'movementPhase', 'shootingPhase']);
    }
  });

  it('repeat with count 1 executes once', () => {
    const sequences = seqMap({
      game: [{ round: { repeat: 1 } }],
      round: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['round']);
  });

  it('mixed steps: events, references, and repeats', () => {
    const sequences = seqMap({
      game: ['setup', { main: { repeat: 2 } }, 'cleanup'],
      setup: ['event'],
      main: ['event'],
      cleanup: ['event'],
    });
    const seq = new Sequencer(sequences, 'game');
    expect(drainEvents(seq)).toEqual(['setup', 'main', 'main', 'cleanup']);
  });
});
