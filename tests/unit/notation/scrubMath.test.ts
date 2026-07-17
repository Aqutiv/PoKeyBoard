import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { getCrossedNoteOnsets } from '@/features/notation/scrubMath';

function note(id: string, startMs: number, midi = 60): NoteEvent {
  return { id, midi, startMs, durationMs: 200, velocity: 0.6 };
}

// Sorted by startMs, as the scrub controller guarantees.
const NOTES = [
  note('a', 0, 60),
  note('b', 250, 62),
  note('c1', 500, 60), // chord at 500
  note('c2', 500, 64),
  note('c3', 500, 67),
  note('d', 750, 65),
  note('e', 1000, 72),
];

describe('getCrossedNoteOnsets', () => {
  it('returns ascending onsets for forward movement over (prev, next]', () => {
    const crossed = getCrossedNoteOnsets(0, 800, NOTES);
    expect(crossed.map((n) => n.id)).toEqual(['b', 'c1', 'c2', 'c3', 'd']);
  });

  it('includes an onset landed on exactly when moving forward', () => {
    expect(getCrossedNoteOnsets(600, 750, NOTES).map((n) => n.id)).toEqual(['d']);
  });

  it('excludes the onset the movement started from', () => {
    expect(getCrossedNoteOnsets(250, 400, NOTES)).toEqual([]);
  });

  it('returns descending onsets for backward movement', () => {
    const crossed = getCrossedNoteOnsets(1100, 200, NOTES);
    expect(crossed.map((n) => n.id)).toEqual(['e', 'd', 'c3', 'c2', 'c1', 'b']);
  });

  it('keeps chords together in both directions', () => {
    const forward = getCrossedNoteOnsets(400, 600, NOTES);
    expect(forward.map((n) => n.id)).toEqual(['c1', 'c2', 'c3']);
    const backward = getCrossedNoteOnsets(600, 400, NOTES);
    expect(new Set(backward.map((n) => n.id))).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('does not replay a boundary onset on tiny backward jitter', () => {
    // Forward crossing lands just past the chord…
    const forward = getCrossedNoteOnsets(400, 501, NOTES);
    expect(forward.map((n) => n.id)).toEqual(['c1', 'c2', 'c3']);
    // …then 1ms of backward jitter must stay silent (both ends open).
    expect(getCrossedNoteOnsets(501, 500, NOTES)).toEqual([]);
    // But genuinely passing back over it auditions again.
    expect(getCrossedNoteOnsets(501, 499, NOTES).map((n) => n.id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('does not replay on forward jitter after landing on an onset', () => {
    const landed = getCrossedNoteOnsets(700, 750, NOTES);
    expect(landed.map((n) => n.id)).toEqual(['d']);
    expect(getCrossedNoteOnsets(750, 751, NOTES)).toEqual([]);
  });

  it('returns empty for zero movement and empty inputs', () => {
    expect(getCrossedNoteOnsets(500, 500, NOTES)).toEqual([]);
    expect(getCrossedNoteOnsets(0, 1000, [])).toEqual([]);
  });

  it('handles large jumps efficiently over many notes', () => {
    const many: NoteEvent[] = [];
    for (let i = 0; i < 20_000; i += 1) many.push(note(`n${i}`, i * 10));
    const started = performance.now();
    const crossed = getCrossedNoteOnsets(50_000, 150_000, many);
    const elapsed = performance.now() - started;
    expect(crossed).toHaveLength(10_000);
    expect(crossed[0]!.startMs).toBe(50_010);
    expect(crossed[crossed.length - 1]!.startMs).toBe(150_000);
    expect(elapsed).toBeLessThan(50);
  });

  it('slices precisely at range edges going backward', () => {
    const crossed = getCrossedNoteOnsets(750, 0, NOTES);
    // Start onset (750) excluded, landing onset (0) excluded (open interval).
    expect(crossed.map((n) => n.id)).toEqual(['c3', 'c2', 'c1', 'b']);
  });
});
