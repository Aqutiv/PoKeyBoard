import { describe, expect, it } from 'vitest';
import { sortNotes } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';
import { CHORD_WINDOW_MS, nextTrainingGate } from '@/domain/trainingGate';

function note(
  id: string,
  midi: number,
  startMs: number,
  staff: NoteEvent['staff'] = undefined,
): NoteEvent {
  return { id, midi, startMs, durationMs: 300, velocity: 0.6, staff };
}

/** Bass = left hand, treble = right; middle C decides when a take says nothing. */
const TAKE = sortNotes([
  note('l1', 48, 0, 'bass'),
  note('r1', 64, 500, 'treble'),
  note('r2', 67, 500 + CHORD_WINDOW_MS, 'treble'), // last ms still one chord
  note('r3', 72, 500 + CHORD_WINDOW_MS + 1, 'treble'), // one ms too late
  note('l2', 43, 900, 'bass'),
]);

describe('nextTrainingGate', () => {
  it('waits on the chosen hand and skips the other', () => {
    expect(nextTrainingGate(TAKE, 0, 'right')).toEqual({
      atMs: 500,
      midis: new Set([64, 67]),
      noteIds: new Set(['r1', 'r2']),
    });
  });

  it('gathers a chord across the onset window but nothing past it', () => {
    const gate = nextTrainingGate(TAKE, 0, 'right');
    expect(gate?.midis.has(72)).toBe(false);
    expect(nextTrainingGate(TAKE, 501, 'right')?.atMs).toBe(500 + CHORD_WINDOW_MS);
  });

  it('takes whichever hand comes first for both', () => {
    expect(nextTrainingGate(TAKE, 0, 'both')?.atMs).toBe(0);
    expect(nextTrainingGate(TAKE, 0, 'both')?.midis).toEqual(new Set([48]));
  });

  it('is inclusive of fromMs, so seeking onto a chord still gates', () => {
    expect(nextTrainingGate(TAKE, 500, 'right')?.atMs).toBe(500);
    expect(nextTrainingGate(TAKE, 0, 'left')?.atMs).toBe(0);
  });

  it('returns null once the hand has nothing left', () => {
    expect(nextTrainingGate(TAKE, 901, 'left')).toBeNull();
    expect(nextTrainingGate(TAKE, 600, 'right')).toBeNull();
    expect(nextTrainingGate([], 0, 'both')).toBeNull();
  });

  it('falls back to the middle-C split when the take names no staff', () => {
    const recorded = sortNotes([note('a', 55, 100), note('b', 72, 200)]);
    expect(nextTrainingGate(recorded, 0, 'right')?.midis).toEqual(new Set([72]));
    expect(nextTrainingGate(recorded, 0, 'left')?.midis).toEqual(new Set([55]));
  });
});
