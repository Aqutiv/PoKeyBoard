import { describe, expect, it } from 'vitest';
import { barsPerSystemFor } from '@/features/learn/staffSystems';

describe('barsPerSystemFor', () => {
  it('keeps a phrase of two bars or fewer on one system at any width', () => {
    // Every chapter before the first melody writes two bars at most, and they
    // must draw exactly as they did before systems existed.
    expect(barsPerSystemFor(1, 4, 200)).toBe(1);
    expect(barsPerSystemFor(2, 4, 200)).toBe(2);
  });

  it('puts a four-bar phrase on one system when the card is wide enough', () => {
    expect(barsPerSystemFor(4, 4, 2000)).toBe(4);
  });

  it('sets at most four bars to a line, however wide the card', () => {
    // A two-phrase tune reads as question above answer, not as one stream.
    expect(barsPerSystemFor(8, 4, 2000)).toBe(4);
  });

  it('breaks a long line at a phone width, into equal systems', () => {
    // About 288px of card at 320px: two bars of quarters to a line.
    const bars = barsPerSystemFor(8, 4, 288);
    expect(bars).toBeLessThan(8);
    expect(8 % bars).toBe(0);
  });

  it('never splits a line into uneven systems', () => {
    // Room for three bars of an eight-bar line still breaks 2+2+2+2, so no
    // phrase ends partway along a system.
    for (let width = 200; width <= 1200; width += 25) {
      const bars = barsPerSystemFor(8, 4, width);
      expect(8 % bars, `${width}px`).toBe(0);
    }
  });
});
