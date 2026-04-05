import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/rng.js';

describe('SeededRNG', () => {
  it('same seed produces same sequence', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(42);
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new SeededRNG(42);
    const b = new SeededRNG(99);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    // Extremely unlikely for all 10 to match
    expect(seqA).not.toEqual(seqB);
  });

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 1000; i++) {
      const val = rng.next();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('rollDie returns values in [1, sides]', () => {
    const rng = new SeededRNG(456);
    for (let sides = 1; sides <= 20; sides++) {
      for (let i = 0; i < 100; i++) {
        const roll = rng.rollDie(sides);
        expect(roll).toBeGreaterThanOrEqual(1);
        expect(roll).toBeLessThanOrEqual(sides);
        expect(Number.isInteger(roll)).toBe(true);
      }
    }
  });

  it('rollDie(6) produces all values 1-6 over many rolls', () => {
    const rng = new SeededRNG(789);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(rng.rollDie(6));
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('getState/setState enables save and restore', () => {
    const rng = new SeededRNG(42);
    // Advance a few steps
    rng.next();
    rng.next();
    const saved = rng.getState();

    // Generate some values
    const values1 = Array.from({ length: 5 }, () => rng.next());

    // Restore and regenerate
    rng.setState(saved);
    const values2 = Array.from({ length: 5 }, () => rng.next());

    expect(values1).toEqual(values2);
  });

  it('rollDie(1) always returns 1', () => {
    const rng = new SeededRNG(999);
    for (let i = 0; i < 100; i++) {
      expect(rng.rollDie(1)).toBe(1);
    }
  });
});
