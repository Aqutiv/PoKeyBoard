import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { createTakeTempoMap } from '@/domain/tempoMap';
import { buildLibraryTake, type LibraryTrackDef } from '@/features/library/trackBuilder';
import { A_BEAUTIFUL_DAY } from '@/features/library/tracks/aBeautifulDay';
import { EVENING_TIDE } from '@/features/library/tracks/eveningTide';
import { FUR_ELISE } from '@/features/library/tracks/furElise';
import { GOOD_NIGHT } from '@/features/library/tracks/goodNight';
import { MOONLIGHT_SONATA } from '@/features/library/tracks/moonlightSonata';
import { layoutScore } from '@/features/notation/notationLayout';
import { beatsForSymbol, TRIPLET, type DurationSymbol } from '@/features/notation/quantization';
import { exactValueForUnits, unitsPerBeat, UNITS_PER_WHOLE } from '@/features/notation/rests';
import { layoutSheet } from '@/features/notation/sheetLayout';
import { TREBLE_SPLIT_MIDI } from '@/features/notation/staffMapping';
import { declaredDivisionOf, fitsDivision, isTernaryBeat } from '@/features/notation/tuplets';

/** A little human sloppiness, as a fraction of the beat. */
function jitter(offsets: number[], by: number): number[] {
  return offsets.map((offset, i) => offset + (i % 2 === 0 ? by : -by));
}

describe('declaredDivisionOf', () => {
  /** `{actual, normal, unit}`, spelled the way the score writes it. */
  const t = (actual: number, normal: number, unit: number) => ({ actual, normal, unit });

  it('turns the ratios the corpus actually uses into divisions of the beat', () => {
    // In 4/4 the beat is a quarter: three eighths in the time of two divide it in
    // three, six sixteenths in the time of four divide it in six.
    expect(declaredDivisionOf(t(3, 2, 8), 4)).toBe(3);
    expect(declaredDivisionOf(t(3, 2, 16), 4)).toBe(6);
    expect(declaredDivisionOf(t(6, 4, 16), 4)).toBe(6);
    expect(declaredDivisionOf(t(3, 2, 32), 4)).toBe(12);
    expect(declaredDivisionOf(t(3, 2, 64), 4)).toBe(24);
    // 2/4 counts the same beat; 2/2 a beat twice as long, so twice the slots.
    expect(declaredDivisionOf(t(3, 2, 16), 2)).toBe(12);
    // In 6/8 and x/16 the beat is shorter and holds fewer.
    expect(declaredDivisionOf(t(3, 2, 16), 8)).toBe(3);
    expect(declaredDivisionOf(t(3, 2, 32), 16)).toBe(3);
  });

  it('refuses a ratio no written value can state', () => {
    // 384ths of a whole note is 2⁷·3: thirds and sixths land exactly, fifths and
    // sevenths and ninths cannot. A quintuplet sixteenth is 19.2 units.
    expect(declaredDivisionOf(t(5, 4, 16), 4)).toBeNull();
    expect(declaredDivisionOf(t(9, 8, 32), 4)).toBeNull();
    expect(declaredDivisionOf(t(7, 4, 16), 4)).toBeNull();
    expect(declaredDivisionOf(t(35, 8, 16), 4)).toBeNull();
  });

  it('refuses a tuplet that does not fit inside one beat', () => {
    // A quarter-note triplet spans two beats of 4/4, and a duplet in 6/8 spans
    // the dotted beat. Slots are anchored at the beat, so neither has a home.
    expect(declaredDivisionOf(t(3, 2, 4), 4)).toBeNull();
    expect(declaredDivisionOf(t(2, 3, 8), 8)).toBeNull();
    expect(declaredDivisionOf(t(6, 9, 8), 8)).toBeNull();
  });

  it('refuses a ratio that cancels out, which is what keeps rests legible', () => {
    // 2:1 of eighths is a quarter and 4:2 of sixteenths is an eighth — plain
    // values, so nothing here is a tuplet. Letting one through would hand the
    // rest filler a binary division, which draws a dotted-32nd "triplet" rest:
    // the right length under an absurd glyph.
    expect(declaredDivisionOf(t(2, 1, 8), 4)).toBeNull();
    expect(declaredDivisionOf(t(4, 2, 16), 4)).toBeNull();
    expect(declaredDivisionOf(t(1, 1, 8), 4)).toBeNull();
  });

  it('refuses nonsense without reaching the arithmetic', () => {
    expect(declaredDivisionOf(t(0, 2, 8), 4)).toBeNull();
    expect(declaredDivisionOf(t(3, 0, 8), 4)).toBeNull();
    expect(declaredDivisionOf(t(3, 2, 0), 4)).toBeNull();
    expect(declaredDivisionOf(t(3, 2, 3), 4)).toBeNull();
    expect(declaredDivisionOf(t(2.5, 2, 8), 4)).toBeNull();
  });

  // This is the test that licenses the plain 3:2 ratio still being hardcoded in
  // the layout, the rest filler and the numeral rule. Every division that
  // survives the gate is three times a power of two, so the slot it implies is
  // always a triplet value — never a quintuplet, never a binary no-op.
  it('only ever admits a division of three times a power of two', () => {
    const units = [1, 2, 4, 8, 16, 32, 64, 128];
    let admitted = 0;
    for (const denominator of [2, 4, 8, 16]) {
      for (let actual = 1; actual <= 40; actual += 1) {
        for (let normal = 1; normal <= 40; normal += 1) {
          for (const unit of units) {
            const division = declaredDivisionOf({ actual, normal, unit }, denominator);
            if (division === null) continue;
            admitted += 1;
            expect(division % 3).toBe(0);
            expect(Number.isInteger(Math.log2(division / 3))).toBe(true);
            // And the slot it implies is a triplet value, plain 3:2.
            const slot = unitsPerBeat(denominator) / division;
            expect(exactValueForUnits(slot)?.tuplet).toEqual(TRIPLET);
          }
        }
      }
    }
    expect(admitted).toBeGreaterThan(0);
  });
});

