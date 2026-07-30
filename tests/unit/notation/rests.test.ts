import { describe, expect, it } from 'vitest';
import type { NoteEvent, TimeSignature } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import { barUnits, restsForGap, restStep, UNITS_PER_WHOLE } from '@/features/notation/rests';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const THREE_FOUR: TimeSignature = { numerator: 3, denominator: 4 };
const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8 };

// Written in note values rather than raw units, so these say what they mean
// and stay true if the unit the layout counts in ever changes.
/** One quarter note, in units. */
const Q = UNITS_PER_WHOLE / 4;
/** A sixteenth, a 32nd, a 64th, and half of one — the short end of the range. */
const S = UNITS_PER_WHOLE / 16;
const T = UNITS_PER_WHOLE / 32;
const SF = UNITS_PER_WHOLE / 64;
const HALF_SF = SF / 2;

/** Compact "value@position" form, positions counted in quarter notes. */
function shape(gap: ReturnType<typeof restsForGap>): string[] {
  return gap.map(
    (span) => `${span.symbol.dotted ? 'dotted ' : ''}${span.symbol.base}@${span.startUnits / Q}`,
  );
}

describe('restsForGap', () => {
  it('fills a whole silent bar with one whole rest whatever the meter', () => {
    for (const ts of [FOUR_FOUR, THREE_FOUR, SIX_EIGHT]) {
      expect(shape(restsForGap(0, barUnits(ts), ts))).toEqual(['whole@0']);
    }
  });

  it('gives each beat of 4/4 its own quarter rest', () => {
    expect(shape(restsForGap(Q, 2 * Q, FOUR_FOUR))).toEqual(['quarter@1']);
    expect(shape(restsForGap(0, Q, FOUR_FOUR))).toEqual(['quarter@0']);
  });

  it('never lets a rest swallow the middle of the bar', () => {
    // Beats 1-3 of 4/4. A dotted half would fit exactly, but it hides the
    // half-bar division a reader counts from: half + quarter is how it reads.
    expect(shape(restsForGap(0, 3 * Q, FOUR_FOUR))).toEqual(['half@0', 'quarter@2']);
  });

  it('merges whole beats into a half rest once past the middle', () => {
    // Beats 2-4: quarter on beat 2, then the whole second half of the bar.
    expect(shape(restsForGap(Q, 4 * Q, FOUR_FOUR))).toEqual(['quarter@1', 'half@2']);
  });

  it('groups a compound meter by its dotted beat', () => {
    // 6/8 counts in two dotted quarters; the first half is one of them.
    expect(shape(restsForGap(0, 1.5 * Q, SIX_EIGHT))).toEqual(['dotted quarter@0']);
  });

  it('lets an odd meter rest across its centre', () => {
    // 3/4 has no half-bar division to protect, so beats 1-2 are one half rest.
    expect(shape(restsForGap(0, 2 * Q, THREE_FOUR))).toEqual(['half@0']);
  });

  it('starts a rest only where one of its length could start', () => {
    // A silence beginning a sixteenth into the beat takes the sixteenth that
    // reaches the next eighth before it can use longer values.
    expect(shape(restsForGap(S, Q, FOUR_FOUR))).toEqual(['sixteenth@0.25', 'eighth@0.5']);
  });

  it('writes the short values too, down to a 64th', () => {
    // A 32nd of silence after a beat, then a 64th after that: both exist now,
    // and each still starts only where one of its own length may.
    expect(shape(restsForGap(Q, Q + T, FOUR_FOUR))).toEqual(['32nd@1']);
    expect(shape(restsForGap(Q, Q + SF, FOUR_FOUR))).toEqual(['64th@1']);
    // Three 64ths of silence on the beat: a dotted 32nd is exactly that long,
    // but a dotted value starts only on a multiple of itself, and the beat is
    // not one — so it reads as the two plain values it divides into.
    expect(shape(restsForGap(Q, Q + T + SF, FOUR_FOUR))).toEqual(['32nd@1', '64th@1.125']);
  });

  it('drops a remainder too short to write', () => {
    // Half a 64th left over: no symbol covers it, and it is invisible anyway.
    expect(shape(restsForGap(0, Q + HALF_SF, FOUR_FOUR))).toEqual(['quarter@0']);
  });

  it('always terminates on a ragged span', () => {
    const bar = barUnits(FOUR_FOUR);
    for (let from = 0; from < bar; from += 1) {
      for (let to = from; to <= bar; to += 1) {
        const spans = restsForGap(from, to, FOUR_FOUR);
        const filled = spans.reduce((sum, span) => sum + span.lengthUnits, 0);
        expect(filled).toBeLessThanOrEqual(to - from);
      }
    }
  });

  it('reads a whole rest from the line above the middle one', () => {
    expect(restStep({ base: 'whole', dotted: false })).toBe(6);
    expect(restStep({ base: 'quarter', dotted: false })).toBe(4);
  });
});

const OPTS = { bpm: 120, timeSignature: FOUR_FOUR, quantization: '1/16' as const };

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 60, startMs: 0, durationMs: 500, velocity: 0.5, ...partial };
}

