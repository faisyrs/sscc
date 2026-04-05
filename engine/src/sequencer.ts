import type { SequenceMap, SequenceStep } from './types.js';

interface StackFrame {
  sequenceName: string;
  steps: SequenceStep[];
  index: number;
  repeatCount?: number;
}

export class Sequencer {
  private sequences: SequenceMap;
  private stack: StackFrame[];

  constructor(sequences: SequenceMap, entryPoint: string) {
    this.sequences = sequences;
    this.stack = [];
    this.pushSequence(entryPoint);
  }

  /** Get the next event name, or null if the sequence is exhausted. */
  nextEvent(): string | null {
    while (this.stack.length > 0) {
      const frame = this.stack[this.stack.length - 1];

      if (frame.index >= frame.steps.length) {
        // Frame exhausted
        if (frame.repeatCount !== undefined && frame.repeatCount > 1) {
          frame.repeatCount--;
          frame.index = 0;
          continue;
        }
        this.stack.pop();
        continue;
      }

      const step = frame.steps[frame.index];
      frame.index++;

      // Leaf: the literal string "event" — return parent sequence name
      if (step === 'event') {
        return frame.sequenceName;
      }

      // String reference to another sequence
      if (typeof step === 'string') {
        this.pushSequence(step);
        continue;
      }

      // Object step
      if (typeof step === 'object' && step !== null) {
        // Explicit reference: { sequence: "name" }
        if ('sequence' in step) {
          this.pushSequence((step as { sequence: string }).sequence);
          continue;
        }

        // Repeat: { someName: { repeat: N } }
        const keys = Object.keys(step);
        if (keys.length === 1) {
          const seqName = keys[0];
          const val = (step as Record<string, { repeat: number }>)[seqName];
          if (val && typeof val === 'object' && 'repeat' in val) {
            this.pushSequenceWithRepeat(seqName, val.repeat);
            continue;
          }
        }
      }

      throw new Error(`Unknown sequence step: ${JSON.stringify(step)}`);
    }

    return null;
  }

  /** Called by the engine when a rule effect enters a sub-sequence. */
  enterSubSequence(name: string): void {
    this.pushSequence(name);
  }

  /** Get the steps for a named sequence (for inline sub-sequence processing). */
  getSequenceSteps(name: string): SequenceStep[] | undefined {
    return this.sequences.get(name);
  }

  /** Get the underlying sequences map. */
  getSequences(): SequenceMap {
    return this.sequences;
  }

  private pushSequence(name: string): void {
    const steps = this.sequences.get(name);
    if (!steps) throw new Error(`Unknown sequence: "${name}"`);
    this.stack.push({ sequenceName: name, steps, index: 0 });
  }

  private pushSequenceWithRepeat(name: string, count: number): void {
    const steps = this.sequences.get(name);
    if (!steps) throw new Error(`Unknown sequence: "${name}"`);
    this.stack.push({ sequenceName: name, steps, index: 0, repeatCount: count });
  }
}
