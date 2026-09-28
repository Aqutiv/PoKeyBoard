import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { PdfStandardFonts } from '@/features/export/pdfSurface';
import { defaultKeySignatureFor, layoutTakeSheet } from '@/features/export/sheetPdfService';
import { beginSvgPage } from '@/features/export/svgSurface';
import type { TextRasterizer } from '@/features/export/vectorSurface';
import { loadClassicTake, SCORE_PACK_PATH } from '@/features/library/scoreLoader';
import { dynamicOpticalCentre, DYNAMIC_GLYPHS } from '@/features/notation/glyphs/engravingGlyphs';
import {
  MUSIC_GLYPH_METRICS,
  type MusicGlyphName,
} from '@/features/notation/glyphs/musicGlyphMetrics';
import { signatureSteps } from '@/features/notation/keySignature';
import { layoutScore, type LayoutOptions } from '@/features/notation/notationLayout';
import {
  HEAD_RX_G,
  layoutSheet,
  metricsFor,
  PEDAL_HOOK_G,
  SHEET_GAP_PT,
  staffYRel,
  type SheetBeam,
  type SheetChord,
  type SheetColumn,
  type SheetMeasure,
  type SheetNote,
  type SheetOctave,
  type SheetPage,
  type SheetSystem,
} from '@/features/notation/sheetLayout';
import { drawSheetPage } from '@/features/notation/sheetRenderer';

/**
 * Where the printed sheet puts each music glyph, read back from what it draws:
 * a hand-built page, engraved through the SVG writer, whose `<use>` elements
 * say which glyph went where and at what size, and whose stroked paths are the
 * stems, ledger lines and octave line. Every expectation is the placement rule
 * itself, in staff spaces (G) and the font's own metrics.
 */

const G = SHEET_GAP_PT;
const METRICS = metricsFor('a4');
const TREBLE = 200;
const BASS = 260;
const SYSTEM_X = 40;
/** Where the music starts: past the clefs and a time signature, with no key. */
const MUSIC_X = SYSTEM_X + METRICS.clefAreaPt + METRICS.timeSigAreaPt;

const NO_RASTER: TextRasterizer = {
  measure: () => {
    throw new Error('no text image here');
  },
  rasterize: () => {
    throw new Error('no text image here');
  },
};

function bbox(name: keyof typeof MUSIC_GLYPH_METRICS) {
  const [left, bottom, right, top] = MUSIC_GLYPH_METRICS[name].bbox;
  return { left, bottom, right, top, centre: (left + right) / 2 };
}

function note(step: number, extra: Partial<SheetNote> = {}): SheetNote {
  return {
    midi: 60,
    step,
    accidental: null,
    accidentalColumn: 0,
    ledger: [],
    headShift: 0,
    tiedFromPrev: false,
    tiedToNext: false,
    ...extra,
  };
}

function chord(notes: SheetNote[], extra: Partial<SheetChord> = {}): SheetChord {
  return {
    staff: 'treble',
    clef: 'treble',
    notes,
    voice: 0,
    symbol: { base: 'quarter', dotted: false },
    stemDown: false,
    beamId: null,
    ...extra,
  };
}

function column(xPt: number, parts: Partial<SheetColumn>): SheetColumn {
  return { timeMs: xPt, xPt, treble: [], bass: [], trebleRest: null, bassRest: null, ...parts };
}

function measure(index: number, xPt: number, widthPt: number, parts: Partial<SheetMeasure>) {
  const built: SheetMeasure = {
    index,
    xPt,
    widthPt,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    empty: false,
    columns: [],
    beams: [],
    bpm: 60,
    tempoMarkBpm: null,
    clefs: { treble: 'treble', bass: 'bass' },
    clefChanges: [],
    ...parts,
  };
  return built;
}

function system(measures: SheetMeasure[], parts: Partial<SheetSystem> = {}): SheetSystem {
  return {
    xPt: SYSTEM_X,
    widthPt: 520,
    tempoMarkBaselinePt: TREBLE - 30,
    trebleTopPt: TREBLE,
    bassTopPt: BASS,
    measures,
    ties: [],
    pedals: [],
    pedalRowPt: BASS + 40,
    octaves: [],
    dynamics: [],
    hairpins: [],
    dynamicsRowPt: BASS - 10,
    clefs: { treble: 'treble', bass: 'bass' },
    firstMeasureNumber: 1,
    showTimeSignature: true,
    isLast: false,
    ...parts,
  };
}

interface Use {
  name: string;
  a: number;
  d: number;
  x: number;
  y: number;
}

interface Stroke {
  points: number[];
  width: number;
  dashed: boolean;
}

interface Drawn {
  svg: string;
  uses: Use[];
  strokes: Stroke[];
}

async function engrave(page: SheetPage): Promise<Drawn> {
  const fonts = new PdfStandardFonts(await PDFDocument.create());
  const target = beginSvgPage({
    width: page.metrics.pageWidthPt,
    height: page.metrics.pageHeightPt,
    fonts,
    rasterizer: NO_RASTER,
  });
  drawSheetPage(target.surface, page);
  const svg = target.finish();
  const uses = [
    ...svg.matchAll(/<use href="#(\w+)" transform="matrix\(([^)]*)\)" fill="#000000"\/>/g),
  ].map((match) => {
    const [a, b, c, d, x, y] = match[2]!.split(' ').map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    expect([b, c]).toEqual([0, 0]);
    return { name: match[1]!, a, d, x, y };
  });
  const strokes = [
    ...svg.matchAll(
      /<path d="([^"]*)" fill="none" stroke="#000000" stroke-width="([\d.]+)"([^>]*)\/>/g,
    ),
  ].map((match) => ({
    points: match[1]!.replace(/[MLC]/g, ' ').trim().split(/\s+/).map(Number),
    width: Number(match[2]),
    dashed: match[3]!.includes('stroke-dasharray'),
  }));
  return { svg, uses, strokes };
}

/** Within the 0.01 pt a writer rounds coordinates to. */
function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 0.006;
}

function expectNear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected), `${actual} for ${expected}`).toBeLessThanOrEqual(0.006);
}

function usesOf(drawn: Drawn, name: string): Use[] {
  return drawn.uses.filter((use) => use.name === name);
}

