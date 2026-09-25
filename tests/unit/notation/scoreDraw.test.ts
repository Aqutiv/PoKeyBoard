import { describe, expect, it } from 'vitest';
import type { NoteEvent, NoteStaff } from '@/domain/takeTypes';
import { layoutScore, type ScoreLayout } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  GAP,
  gutterWidthFor,
  SCORE_LEAD_IN,
  SCORE_PALETTES,
  scoreEndMs,
  type ScoreRenderInput,
  type ScoreChrome,
  type ScoreView,
  type StaffMode,
} from '@/features/notation/scoreRenderer';

/**
 * The first test to actually call `drawScore`. It records what the renderer
 * asks the context to do rather than what it paints, which is enough to pin
 * *why* a head is the colour it is — the thing that has no other net.
 */
interface Point {
  x: number;
  y: number;
}

/** A stroked path: the style and width it was stroked in, and its points. */
interface StrokedPath {
  style: string;
  width: number;
  points: Point[];
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  /** Every fillStyle in force at the moment `fill()` was called. */
  fills: string[];
  strokes: string[];
  texts: string[];
  /** Every path stroked, in order. Enough to find where a line was drawn. */
  paths: StrokedPath[];
  /** Every `fillRect`, with the fillStyle in force — a wash, a rest block. */
  rects: { style: string; x: number; width: number }[];
  /**
   * The centre of every ellipse drawn. Heads are drawn by translating to the
   * head and then rotating, so the translation alone places them; scale and
   * rotation are not tracked.
   */
  ellipses: Point[];
}

function recordingContext(): Recorder {
  const fills: string[] = [];
  const strokes: string[] = [];
  const texts: string[] = [];
  const paths: StrokedPath[] = [];
  const rects: { style: string; x: number; width: number }[] = [];
  const ellipses: Point[] = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  let offset: Point = { x: 0, y: 0 };
  const saved: Point[] = [];
  let path: Point[] = [];
  const at = (x: number, y: number): Point => ({ x: offset.x + x, y: offset.y + y });

  const ctx = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save: () => void saved.push(offset),
    restore: () => {
      offset = saved.pop() ?? { x: 0, y: 0 };
    },
    translate: (x: number, y: number) => {
      offset = at(x, y);
    },
    rotate: () => {},
    scale: () => {},
    setTransform: () => {
      offset = { x: 0, y: 0 };
    },
    beginPath: () => {
      path = [];
    },
    closePath: () => {},
    moveTo: (x: number, y: number) => void path.push(at(x, y)),
    lineTo: (x: number, y: number) => void path.push(at(x, y)),
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    arc: () => {},
    ellipse: (x: number, y: number) => void ellipses.push(at(x, y)),
    rect: () => {},
    clearRect: () => {},
    fillRect: (x: number, _y: number, width: number) =>
      void rects.push({ style: state.fillStyle, x: offset.x + x, width }),
    strokeRect: () => {},
    fill: () => void fills.push(state.fillStyle),
    stroke: () => {
      strokes.push(state.strokeStyle);
      paths.push({ style: state.strokeStyle, width: state.lineWidth, points: path });
    },
    fillText: (text: string) => void texts.push(text),
    // Constant, because the renderer caches its glyph-support probe at module
    // scope — a varying width would make the first suite to run decide for all.
    measureText: () => ({ width: 40 }) as TextMetrics,
    clip: () => {},
    setLineDash: () => {},
  } as unknown as CanvasRenderingContext2D;

  return { ctx, fills, strokes, texts, paths, rects, ellipses };
}

const LAYOUT_OPTS = {
  bpm: 60,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16',
  minMeasures: 1,
} as const;

/** One whole note filling its bar, as every Learn snippet is built. */
function oneNote(midi: number, staff?: NoteStaff): ScoreLayout {
  const note: NoteEvent = {
    id: 'n',
    midi,
    startMs: 0,
    durationMs: 4000,
    velocity: 0.7,
    ...(staff !== undefined ? { staff } : {}),
  };
  const score = layoutScore([note], LAYOUT_OPTS);
  return { ...score, dynamics: [], hairpins: [], rests: [] };
}

/**
 * A bar of notes at the given beats, one beat each, as the rhythm chapter
 * writes them. Rests are kept rather than blanked — the silence is the point.
 */
