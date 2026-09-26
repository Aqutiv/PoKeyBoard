import { describe, expect, it } from 'vitest';
import { FORTE_VELOCITY } from '@/features/notation/dynamics';
import {
  accentVelocity,
  calibratedRange,
  MIDI_VELOCITY_CURVES,
  midiVelocity,
  MIN_MIDI_RANGE_SPAN,
  TOUCH_SENSITIVITIES,
  touchVelocity,
  type TouchSensitivity,
} from '@/features/keyboard/velocityResponse';

/** The touch curve the piano shipped with, before there was a choice of one. */
function originalTouchVelocity(yFraction: number): number {
  const clamped = Math.min(1, Math.max(0, yFraction));
  return Math.min(1, 0.25 + 0.75 * Math.pow(clamped, 1.4));
}

/** Top of the key to the bottom, in hundredths. */
const DOWN_THE_KEY = Array.from({ length: 101 }, (_, i) => i / 100);

/** Every note-on velocity a device can send. */
const STRIKES = Array.from({ length: 127 }, (_, i) => i + 1);

/** Each value paired with the one before it. */
function steps(values: readonly number[]): Array<[number, number]> {
  return values.slice(1).map((value, i) => [values[i]!, value]);
}

describe('touchVelocity', () => {
  it('is exactly the original curve at normal sensitivity', () => {
    for (const y of [...DOWN_THE_KEY, 0.123456789, 0.987654321, -0.5, 1.5]) {
      expect(touchVelocity(y, 'normal')).toBe(originalTouchVelocity(y));
    }
  });

  it('rises from a floor at the top of the key to full at the bottom', () => {
    expect(touchVelocity(0, 'light')).toBeCloseTo(0.35);
    expect(touchVelocity(0, 'normal')).toBeCloseTo(0.25);
    expect(touchVelocity(0, 'firm')).toBeCloseTo(0.15);
    for (const sensitivity of TOUCH_SENSITIVITIES) expect(touchVelocity(1, sensitivity)).toBe(1);
  });

  it('only ever gets louder further down the key', () => {
    for (const sensitivity of TOUCH_SENSITIVITIES) {
      for (const [above, below] of steps(DOWN_THE_KEY)) {
        expect(touchVelocity(below, sensitivity)).toBeGreaterThan(
          touchVelocity(above, sensitivity),
        );
      }
    }
  });

  it('is louder on light and softer on firm everywhere above the bottom of the key', () => {
    for (const y of DOWN_THE_KEY.slice(0, -1)) {
      expect(touchVelocity(y, 'light')).toBeGreaterThan(touchVelocity(y, 'normal'));
      expect(touchVelocity(y, 'firm')).toBeLessThan(touchVelocity(y, 'normal'));
    }
  });

  it('reaches forte with less travel on light and more on firm', () => {
    const travel = (sensitivity: TouchSensitivity) =>
      DOWN_THE_KEY.find((y) => touchVelocity(y, sensitivity) >= FORTE_VELOCITY);
    // The figures the curve table in velocityResponse.ts gives.
    expect(travel('light')).toBe(0.56);
    expect(travel('normal')).toBe(0.71);
    expect(travel('firm')).toBe(0.8);
  });

  it('treats a touch past either edge of the key as the edge', () => {
    for (const sensitivity of TOUCH_SENSITIVITIES) {
      expect(touchVelocity(-0.2, sensitivity)).toBe(touchVelocity(0, sensitivity));
      expect(touchVelocity(1.3, sensitivity)).toBe(1);
    }
  });
});

describe('midiVelocity', () => {
  it('is exactly raw / 127 on the normal curve with no calibration', () => {
    for (const raw of [0, ...STRIKES]) expect(midiVelocity(raw, 'normal', null)).toBe(raw / 127);
  });

  it('keeps full velocity full on every curve', () => {
    for (const curve of MIDI_VELOCITY_CURVES) expect(midiVelocity(127, curve, null)).toBe(1);
  });

  it('only ever gets louder with a harder strike', () => {
    for (const curve of MIDI_VELOCITY_CURVES) {
      for (const [softer, harder] of steps(STRIKES)) {
        expect(midiVelocity(harder, curve, null)).toBeGreaterThan(
          midiVelocity(softer, curve, null),
        );
        // Calibrated, the clamped ends are flat, but nothing ever falls.
        expect(midiVelocity(harder, curve, { min: 30, max: 90 })).toBeGreaterThanOrEqual(
          midiVelocity(softer, curve, { min: 30, max: 90 }),
        );
      }
    }
  });

  it('gives more for the same strike on light and less on heavy', () => {
    for (const raw of STRIKES.slice(0, -1)) {
      expect(midiVelocity(raw, 'light', null)).toBeGreaterThan(midiVelocity(raw, 'normal', null));
      expect(midiVelocity(raw, 'heavy', null)).toBeLessThan(midiVelocity(raw, 'normal', null));
    }
    // The middle strike, as the curve comment in velocityResponse.ts puts it.
    expect(Math.round(midiVelocity(64, 'light', null) * 127)).toBe(80);
    expect(Math.round(midiVelocity(64, 'heavy', null) * 127)).toBe(45);
  });

  it('stretches a calibrated range over the whole of 1–127', () => {
    const range = { min: 20, max: 100 };
    expect(midiVelocity(20, 'normal', range)).toBe(1 / 127);
    expect(midiVelocity(100, 'normal', range)).toBe(1);
    // Halfway through the range is halfway through 1–127.
    expect(midiVelocity(60, 'normal', range)).toBeCloseTo(64 / 127, 12);
  });

  it('clamps a strike outside the calibrated range to its nearer end', () => {
    const range = { min: 20, max: 100 };
    expect(midiVelocity(1, 'normal', range)).toBe(1 / 127);
    expect(midiVelocity(19, 'normal', range)).toBe(1 / 127);
    expect(midiVelocity(101, 'normal', range)).toBe(1);
    expect(midiVelocity(127, 'normal', range)).toBe(1);
  });

  it('applies the curve to the calibrated value, not the raw one', () => {
    const range = { min: 20, max: 100 };
    expect(midiVelocity(60, 'light', range)).toBeCloseTo(Math.pow(64 / 127, 2 / 3), 12);
    expect(midiVelocity(60, 'heavy', range)).toBeCloseTo(Math.pow(64 / 127, 1.5), 12);
    expect(midiVelocity(100, 'heavy', range)).toBe(1);
  });
});

describe('accentVelocity', () => {
  it('adds a fifth of full velocity', () => {
    expect(accentVelocity(0.75)).toBeCloseTo(0.95);
    expect(accentVelocity(0.2)).toBeCloseTo(0.4);
  });

  it('never goes past full', () => {
    expect(accentVelocity(0.8)).toBe(1);
    expect(accentVelocity(0.95)).toBe(1);
    expect(accentVelocity(1)).toBe(1);
  });
});

describe('calibratedRange', () => {
  it('keeps a softest and loudest far enough apart', () => {
    expect(calibratedRange(20, 110)).toEqual({ min: 20, max: 110 });
    expect(calibratedRange(40, 40 + MIN_MIDI_RANGE_SPAN)).toEqual({ min: 40, max: 56 });
  });

  it('rejects a loudest note that was no louder than the softest', () => {
    expect(calibratedRange(90, 90)).toBeNull();
    expect(calibratedRange(90, 30)).toBeNull();
  });

  it('rejects a span narrower than the minimum', () => {
    expect(MIN_MIDI_RANGE_SPAN).toBe(16);
    expect(calibratedRange(40, 55)).toBeNull();
  });
});
