import { describe, it, expect } from 'vitest';
import { SeededRNG } from '../src/rng.js';

describe('SeededRNG', () => {
  it('produces the same sequence for the same seed', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const seq1 = Array.from({ length: 10 }, () => rng1.random());
    const seq2 = Array.from({ length: 10 }, () => rng2.random());
    expect(seq1).toEqual(seq2);
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(99);
    const seq1 = Array.from({ length: 10 }, () => rng1.random());
    const seq2 = Array.from({ length: 10 }, () => rng2.random());
    expect(seq1).not.toEqual(seq2);
  });

  it('randomInt returns values in [min, max] inclusive', () => {
    const rng = new SeededRNG(42);
    for (let i = 0; i < 100; i++) {
      const val = rng.randomInt(0, 5);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(5);
    }
  });

  it('pick returns one of the elements', () => {
    const rng = new SeededRNG(42);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it('shuffle produces a deterministic permutation', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    expect(rng1.shuffle([1, 2, 3, 4])).toEqual(rng2.shuffle([1, 2, 3, 4]));
  });

  it('state round-trip: fromState continues the sequence', () => {
    const rng = new SeededRNG(42);
    // Advance a few steps
    rng.random();
    rng.random();
    rng.random();
    const state = rng.getState();
    const next5 = Array.from({ length: 5 }, () => rng.random());

    const restored = SeededRNG.fromState(state);
    const restored5 = Array.from({ length: 5 }, () => restored.random());
    expect(restored5).toEqual(next5);
  });

  it('throws on invalid seed', () => {
    expect(() => new SeededRNG(NaN)).toThrow('Invalid RNG seed');
  });

  it('throws on corrupted state string', () => {
    expect(() => SeededRNG.fromState('not_a_number')).toThrow('Corrupted RNG state');
  });
});
