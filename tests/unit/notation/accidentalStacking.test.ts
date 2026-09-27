import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import {
  accidentalSlots,
  assignAccidentalColumns,
  type StackedAccidental,
} from '@/features/notation/accidentalStacking';
import type { AccidentalKind } from '@/features/notation/keySignature';
import { layoutScore } from '@/features/notation/notationLayout';
import { layoutSheet } from '@/features/notation/sheetLayout';

function marked(step: number, accidental: AccidentalKind | null): StackedAccidental {
  return { step, accidental, accidentalColumn: -1 };
}

/** The columns two accidentals get, the upper one given first. */
function columnsOf(upper: AccidentalKind, lower: AccidentalKind, steps: number): [number, number] {
  const top = marked(10, upper);
  const bottom = marked(10 - steps, lower);
  // Handed over in any order: the stacking works top-down whatever it is given.
  assignAccidentalColumns([bottom, top]);
  return [top.accidentalColumn, bottom.accidentalColumn];
}

describe('assignAccidentalColumns', () => {
  // Upper kind, lower kind, the fewest steps apart at which they share a
  // column, from the glyphs' boxes: the lower one's top and the upper one's
  // bottom must fit between their lines.
  it.each([
    ['#', '#', 6], // 1.4 + 1.392 = 2.792 spaces
    ['natural', 'natural', 6], // 1.364 + 1.34 = 2.704
    ['#', 'b', 7], // a flat below a sharp: 1.756 + 1.392 = 3.148
    ['b', 'b', 5], // 1.756 + 0.7 = 2.456
    ['b', '#', 5], // a sharp below a flat: 1.4 + 0.7 = 2.1
    ['x', 'x', 3], // double sharps are a space tall: 0.508 + 0.5
  ] as const)('lets %s over %s share a column from %i steps apart', (upper, lower, steps) => {
    expect(columnsOf(upper, lower, steps)).toEqual([0, 0]);
    expect(columnsOf(upper, lower, steps + 3)).toEqual([0, 0]);
    // One step closer, the lower one moves out a column.
    expect(columnsOf(upper, lower, steps - 1)).toEqual([0, 1]);
  });

  it('works down from the top, so the topmost accidental stands nearest the chord', () => {
    // Three sharps three steps apart: each fouls the next, but the top one and
    // the bottom one clear each other, so they alternate.
    const notes = [marked(3, '#'), marked(9, '#'), marked(6, '#')];
    assignAccidentalColumns(notes);
    expect(notes.map((note) => [note.step, note.accidentalColumn])).toEqual([
      [3, 0],
      [9, 0],
      [6, 1],
    ]);
    // Four, two steps apart, need three columns: the fourth clears the first.
    const four = [marked(8, '#'), marked(6, '#'), marked(4, '#'), marked(2, '#')];
    assignAccidentalColumns(four);
    expect(four.map((note) => note.accidentalColumn)).toEqual([0, 1, 2, 0]);
  });

  it('gives a double flat two column slots, wider as it is than one column', () => {
    expect(accidentalSlots('bb')).toBe(2);
    expect(accidentalSlots('b')).toBe(1);
    // A sharp just under a double flat cannot use either of its slots.
    const doubleFlat = marked(6, 'bb');
    const sharp = marked(4, '#');
    assignAccidentalColumns([doubleFlat, sharp]);
    expect(doubleFlat.accidentalColumn).toBe(0);
    expect(sharp.accidentalColumn).toBe(2);
    // Far enough below, it shares the first.
    const low = marked(0, '#');
    const high = marked(8, 'bb');
    assignAccidentalColumns([high, low]);
    expect([high.accidentalColumn, low.accidentalColumn]).toEqual([0, 0]);
    // And a double flat under a crowded first column starts its two slots
    // after it.
    const upper = marked(6, 'b');
    const lower = marked(4, 'bb');
    assignAccidentalColumns([upper, lower]);
    expect([upper.accidentalColumn, lower.accidentalColumn]).toEqual([0, 1]);
  });

  it('leaves notes without an accidental alone', () => {
    const plain = marked(5, null);
    const sharp = marked(3, '#');
    assignAccidentalColumns([plain, sharp]);
    expect(plain.accidentalColumn).toBe(-1);
    expect(sharp.accidentalColumn).toBe(0);
  });
});

describe('the layout', () => {
  function note(midi: number, step: 'F' | 'A', startMs = 0): NoteEvent {
    return {
      id: `${step}${midi}`,
      midi,
      startMs,
      durationMs: 1000,
      velocity: 0.6,
      spelling: { step, alter: 1 },
    };
  }

  it("stacks a chord's accidentals by the font's boxes, on screen and on paper alike", () => {
    // F♯5 over A♯4: two sharps five steps apart. The live score used to share
    // a column at five steps; the font's sharps need six.
    const notes = [note(78, 'F'), note(70, 'A')];
    const score = layoutScore(notes, {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
    });
    const live = score.chords.flatMap((chord) => chord.notes);
    // Five steps is too close for two of the font's sharps: the lower moves out.
    expect(live.map((n) => [n.midi, n.accidental, n.accidentalColumn])).toEqual([
      [70, '#', 1],
      [78, '#', 0],
    ]);

    const sheet = layoutSheet(score, {
      paper: 'a4',
      timeSignature: { numerator: 4, denominator: 4 },
      bpm: 60,
      title: 'Sharps',
      subtitle: '',
      credit: 'PoKeyBoard',
    });
    const column = sheet.pages[0]!.systems[0]!.measures[0]!.columns[0]!;
    const printed = column.treble.flatMap((chord) => chord.notes);
    // The sheet takes the layout's columns as they are.
    expect(printed.map((n) => [n.midi, n.accidentalColumn])).toEqual([
      [70, 1],
      [78, 0],
    ]);
  });

  it('gives a double flat two column slots in a chord', () => {
    // B𝄫4 over G♭4, two steps apart: the flat cannot use either of the
    // double flat's slots, so it stands in the third. The old five-step rule
    // put it in the second, under the double flat's own ink.
    const flats: NoteEvent[] = [
      {
        id: 'b',
        midi: 69,
        startMs: 0,
        durationMs: 1000,
        velocity: 0.6,
        spelling: { step: 'B', alter: -2 },
      },
      {
        id: 'g',
        midi: 66,
        startMs: 0,
        durationMs: 1000,
        velocity: 0.6,
        spelling: { step: 'G', alter: -1 },
      },
    ];
    const score = layoutScore(flats, {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
    });
    const live = score.chords.flatMap((chord) => chord.notes);
    expect(live.map((n) => [n.midi, n.accidental, n.accidentalColumn])).toEqual([
      [66, 'b', 2],
      [69, 'bb', 0],
    ]);
  });
});
