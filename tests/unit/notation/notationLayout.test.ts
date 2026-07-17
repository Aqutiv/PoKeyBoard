import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { firstChordIndexAt, layoutScore } from '@/features/notation/notationLayout';

const OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16' as const,
};

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 60, startMs: 0, durationMs: 500, velocity: 0.5, ...partial };
}

describe('layoutScore', () => {
  it('lays out an empty score with the minimum measures', () => {
    const layout = layoutScore([], { ...OPTS, minMeasures: 4 });
    expect(layout.measures).toHaveLength(4);
    expect(layout.barMs).toBe(2000);
    expect(layout.totalMs).toBe(8000);
    expect(layout.measures.every((m) => m.empty)).toBe(true);
  });

  it('groups same-staff notes at one quantized start into a chord', () => {
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 60, startMs: 0 }),
        note({ id: 'b', midi: 64, startMs: 8 }), // 8ms apart → same 1/16 slot
        note({ id: 'c', midi: 67, startMs: 3 }),
      ],
      OPTS,
    );
    expect(layout.chords).toHaveLength(1);
    expect(layout.chords[0]!.notes.map((n) => n.midi)).toEqual([60, 64, 67]);
  });

  it('splits chords across staffs', () => {
    const layout = layoutScore(
      [note({ id: 'a', midi: 48, startMs: 0 }), note({ id: 'b', midi: 72, startMs: 0 })],
      OPTS,
    );
    expect(layout.chords).toHaveLength(2);
    const staffs = layout.chords.map((c) => c.staff).sort();
    expect(staffs).toEqual(['bass', 'treble']);
  });

  it('keeps raw timing while quantizing only the drawn position', () => {
    const layout = layoutScore([note({ id: 'a', startMs: 130 })], OPTS);
    const laid = layout.chords[0]!.notes[0]!;
    expect(laid.startMs).toBe(130);
    expect(laid.displayStartMs).toBe(125);
  });

  it('marks measures containing chords as non-empty and extends to content', () => {
    const layout = layoutScore([note({ id: 'a', startMs: 4100, durationMs: 400 })], OPTS);
    expect(layout.measures.length).toBeGreaterThanOrEqual(3);
    expect(layout.measures[0]!.empty).toBe(true);
    expect(layout.measures[2]!.empty).toBe(false);
  });

  it('sorts chords by display start for binary search', () => {
    const layout = layoutScore(
      [note({ id: 'b', startMs: 1000 }), note({ id: 'a', startMs: 0 }), note({ id: 'c', startMs: 2000 })],
      OPTS,
    );
    const starts = layout.chords.map((c) => c.displayStartMs);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
    expect(firstChordIndexAt(layout.chords, 900)).toBe(1);
    expect(firstChordIndexAt(layout.chords, 0)).toBe(0);
    expect(firstChordIndexAt(layout.chords, 99_999)).toBe(3);
  });

  it('gives a chord the longest note symbol and a majority stem direction', () => {
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 250 }),
        note({ id: 'b', midi: 76, startMs: 0, durationMs: 1000 }),
      ],
      OPTS,
    );
    expect(layout.chords[0]!.symbol).toEqual({ base: 'half', dotted: false });
    expect(layout.chords[0]!.stemDown).toBe(true); // high notes → stems down
  });

  it('handles 2000 notes without excessive layout output', () => {
    const notes: NoteEvent[] = [];
    for (let i = 0; i < 2000; i += 1) {
      notes.push(note({ id: `n${i}`, midi: 48 + (i % 36), startMs: i * 125, durationMs: 120 }));
    }
    const started = performance.now();
    const layout = layoutScore(notes, OPTS);
    const elapsed = performance.now() - started;
    expect(layout.chords.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(250);
  });
});
