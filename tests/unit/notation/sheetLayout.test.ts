import { describe, expect, it } from 'vitest';
import type { NoteEvent, TempoChange, TimeSignature } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  ACCIDENTAL_LEAD_G,
  BEAM_SLANT_MAX_G,
  MIN_BEAM_STEM_G,
  SHEET_GAP_PT,
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
    it('beams eighths per beat in 4/4', () => {
      const result = sheet([
        note({ id: 'a', midi: 76, startMs: 0, durationMs: 250 }),
        note({ id: 'b', midi: 76, startMs: 250, durationMs: 250 }),
        note({ id: 'c', midi: 76, startMs: 500, durationMs: 250 }),
        note({ id: 'd', midi: 76, startMs: 750, durationMs: 250 }),
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(2);
      expect(measure.beams.every((beam) => beam.beamCount === 1)).toBe(true);
      const chords = staffChords(measure, 'treble');
      expect(chords.map(({ chord }) => chord.beamId)).toEqual([0, 0, 1, 1]);
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

    it('falls back to flags for mixed or dotted values', () => {
      const mixed = sheet([
        note({ id: 'a', midi: 76, startMs: 0, durationMs: 250 }),
        note({ id: 'b', midi: 76, startMs: 250, durationMs: 125 }),
      ]);
      expect(allMeasures(mixed)[0]!.beams).toHaveLength(0);

      const dotted = sheet([
        note({ id: 'a', midi: 76, startMs: 0, durationMs: 375 }),
        note({ id: 'b', midi: 76, startMs: 375, durationMs: 375 }),
      ]);
      expect(allMeasures(dotted)[0]!.beams).toHaveLength(0);
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
      // per beat as usual and the held note takes no part in it.
      const result = sheet([
        note({ id: 'held', midi: 79, startMs: 0, durationMs: 1000, voice: 0 }),
        ...[0, 250, 500, 750].map((startMs, i) =>
          note({ id: `e${i}`, midi: 64, startMs, durationMs: 250, voice: 1 }),
        ),
      ]);
      const measure = allMeasures(result)[0]!;
      expect(measure.beams).toHaveLength(2);
      const chords = staffChords(measure, 'treble');
      // The first column carries both voices; the rest carry only the eighths.
      expect(chords.map(({ chord }) => [chord.voice, chord.beamId])).toEqual([
        [0, null],
        [1, 0],
        [1, 0],
        [1, 1],
        [1, 1],
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
      // Eight eighths filling the 240 bpm bar: 125 ms each, four beats of two.
      const notes: NoteEvent[] = [];
      for (let i = 0; i < 8; i += 1) {
        notes.push(note({ id: `e${i}`, startMs: 2000 + i * 125, durationMs: 125 }));
      }
      const measure = allMeasures(sheet(notes, {}, CHANGES))[1]!;
      expect(measure.beams).toHaveLength(4);
      expect(staffChords(measure, 'treble')).toHaveLength(8);
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

    it('drops the bar a final chord only rings into', () => {
      // The chord starts in bar 1 and rings halfway through bar 2. With no
      // ties yet, bar 2 owns no onset and would otherwise print as rests.
      const result = sheet([note({ startMs: 0, durationMs: 3000 })]);
      expect(result.measureCount).toBe(1);
      expect(allMeasures(result)).toHaveLength(1);
      expect(lastMeasure(result).empty).toBe(false);
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