describe('a declared tuplet in the layout', () => {
  const OPTS = {
    bpm: 60, // a beat is a second, so a sextuplet sixteenth is a clean 166⅔ms
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/64' as const,
    minMeasures: 1,
  };
  /** Six in the time of four sixteenths: division 6. */
  const SEXTUPLET = { actual: 3, normal: 2, unit: 16 };

  function note(partial: Partial<NoteEvent>): NoteEvent {
    return { id: 'n', midi: 72, startMs: 0, durationMs: 166, velocity: 0.5, ...partial };
  }

  /** One beat of six, each note declaring the ratio; `group` brackets them. */
  function sextuplet(groups?: [number, number]): NoteEvent[] {
    return [0, 1, 2, 3, 4, 5].map((i) =>
      note({
        id: `s${i}`,
        startMs: Math.round((i * 1000) / 6),
        durationMs: 166,
        tuplet: groups ? { ...SEXTUPLET, group: i < 3 ? groups[0] : groups[1] } : SEXTUPLET,
      }),
    );
  }

  it('writes what the score declared instead of guessing it back', () => {
    // The figure that started this: on a 1/64 grid a sextuplet sixteenth is 2.67
    // grid steps and rounds to three, which is a dotted 32nd — unbeamable, so
    // the run falls apart into flagged notes. Declared, it is a triplet
    // sixteenth and beams.
    const layout = layoutScore(sextuplet(), OPTS);
    expect(layout.chords.map((chord) => chord.symbol.base)).toEqual(Array(6).fill('sixteenth'));
    expect(layout.chords.every((chord) => chord.symbol.tuplet !== undefined)).toBe(true);
    expect(layout.chords.some((chord) => chord.symbol.dotted)).toBe(false);
  });

  it('beams a bracketed six as two threes, each numbered 3', () => {
    // Which is how the same passage is printed: the score drew two groups, so
    // the page shows two, rather than one beam carrying a 6 nobody wrote.
    const layout = layoutScore(sextuplet([0, 1]), OPTS);
    expect(layout.beams).toHaveLength(2);
    expect(layout.beams.map((beam) => beam.members.length)).toEqual([3, 3]);
    expect(layout.beams.map((beam) => beam.tupletCount)).toEqual([3, 3]);
  });

  it('leaves the beat to group a six the score did not bracket', () => {
    // Same notes, same ratio, no brackets: nothing says where the groups are, so
    // the beat groups them as it always has.
    const layout = layoutScore(sextuplet(), OPTS);
    expect(layout.beams).toHaveLength(1);
    expect(layout.beams[0]!.members).toHaveLength(6);
    expect(layout.beams[0]!.tupletCount).toBe(6);
  });

  it('reads a declaration the inference would have refused to make', () => {
    // Two onsets is below MIN_ONSETS_TO_DECIDE, so nothing could be inferred
    // here. The score says, so there is nothing to infer.
    const layout = layoutScore(
      [
        note({ id: 'a', startMs: 0, durationMs: 333, tuplet: { actual: 3, normal: 2, unit: 8 } }),
        note({ id: 'b', startMs: 667, durationMs: 333, tuplet: { actual: 3, normal: 2, unit: 8 } }),
      ],
      OPTS,
    );
    expect(layout.chords.map((chord) => chord.symbol.tuplet?.actual)).toEqual([3, 3]);
    expect(layout.chords.map((chord) => chord.displayStartMs)).toEqual([0, 667]);
  });

  it('does not drag a plain note in the same beat onto the tuplet', () => {
    // A sixteenth written beside a sextuplet group is not part of it. Pulled
    // onto sixths it would move an eighth of a beat and be written a third
    // longer than it is, and the bar would stop adding up.
    const layout = layoutScore(
      [
        ...sextuplet(),
        note({ id: 'plain', midi: 60, staff: 'treble', startMs: 1250, durationMs: 250 }),
      ],
      OPTS,
    );
    const plain = layout.chords.find((chord) => chord.notes[0]!.id === 'plain');
    expect(plain?.symbol).toEqual({ base: 'sixteenth', dotted: false });
    expect(plain?.displayStartMs).toBe(1250);
  });

  it('leaves a declaration it cannot state to the inference', () => {
    // A quintuplet: 384ths of a whole note cannot say it, so these notes are
    // laid out exactly as they would be with no declaration at all.
    const five = (tuplet?: NoteEvent['tuplet']): NoteEvent[] =>
      [0, 1, 2, 3, 4].map((i) =>
        note({
          id: `q${i}`,
          startMs: Math.round((i * 1000) / 5),
          durationMs: 200,
          ...(tuplet ? { tuplet } : {}),
        }),
      );
    const declared = layoutScore(five({ actual: 5, normal: 4, unit: 16 }), OPTS);
    const bare = layoutScore(five(), OPTS);
    expect(declared.chords.map((chord) => chord.symbol)).toEqual(
      bare.chords.map((chord) => chord.symbol),
    );
    expect(declared.chords.map((chord) => chord.displayStartMs)).toEqual(
      bare.chords.map((chord) => chord.displayStartMs),
    );
  });
});

