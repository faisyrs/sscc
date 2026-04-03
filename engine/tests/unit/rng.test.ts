import { describe, it, expect } from "vitest";
import { SeededRNG } from "../../src/rng/index.js";

describe("SeededRNG", () => {
  it("produces deterministic sequence for same seed", () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const seq1 = [rng1.nextInt(1, 6), rng1.nextInt(1, 6), rng1.nextInt(1, 6)];
    const seq2 = [rng2.nextInt(1, 6), rng2.nextInt(1, 6), rng2.nextInt(1, 6)];
    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(99);
    const seq1 = [rng1.nextInt(1, 6), rng1.nextInt(1, 6), rng1.nextInt(1, 6)];
    const seq2 = [rng2.nextInt(1, 6), rng2.nextInt(1, 6), rng2.nextInt(1, 6)];
    expect(seq1).not.toEqual(seq2);
  });

  it("nextInt returns values within inclusive range", () => {
    const rng = new SeededRNG(123);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(1, 6);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(6);
    }
  });

  it("nextInt returns values within range for non-d6", () => {
    const rng = new SeededRNG(456);
    for (let i = 0; i < 100; i++) {
      const val = rng.nextInt(1, 20);
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(20);
    }
  });

  it("reseed resets the sequence", () => {
    const rng = new SeededRNG(42);
    const first = [rng.nextInt(1, 6), rng.nextInt(1, 6)];
    rng.reseed(42);
    const second = [rng.nextInt(1, 6), rng.nextInt(1, 6)];
    expect(first).toEqual(second);
  });

  it("getSeed returns current seed", () => {
    const rng = new SeededRNG(42);
    expect(rng.getSeed()).toBe(42);
    rng.reseed(99);
    expect(rng.getSeed()).toBe(99);
  });

  it("seed 668 produces [2, 6, 4, 1] for 4d6", () => {
    const rng = new SeededRNG(668);
    const results = [
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
      rng.nextInt(1, 6),
    ];
    expect(results).toEqual([2, 6, 4, 1]);
  });
});
