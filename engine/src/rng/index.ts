/**
 * Snapshot of RNG state for save/restore.
 */
export interface RNGSnapshot {
  seed: number;
  internalState: number;
}

/**
 * Seeded PRNG for deterministic dice rolls.
 * Uses Mulberry32 — a fast 32-bit PRNG with good statistical properties.
 */
export class SeededRNG {
  private s: number;
  private currentSeed: number;

  constructor(seed: number) {
    this.currentSeed = seed;
    this.s = seed | 0;
  }

  /** Generate a random integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return min + Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * (max - min + 1));
  }

  /** Reset the RNG with a new seed. */
  reseed(seed: number): void {
    this.currentSeed = seed;
    this.s = seed | 0;
  }

  /** Return the current seed value. */
  getSeed(): number {
    return this.currentSeed;
  }

  /** Capture the full RNG state for snapshot. */
  captureState(): RNGSnapshot {
    return { seed: this.currentSeed, internalState: this.s };
  }

  /** Restore RNG to a previously captured state. */
  restoreState(snapshot: RNGSnapshot): void {
    this.currentSeed = snapshot.seed;
    this.s = snapshot.internalState;
  }
}