describe('isTernaryBeat', () => {
  it('reads an even triplet as ternary', () => {
    expect(isTernaryBeat([0, 1 / 3, 2 / 3])).toBe(true);
  });

  it('does not read straight sixteenths as ternary', () => {
    expect(isTernaryBeat([0, 0.25, 0.5, 0.75])).toBe(false);
  });

  it('does not read a run of 32nds or 64ths as ternary', () => {
    // The divisions read only as far as quarters of the beat, so a run finer
    // than that fits neither grid well; the absolute bound is what rejects it
    // rather than letting ternary win by being the less bad of two.
    const run = (count: number): number[] => Array.from({ length: count }, (_, i) => i / count);
    expect(isTernaryBeat(run(8))).toBe(false); // 32nds through a quarter beat
    expect(isTernaryBeat(run(16))).toBe(false); // 64ths
  });

  it('does not read straight quavers as ternary', () => {
    expect(isTernaryBeat([0, 0.5])).toBe(false);
  });

  it('tells a triplet from a dotted eighth and a sixteenth', () => {
    // The pair that fools a test which only counts notes. A dotted eighth plus
    // a sixteenth sits at 0 and ¾; a triplet at 0, ⅓, ⅔.
    expect(isTernaryBeat([0, 0.75])).toBe(false);
    expect(isTernaryBeat([0, 1 / 3, 2 / 3])).toBe(true);
    // And with a note on each side of the beat, still distinct.
    expect(isTernaryBeat([0, 0.5, 0.75])).toBe(false);
  });

  it('does not read a swung pair as a triplet on two notes alone', () => {
    // Swing lands the offbeat near ⅔, which is exactly a triplet position —
    // but two notes is not enough to claim the beat is in three.
    expect(isTernaryBeat([0, 2 / 3])).toBe(false);
  });

  it('forgives a player who is slightly out', () => {
    expect(isTernaryBeat(jitter([0, 1 / 3, 2 / 3], 0.02))).toBe(true);
    expect(isTernaryBeat(jitter([0, 0.25, 0.5, 0.75], 0.02))).toBe(false);
  });

  it('does not read an evenly spaced run that merely starts late', () => {
    // Four notes a clean quarter-beat apart, displaced from the beat. That is
    // binary spacing, but neither grid anchored at the beat fits it well, so a
    // reading that only had to beat the alternative would take it as ternary.
    // Chopin's ornamental runs are full of these; they are not triplets.
    expect(isTernaryBeat([0.143, 0.393, 0.643, 0.893])).toBe(false);
    // Shifted the other way, and at a coarser spacing, still binary.
    expect(isTernaryBeat([0.09, 0.34, 0.59, 0.84])).toBe(false);
    expect(isTernaryBeat([0.12, 0.62])).toBe(false);
  });

  it('still reads a genuine sextuplet fragment sitting off the downbeat', () => {
    // The true positives in the same piece: onsets on sixths of the beat.
    expect(isTernaryBeat([0, 0.5, 2 / 3, 5 / 6])).toBe(true);
  });

  it('refuses to guess at playing too loose to read either way', () => {
    // Halfway between every division of both kinds: no reading is evidence.
    expect(isTernaryBeat([0, 0.19, 0.42])).toBe(false);
  });

  it('says nothing about a beat with too little in it', () => {
    expect(isTernaryBeat([])).toBe(false);
    expect(isTernaryBeat([0])).toBe(false);
    expect(isTernaryBeat([1 / 3])).toBe(false);
  });

  it('reads a sextuplet as ternary', () => {
    const sixths = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
    expect(isTernaryBeat(sixths)).toBe(true);
  });

  it('lets a sparse fragment join a figure it is slightly out of', () => {
    // Detection and inheritance answer different questions. Whether a triplet
    // exists at all must be judged strictly, on these onsets alone. Whether a
    // hand holding one or two notes belongs to the triplet already found next
    // door is a laxer question, because the triplet has already been evidenced
    // — and at 120bpm the stricter bound would reject a note twenty
    // milliseconds out and write it on the binary grid instead.
    const slightlyOut = [0.04];
    expect(isTernaryBeat(slightlyOut)).toBe(false); // far too little to claim one
    expect(fitsDivision(slightlyOut, 3)).toBe(true); // but it belongs to one

    // What inheritance must still refuse: two straight eighths under triplets.
    expect(fitsDivision([0, 0.5], 3)).toBe(false);
  });

  it('does not care what order the onsets arrive in', () => {
    expect(isTernaryBeat([0, 2 / 3, 1 / 3])).toBe(true);
  });

  it('leaves a triplet with a note missing alone', () => {
    // Two onsets on thirds is a swung pair as much as a gapped triplet, and
    // there is nothing to tell them apart; binary is the safer reading.
    expect(isTernaryBeat([0, 2 / 3])).toBe(false);
  });
});

