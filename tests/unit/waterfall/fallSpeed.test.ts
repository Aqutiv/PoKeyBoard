import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATERFALL_SECONDS,
  FASTEST_FALL_SECONDS,
  SLOWEST_FALL_SECONDS,
  stepWaterfallSeconds,
  WATERFALL_SECONDS,
} from '@/features/waterfall/fallSpeed';

describe('the fall speed', () => {
  it('falls in three seconds until changed, and anywhere from one to eight', () => {
    expect(DEFAULT_WATERFALL_SECONDS).toBe(3);
    expect(FASTEST_FALL_SECONDS).toBe(1);
    expect(SLOWEST_FALL_SECONDS).toBe(8);
    expect([...WATERFALL_SECONDS]).toEqual([...WATERFALL_SECONDS].sort((a, b) => a - b));
  });

  it('steps one place at a time, and holds at either end', () => {
    expect(stepWaterfallSeconds(3, true)).toBe(2.5);
    expect(stepWaterfallSeconds(3, false)).toBe(4);
    expect(stepWaterfallSeconds(FASTEST_FALL_SECONDS, true)).toBe(FASTEST_FALL_SECONDS);
    expect(stepWaterfallSeconds(SLOWEST_FALL_SECONDS, false)).toBe(SLOWEST_FALL_SECONDS);
  });

  it('comes back to where it began, a step slower and a step faster', () => {
    for (const seconds of WATERFALL_SECONDS) {
      if (seconds === SLOWEST_FALL_SECONDS) continue;
      expect(stepWaterfallSeconds(stepWaterfallSeconds(seconds, false), true)).toBe(seconds);
    }
  });
});