/** The one use of `name` with its origin at (x, y), at a staff space of `space`. */
function expectUse(drawn: Drawn, name: string, x: number, y: number, space = G): void {
  const found = usesOf(drawn, name).filter((use) => near(use.x, x) && near(use.y, y));
  expect(
    found,
    `${name} at (${x.toFixed(2)}, ${y.toFixed(2)}) among ${JSON.stringify(usesOf(drawn, name))}`,
  ).toHaveLength(1);
  const use = found[0]!;
  expect(use.a).toBeCloseTo(space / 250, 5);
  expect(use.d).toBeCloseTo(-space / 250, 5);
}

/** The stroked two-point line from (x1, y1) to (x2, y2). */
function lineAt(drawn: Drawn, x1: number, y1: number, x2: number, y2: number): Stroke | undefined {
  return drawn.strokes.find(
    (stroke) =>
      stroke.points.length === 4 &&
      near(stroke.points[0]!, x1) &&
      near(stroke.points[1]!, y1) &&
      near(stroke.points[2]!, x2) &&
      near(stroke.points[3]!, y2),
  );
}

const y = (top: number, step: number): number => top + staffYRel(step);

// Measure 1 --------------------------------------------------------------
const M1 = MUSIC_X;
/** A dotted chord with a second, two accidentals stacked and a dot each. */
const SECOND_X = M1 + 30;
/** A lone 32nd in each staff: up in the treble, down in the bass. */
const FLAG_X = M1 + 90;
/** A dotted eighth rest. */
const REST_X = M1 + 140;
/** A whole note on a ledger line below the treble. */
const WHOLE_X = M1 + 190;
// Measure 2 --------------------------------------------------------------
const M2 = M1 + 230;
/** Two beamed runs: a twelve-tuplet up in the treble, a triplet down in the bass. */
const BEAM_XS = [M2 + 40, M2 + 90];

const upStemX = (x: number): number => x + 0.53 * G;
const downStemX = (x: number): number => x - 0.53 * G;

const trebleBeam: SheetBeam = {
  staff: 'treble',
  stemDown: false,
  beamCount: 1,
  tupletCount: 12,
  x1Pt: upStemX(BEAM_XS[0]!),
  y1Pt: TREBLE - 8,
  x2Pt: upStemX(BEAM_XS[1]!),
  y2Pt: TREBLE - 4,
  stemXsPt: BEAM_XS.map(upStemX),
  secondary: [],
};
const bassBeam: SheetBeam = {
  staff: 'bass',
  stemDown: true,
  beamCount: 1,
  tupletCount: 3,
  x1Pt: downStemX(BEAM_XS[0]!),
  y1Pt: BASS + 30,
  x2Pt: downStemX(BEAM_XS[1]!),
  y2Pt: BASS + 30,
  stemXsPt: BEAM_XS.map(downStemX),
  secondary: [],
};

const eighth = { base: 'eighth', dotted: false } as const;

/** An 8va over bar 2, stood well off the staff, and an 8vb under bar 1. */
const OTTAVA: SheetOctave = {
  staff: 'treble',
  up: true,
  x1Pt: M2 + 20,
  x2Pt: M2 + 200,
  yPt: TREBLE - 40,
  continuesLeft: false,
  continuesRight: false,
};
const OTTAVA_BASSA: SheetOctave = {
  staff: 'bass',
  up: false,
  x1Pt: M1 + 20,
  x2Pt: M1 + 120,
  yPt: BASS + 4 * G + 30,
  continuesLeft: false,
  continuesRight: false,
};

const PAGE: SheetPage = {
  pageNumber: 1,
  metrics: METRICS,
  timeSignature: { numerator: 12, denominator: 8 },
  keySignature: 0,
  titleBlock: null,
  systems: [
    system(
      [
        measure(0, M1, 230, {
          columns: [
            column(SECOND_X, {
              treble: [
                chord(
                  [
                    note(1, { accidental: '#', accidentalColumn: 0 }),
                    note(2, { accidental: 'b', accidentalColumn: 1, headShift: 1 }),
                  ],
                  { symbol: { base: 'quarter', dotted: true } },
                ),
              ],
            }),
            column(FLAG_X, {
              treble: [chord([note(4)], { symbol: { base: '32nd', dotted: false } })],
              bass: [
                chord([note(4)], {
                  staff: 'bass',
                  clef: 'bass',
                  symbol: { base: '32nd', dotted: false },
                  stemDown: true,
                }),
              ],
            }),
            column(REST_X, { trebleRest: { symbol: { base: 'eighth', dotted: true }, step: 4 } }),
            column(WHOLE_X, {
              treble: [
                chord([note(-2, { ledger: [-2] })], { symbol: { base: 'whole', dotted: false } }),
              ],
              // C♮4 on the ledger line above the bass staff.
              bass: [
                chord([note(10, { ledger: [10], accidental: 'natural' })], {
                  staff: 'bass',
                  clef: 'bass',
                  stemDown: true,
                }),
              ],
            }),
          ],
        }),
        measure(1, M2, 230, {
          tempoMarkBpm: 90,
          clefs: { treble: 'treble', bass: 'treble' },
          clefChanges: ['bass'],
          columns: BEAM_XS.map((x) =>
            column(x, {
              treble: [chord([note(4)], { symbol: eighth, beamId: 0 })],
              bass: [
                chord([note(4)], {
                  staff: 'bass',
                  clef: 'treble',
                  symbol: eighth,
                  stemDown: true,
                  beamId: 1,
                }),
              ],
            }),
          ),
          beams: [trebleBeam, bassBeam],
        }),
      ],
      {
        dynamics: [{ xPt: M1 + 60, mark: 'mf' }],
        octaves: [OTTAVA, OTTAVA_BASSA],
      },
    ),
  ],
};

let drawn: Drawn;
beforeAll(async () => {
  drawn = await engrave(PAGE);
});

