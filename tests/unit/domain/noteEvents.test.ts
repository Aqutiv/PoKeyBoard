import { describe, expect, it } from 'vitest';
import {
  compareNoteEvents,
  computeTakeDurationMs,
  createEmptyTake,
  removeNotesByIds,
  sortNotes,
  sortPedalEvents,
} from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.5, ...partial };
}

describe('sortNotes', () => {
  it('orders by start, then pitch, then id', () => {
    const notes = [
      note({ id: 'c', startMs: 100, midi: 62 }),
      note({ id: 'b', startMs: 100, midi: 60 }),
      note({ id: 'a', startMs: 100, midi: 60 }),
      note({ id: 'd', startMs: 0, midi: 72 }),
    ];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const notes = [note({ id: 'b', startMs: 50 }), note({ id: 'a', startMs: 0 })];
    sortNotes(notes);
    expect(notes[0]!.id).toBe('b');
  });

  it('is deterministic for identical content with different ids', () => {
    const a = [note({ id: 'x' }), note({ id: 'y' })];
    const b = [note({ id: 'y' }), note({ id: 'x' })];
    expect(sortNotes(a).map((n) => n.id)).toEqual(sortNotes(b).map((n) => n.id));
  });
});

describe('compareNoteEvents', () => {
  it('returns zero only for identical keys', () => {
    expect(compareNoteEvents(note({ id: 'a' }), note({ id: 'a' }))).toBe(0);
    expect(compareNoteEvents(note({ id: 'a' }), note({ id: 'b' }))).toBeLessThan(0);
  });
});

describe('sortPedalEvents', () => {
  it('orders by time with up-before-down at ties', () => {
    const sorted = sortPedalEvents([
      { atMs: 100, down: true },
      { atMs: 100, down: false },
      { atMs: 0, down: true },
    ]);
    expect(sorted).toEqual([
      { atMs: 0, down: true },
      { atMs: 100, down: false },
      { atMs: 100, down: true },
    ]);
  });
});

describe('computeTakeDurationMs', () => {
  it('returns the latest note end', () => {
    expect(
      computeTakeDurationMs([
        note({ startMs: 0, durationMs: 400 }),
        note({ startMs: 300, durationMs: 500 }),
      ]),
    ).toBe(800);
  });

  it('returns 0 for an empty take', () => {
    expect(computeTakeDurationMs([])).toBe(0);
  });
});

describe('removeNotesByIds', () => {
  it('removes only the listed ids', () => {
    const notes = [note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })];
    expect(removeNotesByIds(notes, new Set(['a', 'c'])).map((n) => n.id)).toEqual(['b']);
  });
});

describe('createEmptyTake', () => {
  it('creates a valid default take', () => {
    const take = createEmptyTake();
    expect(take.schemaVersion).toBe(1);
    expect(take.id).toMatch(/[0-9a-f-]{36}/);
    expect(take.tempo.bpm).toBe(120);
    expect(take.notes).toEqual([]);
    expect(take.durationMs).toBe(0);
  });

  it('applies overrides', () => {
    expect(createEmptyTake({ title: 'Scale practice' }).title).toBe('Scale practice');
  });

  it('generates unique ids', () => {
    expect(createEmptyTake().id).not.toBe(createEmptyTake().id);
  });
});