function bar(beats: readonly number[], midi = 60, staff: NoteStaff = 'treble'): ScoreLayout {
  const notes: NoteEvent[] = beats.map((beat, index) => ({
    id: `n${index}`,
    midi,
    startMs: beat * 1000,
    durationMs: 1000,
    velocity: 0.7,
    staff,
  }));
  const score = layoutScore(notes, LAYOUT_OPTS);
  return { ...score, dynamics: [], hairpins: [] };
}

/** Notes at `[beat, beats, midi]` on one staff, with the rests they leave. */
function written(
  entries: readonly (readonly [beat: number, beats: number, midi?: number])[],
  staff: NoteStaff = 'treble',
): ScoreLayout {
  const notes: NoteEvent[] = entries.map(([beat, beats, midi = 60], index) => ({
    id: `w${index}`,
    midi,
    startMs: beat * 1000,
    durationMs: beats * 1000,
    velocity: 0.7,
    staff,
  }));
  const score = layoutScore(notes, LAYOUT_OPTS);
  return { ...score, dynamics: [], hairpins: [] };
}

/** Two beamed eighths on one beat, as the rhythm chapter's last figure has. */
function eighths(
  midis: readonly [number, number] = [60, 62],
  staff: NoteStaff = 'treble',
): ScoreLayout {
  const notes: NoteEvent[] = [0, 0.5].map((beat, index) => ({
    id: `e${index}`,
    midi: midis[index] as number,
    startMs: beat * 1000,
    durationMs: 500,
    velocity: 0.7,
    staff,
  }));
  const score = layoutScore(notes, LAYOUT_OPTS);
  return { ...score, dynamics: [], hairpins: [], rests: [] };
}

function render(
  layout: ScoreLayout,
  extra: Partial<ScoreRenderInput> = {},
  staves: StaffMode = 'treble',
  /** `null` omits the property entirely, which is what the Play page does. */
  chrome: ScoreChrome | null = 'bare',
  overrides: Partial<Pick<ScoreView, 'widthPx' | 'pxPerMs' | 'scrollMs' | 'systemBreakMs'>> = {},
): Recorder {
  const geometry = computeScoreGeometry(layout, { staves });
  const recorder = recordingContext();
  const view: ScoreView = {
    widthPx: 300,
    heightPx: geometry.minHeight,
    pxPerMs: 0.05,
    scrollMs: 0,
    trebleTop: geometry.trebleTop,
    bassTop: geometry.bassTop,
    pedalRow: geometry.pedalRow,
    dynamicsRow: geometry.dynamicsRow,
    gutterPx: gutterWidthFor(0),
    staves,
    ...(chrome === null ? {} : { chrome }),
    ...overrides,
  };
  drawScore(
    recorder.ctx,
    view,
    {
      layout,
      timeSignature: LAYOUT_OPTS.timeSignature,
      keySignature: 0,
      playheadMs: -1e9,
      recording: false,
      openNotes: [],
      ghosts: [],
      ...extra,
    },
    SCORE_PALETTES.dark,
  );
  return recorder;
}

const { note, highlight } = SCORE_PALETTES.dark;

describe('drawScore note highlighting', () => {
  it('draws a head in the plain note colour by default', () => {
    const drawn = render(oneNote(60));
    expect(drawn.strokes).toContain(note);
    expect(drawn.strokes).not.toContain(highlight);
  });

  it('lights the head whose midi the user is holding', () => {
    // A whole note is hollow, so the head is stroked rather than filled.
    const drawn = render(oneNote(60), { litMidis: new Set([60]) });
    expect(drawn.strokes).toContain(highlight);
  });

  it('leaves a head alone when a different key is held', () => {
    const drawn = render(oneNote(60), { litMidis: new Set([62]) });
    expect(drawn.strokes).not.toContain(highlight);
  });

  it('does not light the octave above — the written note is the written note', () => {
    const drawn = render(oneNote(60), { litMidis: new Set([72]) });
    expect(drawn.strokes).not.toContain(highlight);
  });

  it('treats an empty held set as nothing held', () => {
    const drawn = render(oneNote(60), { litMidis: new Set() });
    expect(drawn.strokes).not.toContain(highlight);
  });

  it('lights a head by which note it is, when asked by id', () => {
    const drawn = render(oneNote(60), { litNoteIds: new Set(['n']) });
    expect(drawn.strokes).toContain(highlight);
  });

  it('lights by id instead of by pitch, never both', () => {
    // A lesson walking a line passes ids; a held key must not then light every
    // head of its pitch on top of them.
    const drawn = render(oneNote(60), { litNoteIds: new Set(), litMidis: new Set([60]) });
    expect(drawn.strokes).not.toContain(highlight);
  });

  it('lights one of two heads of the same pitch, by id', () => {
    // Quarter notes are filled, so each lit head is one highlight fill.
    const drawn = render(bar([0, 1]), { litNoteIds: new Set(['n0']) });
    expect(drawn.fills.filter((fill) => fill === highlight)).toHaveLength(1);
    const both = render(bar([0, 1]), { litMidis: new Set([60]) });
    expect(both.fills.filter((fill) => fill === highlight)).toHaveLength(2);
  });
});

