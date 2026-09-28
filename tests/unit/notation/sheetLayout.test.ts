import { describe, expect, it } from 'vitest';
import type { NoteEvent, PedalEvent, TempoChange, TimeSignature } from '@/domain/takeTypes';
import { BEAM_SLANT_MAX_G, MIN_BEAM_STEM_G } from '@/features/notation/beamGeometry';
import { dynamicInkG } from '@/features/notation/glyphs/engravingGlyphs';
import { MUSIC_GLYPH_METRICS } from '@/features/notation/glyphs/musicGlyphMetrics';
import { layoutScore, type ScoreLayout } from '@/features/notation/notationLayout';
import {
  ACCIDENTAL_LEAD_G,
  CLEF_CHANGE_W_G,
  HEAD_RX_G,
  PEDAL_HOOK_G,
  PEDAL_ROW_PT,
  SHEET_GAP_PT,
  TEMPO_MARK_BASELINE_PT,
  TEMPO_MARK_SPACE_PT,
  layoutSheet,
  metricsFor,
  normalizePaperSize,
  staffYRel,
  stemXPt,
  type SheetChord,
  type SheetColumn,
  type SheetLayoutOptions,
  type SheetLayoutResult,
  type SheetMeasure,
  type SheetSystem,
} from '@/features/notation/sheetLayout';

const G = SHEET_GAP_PT;

const SHEET_OPTS: SheetLayoutOptions = {
  paper: 'a4',
  timeSignature: { numerator: 4, denominator: 4 },
  bpm: 120,
  title: 'Test Take',
  subtitle: '17 July 2026',
  credit: 'PoKeyBoard',
};

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 60, startMs: 0, durationMs: 500, velocity: 0.5, ...partial };
}

function sheet(
  notes: NoteEvent[],
  overrides: Partial<SheetLayoutOptions> = {},
  tempoChanges?: readonly TempoChange[],
): SheetLayoutResult {
  const options = { ...SHEET_OPTS, ...overrides };
  const score = layoutScore(notes, {
    bpm: options.bpm,
    timeSignature: options.timeSignature,
    tempoChanges,
    quantization: '1/16',
    minMeasures: 1,
  });
  return layoutSheet(score, options);
}

function allSystems(result: SheetLayoutResult): SheetSystem[] {
  return result.pages.flatMap((page) => page.systems);
}

function allMeasures(result: SheetLayoutResult): SheetMeasure[] {
  return allSystems(result).flatMap((system) => system.measures);
}

function staffChords(
  measure: SheetMeasure,
  staff: 'treble' | 'bass',
): { column: SheetColumn; chord: SheetChord }[] {
  const out: { column: SheetColumn; chord: SheetChord }[] = [];
  for (const column of measure.columns) {
    for (const chord of staff === 'treble' ? column.treble : column.bass) {
      out.push({ column, chord });
    }
  }
  return out;
}

/** m measures of four quarter notes each (E5 so everything stays treble). */
function quarterMeasures(count: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let m = 0; m < count; m += 1) {
    for (let b = 0; b < 4; b += 1) {
      notes.push(
        note({ id: `m${m}b${b}`, midi: 76, startMs: m * 2000 + b * 500, durationMs: 500 }),
      );
    }
  }
  return notes;
}

describe('metricsFor', () => {
  it('returns exact page dimensions per paper size', () => {
    const a4 = metricsFor('a4');
    expect(a4.pageWidthPt).toBeCloseTo(595.28);
    expect(a4.pageHeightPt).toBeCloseTo(841.89);
    expect(a4.contentWidthPt).toBeCloseTo(595.28 - 80);
    const letter = metricsFor('letter');
    expect(letter.pageWidthPt).toBe(612);
    expect(letter.pageHeightPt).toBe(792);
    expect(letter.contentWidthPt).toBe(612 - 80);
  });

  it('falls back to A4 for an unknown or corrupt paper size', () => {
    // A restored/corrupt setting can carry any string; it must not throw.
    const metrics = metricsFor('legal' as unknown as 'a4');
    expect(metrics.paper).toBe('a4');
    expect(metrics.pageWidthPt).toBeCloseTo(595.28);
    expect(normalizePaperSize('legal')).toBe('a4');
    expect(normalizePaperSize(undefined)).toBe('a4');
    expect(normalizePaperSize('letter')).toBe('letter');
  });
});