describe('where the sheet puts its glyphs', () => {
  it('stretches the brace over the whole system at one scale, just left of it', () => {
    const brace = bbox('brace');
    const height = BASS + 4 * G - TREBLE;
    const space = height / (brace.top - brace.bottom);
    const [use] = usesOf(drawn, 'brace');
    expect(use).toBeDefined();
    expect(use!.a).toBeCloseTo(space / 250, 5);
    expect(use!.d).toBeCloseTo(-space / 250, 5);
    // Its right edge 2.5 pt short of the system, its box from staff to staff.
    expectNear(use!.x + brace.right * space, SYSTEM_X - 2.5);
    expectNear(use!.y - brace.top * space, TREBLE);
    expectNear(use!.y - brace.bottom * space, BASS + 4 * G);
  });

  it('sets the clefs on their own lines, and a clef change after its bar line', () => {
    expectUse(drawn, 'gClef', SYSTEM_X + 1.1 * G, TREBLE + 3 * G);
    expectUse(drawn, 'fClef', SYSTEM_X + 1.1 * G, BASS + G);
    // The bass staff turns to a G clef in bar 2: the smaller glyph, on the G line.
    expectUse(drawn, 'gClefChange', M2 + 0.6 * G, BASS + 3 * G);
    expect(usesOf(drawn, 'gClef')).toHaveLength(1);
  });

  it('centres a time signature by the advances of its digits, a row to each half of the staff', () => {
    const x = SYSTEM_X + METRICS.clefAreaPt + METRICS.timeSigAreaPt * 0.4;
    const twelve =
      (MUSIC_GLYPH_METRICS.timeSig1.advance + MUSIC_GLYPH_METRICS.timeSig2.advance) * G;
    for (const top of [TREBLE, BASS]) {
      expectUse(drawn, 'timeSig1', x - twelve / 2, top + G);
      expectUse(
        drawn,
        'timeSig2',
        x - twelve / 2 + MUSIC_GLYPH_METRICS.timeSig1.advance * G,
        top + G,
      );
      expectUse(drawn, 'timeSig8', x - (MUSIC_GLYPH_METRICS.timeSig8.advance * G) / 2, top + 3 * G);
    }
  });

  it('centres noteheads on their column, a second one head less a stem to the side', () => {
    const lowY = y(TREBLE, 1);
    const highY = y(TREBLE, 2);
    expectUse(drawn, 'noteheadBlack', SECOND_X - 0.59 * G, lowY);
    expectUse(drawn, 'noteheadBlack', SECOND_X + 1.06 * G - 0.59 * G, highY);
    expectUse(drawn, 'noteheadWhole', WHOLE_X - 0.844 * G, y(TREBLE, -2));
  });

  it('runs a stem from the far head’s anchor, its outer edge on the head’s edge', () => {
    const stemX = upStemX(SECOND_X);
    const stem = lineAt(drawn, stemX, y(TREBLE, 1) - 0.168 * G, stemX, y(TREBLE, 2) - 3.5 * G);
    expect(stem, JSON.stringify(drawn.strokes.slice(0, 20))).toBeDefined();
    expect(stem!.width).toBeCloseTo(0.12 * G, 3);
    // The stem's right edge is the head's right edge.
    expect(stemX + 0.06 * G).toBeCloseTo(SECOND_X + 0.59 * G, 9);
  });

  it("lengthens a lone 32nd's stem to meet its flag, and hangs the flag at the anchor", () => {
    // Up: the flag asks for 0.376 more stem, and its origin sits that far down.
    const upX = upStemX(FLAG_X);
    const upTip = y(TREBLE, 4) - 3.876 * G;
    expect(lineAt(drawn, upX, y(TREBLE, 4) - 0.168 * G, upX, upTip)).toBeDefined();
    expectUse(drawn, 'flag32ndUp', upX - 0.06 * G, upTip + 0.376 * G);
    // Down: 0.448 more, and the origin that far back up.
    const downX = downStemX(FLAG_X);
    const downTip = y(BASS, 4) + 3.948 * G;
    expect(lineAt(drawn, downX, y(BASS, 4) + 0.168 * G, downX, downTip)).toBeDefined();
    expectUse(drawn, 'flag32ndDown', downX - 0.06 * G, downTip - 0.448 * G);
    // A flag carries all of a note's flags: one glyph, not three.
    expect(usesOf(drawn, 'flag32ndUp')).toHaveLength(1);
  });

  it('sets accidentals right-aligned before the chord, one column a step further out', () => {
    const sharp = bbox('accidentalSharp');
    const flat = bbox('accidentalFlat');
    const rightEdge = SECOND_X - (0.59 + 0.25) * G;
    expectUse(drawn, 'accidentalSharp', rightEdge - sharp.right * G, y(TREBLE, 1));
    expectUse(drawn, 'accidentalFlat', rightEdge - 1.4 * G - flat.right * G, y(TREBLE, 2));
  });

  it('dots after the rightmost head, in a space', () => {
    const dotX = SECOND_X + 1.06 * G + (0.59 + 0.4) * G;
    // The line note's dot moves up into the space; the space note's stays.
    expectUse(drawn, 'augmentationDot', dotX, y(TREBLE, 2) - G / 2);
    expectUse(drawn, 'augmentationDot', dotX, y(TREBLE, 1));
  });

  it('draws a ledger line past the head by the font’s extension, at its thickness', () => {
    const reach = (0.844 + 0.4) * G;
    const ledger = lineAt(drawn, WHOLE_X - reach, y(TREBLE, -2), WHOLE_X + reach, y(TREBLE, -2));
    expect(ledger).toBeDefined();
    expect(ledger!.width).toBeCloseTo(0.16 * G, 3);
  });

  it('stops a ledger line short of an accidental beside it', () => {
    const natural = bbox('accidentalNatural');
    const accidentalRight = WHOLE_X - (0.59 + 0.25) * G;
    expectUse(drawn, 'accidentalNatural', accidentalRight - natural.right * G, y(BASS, 10));
    // Its right end reaches out as usual; its left stops a tenth of a space
    // clear of the natural's ink instead of running into it.
    const ledger = lineAt(
      drawn,
      accidentalRight + 0.1 * G,
      y(BASS, 10),
      WHOLE_X + (0.59 + 0.4) * G,
      y(BASS, 10),
    );
    expect(
      ledger,
      JSON.stringify(drawn.strokes.filter((s) => near(s.points[1]!, y(BASS, 10)))),
    ).toBeDefined();
  });

  it('centres a rest on its column, on its registered line, its dot in the space above', () => {
    const rest = bbox('rest8th');
    const restY = y(TREBLE, 4);
    expectUse(drawn, 'rest8th', REST_X - rest.centre * G, restY);
    const right = REST_X + ((rest.right - rest.left) / 2) * G;
    expectUse(drawn, 'augmentationDot', right + 0.3 * G, restY - 0.5 * G);
  });

  it('numbers a tuplet on the beam’s far side from the heads, centred on the beam', () => {
    const midX = (trebleBeam.x1Pt + trebleBeam.x2Pt) / 2;
    const above = (trebleBeam.y1Pt + trebleBeam.y2Pt) / 2 - 0.6 * G;
    const size = 0.8 * G;
    const one = MUSIC_GLYPH_METRICS.tuplet1.advance * size;
    const two = MUSIC_GLYPH_METRICS.tuplet2.advance * size;
    expectUse(drawn, 'tuplet1', midX - (one + two) / 2, above, size);
    expectUse(drawn, 'tuplet2', midX - (one + two) / 2 + one, above, size);
    // Under a down-stem run, the numeral goes below its beam.
    const three = MUSIC_GLYPH_METRICS.tuplet3.advance * size;
    const below = (bassBeam.y1Pt + bassBeam.y2Pt) / 2 + 1.8 * G;
    expectUse(drawn, 'tuplet3', (bassBeam.x1Pt + bassBeam.x2Pt) / 2 - three / 2, below, size);
    // The digits clear the beam's own thickness.
    const beamTop = (trebleBeam.y1Pt + trebleBeam.y2Pt) / 2 - 0.25 * G;
    expect(above - bbox('tuplet1').bottom * size).toBeLessThan(beamTop);
  });

  it('places a dynamic by its optical centre, on the dynamics row', () => {
    expectUse(drawn, 'dynamicMF', M1 + 60 - 1.796 * G, BASS - 10);
  });

  it('draws an octave line where the layout stands it, the whole mark within its label’s height', () => {
    const size = 0.7 * G;
    for (const octave of [OTTAVA, OTTAVA_BASSA]) {
      const name = octave.up ? 'ottavaAlta' : 'ottavaBassaVb';
      const label = bbox(name);
      // The glyph's ink centred on the line...
      expectUse(
        drawn,
        name,
        octave.x1Pt,
        octave.yPt + ((label.bottom + label.top) / 2) * size,
        size,
      );
      // ...the line starting clear after its advance and running to the end...
      const from = octave.x1Pt + MUSIC_GLYPH_METRICS[name].advance * size + 0.4 * G;
      const dashed = drawn.strokes.filter(
        (stroke) => stroke.dashed && near(stroke.points[1]!, octave.yPt),
      );
      expect(dashed).toHaveLength(1);
      expectNear(dashed[0]!.points[0]!, from);
      expectNear(dashed[0]!.points[2]!, octave.x2Pt);
      // ...and the hook there turning in toward the staff, as far as the label reaches.
      const reach = ((label.top - label.bottom) / 2) * size * (octave.up ? 1 : -1);
      const hook = lineAt(drawn, octave.x2Pt, octave.yPt, octave.x2Pt, octave.yPt + reach);
      expect(hook, JSON.stringify(drawn.strokes.filter((s) => s.width === 0.7))).toBeDefined();
    }
    // The labels are no longer set as text.
    expect(drawn.svg).not.toContain('>8va</text>');
  });

  it('marks a tempo with the quarter-note glyph standing on the baseline', () => {
    const baseline = TREBLE - 30;
    const size = 0.75 * G;
    const originX = M2 + 1 + 0.5;
    expectUse(
      drawn,
      'metNoteQuarterUp',
      originX,
      baseline + bbox('metNoteQuarterUp').bottom * size,
      size,
    );
    expect(drawn.svg).toMatch(
      new RegExp(
        `<text x="${(originX + 1.6 * G).toFixed(2).replace(/\.?0+$/, '')}" y="${baseline}"[^>]*>= 90</text>`,
      ),
    );
  });

  it('draws every symbol from the font, and none as text or hand-drawn curves', () => {
    for (const text of drawn.svg.matchAll(/>([^<]*)<\/text>/g)) {
      expect(text[1]).toMatch(/^(\d+|= \d+)$/);
    }
    // Every filled path left is a beam: four corners, straight sides.
    for (const path of drawn.svg.matchAll(/<path d="([^"]*)" fill="#000000"\/>/g)) {
      expect(path[1]).not.toContain('C');
    }
  });
});

