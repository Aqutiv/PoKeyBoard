import { describe, expect, it } from 'vitest';
import { roundEntryAt, strideFor } from '@/features/learn/rounds';

const cycle = <T>(pool: readonly T[]): T[] =>
  pool.map((_, round) => roundEntryAt(pool, round) as T);

describe('strideFor', () => {
  it('is coprime with the pool size, so every entry is reached', () => {
    for (let size = 3; size <= 24; size += 1) {
      const pool = Array.from({ length: size }, (_, i) => i);
      expect(new Set(cycle(pool)).size, `size ${size}`).toBe(size);
    }
  });

  it('keeps searching when both 3 and 2 share a factor with the size', () => {
    // A pool of 12 is the obvious next one to want, and stopping at [3, 2]
    // silently handed back a stride of 1 — the plain order.
    expect(strideFor(12)).toBeGreaterThan(1);
    expect(strideFor(6)).toBeGreaterThan(1);
    expect(strideFor(18)).toBeGreaterThan(1);
  });

  it('does not ask a pool of twelve in plain order', () => {
    const pool = Array.from({ length: 12 }, (_, i) => i);
    expect(cycle(pool)).not.toEqual(pool);
  });

  it('leaves the pools already in use alone', () => {
    // Chapter 2 quizzes seven white keys and chapter 3 five black ones; their
    // e2e assertions name exact answers, so these strides are load-bearing.
    expect(strideFor(7)).toBe(3);
    expect(strideFor(5)).toBe(3);
  });

  it('degenerates safely for pools too small to scramble', () => {
    expect(strideFor(1)).toBe(1);
    expect(strideFor(2)).toBe(1);
  });
});

describe('roundEntryAt', () => {
  it('wraps past the end of the pool', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    expect(roundEntryAt(pool, 5)).toBe(roundEntryAt(pool, 0));
  });

  it('is deterministic', () => {
    const pool = [10, 20, 30, 40, 50, 60, 70];
    expect(roundEntryAt(pool, 4)).toBe(roundEntryAt(pool, 4));
  });

  it('has nothing to return for an empty pool', () => {
    expect(roundEntryAt([], 3)).toBeUndefined();
  });
});
