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

  it('asks for nothing from endMs on, where a loop goes round', () => {
    // A loop ending as the chord's second note starts: that note never plays.
    const endMs = 500 + CHORD_WINDOW_MS;
    expect(nextTrainingGate(TAKE, 0, 'right', endMs)).toEqual({
      atMs: 500,
      midis: new Set([64]),
      noteIds: new Set(['r1']),
    });
    expect(nextTrainingGate(TAKE, 501, 'right', endMs)).toBeNull();
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

  it('never stops for a hidden note, and lets playback play it', () => {
    // A written trill note at 500 and the trill a hidden voice plays for it.
    const hide = (n: NoteEvent): NoteEvent => ({ ...n, hidden: true });
    const trill = sortNotes([
      note('written', 77, 500, 'treble'),
      hide(note('g1', 79, 500, 'treble')),
      hide(note('f1', 77, 562, 'treble')),
      hide(note('g2', 79, 625, 'treble')),
      note('next', 76, 1000, 'treble'),
    ]);
    expect(nextTrainingGate(trill, 0, 'right')).toEqual({
      atMs: 500,
      midis: new Set([77]),
      noteIds: new Set(['written']),
    });
    // Resuming past the hold: the hidden notes are no hold of their own.
    expect(nextTrainingGate(trill, 501, 'right')?.atMs).toBe(1000);
    expect(nextTrainingGate(sortNotes([hide(note('only', 60, 0))]), 0, 'both')).toBeNull();
  });

  it('lets a hidden copy of the key asked for through with it', () => {
    // A score completing one voice with a note another holds: the same key at
    // the same moment. The player strikes it once; the copy must not echo it.
    const hiddenCopy: NoteEvent = { ...note('copy', 65, 500, 'bass'), hidden: true };
    const take = sortNotes([
      hiddenCopy,
      note('held', 65, 500, 'treble'),
      // Same key, a little later inside the window: not a copy but a new strike.
      { ...note('later', 65, 530, 'treble'), hidden: true },
    ]);
    expect(nextTrainingGate(take, 0, 'right')).toEqual({
      atMs: 500,
      midis: new Set([65]),
      noteIds: new Set(['held', 'copy']),
    });
  });

  it('falls back to the middle-C split when the take names no staff', () => {
    const recorded = sortNotes([note('a', 55, 100), note('b', 72, 200)]);
    expect(nextTrainingGate(recorded, 0, 'right')?.midis).toEqual(new Set([72]));
    expect(nextTrainingGate(recorded, 0, 'left')?.midis).toEqual(new Set([55]));
  });
});