describe('the key signature', () => {
  it('centres each accidental on the positions it always had', async () => {
    const keyed: SheetPage = {
      ...PAGE,
      keySignature: -3,
      systems: [system([measure(0, 150, 300, { empty: true })], { showTimeSignature: false })],
    };
    const keyDrawn = await engrave(keyed);
    const flat = bbox('accidentalFlat');
    const left = SYSTEM_X + METRICS.clefAreaPt;
    for (const [top, clef] of [
      [TREBLE, 'treble'],
      [BASS, 'bass'],
    ] as const) {
      signatureSteps(-3, clef).forEach((step, i) => {
        const centre = left + (i + 0.5) * 1.15 * G;
        expectUse(keyDrawn, 'accidentalFlat', centre - flat.centre * G, y(top, step));
      });
    }
    // An empty bar's whole rest hangs from the fourth line, centred in the bar.
    const whole = bbox('restWhole');
    expectUse(keyDrawn, 'restWhole', 150 + 150 - whole.centre * G, y(TREBLE, 6));
  });
});

describe('a hairpin between two dynamics', () => {
  it('keeps clear of the ink of the mark at either end, however wide the mark', () => {
    // Four bars of quarters, a crescendo from mp in bar 1 to ff in bar 3.
    const notes = Array.from({ length: 16 }, (_, i) => ({
      id: `n${i}`,
      midi: 76,
      startMs: i * 500,
      durationMs: 500,
      velocity: 0.5,
    }));
    const score = layoutScore(notes, {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
    });
    score.dynamics = [
      { atMs: 0, mark: 'mp' },
      { atMs: 4000, mark: 'ff' },
    ];
    score.hairpins = [{ fromMs: 0, toMs: 4000, grow: true }];
    const [sheetSystem] = layoutSheet(score, {
      paper: 'a4',
      timeSignature: { numerator: 4, denominator: 4 },
      bpm: 120,
      title: 'Swell',
      subtitle: '',
      credit: 'PoKeyBoard',
    }).pages[0]!.systems;
    const [start, end] = sheetSystem!.dynamics;
    const [wedge] = sheetSystem!.hairpins;
    expect(start?.mark).toBe('mp');
    expect(end?.mark).toBe('ff');
    expect(wedge).toBeDefined();

    // Where each mark's ink reaches, placed as the renderer places it.
    const ink = (mark: 'mp' | 'ff', x: number) => {
      const [left, , right] = MUSIC_GLYPH_METRICS[DYNAMIC_GLYPHS[mark]].bbox;
      const origin = x - dynamicOpticalCentre(mark) * G;
      return { left: origin + left * G, right: origin + right * G };
    };
    const gap = 0.5 * G;
    expect(wedge!.x1Pt - ink('mp', start!.xPt).right).toBeCloseTo(gap, 6);
    expect(ink('ff', end!.xPt).left - wedge!.x2Pt).toBeCloseTo(gap, 6);
  });
});

