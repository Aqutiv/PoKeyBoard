import { describe, expect, it } from 'vitest';
import {
  BLACK_KEY_HEIGHT,
  computeVisibleWhites,
  FULL_RANGE_HIGH,
  FULL_RANGE_LOW,
  hitTestKey,
  layoutKeyboard,
  MAX_VISIBLE_WHITES,
  maxLowMidiFor,
  MIN_VISIBLE_WHITES,
  snapToWhite,
  stepWhites,
  touchVelocity,
  whiteKeyCount,
} from '@/features/keyboard/keyboardGeometry';

describe('layoutKeyboard', () => {
  it('lays out C3-B5 with 21 white and 15 black keys', () => {
    const layout = layoutKeyboard(48, 83);
    expect(layout.whiteCount).toBe(21);
    expect(layout.keys.filter((k) => !k.isBlack)).toHaveLength(21);
    expect(layout.keys.filter((k) => k.isBlack)).toHaveLength(15);
  });

  it('snaps range ends to white keys', () => {
    const layout = layoutKeyboard(49, 82); // C#3 .. A#5
    expect(layout.lowMidi).toBe(50); // D3
    expect(layout.highMidi).toBe(81); // A5
  });

  it('places black keys between their neighbors', () => {
    const layout = layoutKeyboard(60, 72);
    const cSharp = layout.keys.find((k) => k.midi === 61);
    expect(cSharp).toBeDefined();
    expect(cSharp!.isBlack).toBe(true);
    // C#4 must overlap the boundary between white index 0 (C4) and 1 (D4).
    expect(cSharp!.x).toBeGreaterThan(0.4);
    expect(cSharp!.x + cSharp!.width).toBeLessThan(1.6);
  });
});

describe('hitTestKey', () => {
  const layout = layoutKeyboard(60, 72); // C4..C5

  it('hits white keys below the black-key region', () => {
    expect(hitTestKey(layout, 0.5, 0.9)).toBe(60); // C4
    expect(hitTestKey(layout, 1.5, 0.9)).toBe(62); // D4
    expect(hitTestKey(layout, 7.5, 0.9)).toBe(72); // C5
  });

  it('gives black keys precedence in the upper region', () => {
    const cSharp = layout.keys.find((k) => k.midi === 61)!;
    const centerX = cSharp.x + cSharp.width / 2;
    expect(hitTestKey(layout, centerX, BLACK_KEY_HEIGHT / 2)).toBe(61);
    // The same x below the black key belongs to a white key.
    const below = hitTestKey(layout, centerX, 0.95);
    expect([60, 62]).toContain(below);
  });

  it('returns null outside the keyboard', () => {
    expect(hitTestKey(layout, -0.1, 0.5)).toBeNull();
    expect(hitTestKey(layout, 99, 0.5)).toBeNull();
    expect(hitTestKey(layout, 1, 1.2)).toBeNull();
  });
});

describe('computeVisibleWhites', () => {
  it('falls back while the container is unmeasured', () => {
    expect(computeVisibleWhites(0)).toBe(14);
    expect(computeVisibleWhites(-5)).toBe(14);
  });

  it('clamps to the one-octave minimum on tiny containers', () => {
    expect(computeVisibleWhites(100)).toBe(7);
    expect(computeVisibleWhites(266)).toBe(7);
  });

  it('matches the legacy stretch behavior on narrow containers', () => {
    expect(computeVisibleWhites(375)).toBe(9);
    expect(computeVisibleWhites(800)).toBe(21);
    expect(computeVisibleWhites(1180)).toBe(21); // e2e viewport 1280 minus nav and padding
    expect(computeVisibleWhites(1512)).toBe(21);
  });

  it('adds keys instead of stretching on wide containers', () => {
    expect(computeVisibleWhites(1513)).toBe(22);
    expect(computeVisibleWhites(1820)).toBe(26); // 1920 viewport
    expect(computeVisibleWhites(2460)).toBe(35); // 2560 viewport
    expect(computeVisibleWhites(3672)).toBe(51);
    expect(computeVisibleWhites(3673)).toBe(52);
  });

  it('caps at the full piano', () => {
    expect(computeVisibleWhites(3740)).toBe(52); // 4K viewport minus nav and padding
    expect(computeVisibleWhites(5000)).toBe(52);
  });

  it('is monotonic and always within bounds', () => {
    let previous = computeVisibleWhites(1);
    for (let width = 2; width <= 5200; width += 1) {
      const count = computeVisibleWhites(width);
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeGreaterThanOrEqual(MIN_VISIBLE_WHITES);
      expect(count).toBeLessThanOrEqual(MAX_VISIBLE_WHITES);
      previous = count;
    }
  });
});

describe('stepWhites', () => {
  it('walks white keys upward inclusively', () => {
    expect(stepWhites(48, 1, 1)).toBe(48); // C3 alone
    expect(stepWhites(48, 21, 1)).toBe(83); // C3 + 21 whites = B5
  });

  it('clamps at the top of the range', () => {
    expect(stepWhites(96, 21, 1)).toBe(108);
    expect(stepWhites(21, 99, 1)).toBe(108);
  });

  it('walks white keys downward inclusively', () => {
    expect(stepWhites(108, 7, -1)).toBe(98); // D7
    expect(stepWhites(108, 21, -1)).toBe(74); // D5
    expect(stepWhites(108, 52, -1)).toBe(21); // A0, the full piano
  });

  it('clamps at the bottom of the range', () => {
    expect(stepWhites(108, 99, -1)).toBe(21);
  });
});

describe('maxLowMidiFor', () => {
  it('leaves exactly the requested whites below C8', () => {
    for (let count = MIN_VISIBLE_WHITES; count <= MAX_VISIBLE_WHITES; count += 1) {
      expect(whiteKeyCount(maxLowMidiFor(count), FULL_RANGE_HIGH)).toBe(count);
    }
  });

  it('never lets any anchor/width combination shrink the layout', () => {
    for (let count = MIN_VISIBLE_WHITES; count <= MAX_VISIBLE_WHITES; count += 1) {
      for (let anchor = FULL_RANGE_LOW; anchor <= FULL_RANGE_HIGH; anchor += 1) {
        const snapped = snapToWhite(anchor, 1);
        const low = Math.min(snapped, maxLowMidiFor(count));
        const layout = layoutKeyboard(low, stepWhites(low, count, 1));
        expect(layout.whiteCount).toBe(count);
      }
    }
  });
});

describe('helpers', () => {
  it('counts white keys', () => {
    expect(whiteKeyCount(60, 71)).toBe(7); // one octave
    expect(whiteKeyCount(21, 108)).toBe(52); // full piano
  });

  it('snaps to white keys directionally', () => {
    expect(snapToWhite(61, -1)).toBe(60);
    expect(snapToWhite(61, 1)).toBe(62);
    expect(snapToWhite(60)).toBe(60);
  });

  it('produces soft-to-strong touch velocity', () => {
    expect(touchVelocity(0)).toBeCloseTo(0.25);
    expect(touchVelocity(1)).toBeCloseTo(1);
    expect(touchVelocity(0.5)).toBeGreaterThan(0.25);
    expect(touchVelocity(0.5)).toBeLessThan(1);
  });
});
