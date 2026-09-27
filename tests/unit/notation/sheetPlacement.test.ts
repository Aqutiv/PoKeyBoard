import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { PdfStandardFonts } from '@/features/export/pdfSurface';
import { beginSvgPage } from '@/features/export/svgSurface';
import type { TextRasterizer } from '@/features/export/vectorSurface';
import { dynamicOpticalCentre, DYNAMIC_GLYPHS } from '@/features/notation/glyphs/engravingGlyphs';
import { MUSIC_GLYPH_METRICS } from '@/features/notation/glyphs/musicGlyphMetrics';
import { signatureSteps } from '@/features/notation/keySignature';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  layoutSheet,
  metricsFor,
  SHEET_GAP_PT,
  staffYRel,
  type SheetBeam,
  type SheetChord,
  type SheetColumn,
  type SheetMeasure,
  type SheetNote,
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
        octaves: [
          {
            staff: 'treble',
            up: true,
            x1Pt: M2 + 20,
            x2Pt: M2 + 200,
            continuesLeft: false,
            continuesRight: false,
          },
        ],
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

  it('labels an 8va with the glyph and starts its line past the glyph’s advance', () => {
    const lineY = TREBLE - 2.6 * G;
    const size = 0.7 * G;
    expectUse(drawn, 'ottavaAlta', M2 + 20, lineY + 0.65 * G, size);
    const from = M2 + 20 + MUSIC_GLYPH_METRICS.ottavaAlta.advance * size + 0.4 * G;
    const dashed = drawn.strokes.find((stroke) => stroke.dashed);
    expect(dashed).toBeDefined();
    expectNear(dashed!.points[0]!, from);
    expectNear(dashed!.points[1]!, lineY);
    // The label is no longer set as text.
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