describe('layoutSheet', () => {
  it('lays out a single note on one titled page', () => {
    const result = sheet([note({ midi: 60, durationMs: 1900 })]);
    expect(result.measureCount).toBe(1);
    expect(result.pages).toHaveLength(1);

    const page = result.pages[0]!;
    expect(page.titleBlock).toEqual({
      title: 'Test Take',
      subtitle: '17 July 2026',
      bpm: 120,
      credit: 'PoKeyBoard',
    });
    expect(page.systems).toHaveLength(1);

    const system = page.systems[0]!;
    expect(system.showTimeSignature).toBe(true);
    expect(system.isLast).toBe(true);
    expect(system.firstMeasureNumber).toBe(1);
    expect(system.trebleTopPt).toBeGreaterThanOrEqual(
      page.metrics.marginTopPt + page.metrics.titleBlockHeightPt,
    );

    const column = system.measures[0]!.columns[0]!;
    const contentStart =
      page.metrics.marginLeftPt + page.metrics.clefAreaPt + page.metrics.timeSigAreaPt;
    expect(column.xPt).toBeGreaterThan(contentStart);
    expect(column.xPt).toBeLessThan(page.metrics.pageWidthPt - page.metrics.marginRightPt);
  });

  it('justifies every non-final system to the full content width', () => {
    const result = sheet(quarterMeasures(40));
    const systems = allSystems(result);
    expect(systems.length).toBeGreaterThan(3);
    const { contentWidthPt } = metricsFor('a4');
    for (const system of systems) {
      if (system.isLast) {
        expect(system.widthPt).toBeLessThanOrEqual(contentWidthPt + 0.5);
      } else {
        expect(Math.abs(system.widthPt - contentWidthPt)).toBeLessThan(0.5);
      }
    }
  });

  it('keeps measure numbers continuous across systems and pages', () => {
    const result = sheet(quarterMeasures(40));
    expect(result.pages.length).toBeGreaterThan(1);
    const measures = allMeasures(result);
    expect(measures.map((m) => m.index)).toEqual(measures.map((_, i) => i));
    let expected = 1;
    for (const system of allSystems(result)) {
      expect(system.firstMeasureNumber).toBe(expected);
      expected += system.measures.length;
    }
    expect(allSystems(result).filter((s) => s.showTimeSignature)).toHaveLength(1);
  });

  it('omits the title block after page 1 and keeps systems inside margins', () => {
    const result = sheet(quarterMeasures(40));
    const metrics = metricsFor('a4');
    for (const page of result.pages) {
      expect(page.titleBlock === null).toBe(page.pageNumber !== 1);
      for (const system of page.systems) {
        expect(system.trebleTopPt).toBeGreaterThanOrEqual(metrics.marginTopPt);
        expect(system.bassTopPt + metrics.staffHeightPt).toBeLessThanOrEqual(
          metrics.pageHeightPt - metrics.marginBottomPt - metrics.footerHeightPt,
        );
      }
    }
  });

  it('reserves extra lead for columns carrying an accidental', () => {
    const plain = sheet([
      note({ id: 'a', midi: 76, startMs: 0 }),
      note({ id: 'b', midi: 77, startMs: 500 }), // F5
    ]);
    const sharp = sheet([
      note({ id: 'a', midi: 76, startMs: 0 }),
      note({ id: 'b', midi: 78, startMs: 500 }), // F#5
    ]);
    const gap = (result: SheetLayoutResult): number => {
      const columns = allMeasures(result)[0]!.columns;
      return columns[1]!.xPt - columns[0]!.xPt;
    };
    expect(gap(sharp) - gap(plain)).toBeGreaterThanOrEqual(ACCIDENTAL_LEAD_G * G - 1e-6);
  });

  it('gives empty measures a compact width and keeps the empty flag', () => {
    const result = sheet([
      note({ id: 'a', startMs: 0, durationMs: 1900 }),
      note({ id: 'b', startMs: 8000, durationMs: 1900 }),
    ]);
    const measures = allMeasures(result);
    expect(measures).toHaveLength(5);
    expect(measures.slice(1, 4).every((m) => m.empty)).toBe(true);
    expect(measures[0]!.empty).toBe(false);
    const stretchSafeMax = Math.max(measures[0]!.widthPt, measures[4]!.widthPt);
    for (const empty of measures.slice(1, 4)) {
      expect(empty.widthPt).toBeLessThanOrEqual(stretchSafeMax);
      expect(empty.columns).toHaveLength(0);
    }
  });

  describe('beaming', () => {
    it('beams four eighths in 4/4 as one half-bar group', () => {
      const result = sheet([
        note({ id: 'a', midi: 76, startMs: 0, durationMs: 250 }),
        note({ id: 'b', midi: 76, startMs: 250, durationMs: 250 }),
        note({ id: 'c', midi: 76, startMs: 500, durationMs: 250 }),
        note({ id: 'd', midi: 76, startMs: 750, durationMs: 250 }),
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(1);
      expect(measure.beams[0]!.beamCount).toBe(1);
      expect(measure.beams[0]!.stemXsPt).toHaveLength(4);
      const chords = staffChords(measure, 'treble');
      expect(chords.map(({ chord }) => chord.beamId)).toEqual([0, 0, 0, 0]);
    });

    it('double-beams a sixteenth run inside one beat', () => {
      const result = sheet(
        [0, 125, 250, 375].map((startMs, i) =>
          note({ id: `s${i}`, midi: 76, startMs, durationMs: 125 }),
        ),
      );
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(1);
      expect(measure.beams[0]!.beamCount).toBe(2);
      expect(staffChords(measure, 'treble').every(({ chord }) => chord.beamId === 0)).toBe(true);
    });

    it('beams mixed and dotted values, the extra beam a stub on the note that has it', () => {
      // An eighth and a sixteenth: one beam over both, and the sixteenth's
      // second beam a stub pointing back into the pair.
      const mixed = allMeasures(
        sheet([
          note({ id: 'a', midi: 76, startMs: 0, durationMs: 250 }),
          note({ id: 'b', midi: 76, startMs: 250, durationMs: 125 }),
        ]),
      )[0]!;
      expect(mixed.beams).toHaveLength(1);
      expect(mixed.beams[0]!.beamCount).toBe(2);
      expect(mixed.beams[0]!.secondary).toEqual([[{ from: 1, to: 1, stub: -1 }]]);

      // A dotted eighth and its sixteenth, the commonest dotted figure there is.
      const dotted = allMeasures(
        sheet([
          note({ id: 'a', midi: 76, startMs: 0, durationMs: 375 }),
          note({ id: 'b', midi: 76, startMs: 375, durationMs: 125 }),
        ]),
      )[0]!;
      expect(dotted.beams).toHaveLength(1);
      expect(dotted.beams[0]!.secondary).toEqual([[{ from: 1, to: 1, stub: -1 }]]);
    });

    it('splits runs at beat boundaries', () => {
      const result = sheet([
        note({ id: 'a', midi: 76, startMs: 250, durationMs: 250 }),
        note({ id: 'b', midi: 76, startMs: 500, durationMs: 250 }),
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(0);
      expect(staffChords(measure, 'treble').every(({ chord }) => chord.beamId === null)).toBe(true);
    });

    it('groups per dotted beat in compound 6/8 meter', () => {
      const timeSignature: TimeSignature = { numerator: 6, denominator: 8 };
      const result = sheet(
        [0, 250, 500].map((startMs, i) =>
          note({ id: `e${i}`, midi: 76, startMs, durationMs: 250 }),
        ),
        { timeSignature },
      );
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(1);
      const chords = staffChords(measure, 'treble');
      expect(chords).toHaveLength(3);
      expect(chords.every(({ chord }) => chord.beamId === 0)).toBe(true);
    });

    it('forces the majority stem direction onto all members', () => {
      const result = sheet([
        note({ id: 'a', midi: 76, startMs: 0, durationMs: 250 }), // E5, stem down
        note({ id: 'b', midi: 67, startMs: 250, durationMs: 250 }), // G4, stem up
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(1);
      expect(measure.beams[0]!.stemDown).toBe(true); // tie → down
      expect(staffChords(measure, 'treble').every(({ chord }) => chord.stemDown)).toBe(true);
    });

    it('beams each voice of a staff on its own', () => {
      // A half note held over four eighths in the same hand: the eighths beam
      // as one half-bar group and the held note takes no part in it.
      const result = sheet([
        note({ id: 'held', midi: 79, startMs: 0, durationMs: 1000, voice: 0 }),
        ...[0, 250, 500, 750].map((startMs, i) =>
          note({ id: `e${i}`, midi: 64, startMs, durationMs: 250, voice: 1 }),
        ),
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(1);
      const chords = staffChords(measure, 'treble');
      // The first column carries both voices; the rest carry only the eighths.
      expect(chords.map(({ chord }) => [chord.voice, chord.beamId])).toEqual([
        [0, null],
        [1, 0],
        [1, 0],
        [1, 0],
        [1, 0],
      ]);
      // The held note keeps its own value rather than absorbing the eighths.
      expect(chords[0]!.chord.symbol).toEqual({ base: 'half', dotted: false });
      // Outer voices stem apart and stay that way, beat 2 included, even
      // though the eighths there are the only thing struck on the staff.
      expect(chords[0]!.chord.stemDown).toBe(false);
      expect(measure.beams.every((beam) => beam.stemDown)).toBe(true);
    });

    it('carries notehead displacement through to the drawn column', () => {
      // Two voices in unison: one head keeps the column, the other clears it,
      // so the half note's hollow head is not painted over by the eighth.
      const result = sheet([
        note({ id: 'held', midi: 72, startMs: 0, durationMs: 1000, voice: 0 }),
        note({ id: 'run', midi: 72, startMs: 0, durationMs: 250, voice: 1 }),
      ]);
      const column = allMeasures(result)[0]!.columns[0]!;
      expect(column.treble.map((c) => [c.symbol.base, c.notes[0]!.headShift])).toEqual([
        ['half', 1],
        ['eighth', 0],
      ]);
      // Both chords still share one column, so the stems stay a head apart and
      // the beams built from them are untouched.
      expect(
        column.treble.every((c) => c.notes[0]!.step === column.treble[0]!.notes[0]!.step),
      ).toBe(true);
    });

    it('places a chord’s seconds again when the beam turns its stem around', () => {
      // C4+D4 on its own stems up, so D moves right. The high E5 that follows
      // pulls the beam's majority the other way, and the pair has to be laid
      // out again against the new stem or its heads sit on the wrong side.
      const result = sheet([
        note({ id: 'c', midi: 60, startMs: 0, durationMs: 250 }),
        note({ id: 'd', midi: 62, startMs: 0, durationMs: 250 }),
        note({ id: 'e', midi: 88, startMs: 250, durationMs: 250 }),
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(1);
      expect(measure.beams[0]!.stemDown).toBe(true);
      const chord = measure.columns[0]!.treble[0]!;
      expect(chord.stemDown).toBe(true);
      // Stem down means the lower head is the one that steps aside, to the left.
      expect(chord.notes.map((n) => [n.midi, n.headShift])).toEqual([
        [60, -1],
        [62, 0],
      ]);
    });

    it('breaks a derived voice out of its beam where the voices meet', () => {
      // The same music from a source with no voice numbers. Voices are then
      // only a pitch rank within each column, so the eighth that shares a
      // column with the held note ranks second and cannot beam to the rest.
      const result = sheet([
        note({ id: 'held', midi: 79, startMs: 0, durationMs: 1000 }),
        ...[0, 250, 500, 750].map((startMs, i) =>
          note({ id: `e${i}`, midi: 64, startMs, durationMs: 250 }),
        ),
      ]);
      const measure = allMeasures(result)[0]!;
      const chords = staffChords(measure, 'treble');
      expect(chords.map(({ chord }) => [chord.voice, chord.beamId])).toEqual([
        [0, null], // the half note
        [1, null], // its column-mate, ranked below it
        [0, null], // alone in its beat, so nothing to beam to
        [0, 0],
        [0, 0],
      ]);
      // Every note still keeps its own written value, which is the point.
      expect(chords.map(({ chord }) => chord.symbol.base)).toEqual([
        'half',
        'eighth',
        'eighth',
        'eighth',
        'eighth',
      ]);
    });

    it('clamps beam slant and keeps every stem at minimum length', () => {
      const result = sheet([
        note({ id: 'a', midi: 84, startMs: 0, durationMs: 250 }), // C6
        note({ id: 'b', midi: 67, startMs: 250, durationMs: 250 }), // G4
      ]);
      const measure = allMeasures(result)[0]!;
      const beam = measure.beams[0]!;
      expect(Math.abs(beam.y2Pt - beam.y1Pt)).toBeLessThanOrEqual(BEAM_SLANT_MAX_G * G + 1e-6);

      const system = allSystems(result)[0]!;
      const staffTop = system.trebleTopPt;
      const dir = beam.stemDown ? 1 : -1;
      for (const { column, chord } of staffChords(measure, 'treble')) {
        const anchorNote = chord.stemDown ? chord.notes[0]! : chord.notes[chord.notes.length - 1]!;
        const anchorY = staffTop + staffYRel(anchorNote.step);
        const stemX = stemXPt(column.xPt, chord.stemDown);
        const lineY =
          beam.y1Pt + ((stemX - beam.x1Pt) / (beam.x2Pt - beam.x1Pt)) * (beam.y2Pt - beam.y1Pt);
        expect((lineY - anchorY) * dir).toBeGreaterThanOrEqual(MIN_BEAM_STEM_G * G - 1e-6);
      }
    });
  });

  it('lowers a system to make room for high ledger notes', () => {
    const plain = sheet([note({ midi: 72, durationMs: 1900 })]);
    const high = sheet([note({ midi: 108, durationMs: 1900 })]); // C8
    const trebleTop = (result: SheetLayoutResult): number => allSystems(result)[0]!.trebleTopPt;
    expect(trebleTop(high)).toBeGreaterThan(trebleTop(plain) + 3 * G);
  });

  it('is deterministic for identical input', () => {
    const notes = quarterMeasures(12);
    expect(sheet(notes)).toEqual(sheet(notes));
  });

  describe('tempo changes', () => {
    const CHANGES: TempoChange[] = [{ atMs: 2000, bpm: 240 }];

    it('marks the tempo once, on the measure where it takes over', () => {
      const result = sheet(
        [
          note({ id: 'a', startMs: 0, durationMs: 1900 }),
          note({ id: 'b', startMs: 2000, durationMs: 900 }),
        ],
        {},
        CHANGES,
      );
      const measures = allMeasures(result);
      expect(measures.map((measure) => measure.bpm)).toEqual([120, 240]);
      expect(measures.map((measure) => measure.tempoMarkBpm)).toEqual([null, 240]);
    });

    it('leaves the tempo unmarked when it never changes', () => {
      const measures = allMeasures(sheet(quarterMeasures(3)));
      expect(measures.every((measure) => measure.tempoMarkBpm === null)).toBe(true);
      expect(measures.every((measure) => measure.bpm === 120)).toBe(true);
    });

    it('reserves room above a system carrying a tempo mark', () => {
      const plain = sheet([note({ startMs: 2000, durationMs: 900 })]);
      const marked = sheet([note({ startMs: 2000, durationMs: 900 })], {}, CHANGES);
      expect(allSystems(marked)[0]!.trebleTopPt).toBeGreaterThan(allSystems(plain)[0]!.trebleTopPt);
    });

    it('beams by the local beat, not the opening one', () => {
      // Eight eighths filling the 240 bpm bar: 125 ms each, two half bars of
      // four. Read at the opening 120 bpm they would be sixteenths.
      const notes: NoteEvent[] = [];
      for (let i = 0; i < 8; i += 1) {
        notes.push(note({ id: `e${i}`, startMs: 2000 + i * 125, durationMs: 125 }));
      }
      const measure = allMeasures(sheet(notes, {}, CHANGES))[1]!;
      expect(measure.beams).toHaveLength(2);
      expect(measure.beams.every((beam) => beam.beamCount === 1)).toBe(true);
      expect(staffChords(measure, 'treble')).toHaveLength(8);
    });
  });

  describe('room for an octave line', () => {
    const [, bottom, , top] = MUSIC_GLYPH_METRICS.ottavaAlta.bbox;
    /** How far an octave line's mark reaches either side of it: its label's half-height. */
    const BAND = ((top - bottom) / 2) * 0.7 * G;

    /** Four quarters of one pitch, from `startMs`. */
    function four(midi: number, startMs = 0, extra: Partial<NoteEvent> = {}): NoteEvent[] {
      return [0, 1, 2, 3].map((i) =>
        note({ id: `q${startMs}-${i}`, midi, startMs: startMs + i * 500, ...extra }),
      );
    }

    it.each([
      ['inside the staff', 84],
      ['on the ledger lines of C6', 96],
      ['on the ledger lines of C7', 108],
    ])('reserves the room an 8va needs over notes written %s, and no more', (_, midi) => {
      const system = allSystems(sheet(four(midi)))[0]!;
      const [octave] = system.octaves;
      expect(octave?.up).toBe(true);
      // The first system's room starts under the title block, and the line's band tops it.
      const { marginTopPt, titleBlockHeightPt } = metricsFor('a4');
      expect(octave!.yPt - BAND).toBeCloseTo(marginTopPt + titleBlockHeightPt, 6);
    });

    it('keeps a tempo mark on top of the room, over the line', () => {
      const system = allSystems(
        sheet(
          [note({ id: 'w', midi: 60, durationMs: 2000 }), ...four(96, 2000, { durationMs: 250 })],
          {},
          [{ atMs: 2000, bpm: 240 }],
        ),
      )[0]!;
      const [octave] = system.octaves;
      expect(octave).toBeDefined();
      // Its baseline stands as far over the line's band as it does over the music elsewhere.
      expect(octave!.yPt - BAND - system.tempoMarkBaselinePt).toBeCloseTo(
        TEMPO_MARK_SPACE_PT - TEMPO_MARK_BASELINE_PT,
        6,
      );
    });

    it('reserves the room an 8vb needs under the bass staff, the pedal row under that', () => {
      const score = layoutScore(four(24, 0, { staff: 'bass' }), {
        bpm: 120,
        timeSignature: SHEET_OPTS.timeSignature,
        quantization: '1/16',
        pedals: [
          { atMs: 0, down: true },
          { atMs: 1900, down: false },
        ],
        minMeasures: 1,
      });
      const system = layoutSheet(score, SHEET_OPTS).pages[0]!.systems[0]!;
      const [octave] = system.octaves;
      expect(octave?.up).toBe(false);
      expect(system.pedals).toHaveLength(1);
      const bandBottom = octave!.yPt + BAND;
      // The bracket, hooks and all, half a space clear under the band, and in
      // the row it always takes rather than a row further down.
      expect(system.pedalRowPt - PEDAL_HOOK_G * G - bandBottom).toBeGreaterThanOrEqual(0.5 * G);
      expect(system.pedalRowPt - bandBottom).toBeLessThanOrEqual(PEDAL_ROW_PT);
    });

    it('lays out a system without one exactly as before', () => {
      // The treble's own music and the pedal row decide its room, as they always did.
      const system = allSystems(sheet(four(76)))[0]!;
      const { marginTopPt, titleBlockHeightPt } = metricsFor('a4');
      expect(system.octaves).toEqual([]);
      expect(system.trebleTopPt - (marginTopPt + titleBlockHeightPt)).toBeCloseTo(3 * G, 6);
    });
  });

  describe('marks on the first downbeat of a system', () => {
    // Forty bars of quarters on E5 fill several systems. Raising a few of them
    // to E6 writes those under an 8va without moving a single column, since the
    // spacing reads rhythm and accidentals, never pitch.
    const plain = allSystems(sheet(quarterMeasures(40)));
    /** Where the second and third systems begin. */
    const [second, third] = plain.slice(1, 3).map((system) => system.measures[0]!.startMs) as [
      number,
      number,
    ];

    function raised(fromMs: number, toMs: number): NoteEvent[] {
      return quarterMeasures(40).map((n) =>
        n.startMs >= fromMs && n.startMs <= toMs ? { ...n, midi: 88 } : n,
      );
    }

    function layout(options: { pedals?: PedalEvent[] } = {}): ScoreLayout {
      return layoutScore(quarterMeasures(40), {
        bpm: SHEET_OPTS.bpm,
        timeSignature: SHEET_OPTS.timeSignature,
        quantization: '1/16',
        minMeasures: 1,
        ...options,
      });
    }

    /** The system that begins at `startMs`, and the column on its downbeat. */
    function systemAt(
      result: SheetLayoutResult,
      startMs: number,
    ): { system: SheetSystem; column: SheetColumn } {
      const system = allSystems(result).find((s) => s.measures[0]!.startMs === startMs);
      expect(system, `a system starting at ${startMs}`).toBeDefined();
      const column = system!.measures[0]!.columns[0]!;
      expect(column.timeMs).toBe(startMs);
      return { system: system!, column };
    }

    it('starts an 8va there at its first note, as on any other downbeat', () => {
      // The piece's own first downbeat, and one a system break lands on.
      for (const startMs of [0, second]) {
        const { system, column } = systemAt(sheet(raised(startMs, startMs + 1500)), startMs);
        const [octave] = system.octaves;
        expect(octave?.continuesLeft).toBe(false);
        // The label starts at the head's left edge, not at the bar line.
        expect(octave!.x1Pt).toBeCloseTo(column.xPt - HEAD_RX_G * G, 6);
      }
    });

    it('ends an 8va there past its last note, carried in from the system start', () => {
      const { system, column } = systemAt(sheet(raised(second - 1500, second)), second);
      const [octave] = system.octaves;
      expect(octave).toMatchObject({ continuesLeft: true, continuesRight: false });
      // The line picks up where the system starts, as a carried-over line always has...
      expect(octave!.x1Pt).toBeCloseTo(system.measures[0]!.xPt - HEAD_RX_G * G, 6);
      // ...and hooks past the one note it still has to cover.
      expect(octave!.x2Pt).toBeCloseTo(column.xPt + 2 * HEAD_RX_G * G, 6);
    });

    it('leaves an 8va running on to the next system open, at the end of the staff', () => {
      // One whose last note is the next system's downbeat, and one running on
      // past it: neither stops where this system does.
      for (const [fromMs, toMs] of [
        [second - 1500, second],
        [second - 1000, second + 1000],
      ] as const) {
        const systems = allSystems(sheet(raised(fromMs, toMs)));
        const next = systems.findIndex((system) => system.measures[0]!.startMs === second);
        const system = systems[next - 1]!;
        const [octave] = system.octaves;
        expect(octave).toMatchObject({ continuesLeft: false, continuesRight: true });
        expect(octave!.x2Pt).toBeCloseTo(system.xPt + system.widthPt, 6);
      }
    });

    it('writes a dynamic there under its note, and a hairpin from it clear of the mark', () => {
      const score = layout();
      score.dynamics = [
        { atMs: 0, mark: 'p' },
        { atMs: second, mark: 'f' },
        // A downbeat inside the system, which has always been placed this way.
        { atMs: second + 2000, mark: 'mp' },
      ];
      score.hairpins = [
        { fromMs: second, toMs: second + 1500, grow: false },
        { fromMs: third - 1000, toMs: third + 1000, grow: true },
      ];
      const result = layoutSheet(score, SHEET_OPTS);

      const opening = systemAt(result, 0);
      expect(opening.system.dynamics[0]).toEqual({ xPt: opening.column.xPt, mark: 'p' });

      const { system, column } = systemAt(result, second);
      const next = system.measures[1]!.columns[0]!;
      expect(next.timeMs).toBe(second + 2000);
      expect(system.dynamics).toEqual([
        { xPt: column.xPt, mark: 'f' },
        { xPt: next.xPt, mark: 'mp' },
      ]);
      // The diminuendo sets off from the f's ink where the f stands.
      expect(system.hairpins[0]!.x1Pt).toBeCloseTo(
        column.xPt + (dynamicInkG('f').right + 0.5) * G,
        6,
      );

      // A swell carried over the break opens at the system start.
      const carried = systemAt(result, third).system.hairpins[0]!;
      expect(carried.continuesLeft).toBe(true);
      expect(carried.x1Pt).toBeCloseTo(systemAt(result, third).system.measures[0]!.xPt, 6);
    });

    it('presses the pedal there under its note, and carries a held one in from the system start', () => {
      const result = layoutSheet(
        layout({
          pedals: [
            { atMs: second, down: true },
            { atMs: second + 1900, down: false },
            { atMs: third - 1000, down: true },
            { atMs: third + 1000, down: false },
          ],
        }),
        SHEET_OPTS,
      );
      const pressed = systemAt(result, second);
      expect(pressed.system.pedals[0]!.continuesLeft).toBe(false);
      expect(pressed.system.pedals[0]!.xFromPt).toBeCloseTo(pressed.column.xPt, 6);

      const held = systemAt(result, third).system;
      expect(held.pedals[0]!.continuesLeft).toBe(true);
      expect(held.pedals[0]!.xFromPt).toBeCloseTo(held.measures[0]!.xPt, 6);
    });
  });

  describe('a clef turning over', () => {
    /**
     * Both hands in step, `beats[m]` even notes to bar m: the right hand on E5,
     * the left on C4, which it reads under a G clef from bar index `turn` on and
     * under its own F clef before that (throughout, for `null`).
     */
    function hands(beats: number[], turn: number | null): NoteEvent[] {
      return beats.flatMap((count, m) =>
        Array.from({ length: count }, (_, i) => {
          const startMs = m * 2000 + (i * 2000) / count;
          const durationMs = 2000 / count;
          const clef = turn !== null && m >= turn ? 'treble' : 'bass';
          return [
            note({ id: `r${m}-${i}`, midi: 76, startMs, durationMs }),
            note({ id: `l${m}-${i}`, midi: 60, startMs, durationMs, staff: 'bass', clef }),
          ];
        }).flat(),
      );
    }

    /** Each system's bars, by index. */
    function barsBySystem(result: SheetLayoutResult): number[][] {
      return allSystems(result).map((system) => system.measures.map((measure) => measure.index));
    }

    /** Where every bar line and column stands across the page. */
    function across(result: SheetLayoutResult): number[] {
      return allMeasures(result).flatMap((measure) => [
        measure.xPt,
        measure.widthPt,
        ...measure.columns.map((column) => column.xPt),
      ]);
    }

    /** `turned` breaks where `plain` does, and puts every bar and column where it does. */
    function expectLaidOutAlike(turned: SheetLayoutResult, plain: SheetLayoutResult): void {
      expect(barsBySystem(turned)).toEqual(barsBySystem(plain));
      const expected = across(plain);
      const drift = across(turned).map((x, i) => Math.abs(x - expected[i]!));
      expect(Math.max(...drift)).toBeLessThan(1e-9);
    }

    it('keeps no room after the bar line when a system opens on the turnover', () => {
      // Three bars of quarters to a system; the left hand goes up at bar 4,
      // which opens the second. That system's prefix engraves the new clef, so
      // nothing is set after its first bar line, and no room is left there.
      const beats = [4, 4, 4, 4, 4, 4];
      const turned = sheet(hands(beats, 3));
      const second = allSystems(turned)[1]!;
      expect(second.firstMeasureNumber).toBe(4);
      expect(second.clefs.bass).toBe('treble');
      expect(second.measures[0]!.clefChanges).toEqual([]);
      expectLaidOutAlike(turned, sheet(hands(beats, null)));
    });

    it('fits a system opening on the turnover the bars it would hold without one', () => {
      // Halves from bar 5 on: the second system has room for bar 4 and four
      // bars of halves, but not for those and the room a clef change takes.
      const beats = [4, 4, 4, 4, 2, 2, 2, 2, 2];
      const turned = sheet(hands(beats, 3));
      expect(barsBySystem(turned)).toEqual([[0, 1, 2], [3, 4, 5, 6, 7], [8]]);
      expectLaidOutAlike(turned, sheet(hands(beats, null)));
    });

    it('makes room for the new clef after a bar line inside a system', () => {
      const measures = allMeasures(sheet(hands([4, 4, 4, 4, 4, 4], 4)));
      const plain = measures[3]!;
      const turned = measures[4]!;
      expect(turned.clefChanges).toEqual(['bass']);
      // Bars 4 and 5 share a system, so they stretch alike: the room after the
      // bar line is all that bar 5 has more of, and its music starts that much
      // further in.
      const lead = (measure: SheetMeasure): number => measure.columns[0]!.xPt - measure.xPt;
      expect(lead(turned) - lead(plain)).toBeCloseTo(turned.widthPt - plain.widthPt, 6);
      expect(lead(turned) - lead(plain)).toBeGreaterThanOrEqual(CLEF_CHANGE_W_G * G);
    });
  });

  describe('the end of the piece', () => {
    /** The last measure the layout actually printed. */
    function lastMeasure(result: SheetLayoutResult): SheetMeasure {
      const measures = allMeasures(result);
      return measures[measures.length - 1]!;
    }

    it('closes on the last measure with notes when the take ends on a bar line', () => {
      // Two full 4/4 bars at 120 bpm; the score keeps a third to record into.
      const result = sheet([
        note({ id: 'a', startMs: 0, durationMs: 2000 }),
        note({ id: 'b', startMs: 2000, durationMs: 2000 }),
      ]);
      expect(result.measureCount).toBe(2);
      expect(allMeasures(result)).toHaveLength(2);
      expect(lastMeasure(result).empty).toBe(false);
    });

    it('engraves the bar a final chord rings into, tied', () => {
      // The chord starts in bar 1 and rings halfway through bar 2. A tie
      // carries it over the bar line, so bar 2 owns a real half note rather
      // than being dropped for having no onset of its own.
      const result = sheet([note({ startMs: 0, durationMs: 3000 })]);
      expect(result.measureCount).toBe(2);
      const measures = allMeasures(result);
      expect(measures).toHaveLength(2);
      expect(lastMeasure(result).empty).toBe(false);
      const tail = measures[1]!.columns[0]!.treble[0]!;
      expect(tail.symbol).toEqual({ base: 'half', dotted: false });
      expect(tail.notes[0]!.tiedFromPrev).toBe(true);
    });

    it('keeps a rest bar that falls inside the piece', () => {
      const result = sheet([
        note({ id: 'a', startMs: 0, durationMs: 500 }),
        note({ id: 'b', startMs: 4000, durationMs: 500 }),
      ]);
      expect(allMeasures(result).map((measure) => measure.empty)).toEqual([false, true, false]);
    });

    it('keeps the scaffold of a take with no notes at all', () => {
      const score = layoutScore([], {
        bpm: SHEET_OPTS.bpm,
        timeSignature: SHEET_OPTS.timeSignature,
        quantization: '1/16',
        minMeasures: 4,
      });
      const result = layoutSheet(score, SHEET_OPTS);
      expect(result.measureCount).toBe(4);
      expect(allMeasures(result).every((measure) => measure.empty)).toBe(true);
    });
  });
});
