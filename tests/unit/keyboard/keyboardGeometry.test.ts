import { describe, expect, it } from 'vitest';
import {
  BLACK_KEY_HEIGHT,
  hitTestKey,
  layoutKeyboard,
  snapToWhite,
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
