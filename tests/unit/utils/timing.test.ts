import { describe, expect, it } from 'vitest';
import {
  barDurationMs,
  beatDurationMs,
  clamp,
  countInDurationMs,
  formatDurationMs,
  wholeNoteDurationMs,
} from '@/utils/timing';

describe('beat and bar durations', () => {
  it('computes 4/4 at 120 BPM', () => {
    const ts = { numerator: 4, denominator: 4 };
    expect(beatDurationMs(120, ts)).toBe(500);
    expect(barDurationMs(120, ts)).toBe(2000);
  });

  it('treats the denominator note as the beat in 6/8', () => {
    const ts = { numerator: 6, denominator: 8 };
    expect(beatDurationMs(120, ts)).toBe(250);
    expect(barDurationMs(120, ts)).toBe(1500);
  });

  it('computes count-in length from bars', () => {
    expect(
      countInDurationMs({
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        countInBars: 2,
      }),
    ).toBe(4000);
    expect(
      countInDurationMs({
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        countInBars: 0,
      }),
    ).toBe(0);
  });

  it('computes whole-note duration', () => {
    expect(wholeNoteDurationMs(120)).toBe(2000);
    expect(wholeNoteDurationMs(60)).toBe(4000);
  });
});

describe('formatDurationMs', () => {
  it('formats minutes and seconds', () => {
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatDurationMs(83_000)).toBe('1:23');
    expect(formatDurationMs(83_456, true)).toBe('1:23.4');
  });

  it('clamps negatives to zero', () => {
    expect(formatDurationMs(-500)).toBe('0:00');
  });
});

describe('clamp', () => {
  it('clamps into the inclusive range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