describe('drawScore bare chrome', () => {
  it('prints no time signature and no measure number', () => {
    const drawn = render(oneNote(60));
    expect(drawn.texts).not.toContain('4');
    expect(drawn.texts).not.toContain('1');
  });
});

describe('drawScore single-staff filtering', () => {
  // A single-staff view collapses `bassTop` onto `trebleTop`, so a chord from
  // the staff it is not showing is not harmlessly off-canvas: it lands on the
  // staff that *is* drawn, measured from the other clef's reference line —
  // roughly a sixth from where it belongs, with nothing to say so.
  //
  // `litMidis` is the probe rather than a stroke count because the highlight
  // colour is used for note heads and nothing else.
  it('draws a note whose staff the view shows', () => {
    const drawn = render(oneNote(60, 'bass'), { litMidis: new Set([60]) }, 'bass');
    expect(drawn.strokes).toContain(highlight);
  });

  it('leaves out a note belonging to the staff the view does not show', () => {
    // C4 with no hint resolves to the treble staff, so a bass-only view has
    // no business drawing it at all.
    const drawn = render(oneNote(60), { litMidis: new Set([60]) }, 'bass');
    expect(drawn.strokes).not.toContain(highlight);
  });

  it('draws both staves of a grand view', () => {
    const bass = render(oneNote(53, 'bass'), { litMidis: new Set([53]) }, 'grand');
    expect(bass.strokes).toContain(highlight);
    const treble = render(oneNote(60, 'treble'), { litMidis: new Set([60]) }, 'grand');
    expect(treble.strokes).toContain(highlight);
  });
});

describe('drawScore clefs', () => {
  // The gutter names the clef in force with a glyph, so which clef a lesson
  // snippet draws is assertable rather than something only a screenshot sees.
  const TREBLE_CLEF = '\u{1D11E}';
  const BASS_CLEF = '\u{1D122}';

  it('draws a treble clef, and only that, for a treble view', () => {
    const drawn = render(oneNote(60), {}, 'treble');
    expect(drawn.texts).toContain(TREBLE_CLEF);
    expect(drawn.texts).not.toContain(BASS_CLEF);
  });

  it('draws an F clef, and only that, for a bass view', () => {
    const drawn = render(oneNote(53, 'bass'), {}, 'bass');
    expect(drawn.texts).toContain(BASS_CLEF);
    expect(drawn.texts).not.toContain(TREBLE_CLEF);
  });

  it('draws both clefs for a grand view', () => {
    const drawn = render(oneNote(60, 'treble'), {}, 'grand');
    expect(drawn.texts).toContain(TREBLE_CLEF);
    expect(drawn.texts).toContain(BASS_CLEF);
  });
});