describe('against the bundled repertoire', () => {
  /** Onsets grouped per staff per beat, the way the layout will group them. */
  function ternaryBeatsIn(def: LibraryTrackDef): { ternary: number; total: number } {
    const take = buildLibraryTake(def);
    const map = createTakeTempoMap(take.tempo);
    const byBeat = new Map<string, number[]>();
    for (const note of take.notes) {
      const staff = note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
      const beat = map.beatAtMs(note.startMs);
      const whole = Math.floor(beat + 1e-9);
      const offset = beat - whole;
      const key = `${staff}|${whole}`;
      const list = byBeat.get(key) ?? [];
      if (!list.some((seen) => Math.abs(seen - offset) < 1e-6)) list.push(offset);
      byBeat.set(key, list);
    }
    let ternary = 0;
    for (const offsets of byBeat.values()) if (isTernaryBeat(offsets)) ternary += 1;
    return { ternary, total: byBeat.size };
  }

  it('finds the triplets in the one piece built on them', () => {
    // Moonlight's whole texture is triplet arpeggios, across both hands.
    const { ternary, total } = ternaryBeatsIn(MOONLIGHT_SONATA);
    expect(ternary).toBeGreaterThan(total * 0.5);
  });

  it('finds none in music that is straight', () => {
    // The cost of a false positive is a wrong rhythm on the page, so these
    // have to come back at exactly zero, not merely low.
    for (const def of [FUR_ELISE, A_BEAUTIFUL_DAY, GOOD_NIGHT, EVENING_TIDE]) {
      expect(ternaryBeatsIn(def).ternary).toBe(0);
    }
  });
});

