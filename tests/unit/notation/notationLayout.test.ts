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

  it("follows an imported note's staff over its pitch", () => {
    // Mozart K. 545 opens with the left hand written at C4/E4/G4 — at and
    // above middle C, so the pitch rule alone would print it in the treble.
    const layout = layoutScore(
      [
        note({ id: 'rh', midi: 72, startMs: 0, staff: 'treble' }),
        note({ id: 'lh', midi: 60, startMs: 0, staff: 'bass' }),
      ],
      OPTS,
    );
    const bass = layout.chords.find((c) => c.staff === 'bass');
    expect(bass?.notes.map((n) => n.midi)).toEqual([60]);
    // C4 on the bass staff sits on the first ledger line above it.
    expect(bass?.notes[0]!.ledger).toEqual([10]);
  });

  it('gives simultaneous notes of different lengths a stem each', () => {
    // A half note held over a run of eighths in the same hand: one stem for
    // each, not one fat chord carrying the longer of the two values.
    const layout = layoutScore(
      [
        note({ id: 'held', midi: 72, startMs: 0, durationMs: 1000 }),
        note({ id: 'run', midi: 64, startMs: 0, durationMs: 250 }),
      ],
      OPTS,
    );
    expect(layout.chords).toHaveLength(2);
    const [upper, lower] = layout.chords as [(typeof layout.chords)[0], (typeof layout.chords)[0]];
    expect(upper.notes.map((n) => n.midi)).toEqual([72]);
    expect(upper.symbol).toEqual({ base: 'half', dotted: false });
    expect(upper.stemDown).toBe(false); // top voice stems up
    expect(lower.notes.map((n) => n.midi)).toEqual([64]);
    expect(lower.symbol).toEqual({ base: 'eighth', dotted: false });
    expect(lower.stemDown).toBe(true); // bottom voice stems down
  });

  it('numbers voices from the source when it has them, else by pitch', () => {
    const imported = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 1000, voice: 3 }),
        note({ id: 'b', midi: 64, startMs: 0, durationMs: 250, voice: 7 }),
      ],
      OPTS,
    );
    expect(imported.chords.map((c) => c.voice)).toEqual([3, 7]);

    const derived = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 1000 }),
        note({ id: 'b', midi: 64, startMs: 0, durationMs: 250 }),
      ],
      OPTS,
    );
    expect(derived.chords.map((c) => c.voice)).toEqual([0, 1]);
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
    // One voice, so the two lengths belong to the same stem after all.
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 250, voice: 0 }),
        note({ id: 'b', midi: 76, startMs: 0, durationMs: 1000, voice: 0 }),
      ],
      OPTS,
    );
    expect(layout.chords).toHaveLength(1);
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

  it('keeps the written value of a note held across a tempo change', () => {
    // 120 bpm halves to 60 at bar 2 (2000 ms). A half note on beat 3 runs from
    // beat 3 to beat 5, so it crosses the change and sounds for 1500 ms — which
    // read against the starting tempo alone would draw a dotted half.
    const layout = layoutScore([note({ id: 'held', startMs: 1500, durationMs: 1500 })], {
      ...OPTS,
      tempoChanges: [{ atMs: 2000, bpm: 60 }],
      minMeasures: 1,
    });
    expect(layout.chords[0]!.symbol).toEqual({ base: 'half', dotted: false });
  });

  it('quantizes onto the grid the tempo change starts, not one anchored at zero', () => {
    // 4/4 at 100 bpm gives 2400 ms bars, so bar 5 starts at 9600 ms. The new
    // tempo's 1/16 grid does not divide 9600, so an absolute grid would push
    // this downbeat to ~9635 ms — visibly after the bar line it belongs on.
    const layout = layoutScore([note({ id: 'downbeat', startMs: 9600, durationMs: 400 })], {
      ...OPTS,
      bpm: 100,
      tempoChanges: [{ atMs: 9600, bpm: 137 }],
      minMeasures: 1,
    });
    expect(layout.measures[4]!.startMs).toBe(9600);
    expect(layout.chords[0]!.displayStartMs).toBe(9600);
    expect(measureIndexAt(layout.measures, layout.chords[0]!.displayStartMs)).toBe(4);
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
