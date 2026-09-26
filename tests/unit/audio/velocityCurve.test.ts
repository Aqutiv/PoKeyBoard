import { describe, expect, it } from 'vitest';
import {
  CURVE_FLOOR_DB,
  CURVE_GAMMA,
  CURVE_REFERENCE_VELOCITY,
  curveDb,
} from '@/audio/velocityCurve';

describe('curveDb', () => {
  it('is zero at the reference velocity, the computer keyboard’s default', () => {
    expect(CURVE_REFERENCE_VELOCITY).toBe(0.75);
    expect(curveDb(0.75)).toBe(0);
  });

  it('is 20·γ·log10(v / 0.75) above the floor, with γ = 1.2', () => {
    expect(CURVE_GAMMA).toBe(1.2);
    for (const v of [0.1, 0.25, 0.5, 0.9, 1]) {
      expect(curveDb(v)).toBeCloseTo(24 * Math.log10(v / 0.75), 10);
    }
  });

  it('spans about double the old range: ~14.4 dB over 0.25–1, ~24 dB over 0.1–1', () => {
    expect(curveDb(1) - curveDb(0.25)).toBeCloseTo(14.45, 2);
    expect(curveDb(1) - curveDb(0.1)).toBeCloseTo(24.0, 1);
  });

  it('never falls below the floor, so the softest MIDI notes still sound', () => {
    expect(CURVE_FLOOR_DB).toBeGreaterThanOrEqual(-30);
    expect(CURVE_FLOOR_DB).toBeLessThanOrEqual(-28);
    expect(curveDb(0)).toBe(CURVE_FLOOR_DB);
    expect(curveDb(-1)).toBe(CURVE_FLOOR_DB);
    expect(curveDb(1 / 127)).toBe(CURVE_FLOOR_DB);
    for (let midi = 1; midi <= 127; midi += 1) {
      expect(curveDb(midi / 127)).toBeGreaterThanOrEqual(CURVE_FLOOR_DB);
    }
  });

  it('only reaches the floor below any velocity the app’s own inputs play', () => {
    // The firmest touch sensitivity's lightest touch, and ppp from an import.
    expect(curveDb(0.15)).toBeGreaterThan(CURVE_FLOOR_DB + 10);
  });

  it('rises monotonically, strictly once off the floor', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 1000; step += 1) {
      const level = curveDb(step / 1000);
      expect(level).toBeGreaterThanOrEqual(previous);
      if (previous > CURVE_FLOOR_DB) expect(level).toBeGreaterThan(previous);
      previous = level;
    }
  });

  it('treats anything past full velocity as full', () => {
    expect(curveDb(1.5)).toBe(curveDb(1));
    expect(curveDb(1)).toBeCloseTo(3.0, 2);
  });
});