describe('laying a tuplet out', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  /** `count` even notes filling each of `beats` beats, in one hand. */
  function evenly(count: number, beats: number, midi = 72): NoteEvent[] {
    const notes: NoteEvent[] = [];
    for (let beat = 0; beat < beats; beat += 1) {
      for (let k = 0; k < count; k += 1) {
        notes.push({
          id: `b${beat}k${k}`,
          midi,
          startMs: Math.round(beat * 500 + (k * 500) / count),
          durationMs: Math.round(400 / count),
          velocity: 0.5,
        });
      }
    }
    return notes;
  }

  it('writes triplets in one hand as beamed threes with a numeral', () => {
    const layout = layoutScore(evenly(3, 4), OPTS);
    expect(layout.chords.every((chord) => chord.symbol.tuplet)).toBe(true);
    expect(layout.chords.every((chord) => chord.symbol.base === 'eighth')).toBe(true);
    expect(layout.beams.map((beam) => [beam.members.length, beam.tupletCount])).toEqual([
      [3, 3],
      [3, 3],
      [3, 3],
      [3, 3],
    ]);
  });

  it('leaves straight sixteenths entirely alone', () => {
    const layout = layoutScore(evenly(4, 4), OPTS);
    expect(layout.chords.some((chord) => chord.symbol.tuplet)).toBe(false);
    expect(layout.beams.every((beam) => beam.tupletCount === null)).toBe(true);
  });

  it('makes a bar of triplets add up, rests and all', () => {
    // Three of the four beats played, the last silent: the rests filling it
    // have to be triplet rests too, or the bar comes out short.
    const layout = layoutScore(evenly(3, 3), OPTS);
    const written = (symbol: {
      base: string;
      dotted: boolean;
      tuplet?: { actual: number; normal: number };
    }): number => {
      const base = { whole: 96, half: 48, quarter: 24, eighth: 12, sixteenth: 6 }[symbol.base]!;
      const dotted = base * (symbol.dotted ? 1.5 : 1);
      return symbol.tuplet ? (dotted * symbol.tuplet.normal) / symbol.tuplet.actual : dotted;
    };
    const inBar = (ms: number): boolean => ms < 2000;
    const filled =
      layout.chords
        .filter((c) => c.staff === 'treble' && inBar(c.displayStartMs))
        .reduce((sum, c) => sum + written(c.symbol), 0) +
      layout.rests
        .filter((r) => r.staff === 'treble' && inBar(r.displayStartMs))
        .reduce((sum, r) => sum + written(r.symbol), 0);
    expect(filled).toBe(96); // one 4/4 bar in ninety-sixths
  });

  it('does not number a tuplet the hands have split between them', () => {
    // An arpeggio crossing middle C leaves a fragment on each staff. Two
    // thirds of a triplet numbered "2" would name a duplet — a different
    // rhythm — so a fragment carries no numeral at all.
    const notes: NoteEvent[] = [];
    for (let beat = 0; beat < 4; beat += 1) {
      for (let k = 0; k < 3; k += 1) {
        notes.push({
          id: `s${beat}${k}`,
          midi: k === 0 ? 52 : 72, // the lowest of each triplet falls to the bass
          startMs: Math.round(beat * 500 + (k * 500) / 3),
          durationMs: 130,
          velocity: 0.5,
        });
      }
    }
    const layout = layoutScore(notes, OPTS);
    // Both hands still agree the beat is in three...
    expect(layout.chords.every((chord) => chord.symbol.tuplet)).toBe(true);
    // ...but neither holds a whole one, so neither is numbered.
    expect(layout.beams.every((beam) => beam.tupletCount === null)).toBe(true);
  });
});