describe('drawScore lesson chrome', () => {
  const { rest } = SCORE_PALETTES.dark;

  it('draws the rests the engraver derived', () => {
    // A bar with a hole on beat two. `StaffSnippet` blanks rests by default,
    // because a worked example is not a performance — but the rhythm chapter
    // teaches the rest as a symbol, so it asks for them back.
    const drawn = render(bar([0, 2, 3]), {}, 'treble', 'lesson');
    expect(drawn.fills).toContain(rest);
  });

  it('draws none once they are blanked', () => {
    const withRests = bar([0, 2, 3]);
    const drawn = render({ ...withRests, rests: [] }, {}, 'treble', 'lesson');
    expect(drawn.fills).not.toContain(rest);
  });

  it('prints the time signature under lesson chrome, and not under bare', () => {
    expect(render(bar([0, 1, 2, 3]), {}, 'treble', 'lesson').texts).toContain('4');
    // The regression guard: adding a third value changed nothing for 'bare'.
    expect(render(bar([0, 1, 2, 3]), {}, 'treble', 'bare').texts).not.toContain('4');
  });

  it('leaves the measure number off under lesson chrome', () => {
    // Diffed against 'full' rather than asserted directly: a measure number
    // '1' and a time-signature '4' are both just text, and counting is the
    // honest way to tell one apart from the other.
    const full = render(bar([0, 1, 2, 3]), {}, 'treble', 'full');
    const lesson = render(bar([0, 1, 2, 3]), {}, 'treble', 'lesson');
    expect(full.texts.length).toBeGreaterThan(lesson.texts.length);
    // 4/4 prints two of them, one over the other, on the single staff drawn.
    expect(lesson.texts.filter((text) => text === '4')).toHaveLength(2);
  });

  it('suppresses the empty spill bar, as bare does', () => {
    // A bar that is exactly filled spills a second, empty measure into the
    // layout, and that measure brings a bar line and a whole rest with it. A
    // lesson draws the music, not the silence after it. (Its closing line
    // stands where the spill bar's opening one would, thick: see below.)
    const filled = bar([0, 1, 2, 3]);
    const spill = (drawn: Recorder) => ({
      lines: drawn.paths.filter(
        (path) => path.style === SCORE_PALETTES.dark.barLine && path.width === 1,
      ).length,
      // A whole rest is a block, drawn with `fillRect`.
      rests: drawn.rects.filter((rect) => rect.style === rest).length,
    });
    const wide = { widthPx: 600 };
    expect(spill(render(filled, {}, 'treble', 'full', wide))).toEqual({ lines: 1, rests: 1 });
    expect(spill(render(filled, {}, 'treble', 'lesson', wide))).toEqual({ lines: 0, rests: 0 });
  });

  it('treats an unset chrome as full, which is what the Play page passes', () => {
    // `MusicScore` passes no chrome at all. Comparing `view.chrome === 'full'`
    // without defaulting would turn every piece of furniture off for the live
    // score, which is the regression this guards.
    const drawn = render(bar([0, 2, 3]), {}, 'treble', null);
    expect(drawn.texts).toContain('4');
    expect(drawn.fills).toContain(rest);
  });
});

describe('drawScore beams', () => {
  it('lights the head that is held and leaves the beam alone', () => {
    // The answer to "what colour is a half-lit beam": nothing. A head says
    // which note is sounding; a beam belongs to the group, so there is no half
    // of one to colour. Pinned so a later refactor cannot quietly change it.
    const drawn = render(eighths([60, 62]), { litMidis: new Set([60]) });
    expect(drawn.fills.filter((fill) => fill === highlight)).toHaveLength(1);
    expect(drawn.fills).toContain(note);
  });

  it('leaves out a beam belonging to the staff the view does not show', () => {
    const grand = render(eighths([48, 50], 'bass'), {}, 'grand');
    const trebleOnly = render(eighths([48, 50], 'bass'), {}, 'treble');
    expect(trebleOnly.fills.length).toBeLessThan(grand.fills.length);
  });
});

