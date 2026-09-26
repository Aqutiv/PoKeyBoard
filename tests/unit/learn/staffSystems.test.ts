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

  it('leaves fewer bars to a line under a key signature, which every system repeats', () => {
    // Seven sharps widen the prefix by over sixty pixels; somewhere a width
    // that held four bars in C holds only two under them.
    const narrowed = [...Array(40).keys()]
      .map((i) => 360 + i * 10)
      .some((width) => barsPerSystemFor(8, 4, width, 7) < barsPerSystemFor(8, 4, width));
    expect(narrowed).toBe(true);
    for (let width = 200; width <= 1200; width += 25) {
      expect(barsPerSystemFor(8, 4, width, 7), `${width}px`).toBeLessThanOrEqual(
        barsPerSystemFor(8, 4, width),
      );
    }
    // Omitted is C major, exactly as before.
    expect(barsPerSystemFor(8, 4, 500, 0)).toBe(barsPerSystemFor(8, 4, 500));
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