/** A box of ink on the page, y down. */
interface Ink {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A glyph's ink as placed: the font's box, at the scale its use sets. */
function useInk(use: Use): Ink {
  const [left, bottom, right, top] = MUSIC_GLYPH_METRICS[use.name as MusicGlyphName].bbox;
  const space = use.a * 250;
  return {
    left: use.x + left * space,
    right: use.x + right * space,
    top: use.y - top * space,
    bottom: use.y - bottom * space,
  };
}

/** A stroked line's ink: its ends, widened across by the pen (the caps are butt). */
function strokeInk(stroke: Stroke): Ink {
  const xs = stroke.points.filter((_, i) => i % 2 === 0);
  const ys = stroke.points.filter((_, i) => i % 2 === 1);
  const half = stroke.width / 2;
  const upright = Math.min(...xs) === Math.max(...xs);
  const level = Math.min(...ys) === Math.max(...ys);
  return {
    left: Math.min(...xs) - (level ? 0 : half),
    right: Math.max(...xs) + (level ? 0 : half),
    top: Math.min(...ys) - (upright ? 0 : half),
    bottom: Math.max(...ys) + (upright ? 0 : half),
  };
}

/**
 * Every black filled path's outline — beams, ties, a final bar line's thick
 * stroke — as points close enough together to stand for it: a slanted beam
 * stands far out at one end and not the other, and only a trace says which.
 */
function filledOutlines(svg: string): [number, number][][] {
  return [...svg.matchAll(/<path d="([^"]*)" fill="#000000"\/>/g)].map((match) => {
    const points: [number, number][] = [];
    let at: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    /** Points every twentieth of a point along a straight edge. */
    const edge = (to: [number, number]): void => {
      const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - at[0], to[1] - at[1]) * 20));
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps;
        points.push([at[0] + (to[0] - at[0]) * t, at[1] + (to[1] - at[1]) * t]);
      }
      at = to;
    };
    for (const segment of match[1]!.match(/[MLCZ][^MLCZ]*/g) ?? []) {
      const n = segment.slice(1).trim().split(/\s+/).filter(Boolean).map(Number);
      if (segment[0] === 'M') {
        at = start = [n[0]!, n[1]!];
        points.push(at);
      } else if (segment[0] === 'L') {
        edge([n[0]!, n[1]!]);
      } else if (segment[0] === 'Z') {
        edge(start);
      } else {
        const [x1, y1, x2, y2, x, y] = n as [number, number, number, number, number, number];
        for (let k = 1; k <= 1024; k += 1) {
          const t = k / 1024;
          const u = 1 - t;
          points.push([
            u * u * u * at[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * at[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          ]);
        }
        at = [x, y];
      }
    }
    return points;
  });
}

/** The outlines of the beams and ties, as points of ink: not a bar line's, which fills the system. */
function filledInk(svg: string): Ink[] {
  return filledOutlines(svg)
    .filter((points) => {
      const ys = points.map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys) < 3 * G;
    })
    .flatMap((points) => points.map(([x, y]) => ({ left: x, right: x, top: y, bottom: y })));
}

/** The box a set of inks fills together. */
function union(inks: readonly Ink[]): Ink {
  return inks.reduce((a, b) => ({
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  }));
}

/**
 * Everything drawn for the notes: heads, accidentals, dots, flags and tuplet
 * digits; the stems and ledger lines stroked for them; and beams and ties.
 */
function noteInk(drawn: Drawn): Ink[] {
  const widths = [0.12 * G, 0.16 * G];
  return [
    ...drawn.uses
      .filter((use) => /^(notehead|accidental|augmentationDot|flag|tuplet)/.test(use.name))
      .map(useInk),
    ...drawn.strokes
      .filter((stroke) => widths.some((width) => Math.abs(stroke.width - width) < 0.001))
      .map(strokeInk),
    ...filledInk(drawn.svg),
  ];
}

const highest = (inks: readonly Ink[]): number => Math.min(...inks.map((ink) => ink.top));
const lowest = (inks: readonly Ink[]): number => Math.max(...inks.map((ink) => ink.bottom));

/**
 * An octave line's mark as drawn — its label, the dashed line and the hook at
 * its end — found by the ends the layout gave it.
 */
function markOf(drawn: Drawn, octave: SheetOctave): Ink {
  const lines = drawn.strokes.filter(
    (stroke) =>
      stroke.dashed &&
      stroke.points[0]! > octave.x1Pt - 0.01 &&
      stroke.points[2]! < octave.x2Pt + 0.01,
  );
  expect(lines).toHaveLength(1);
  const line = lines[0]!;
  const lineY = line.points[1]!;
  const pieces = [strokeInk(line)];
  if (!octave.continuesLeft) {
    // Its label starts where the line does, its ink around the line's height.
    const labels = drawn.uses
      .filter((use) => use.name.startsWith('ottava') && near(use.x, octave.x1Pt))
      .map(useInk)
      .filter((ink) => ink.top < lineY && ink.bottom > lineY);
    expect(labels).toHaveLength(1);
    pieces.push(labels[0]!);
  }
  if (!octave.continuesRight) {
    const hooks = drawn.strokes.filter(
      (stroke) =>
        !stroke.dashed &&
        stroke.points.length === 4 &&
        near(stroke.points[0]!, octave.x2Pt) &&
        near(stroke.points[2]!, octave.x2Pt) &&
        near(stroke.points[1]!, lineY),
    );
    expect(hooks).toHaveLength(1);
    pieces.push(strokeInk(hooks[0]!));
  }
  return union(pieces);
}

