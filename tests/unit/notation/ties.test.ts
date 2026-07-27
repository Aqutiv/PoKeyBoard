import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import { layoutSheet } from '@/features/notation/sheetLayout';

const OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16' as const,
  minMeasures: 1,
};

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 72, startMs: 0, durationMs: 500, velocity: 0.5, ...partial };
}

/** Compact "value(tie flags)" form for a laid-out run. */
function shape(layout: ReturnType<typeof layoutScore>): string[] {
  return layout.chords.map((chord) => {
    const first = chord.notes[0]!;
    const flags = `${first.tiedFromPrev ? '<' : ''}${first.tiedToNext ? '>' : ''}`;
    return `${chord.symbol.dotted ? 'dotted ' : ''}${chord.symbol.base}${flags}`;
  });
}

describe('ties', () => {
  it('leaves a note that fits inside its bar alone', () => {
    // A quarter, a half and a dotted half all sit in one bar and take one
    // symbol each — a dotted half must not become a tied half and quarter.
    expect(shape(layoutScore([note({ durationMs: 500 })], OPTS))).toEqual(['quarter']);
    expect(shape(layoutScore([note({ durationMs: 1000 })], OPTS))).toEqual(['half']);
    expect(shape(layoutScore([note({ durationMs: 1500 })], OPTS))).toEqual(['dotted half']);
    expect(shape(layoutScore([note({ durationMs: 2000 })], OPTS))).toEqual(['whole']);
  });

  it('splits a note at the bar line it crosses', () => {
    // Struck on beat 3 and held two beats: a half note across the bar line,
    // which is written as a quarter in each bar with a tie between them.
    const layout = layoutScore([note({ startMs: 1000, durationMs: 1000 })], OPTS);
    expect(shape(layout)).toEqual(['half']); // beats 3-4, inside the bar

    const across = layoutScore([note({ startMs: 1500, durationMs: 1000 })], OPTS);
    expect(shape(across)).toEqual(['quarter>', 'quarter<']);
  });

  it('writes a note longer than a whole note instead of clamping it', () => {
    // Two whole bars held. This used to draw a single whole note and lose the
    // second bar entirely.
    const layout = layoutScore([note({ durationMs: 4000 })], OPTS);
    expect(shape(layout)).toEqual(['whole>', 'whole<']);
  });

  it('ties a length no single symbol can express', () => {
    // Five eighths: a half tied to an eighth.
    const layout = layoutScore([note({ durationMs: 1250 })], OPTS);
    expect(shape(layout)).toEqual(['half>', 'eighth<']);
  });

  it('keeps every piece sounding for the whole note under the playhead', () => {
    const layout = layoutScore([note({ startMs: 0, durationMs: 4000 })], OPTS);
    for (const chord of layout.chords) {
      expect(chord.notes[0]!.startMs).toBe(0);
      expect(chord.notes[0]!.durationMs).toBe(4000);
    }
  });

  it('does not buy a blank bar for every tie', () => {
    // Because each piece carries the whole note's performance timing, measuring
    // a piece as its own start plus that duration counts the note twice: two
    // bars held would reach four. The layout ends where the music does, plus
    // the one spare bar the on-screen score always keeps to record into.
    const twoBars = layoutScore([note({ startMs: 0, durationMs: 4000 })], OPTS);
    expect(twoBars.measures).toHaveLength(3);
    expect(twoBars.totalMs).toBe(6000);

    // And the error grew with the tie: four bars held must not reach eight.
    const fourBars = layoutScore([note({ startMs: 0, durationMs: 8000 })], OPTS);
    expect(fourBars.measures).toHaveLength(5);
    expect(fourBars.totalMs).toBe(10000);
  });

  it('closes an open pedal at the real end of the music', () => {
    // totalMs is where an unreleased pedal bracket stops, so an inflated
    // extent dragged the bracket past the take with it.
    const layout = layoutScore([note({ startMs: 0, durationMs: 4000 })], {
      ...OPTS,
      pedals: [{ atMs: 0, down: true }],
    });
    expect(layout.pedals).toEqual([{ fromMs: 0, toMs: 6000 }]);
  });

  it('does not repeat the accidental on the far side of a tie', () => {
    // A C sharp held over the bar line is marked once. The new bar has
    // forgotten every other accidental, but the tie carries this one.
    const layout = layoutScore([note({ midi: 73, startMs: 1500, durationMs: 1000 })], OPTS);
    expect(layout.chords.map((chord) => chord.notes[0]!.accidental)).toEqual(['#', null]);
  });

  it('still marks a different note on the same line after a tie', () => {
    const layout = layoutScore(
      [
        note({ id: 'held', midi: 73, startMs: 1500, durationMs: 1000 }), // C#5 over the bar
        note({ id: 'after', midi: 72, startMs: 2500, durationMs: 500 }), // C natural, same line
      ],
      OPTS,
    );
    const after = layout.chords.find((chord) => chord.notes[0]!.id === 'after');
    expect(after?.notes[0]!.accidental).toBe('natural');
  });

  it('leaves notes whole when the score is on no grid at all', () => {
    // Only the live score offers this, and there is nothing to align to.
    const layout = layoutScore([note({ durationMs: 4000 })], { ...OPTS, quantization: 'off' });
    expect(layout.chords).toHaveLength(1);
    expect(layout.chords[0]!.notes[0]!.tiedToNext).toBe(false);
  });
});

describe('tie arcs on paper', () => {
  const SHEET_OPTS = {
    paper: 'a4' as const,
    timeSignature: OPTS.timeSignature,
    bpm: 120,
    title: 'T',
    subtitle: '',
    credit: 'C',
  };

  it('joins the two heads of a tie with one arc', () => {
    const score = layoutScore([note({ durationMs: 4000 })], OPTS);
    const result = layoutSheet(score, SHEET_OPTS);
    const ties = result.pages[0]!.systems.flatMap((system) => system.ties);
    expect(ties).toHaveLength(1);
    const tie = ties[0]!;
    expect(tie.staff).toBe('treble');
    expect(tie.x2Pt).toBeGreaterThan(tie.x1Pt);
  });

  it('draws no arcs for a piece with nothing tied', () => {
    const score = layoutScore([note({ durationMs: 500 })], OPTS);
    const result = layoutSheet(score, SHEET_OPTS);
    expect(result.pages[0]!.systems.flatMap((system) => system.ties)).toEqual([]);
  });
});
