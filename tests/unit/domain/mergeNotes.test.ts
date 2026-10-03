import { describe, expect, it } from 'vitest';
import { mergeNotes, sortNotes } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { xorshift32 } from '@/utils/random';

/** Notes on a coarse grid, so onsets and pitches collide and ids break ties. */
function randomNotes(random: () => number, count: number, prefix: string): NoteEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${Math.floor(random() * 1e6)}-${i}`,
    midi: 48 + Math.floor(random() * 6),
    startMs: Math.floor(random() * 20) * 250,
    durationMs: 100,
    velocity: 0.5,
  }));
}

describe('mergeNotes', () => {
  it('gives what sorting the lot gives, a note or a pass at a time', () => {
    const random = xorshift32(7);
    for (let round = 0; round < 200; round += 1) {
      const existing = sortNotes(randomNotes(random, Math.floor(random() * 60), 'a'));
      const added = randomNotes(random, 1 + Math.floor(random() * 4), 'b');
      expect(mergeNotes(existing, added)).toEqual(sortNotes([...existing, ...added]));
    }
  });

  it('sorts the whole take, as before, when it was not in order to begin with', () => {
    const random = xorshift32(11);
    const existing = randomNotes(random, 40, 'a');
    const added = randomNotes(random, 3, 'b');
    expect(mergeNotes(existing, added)).toEqual(sortNotes([...existing, ...added]));
  });

  it('leaves the take it was given alone', () => {
    const existing = sortNotes(randomNotes(xorshift32(3), 10, 'a'));
    const copy = [...existing];
    mergeNotes(existing, randomNotes(xorshift32(4), 2, 'b'));
    expect(existing).toEqual(copy);
  });
});