describe('octave lines', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  function run(midis: number[]): NoteEvent[] {
    return midis.map((midi, i) => ({
      id: `n${i}`,
      midi,
      startMs: i * 500,
      durationMs: 400,
      velocity: 0.5,
    }));
  }

  it('draws a passage far above the treble an octave in', () => {
    // Six notes around C7, which would otherwise need four ledger lines each.
    const high = [96, 98, 100, 101, 103, 96];
    const layout = layoutScore(run(high), OPTS);
    expect(layout.octaves).toHaveLength(1);
    expect(layout.octaves[0]!.up).toBe(true);
    expect(layout.octaves[0]!.staff).toBe('treble');

    // Every head has come in by an octave, and its ledger lines with it.
    const plain = layoutScore(run([96]), OPTS);
    const shifted = layout.chords[0]!.notes[0]!;
    expect(shifted.step).toBe(plain.chords[0]!.notes[0]!.step - 7);
    expect(shifted.ledger.length).toBeLessThan(plain.chords[0]!.notes[0]!.ledger.length);
  });

  it('draws a passage far below the bass an octave in', () => {
    const low = [28, 26, 24, 23, 21, 28];
    const layout = layoutScore(run(low), OPTS);
    expect(layout.octaves).toHaveLength(1);
    expect(layout.octaves[0]!.up).toBe(false);
    expect(layout.octaves[0]!.staff).toBe('bass');
  });

  it('does not draw a line over one stray note', () => {
    // A single leap up costs a reader less than a line and a label would.
    const layout = layoutScore(run([72, 74, 100, 74, 72]), OPTS);
    expect(layout.octaves).toEqual([]);
  });

  it('leaves music inside the staves entirely alone', () => {
    const layout = layoutScore(run([60, 62, 64, 65, 67, 69]), OPTS);
    expect(layout.octaves).toEqual([]);
  });
});

describe('octave lines on paper', () => {
  const SHEET_OPTS = {
    paper: 'a4' as const,
    timeSignature: { numerator: 4, denominator: 4 },
    bpm: 120,
    title: 'T',
    subtitle: '',
    credit: 'C',
  };

  it('runs the line over the passage and reserves room for it', () => {
    const notes: NoteEvent[] = [96, 98, 100, 101, 103, 96].map((midi, i) => ({
      id: `n${i}`,
      midi,
      startMs: i * 500,
      durationMs: 400,
      velocity: 0.5,
    }));
    const score = layoutScore(notes, {
      bpm: 120,
      timeSignature: SHEET_OPTS.timeSignature,
      quantization: '1/16',
      minMeasures: 1,
    });
    const result = layoutSheet(score, SHEET_OPTS);
    const system = result.pages[0]!.systems[0]!;
    expect(system.octaves).toHaveLength(1);
    const octave = system.octaves[0]!;
    expect(octave.up).toBe(true);
    expect(octave.x2Pt).toBeGreaterThan(octave.x1Pt);
    expect(octave.continuesLeft).toBe(false);
    expect(octave.continuesRight).toBe(false);

    // The system opens up above the treble staff to carry it.
    const plain = layoutSheet(
      layoutScore(
        notes.map((note) => ({ ...note, midi: note.midi - 24 })),
        {
          bpm: 120,
          timeSignature: SHEET_OPTS.timeSignature,
          quantization: '1/16',
          minMeasures: 1,
        },
      ),
      SHEET_OPTS,
    );
    expect(plain.pages[0]!.systems[0]!.octaves).toEqual([]);
  });
});

