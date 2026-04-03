/**
 * Mulberry32 — a fast 32-bit PRNG with good statistical properties.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded PRNG for deterministic dice rolls.
 */
export class SeededRNG {
  private rng: () => number;
  private currentSeed: number;

  constructor(seed: number) {
    this.currentSeed = seed;
    this.rng = mulberry32(seed);
  }

  /** Generate a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  /** Reset the RNG with a new seed. */
  reseed(seed: number): void {
    this.currentSeed = seed;
    this.rng = mulberry32(seed);
  }

  /** Return the current seed value. */
  getSeed(): number {
    return this.currentSeed;
  }
}
