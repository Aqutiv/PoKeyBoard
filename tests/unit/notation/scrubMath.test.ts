import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { getCrossedNoteOnsets, getCrossedNoteOnsetsRound } from '@/features/notation/scrubMath';

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

  it('keeps copies of one key at one onset in the order they came in, going back', () => {
    // Strike order: the quieter copy of the shared key first, the louder last.
    const shared = [
      note('before', 250, 62),
      note('soft', 500, 60),
      note('loud', 500, 60),
      note('other', 500, 64),
      note('after', 750, 65),
    ];
    expect(getCrossedNoteOnsets(1000, 0, shared).map((n) => n.id)).toEqual([
      'after',
      'other',
      'soft',
      'loud',
      'before',
    ]);
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

describe('getCrossedNoteOnsetsRound', () => {
  // b and the chord c are the loop's own; d starts on its end, outside it.
  const LOOP = { startMs: 250, endMs: 750 };
  const ids = (from: number, to: number) =>
    getCrossedNoteOnsetsRound(LOOP, from, to, NOTES).map((n) => n.id);

  it('crosses within a pass as a straight run does', () => {
    expect(ids(300, 600)).toEqual(['c1', 'c2', 'c3']);
  });

  it('comes round past the end to the top: never the note on the end, always the one on the top', () => {
    // 800 on the run is 300 on the second pass.
    expect(ids(600, 800)).toEqual(['b']);
    expect(ids(100, 800)).toEqual(['b', 'c1', 'c2', 'c3', 'b']);
  });

  it('crosses every pass a long movement goes round', () => {
    // 1800 on the run is 300 on the fourth pass.
    expect(ids(600, 1800)).toEqual(['b', 'c1', 'c2', 'c3', 'b', 'c1', 'c2', 'c3', 'b']);
  });

  it('goes back across the top to the pass before, crossing the note on the top', () => {
    expect(ids(800, 700)).toEqual(['b']);
  });

  it('keeps only the last of them within its limit, nearest the landing', () => {
    const crossed = getCrossedNoteOnsetsRound(LOOP, 600, 1800, NOTES, 5);
    expect(crossed.map((n) => n.id)).toEqual(['b', 'c1', 'c2', 'c3', 'b']);
  });

  it('never walks the passes its limit leaves out, however many a movement goes round', () => {
    // Ten onsets a millisecond round a 100 ms loop, and 10,000 passes in one movement.
    const dense: NoteEvent[] = [];
    for (let i = 0; i < 1_000; i += 1) dense.push(note(`d${i}`, Math.floor(i / 10)));
    const shortest = { startMs: 0, endMs: 100 };
    const started = performance.now();
    const crossed = getCrossedNoteOnsetsRound(shortest, 50, 1_000_050, dense, 24);
    const elapsed = performance.now() - started;
    expect(crossed).toHaveLength(24);
    expect(crossed[crossed.length - 1]!.startMs).toBe(50);
    expect(elapsed).toBeLessThan(50);
  });
});
