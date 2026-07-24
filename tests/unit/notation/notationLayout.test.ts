import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { firstChordIndexAt, layoutScore, measureIndexAt } from '@/features/notation/notationLayout';

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
      [
        note({ id: 'b', startMs: 1000 }),
        note({ id: 'a', startMs: 0 }),
        note({ id: 'c', startMs: 2000 }),
      ],
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

  it('sizes measures from the tempo in force and reports it', () => {
    // Two bars at 120, then twice as fast from bar 3.
    const layout = layoutScore([note({ id: 'a', startMs: 4000, durationMs: 500 })], {
      ...OPTS,
      tempoChanges: [{ atMs: 4000, bpm: 240 }],
      minMeasures: 1,
    });
    expect(layout.measures.map((m) => [m.startMs, m.endMs])).toEqual([
      [0, 2000],
      [2000, 4000],
      [4000, 5000], // four beats at 240 bpm
    ]);
    expect(layout.measures.map((m) => m.bpm)).toEqual([120, 120, 240]);
    // barMs stays the first measure's length; totalMs is the real extent.
    expect(layout.barMs).toBe(2000);
    expect(layout.totalMs).toBe(5000);
    expect(layout.measures[2]!.empty).toBe(false);
  });

  it('reads note values at the local tempo', () => {
    const slow = note({ id: 'slow', startMs: 0, durationMs: 500 });
    const fast = note({ id: 'fast', startMs: 4000, durationMs: 250 });
    const layout = layoutScore([slow, fast], {
      ...OPTS,
      tempoChanges: [{ atMs: 4000, bpm: 240 }],
      minMeasures: 1,
    });
    const symbols = new Map(
      layout.chords.map((chord) => [chord.notes[0]!.id, chord.notes[0]!.symbol]),
    );
    // Both are quarter notes: 500 ms at 120 bpm, 250 ms at 240 bpm.
    expect(symbols.get('slow')).toEqual({ base: 'quarter', dotted: false });
    expect(symbols.get('fast')).toEqual({ base: 'quarter', dotted: false });
  });

  it('finds the measure containing a time, and nothing outside the layout', () => {
    const layout = layoutScore([], { ...OPTS, minMeasures: 3 });
    expect(measureIndexAt(layout.measures, 0)).toBe(0);
    expect(measureIndexAt(layout.measures, 1999)).toBe(0);
    expect(measureIndexAt(layout.measures, 2000)).toBe(1);
    expect(measureIndexAt(layout.measures, 5999)).toBe(2);
    expect(measureIndexAt(layout.measures, 6000)).toBeNull();
    expect(measureIndexAt(layout.measures, -1)).toBeNull();
    expect(measureIndexAt([], 0)).toBeNull();
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