describe('layoutScore rests', () => {
  it('fills the silence between two notes of a bar', () => {
    // Quarter on beat 1, quarter on beat 3, at 120bpm (500ms a beat).
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 500 }),
        note({ id: 'b', midi: 72, startMs: 1000, durationMs: 500 }),
      ],
      OPTS,
    );
    const treble = layout.rests.filter((rest) => rest.staff === 'treble');
    expect(treble.map((rest) => [rest.symbol.base, rest.displayStartMs])).toEqual([
      ['quarter', 500],
      ['quarter', 1500],
    ]);
  });

  it('rests the staff that is silent while the other plays', () => {
    const layout = layoutScore([note({ midi: 72, startMs: 0, durationMs: 2000 })], OPTS);
    const bass = layout.rests.filter((rest) => rest.staff === 'bass' && rest.displayStartMs < 2000);
    expect(bass).toHaveLength(1);
    expect(bass[0]!.symbol).toEqual({ base: 'whole', dotted: false });
  });

  it("does not rest between detached notes at the score's own resolution", () => {
    // Four quarters, each lifted a little early. On a 1/8 grid that is four
    // quarter notes and no silence at all — the lift is phrasing, and the
    // score is not written finely enough to have an opinion about it.
    const layout = layoutScore(
      [0, 500, 1000, 1500].map((startMs, i) =>
        note({ id: `n${i}`, midi: 72, startMs, durationMs: 400 }),
      ),
      { ...OPTS, quantization: '1/8' },
    );
    expect(layout.chords.map((chord) => chord.symbol.base)).toEqual([
      'quarter',
      'quarter',
      'quarter',
      'quarter',
    ]);
    expect(layout.rests.filter((rest) => rest.staff === 'treble')).toEqual([]);
  });

  it('writes the silence a genuinely short note leaves, and the bar adds up', () => {
    // The same four beats played properly staccato, read on a 1/16 grid: a
    // sixteenth sounding and the rest of the beat silent, four times over.
    const layout = layoutScore(
      [0, 500, 1000, 1500].map((startMs, i) =>
        note({ id: `n${i}`, midi: 72, startMs, durationMs: 180 }),
      ),
      OPTS,
    );
    expect(layout.chords.map((chord) => chord.symbol.base)).toEqual([
      'sixteenth',
      'sixteenth',
      'sixteenth',
      'sixteenth',
    ]);

    // What matters is that nothing is missing: notes plus rests fill the bar.
    const written = (symbol: { base: string; dotted: boolean }): number =>
      ({ whole: 32, half: 16, quarter: 8, eighth: 4, sixteenth: 2 })[symbol.base]! *
      (symbol.dotted ? 1.5 : 1);
    const inBarOne = (ms: number): boolean => ms < 2000;
    const filled =
      layout.chords
        .filter((chord) => chord.staff === 'treble' && inBarOne(chord.displayStartMs))
        .reduce((sum, chord) => sum + written(chord.symbol), 0) +
      layout.rests
        .filter((rest) => rest.staff === 'treble' && inBarOne(rest.displayStartMs))
        .reduce((sum, rest) => sum + written(rest.symbol), 0);
    expect(filled).toBe(32); // one 4/4 bar in 32nd notes
  });

  it('fills a 32nd of silence with a 32nd rest', () => {
    // At 60bpm a beat is a second, so a 32nd is 125ms: one sounding, one silent,
    // read on a grid fine enough to have an opinion about either.
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 125 }),
        note({ id: 'b', midi: 72, startMs: 250, durationMs: 125 }),
      ],
      { ...OPTS, bpm: 60, quantization: '1/32' },
    );
    const treble = layout.rests.filter((rest) => rest.staff === 'treble');
    expect(treble[0]!.symbol).toEqual({ base: '32nd', dotted: false });
    expect(treble[0]!.displayStartMs).toBe(125);
  });

  it('writes no rest finer than the grid the page is read on', () => {
    // The same 32nd of silence on a 1/16 grid. A page whose notes are rounded
    // to sixteenths has no business showing a 32nd rest: the reader was told
    // nothing finer happens, and a sliver left by rounding is not music. So
    // this reads as it did before the short values existed — two sixteenths.
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 125 }),
        note({ id: 'b', midi: 72, startMs: 250, durationMs: 125 }),
      ],
      { ...OPTS, bpm: 60, quantization: '1/16' },
    );
    const treble = layout.rests.filter((rest) => rest.staff === 'treble');
    expect(treble.map((rest) => rest.symbol.base)).not.toContain('32nd');
    expect(layout.chords.map((chord) => chord.symbol.base)).toEqual(['sixteenth', 'sixteenth']);
  });

  it('leaves a wholly silent bar to the empty-measure whole rest', () => {
    const layout = layoutScore(
      [
        note({ id: 'a', midi: 72, startMs: 0, durationMs: 2000 }),
        note({ id: 'b', midi: 72, startMs: 4000, durationMs: 2000 }),
      ],
      OPTS,
    );
    expect(layout.measures[1]!.empty).toBe(true);
    const inBarTwo = layout.rests.filter(
      (rest) => rest.displayStartMs >= 2000 && rest.displayStartMs < 4000,
    );
    expect(inBarTwo).toEqual([]);
  });

  it('counts a note held over the bar line as occupying the bar it runs into', () => {
    // A whole note from bar 1 covers bar 2 as well, so bar 2 rests only after
    // it stops — here the note ends the bar, so bar 2 rests from beat 1.
    const layout = layoutScore(
      [
        note({ id: 'held', midi: 72, startMs: 0, durationMs: 2000 }),
        note({ id: 'next', midi: 60, startMs: 2000, durationMs: 500, staff: 'bass' }),
      ],
      OPTS,
    );
    const trebleBarTwo = layout.rests.filter(
      (rest) =>
        rest.staff === 'treble' && rest.displayStartMs >= 2000 && rest.displayStartMs < 4000,
    );
    expect(trebleBarTwo.map((rest) => rest.symbol.base)).toEqual(['whole']);
  });
});
