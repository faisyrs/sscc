// Seeded PRNG using Mulberry32 algorithm
export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns integer in [1, sides] */
  rollDie(sides: number): number {
    return Math.floor(this.next() * sides) + 1;
  }

  getState(): number {
    return this.state;
  }

  setState(s: number): void {
    this.state = s;
  }
}