describe('three against two', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  /** Triplets in the right hand against straight eighths in the left. */
  function polyrhythm(): NoteEvent[] {
    const notes: NoteEvent[] = [];
    let i = 0;
    for (let beat = 0; beat < 4; beat += 1) {
      const at = beat * 500;
      for (let k = 0; k < 3; k += 1) {
        notes.push({
          id: `t${i++}`,
          midi: 72,
          startMs: Math.round(at + (k * 500) / 3),
          durationMs: 150,
          velocity: 0.5,
        });
      }
      for (let k = 0; k < 2; k += 1) {
        notes.push({
          id: `b${i++}`,
          midi: 48,
          startMs: at + k * 250,
          durationMs: 230,
          velocity: 0.5,
        });
      }
    }
    return notes;
  }

  it('leaves the binary hand playing straight eighths', () => {
    // The left hand has only two onsets a beat — too few to claim a division,
    // but plenty to rule one out. Dragged into the right hand's triplets, its
    // offbeat would move from halfway through the beat to two thirds.
    const layout = layoutScore(polyrhythm(), OPTS);
    const bass = layout.chords.filter((chord) => chord.staff === 'bass');
    expect(bass).toHaveLength(8);
    expect(bass.every((chord) => chord.symbol.tuplet === undefined)).toBe(true);
    expect(bass.every((chord) => chord.symbol.base === 'eighth')).toBe(true);
    // And it still lands on the half-beat, not on a third of one.
    expect(bass.map((chord) => chord.displayStartMs)).toEqual([
      0, 250, 500, 750, 1000, 1250, 1500, 1750,
    ]);
  });

  it('still reads the triplet hand as triplets', () => {
    const layout = layoutScore(polyrhythm(), OPTS);
    const treble = layout.chords.filter((chord) => chord.staff === 'treble');
    expect(treble.every((chord) => chord.symbol.tuplet)).toBe(true);
  });
});

describe('octave spans in time order', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  it('orders an early bass passage before a later treble one', () => {
    // The live score walks these and stops at the first past the view, so a
    // late treble line sorted ahead of an early bass one would hide the bass
    // line while its notes stayed shifted.
    const notes: NoteEvent[] = [];
    let i = 0;
    for (let k = 0; k < 6; k += 1) {
      notes.push({
        id: `low${i++}`,
        midi: 26 + k,
        startMs: k * 500,
        durationMs: 400,
        velocity: 0.5,
      });
    }
    for (let k = 0; k < 6; k += 1) {
      notes.push({
        id: `high${i++}`,
        midi: 96 + k,
        startMs: 6000 + k * 500,
        durationMs: 400,
        velocity: 0.5,
      });
    }
    const layout = layoutScore(notes, OPTS);
    expect(layout.octaves).toHaveLength(2);
    expect(layout.octaves.map((span) => span.staff)).toEqual(['bass', 'treble']);
    for (let k = 1; k < layout.octaves.length; k += 1) {
      expect(layout.octaves[k]!.fromMs).toBeGreaterThanOrEqual(layout.octaves[k - 1]!.fromMs);
    }
  });
});

describe('tuplet lengths a symbol cannot state', () => {
  const OPTS = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    quantization: '1/16' as const,
  };

  it('never writes a tuplet longer than it was played', () => {
    // Triplet eighths, one of them held five slots — a length no single value
    // states. Rounded up to six it would overfill the beat, and a tuplet is
    // never split into tied pieces to make up the difference.
    const notes: NoteEvent[] = [
      { id: 'a', midi: 72, startMs: 0, durationMs: 160, velocity: 0.5 },
      { id: 'b', midi: 74, startMs: 167, durationMs: 160, velocity: 0.5 },
      { id: 'c', midi: 76, startMs: 333, durationMs: 833, velocity: 0.5 }, // five slots
      { id: 'd', midi: 72, startMs: 1500, durationMs: 160, velocity: 0.5 },
      { id: 'e', midi: 74, startMs: 1667, durationMs: 160, velocity: 0.5 },
      { id: 'f', midi: 76, startMs: 1833, durationMs: 160, velocity: 0.5 },
    ];
    const layout = layoutScore(notes, OPTS);
    const held = layout.chords.find((chord) => chord.notes[0]!.id === 'c');
    expect(held).toBeDefined();
    // Said in note values rather than raw counts, so it stays true whatever the
    // unit the layout counts in: five triplet-eighth slots, and no more.
    const units = (symbol: DurationSymbol): number => beatsForSymbol(symbol, UNITS_PER_WHOLE);
    const slot = units({ base: 'eighth', dotted: false, tuplet: TRIPLET });
    expect(units(held!.symbol)).toBeLessThanOrEqual(5 * slot);
  });
});