const PACK_DIR = path.resolve(process.cwd(), 'public', SCORE_PACK_PATH);

describe('octave lines', () => {
  /** Clear space an octave line's mark keeps from the music under it. */
  const CLEAR = 0.5 * G;
  /** How far writing coordinates to 0.01 pt can move one measurement against another. */
  const WRITTEN = 0.02;
  const TIME = { numerator: 4, denominator: 4 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Notes a beat to a second, each `[beat, midi]` a quarter unless `extra` says otherwise. */
  function played(beats: [number, number][], extra: Partial<NoteEvent> = {}): NoteEvent[] {
    return beats.map(([beat, midi], i) => ({
      velocity: 0.6,
      durationMs: 1000,
      ...extra,
      id: `${extra.id ?? 'n'}${i}`,
      midi,
      startMs: beat * 1000,
    }));
  }

  /** Page 1, its dynamics left out: a hairpin is stroked at the octave line's width. */
  function pageOf(notes: NoteEvent[], options: Partial<LayoutOptions> = {}): SheetPage {
    const score = layoutScore(notes, {
      bpm: 60,
      timeSignature: TIME,
      quantization: '1/16',
      minMeasures: 1,
      ...options,
    });
    score.dynamics = [];
    score.hairpins = [];
    return layoutSheet(score, {
      paper: 'a4',
      timeSignature: TIME,
      bpm: 60,
      title: 'Octaves',
      subtitle: '',
      credit: 'PoKeyBoard',
    }).pages[0]!;
  }

  /** The page's one octave line, and the page engraved. */
  async function octaveOn(page: SheetPage): Promise<{ octave: SheetOctave; drawn: Drawn }> {
    const octaves = page.systems.flatMap((system) => system.octaves);
    expect(octaves).toHaveLength(1);
    return { octave: octaves[0]!, drawn: await engrave(page) };
  }

  /** How far the highest note ink stands over the mark's lowest, less the clear space. */
  function slack(drawn: Drawn, octave: SheetOctave): number {
    return highest(noteInk(drawn)) - markOf(drawn, octave).bottom - CLEAR;
  }

  it('stands the line its usual distance off the staff where nothing under it reaches that far', async () => {
    // C6 to E6, written an octave down inside the staff.
    const page = pageOf(
      played([
        [0, 84],
        [1, 86],
        [2, 88],
        [3, 86],
      ]),
    );
    const { octave, drawn } = await octaveOn(page);
    const line = drawn.strokes.filter((stroke) => stroke.dashed);
    expect(line).toHaveLength(1);
    expectNear(line[0]!.points[1]!, page.systems[0]!.trebleTopPt - 2.6 * G);
    expect(slack(drawn, octave)).toBeGreaterThan(0);
  });

  it('rises clear of the heads and ledger lines it covers', async () => {
    // C7s, written C6 on two ledger lines: 2.6 spaces up, the line ran through the heads.
    const { octave, drawn } = await octaveOn(pageOf(played([0, 1, 2, 3].map((b) => [b, 96]))));
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
  });

  it('rises clear of an accidental standing taller than its head', async () => {
    // B♭6s, written B♭5: the flat reaches well above the head it alters.
    const notes = played(
      [0, 1, 2, 3].map((b) => [b, 94]),
      { spelling: { step: 'B', alter: -1 } },
    );
    const { octave, drawn } = await octaveOn(pageOf(notes));
    const [flat] = usesOf(drawn, 'accidentalFlat');
    expect(highest(noteInk(drawn))).toBeCloseTo(useInk(flat!).top, 6);
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
  });

  it('rises clear of the stems and flags of an upper voice', async () => {
    // E7 eighths stemming up over C7 quarters, all of it an octave down.
    const notes = [
      ...played(
        [0, 1, 2, 3].map((b) => [b, 100]),
        { id: 'u', durationMs: 500, voice: 0 },
      ),
      ...played(
        [0, 1, 2, 3].map((b) => [b, 96]),
        { id: 'l', voice: 1 },
      ),
    ];
    const { octave, drawn } = await octaveOn(pageOf(notes));
    const flags = usesOf(drawn, 'flag8thUp');
    expect(flags).toHaveLength(4);
    expect(highest(noteInk(drawn))).toBeCloseTo(highest(flags.map(useInk)), 6);
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
  });

  it('rises clear of a beam over the notes', async () => {
    // The same, in pairs of E7 eighths joined by a beam.
    const notes = [
      ...played(
        [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((b) => [b, 100]),
        { id: 'u', durationMs: 500, voice: 0 },
      ),
      ...played(
        [0, 1, 2, 3].map((b) => [b, 96]),
        { id: 'l', voice: 1 },
      ),
    ];
    const page = pageOf(notes);
    expect(page.systems[0]!.measures[0]!.beams.length).toBeGreaterThan(0);
    const { octave, drawn } = await octaveOn(page);
    const beams = filledInk(drawn.svg);
    expect(highest(noteInk(drawn))).toBeCloseTo(highest(beams), 6);
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
  });

  it('rises clear of a tie arcing up toward it', async () => {
    // A C7 held from bar 1 into bar 2, stemmed down, so its tie bows up.
    const notes = [
      ...played([[0, 96]], { id: 'held', durationMs: 6000 }),
      ...played([
        [6, 96],
        [7, 96],
      ]),
    ];
    const { octave, drawn } = await octaveOn(pageOf(notes));
    const [whole] = usesOf(drawn, 'noteheadWhole');
    // The arc is what reaches highest.
    expect(highest(noteInk(drawn))).toBeLessThan(useInk(whole!).top - 0.5 * G);
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
  });

  it.each([
    ['before', 0, 1],
    ['after', 4, 0],
  ])(
    'stays down beside a high chord just %s the passage that stands clear of it',
    async (_, chordBeat, runStart) => {
      // A5 and E7 together: not all of it that high, so not written an octave in.
      const notes = [
        ...played(
          [
            [chordBeat, 81],
            [chordBeat, 100],
          ],
          { id: 'c' },
        ),
        ...played([84, 86, 88, 86].map((midi, i): [number, number] => [runStart + i, midi])),
      ];
      const page = pageOf(notes);
      const { octave, drawn } = await octaveOn(page);
      // E7's head on its six ledger lines is the highest thing on the page...
      const system = page.systems[0]!;
      const e7 = usesOf(drawn, 'noteheadBlack')
        .map(useInk)
        .find((ink) => near(ink.top, system.trebleTopPt + staffYRel(21) - 0.5 * G));
      expect(e7).toBeDefined();
      expect(highest(noteInk(drawn))).toBeCloseTo(e7!.top, 6);
      // ...but it stands well clear of the mark across the page, so the line
      // keeps its usual place over the passage.
      const mark = markOf(drawn, octave);
      expect(Math.max(e7!.left - mark.right, mark.left - e7!.right)).toBeGreaterThan(2 * G);
      expectNear(octave.yPt, system.trebleTopPt - 2.6 * G);
    },
  );

  it('keeps clear of a chord beside the passage whose ink reaches in under its hook', async () => {
    // Four sixteenths from C6, written in the staff, then A5 and B5: a second
    // whose lower head, set off left of the stem, stands just past the hook.
    const notes = [
      ...[84, 86, 88, 86].map((midi, i) => ({
        id: `s${i}`,
        midi,
        startMs: i * 250,
        durationMs: 250,
        velocity: 0.6,
      })),
      ...[81, 83].map((midi, i) => ({
        id: `c${i}`,
        midi,
        startMs: 1000,
        durationMs: 250,
        velocity: 0.6,
      })),
    ];
    const page = pageOf(notes);
    const second = page.systems[0]!.measures[0]!.columns.find((column) => column.timeMs === 1000);
    expect(second?.treble[0]?.notes.map((note) => note.headShift)).toEqual([-1, 0]);
    const { octave, drawn } = await octaveOn(page);
    // Its ledger line, the only one on the page, runs in under the hook...
    const mark = markOf(drawn, octave);
    const ledgers = drawn.strokes
      .filter((stroke) => Math.abs(stroke.width - 0.16 * G) < 0.001)
      .map(strokeInk);
    expect(ledgers.length).toBeGreaterThan(0);
    expect(Math.min(...ledgers.map((ink) => ink.left))).toBeLessThan(mark.right);
    expect(Math.min(...ledgers.map((ink) => ink.left))).toBeGreaterThan(octave.x2Pt - CLEAR);
    // ...so the line clears that chord, whose B5 is the highest thing on the page.
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
    expect(octave.yPt).toBeLessThan(page.systems[0]!.trebleTopPt - 2.6 * G - 0.5 * G);
  });

  it('sinks an 8vb clear of what it covers, and the pedal bracket under it', async () => {
    // C1s, written C2 on two ledger lines under the bass staff, with the pedal down.
    const notes = played(
      [0, 1, 2, 3].map((b) => [b, 24]),
      { staff: 'bass' },
    );
    const page = pageOf(notes, {
      pedals: [
        { atMs: 0, down: true },
        { atMs: 3900, down: false },
      ],
    });
    const { octave, drawn } = await octaveOn(page);
    expect(octave.up).toBe(false);
    const mark = markOf(drawn, octave);
    expect(Math.abs(mark.top - lowest(noteInk(drawn)) - CLEAR)).toBeLessThan(WRITTEN);
    const pedal = drawn.strokes.filter((stroke) => stroke.width === 0.8).map(strokeInk);
    expect(pedal.length).toBeGreaterThan(0);
    expect(highest(pedal) - mark.bottom).toBeGreaterThanOrEqual(CLEAR - WRITTEN);
  });

  it('keeps a tempo mark over the line', async () => {
    // Bar 2 goes to 90 bpm, and its C7s go under an 8va stood clear of their ledger lines.
    const beat = 60_000 / 90;
    const notes: NoteEvent[] = [
      { id: 'w', midi: 60, startMs: 0, durationMs: 4000, velocity: 0.6 },
      ...[0, 1, 2, 3].map((i) => ({
        id: `q${i}`,
        midi: 96,
        startMs: Math.round(4000 + i * beat),
        durationMs: Math.round(beat),
        velocity: 0.6,
      })),
    ];
    const page = pageOf(notes, { tempoChanges: [{ atMs: 4000, bpm: 90 }] });
    const { octave, drawn } = await octaveOn(page);
    expect(Math.abs(slack(drawn, octave))).toBeLessThan(WRITTEN);
    const mark = markOf(drawn, octave);
    const [note] = usesOf(drawn, 'metNoteQuarterUp');
    expect(note).toBeDefined();
    expect(mark.top - useInk(note!).bottom).toBeGreaterThanOrEqual(CLEAR);
    const number = /<text x="[\d.]+" y="([\d.]+)"[^>]*>= 90<\/text>/.exec(drawn.svg);
    expect(number).not.toBeNull();
    expect(mark.top - Number(number![1])).toBeGreaterThanOrEqual(CLEAR);
  });

  it('carries a line open over a system break on to the note it ends on, clear of it', async () => {
    // Bars of E5 quarters, broken into systems, but for the last three beats of
    // the first system and the second's downbeat: C7s, written C6 on two ledger
    // lines under a line that runs from one system into the next. The spacing
    // reads rhythm, not pitch, so raising them leaves the break where it was.
    const beats = Array.from({ length: 96 }, (_, beat) => beat);
    const plain = pageOf(played(beats.map((beat) => [beat, 76])));
    const breakBeat = plain.systems[1]!.measures[0]!.startMs / 1000;
    const raised = (beat: number): boolean => beat >= breakBeat - 3 && beat <= breakBeat;
    const page = pageOf(played(beats.map((beat) => [beat, raised(beat) ? 96 : 76])));
    const system = page.systems[1]!;
    expect(system.measures[0]!.startMs).toBe(breakBeat * 1000);
    const [octave] = system.octaves;
    expect(octave).toMatchObject({ continuesLeft: true, continuesRight: false });
    const drawn = await engrave(page);
    const mark = markOf(drawn, octave!);

    // The note it ends on, the first in the system: its hook stands past that
    // head, not at the bar line before it...
    const head = system.measures[0]!.columns[0]!;
    const covered = usesOf(drawn, 'noteheadBlack')
      .map(useInk)
      .filter(
        (ink) => ink.left < head.xPt && ink.right > head.xPt && ink.bottom < system.trebleTopPt,
      );
    expect(covered).toHaveLength(1);
    expect(mark.right).toBeGreaterThan(covered[0]!.right);
    // ...and the line stands clear of it, ledger lines and all.
    const under = noteInk(drawn).filter(
      (box) =>
        box.right > mark.left - CLEAR &&
        box.left < mark.right + CLEAR &&
        box.bottom > mark.top &&
        box.top < system.trebleTopPt + 4 * G,
    );
    expect(under.length).toBeGreaterThan(2);
    expect(highest(under) - mark.bottom).toBeGreaterThanOrEqual(CLEAR - WRITTEN);

    // On the system before, the line runs to the end of the staff and no
    // further, and stays open there: no hook says it stops.
    const before = page.systems[0]!;
    const [runs] = before.octaves;
    expect(runs).toMatchObject({ continuesLeft: false, continuesRight: true });
    expectNear(markOf(drawn, runs!).right, before.xPt + before.widthPt);
    const hooks = drawn.strokes.filter(
      (stroke) =>
        !stroke.dashed &&
        stroke.points.length === 4 &&
        near(stroke.points[0]!, stroke.points[2]!) &&
        near(stroke.points[1]!, runs!.yPt),
    );
    expect(hooks).toHaveLength(0);
  });

  it('keeps every 8va in the Waltz, Op. 64 No. 2 clear of the beams and stems it covers', async () => {
    // Its running eighths stem up to beams two to four spaces over the staff,
    // written an octave down; 2.6 spaces up, the line ran through them.
    vi.stubGlobal('fetch', async (input: string) => {
      const file = path.basename(new URL(input, 'http://localhost/').pathname);
      const bytes = await readFile(path.join(PACK_DIR, decodeURIComponent(file)));
      return new Response(new Uint8Array(bytes), { status: 200 });
    });
    const take = await loadClassicTake('score-waltz-opus-64-no-2-in-c-minor');
    expect(take?.title).toBe('Waltz, Op. 64 No. 2');
    const grid = take!.display.quantization === 'off' ? '1/16' : take!.display.quantization;
    const { pages } = layoutTakeSheet(take!, 'a4', grid, defaultKeySignatureFor(take!), '');
    const marked = pages.filter((page) => page.systems.some((system) => system.octaves.length > 0));
    // Bar 47 among them.
    expect(
      marked.some((page) =>
        page.systems.some(
          (system) =>
            system.octaves.length > 0 && system.measures.some((measure) => measure.index === 46),
        ),
      ),
    ).toBe(true);

    let checked = 0;
    for (const page of marked) {
      const drawn = await engrave(page);
      const ink = noteInk(drawn);
      for (const system of page.systems) {
        for (const octave of system.octaves) {
          expect(octave.up).toBe(true);
          const mark = markOf(drawn, octave);
          // What is drawn under the mark, or within its clear space of it,
          // down to its staff's bottom line.
          const under = ink.filter(
            (box) =>
              box.right > mark.left - CLEAR &&
              box.left < mark.right + CLEAR &&
              box.bottom > mark.top &&
              box.top < system.trebleTopPt + 4 * G,
          );
          expect(under.length).toBeGreaterThan(5);
          expect(highest(under) - mark.bottom).toBeGreaterThanOrEqual(CLEAR - WRITTEN);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});

describe('marks on the first downbeat', () => {
  it('stand over and under its note, not at the bar line before it', async () => {
    // Six quarters high enough for an 8va from the downbeat on, pedalled from
    // there and marked p there.
    const notes = [96, 98, 100, 101, 103, 96].map((midi, i) => ({
      id: `n${i}`,
      midi,
      startMs: i * 500,
      durationMs: 400,
      velocity: 0.5,
    }));
    const score = layoutScore(notes, {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      quantization: '1/16',
      minMeasures: 1,
      pedals: [
        { atMs: 0, down: true },
        { atMs: 1500, down: false },
      ],
    });
    score.dynamics = [{ atMs: 0, mark: 'p' }];
    score.hairpins = [];
    const page = layoutSheet(score, {
      paper: 'a4',
      timeSignature: { numerator: 4, denominator: 4 },
      bpm: 120,
      title: 'Downbeat',
      subtitle: '',
      credit: 'PoKeyBoard',
    }).pages[0]!;
    const sheetSystem = page.systems[0]!;
    const head = sheetSystem.measures[0]!.columns[0]!;
    expect(head.timeMs).toBe(0);
    expect(head.xPt - sheetSystem.measures[0]!.xPt).toBeGreaterThan(G);
    const downbeat = await engrave(page);

    // The 8va's label starts at the head's left edge.
    const [label] = usesOf(downbeat, 'ottavaAlta');
    expectNear(label!.x, head.xPt - HEAD_RX_G * G);
    // The p is centred on the note by its optical centre.
    const [piano] = usesOf(downbeat, 'dynamicPiano');
    expectNear(piano!.x, head.xPt - dynamicOpticalCentre('p') * G);
    // The pedal goes down under the note: its bracket's first hook.
    const hookTop = sheetSystem.pedalRowPt - PEDAL_HOOK_G * G;
    const pedal = downbeat.strokes.find(
      (stroke) => stroke.points.length === 8 && near(stroke.points[1]!, hookTop),
    );
    expect(
      pedal,
      JSON.stringify(downbeat.strokes.filter((s) => s.points.length > 4)),
    ).toBeDefined();
    expectNear(pedal!.points[0]!, head.xPt);
  });
});