describe('drawScore bar lines', () => {
  const { barLine, gutterBg, loopEdge, loopWash, playhead } = SCORE_PALETTES.dark;
  /** Half a head's width, as the renderer draws it. */
  const HEAD_RX = GAP * 0.64;
  /** Three bars of 4/4 across, a beat to 50 px. */
  const WIDE = { widthPx: 800, pxPerMs: 0.05 };

  /** Where the music at `ms` is drawn, from the top of the take. */
  const onsetX = (ms: number, pxPerMs = WIDE.pxPerMs): number =>
    gutterWidthFor(0) + SCORE_LEAD_IN + ms * pxPerMs;

  /** Every bar line's x. The final bar line is the thick one, and left out. */
  const barLines = (drawn: Recorder): number[] =>
    drawn.paths
      .filter((path) => path.style === barLine && path.width === 1)
      .map((path) => (path.points[0] as Point).x);

  /** The one bar line within half a beat of `ms`. */
  const lineNear = (drawn: Recorder, ms: number, pxPerMs = WIDE.pxPerMs): number => {
    const near = barLines(drawn).filter((x) => Math.abs(x - onsetX(ms, pxPerMs)) < 500 * pxPerMs);
    expect(near).toHaveLength(1);
    return near[0] as number;
  };

  const quarters = (bars: number): ScoreLayout =>
    bar(Array.from({ length: bars * 4 }, (_, beat) => beat));

  it('stands before the downbeat, clear of its head, and leaves the head on its onset', () => {
    const drawn = render(quarters(2), {}, 'treble', null, WIDE);
    const downbeat = onsetX(4000);
    // The note is still drawn at its time: only the line moved.
    expect(drawn.ellipses.some((head) => Math.abs(head.x - downbeat) < 1e-6)).toBe(true);
    const line = lineNear(drawn, 4000);
    expect(line).toBeLessThan(downbeat - HEAD_RX);
    // About a head's width back, not drifting off into the bar before.
    expect(downbeat - line).toBeLessThan(GAP * 2);
  });

  it.each(['full', 'lesson', 'bare'] as const)(
    'draws no line opening the first bar (%s)',
    (chrome) => {
      // The gutter's clef and time signature open the first bar, as they do a
      // printed system; a line there as well struck through the first note.
      const drawn = render(quarters(1), {}, 'treble', chrome, WIDE);
      expect(barLines(drawn).filter((x) => x < onsetX(3000))).toEqual([]);
    },
  );

  it('still numbers the first bar on the Play page', () => {
    expect(render(quarters(1), {}, 'treble', null, WIDE).texts).toContain('1');
  });

  describe.each([
    ['quarters', quarters(3)],
    [
      'whole and half notes',
      written([
        [0, 4],
        [4, 2],
        [6, 2],
        [8, 4],
      ]),
    ],
    [
      'eighths into the bar',
      written([
        [0, 3],
        [3, 0.5],
        [3.5, 0.5],
        [4, 0.5, 64],
        [4.5, 0.5, 65],
        [5, 3],
      ]),
    ],
  ] as const)('with %s', (_, layout) => {
    it.each([null, 'lesson', 'bare'] as const)('runs through no head (chrome %s)', (chrome) => {
      // Roomy, and with eighths 17.5 px apart — near the 16 px the Play page
      // packs a take's common onsets to. Any closer and the heads all but
      // touch, leaving no clear point to find.
      for (const pxPerMs of [WIDE.pxPerMs, 0.035]) {
        const drawn = render(layout, {}, 'treble', chrome, { widthPx: 800, pxPerMs });
        const lines = barLines(drawn);
        expect(lines.length).toBeGreaterThan(0);
        for (const x of lines) {
          for (const head of drawn.ellipses) {
            // A whole note's head is a quarter as wide again.
            expect(Math.abs(x - head.x)).toBeGreaterThan(HEAD_RX * 1.25);
          }
        }
      }
    });
  });

  it('clears an accidental on the downbeat as well', () => {
    const at = (midi: number) =>
      lineNear(
        render(
          written([
            [0, 4],
            [4, 4, midi],
          ]),
          {},
          'treble',
          null,
          WIDE,
        ),
        4000,
      );
    const plain = at(65);
    const sharp = at(66);
    // The sharp is centred past the head's edge and a gap; this is its left side.
    expect(sharp).toBeLessThan(onsetX(4000) - (HEAD_RX * 1.25 + GAP * 0.7 + GAP * 0.6));
    expect(sharp).toBeLessThan(plain);
  });

  it('splits the gap when the music is too packed to clear both sides', () => {
    // A sixteenth into the downbeat, 16 px apart: as close as the Play page
    // spaces a take's common onsets at 100%.
    const pxPerMs = 16 / 250;
    const packed = written([
      [0, 3],
      [3, 0.75],
      [3.75, 0.25],
      [4, 1],
    ]);
    const drawn = render(packed, {}, 'treble', null, { widthPx: 800, pxPerMs });
    const line = lineNear(drawn, 4000, pxPerMs);
    expect(line).toBeGreaterThan(onsetX(3750, pxPerMs) + HEAD_RX);
    expect(line).toBeLessThan(onsetX(4000, pxPerMs) - HEAD_RX);
  });

  it('keeps clear of the downbeat head when a flag swings out over it', () => {
    // The same sixteenth alone in its beat, so it flags instead of beaming —
    // and its flag reaches past where the downbeat's head begins. Splitting the
    // ink's overlap would put the line inside that head; the heads decide.
    const pxPerMs = 16 / 250;
    const flagged = written([
      [0, 1],
      [1, 1],
      [2, 1],
      [3.75, 0.25],
      [4, 1],
    ]);
    const sixteenth = flagged.chords.find((chord) => chord.displayStartMs === 3750);
    expect(sixteenth?.beamId).toBeNull();
    expect(sixteenth?.stemDown).toBe(false);
    const drawn = render(flagged, {}, 'treble', null, { widthPx: 800, pxPerMs });
    const line = lineNear(drawn, 4000, pxPerMs);
    expect(line).toBeGreaterThan(onsetX(3750, pxPerMs) + HEAD_RX);
    expect(line).toBeLessThan(onsetX(4000, pxPerMs) - HEAD_RX);
  });

  it('stays on its time when nothing starts on the downbeat', () => {
    const late = written([
      [0, 4],
      [5, 1],
    ]);
    const drawn = render({ ...late, rests: [] }, {}, 'treble', 'lesson', WIDE);
    expect(lineNear(drawn, 4000)).toBe(Math.round(onsetX(4000)) + 0.5);
  });

  it('stands before a rest on the downbeat', () => {
    const late = written([
      [0, 4],
      [5, 1],
    ]);
    const drawn = render(late, {}, 'treble', null, WIDE);
    expect(lineNear(drawn, 4000)).toBeLessThan(onsetX(4000) - GAP * 0.6);
  });

  it('runs a loop from bar line to bar line, with the wash between them', () => {
    const drawn = render(
      quarters(3),
      { loop: { startMs: 4000, endMs: 8000 } },
      'treble',
      null,
      WIDE,
    );
    const edges = drawn.paths
      .filter((path) => path.style === loopEdge)
      .flatMap((path) => path.points.map((point) => point.x));
    const bars = [lineNear(drawn, 4000), lineNear(drawn, 8000)] as const;
    expect([...new Set(edges)]).toEqual(bars);
    const wash = drawn.rects.find((rect) => rect.style === loopWash);
    expect(wash?.x).toBe(bars[0]);
    expect(wash?.width).toBe(bars[1] - bars[0]);
  });

  it('announces a new tempo over the downbeat, where it always stood', () => {
    // Hung off the line, the mark's note would land on the downbeat's head.
    const notes: NoteEvent[] = Array.from({ length: 8 }, (_, beat) => ({
      id: `t${beat}`,
      midi: 60,
      startMs: beat * 1000,
      durationMs: 1000,
      velocity: 0.7,
    }));
    const score = layoutScore(notes, { ...LAYOUT_OPTS, tempoChanges: [{ atMs: 4000, bpm: 90 }] });
    const drawn = render({ ...score, dynamics: [], hairpins: [] }, {}, 'treble', null, WIDE);
    expect(drawn.texts).toContain('= 90');
    const mark = Math.round(onsetX(4000)) + 0.5 + 16;
    expect(drawn.ellipses.some((ellipse) => Math.abs(ellipse.x - mark) < 1e-6)).toBe(true);
  });

  it('keeps the tempo mark while its downbeat shows, after the line has scrolled away', () => {
    // Scrolled so the downbeat stands just inside the gutter's edge: its line,
    // a head-width further left, has gone under the gutter; the mark has not.
    const notes: NoteEvent[] = Array.from({ length: 8 }, (_, beat) => ({
      id: `t${beat}`,
      midi: 60,
      startMs: beat * 1000,
      durationMs: 1000,
      velocity: 0.7,
    }));
    const score = layoutScore(notes, { ...LAYOUT_OPTS, tempoChanges: [{ atMs: 4000, bpm: 90 }] });
    const scrollMs = 4000 + (SCORE_LEAD_IN + 4) / WIDE.pxPerMs;
    const drawn = render({ ...score, dynamics: [], hairpins: [] }, {}, 'treble', null, {
      ...WIDE,
      scrollMs,
    });
    const onset = gutterWidthFor(0) - 4;
    expect(barLines(drawn).filter((x) => Math.abs(x - onset) < GAP * 3)).toEqual([]);
    expect(drawn.texts).toContain('= 90');
  });

  it('keeps the playhead on the onset it is sounding', () => {
    const drawn = render(quarters(2), { playheadMs: 4000 }, 'treble', null, WIDE);
    const line = drawn.paths.find((path) => path.style === playhead && path.width === 1.6);
    expect(line?.points[0]?.x).toBeCloseTo(onsetX(4000));
  });

  it('announces a clef change just before the bar line, not over it', () => {
    // The left hand's second bar is written high, under a treble clef.
    const notes: NoteEvent[] = [
      { id: 'a', midi: 48, startMs: 0, durationMs: 4000, velocity: 0.7, staff: 'bass' },
      {
        id: 'b',
        midi: 67,
        startMs: 4000,
        durationMs: 4000,
        velocity: 0.7,
        staff: 'bass',
        clef: 'treble',
      },
    ];
    const layout = { ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [] };
    const drawn = render(layout, {}, 'grand', null, WIDE);
    const line = lineNear(drawn, 4000);
    // The gutter is washed too; the clef's own wash is the one out in the music.
    const wash = drawn.rects.find((rect) => rect.style === gutterBg && rect.x > gutterWidthFor(0));
    expect(wash).toBeDefined();
    expect((wash?.x ?? 0) + (wash?.width ?? 0)).toBeLessThanOrEqual(line);
  });

  describe('the closing line', () => {
    /** Every final bar line's x: the thick ones. */
    const finalLines = (drawn: Recorder): number[] =>
      drawn.paths
        .filter((path) => path.style === barLine && path.width === 2)
        .map((path) => (path.points[0] as Point).x);

    it.each(['lesson', 'bare'] as const)(
      'ends a %s view at its last written bar, not after the empty bar it spills',
      (chrome) => {
        // A bar of quarters fills its bar, so the layout spills a second one.
        const filled = quarters(1);
        expect(filled.totalMs).toBe(8000);
        const drawn = render(filled, {}, 'treble', chrome, WIDE);
        expect(finalLines(drawn)).toEqual([Math.round(onsetX(4000)) + 0.5]);
        expect(barLines(drawn)).toEqual([]);
      },
    );

    it('keeps the empty bar on the Play page, where a recording carries on into it', () => {
      const drawn = render(quarters(1), {}, 'treble', null, WIDE);
      expect(finalLines(drawn)).toEqual([Math.round(onsetX(8000)) + 0.5]);
      expect(barLines(drawn)).toEqual([Math.round(onsetX(4000)) + 0.5]);
    });

    it('closes a system the music runs on from with a plain bar line', () => {
      const drawn = render(quarters(1), {}, 'treble', 'bare', { ...WIDE, systemBreakMs: 4000 });
      expect(finalLines(drawn)).toEqual([]);
      expect(barLines(drawn)).toEqual([Math.round(onsetX(4000)) + 0.5]);
    });

    it('closes a system at its break under a note held on across it', () => {
      // A whole note from beat 3 is laid out tied on into the next bar, so the
      // layout's own music runs a bar past the break. The system still closes
      // at the break, and only there.
      const held = written([
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 4],
      ]);
      expect(scoreEndMs(held, 'bare')).toBe(8000);
      const drawn = render(held, {}, 'treble', 'bare', { ...WIDE, systemBreakMs: 4000 });
      expect(finalLines(drawn)).toEqual([]);
      const lines = [...new Set(barLines(drawn))];
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBeGreaterThan(onsetX(3000));
      expect(lines[0]).toBeLessThan(onsetX(4000));
    });

    it('ends a bar left partly silent at the bar, not at its last note', () => {
      const drawn = render({ ...bar([0, 1]), rests: [] }, {}, 'treble', 'lesson', WIDE);
      expect(finalLines(drawn)).toEqual([Math.round(onsetX(4000)) + 0.5]);
    });

    it('gives a snippet the span its closing line stands at', () => {
      // `StaffSnippet` fits its width to this, so the line lands at its edge.
      const filled = quarters(2);
      expect(scoreEndMs(filled)).toBe(filled.totalMs);
      expect(scoreEndMs(filled, 'full')).toBe(12000);
      expect(scoreEndMs(filled, 'lesson')).toBe(8000);
      expect(scoreEndMs(filled, 'bare')).toBe(8000);
      // An empty stave still keeps its one bar.
      const empty = layoutScore([], LAYOUT_OPTS);
      expect(scoreEndMs(empty, 'lesson')).toBe(empty.totalMs);
      expect(empty.totalMs).toBeGreaterThan(0);
    });
  });
});
