import { describe, expect, it } from 'vitest';
import { followAnchor } from '@/features/keyboard/keyboardFollow';
import { stepWhites } from '@/features/keyboard/keyboardGeometry';

// A 14-white window from C3 (48) reaches B4 (71).
const LOW = 48;
const WHITES = 14;

describe('the keyboard following playback', () => {
  it('stays put while everything playing is on the bed', () => {
    expect(followAnchor({ now: [60, 64], soon: [67, 71, 48] }, LOW, WHITES)).toBeNull();
    expect(followAnchor({ now: [], soon: [] }, LOW, WHITES)).toBeNull();
  });

  it('moves up to bring a melody above the bed into view', () => {
    const next = followAnchor({ now: [76, 79], soon: [81, 84] }, LOW, WHITES);
    expect(next).not.toBeNull();
    for (const midi of [76, 79, 81, 84]) {
      expect(midi).toBeGreaterThanOrEqual(next!);
      expect(midi).toBeLessThanOrEqual(stepWhites(next!, WHITES, 1));
    }
  });

  it('shows where most is happening when the music is wider than the bed', () => {
    // A low bass note against a busy right hand two octaves up: the right hand wins.
    const next = followAnchor({ now: [28, 79, 83], soon: [84, 86, 88, 91] }, LOW, WHITES);
    expect(next).not.toBeNull();
    expect(83).toBeGreaterThanOrEqual(next!);
    expect(91).toBeLessThanOrEqual(stepWhites(next!, WHITES, 1));
  });

  it('never moves to a window that shows less than it does now', () => {
    // One note off the bed, the rest on it and no window holding them all.
    expect(followAnchor({ now: [50, 55, 60, 64, 67], soon: [96] }, LOW, WHITES)).toBeNull();
  });

  it('keeps the move as small as it can among equally good windows', () => {
    // A note just above the bed: the window slides up rather than leaping.
    const next = followAnchor({ now: [72], soon: [] }, LOW, WHITES);
    expect(next).not.toBeNull();
    expect(stepWhites(next!, WHITES, 1)).toBe(72);
  });
});
