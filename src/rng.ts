// Seeded PRNG using mulberry32 algorithm
// Deterministic, serializable, no Math.random() usage

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    if (seed === undefined || seed === null || Number.isNaN(seed)) {
      throw new Error(`Invalid RNG seed: ${seed}. Must be a valid number.`);
    }
    this.state = seed | 0;
  }

  static fromState(stateString: string): SeededRNG {
    if (!stateString || typeof stateString !== 'string') {
      throw new Error(`Invalid RNG state string: ${stateString}`);
    }
    const parsed = parseInt(stateString, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Corrupted RNG state string: "${stateString}" is not a valid integer`);
    }
    const rng = new SeededRNG(0);
    rng.state = parsed;
    return rng;
  }

  getState(): string {
    return this.state.toString();
  }

  random(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  randomInt(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return arr[this.randomInt(0, arr.length - 1)];
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  fork(): SeededRNG {
    const childSeed = (this.random() * 4294967296) | 0;
    return new SeededRNG(childSeed);
  }
}
