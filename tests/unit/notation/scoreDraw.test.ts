import { describe, expect, it, vi } from 'vitest';
import type { NoteEvent, NoteStaff, TimeSignature } from '@/domain/takeTypes';
import type { MusicGlyphName } from '@/features/notation/glyphs/musicGlyphMetrics';
import type { LayoutOptions, ScoreLayout } from '@/features/notation/notationLayout';
import type {
  ScoreChrome,
  ScoreRenderInput,
  ScoreView,
  StaffMode,
} from '@/features/notation/scoreRenderer';

/**
 * The first test to actually call `drawScore`. It records what the renderer
 * asks the context to do rather than what it paints, which is enough to pin
 * *why* a head is the colour it is — the thing that has no other net.
 *
 * Every music symbol on the live score is a glyph of the music font, drawn
 * through `drawGlyph`. The calls are passed straight through to the real
 * function, so their paths and fills still reach the recording context, and
 * each one is logged on the way: which glyph, where its origin went, the staff
 * space it was drawn to, and the colour and alpha it was filled in.
 */
interface GlyphCall {
  name: MusicGlyphName;
  x: number;
  y: number;
  space: number;
  fill: string;
  alpha: number;
}

/** Every glyph drawn in this file, in order; each render keeps its own slice. */
const glyphLog: GlyphCall[] = [];
/**
 * Set while a glyph's outline is being filled, so the recording context can
 * tell a glyph's fill from a shape the renderer fills itself — a beam, a tie.
 */
let fillingGlyph = false;

vi.doMock('@/features/notation/glyphs/drawGlyph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/notation/glyphs/drawGlyph')>();
  return {
    ...actual,
    drawGlyph: (...args: Parameters<typeof actual.drawGlyph>): void => {
      const [ctx, name, x, y, space] = args;
      const alpha = (ctx as unknown as { globalAlpha?: number }).globalAlpha ?? 1;
      glyphLog.push({ name, x, y, space, fill: String(ctx.fillStyle), alpha });
      fillingGlyph = true;
      try {
        actual.drawGlyph(...args);
      } finally {
        fillingGlyph = false;
      }
    },
  };
});

// One import at a time, after the mock: imports started together can each
// replay vitest's mock queue, and one of them can bind the real module.
const { MUSIC_GLYPH_ANCHORS, MUSIC_GLYPH_METRICS } =
  await import('@/features/notation/glyphs/musicGlyphMetrics');
const { flagAnchorYG, flaggedStemG, STEM_ANCHOR_RISE_G } =
  await import('@/features/notation/glyphs/engravingGlyphs');
const { layoutScore } = await import('@/features/notation/notationLayout');
const {
  computeScoreGeometry,
  drawScore,
  GAP,
  gutterWidthFor,
  SCORE_LEAD_IN,
  SCORE_PALETTES,
  scoreEndMs,
} = await import('@/features/notation/scoreRenderer');
const { basePxPerMsFor } = await import('@/features/notation/scoreZoom');

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

/** A quadratic curve in a filled path: from `from`, pulled toward `control`, to `to`. */
interface Curve {
  from: Point;
  control: Point;
  to: Point;
}

/**
 * A shape the renderer filled itself, rather than a glyph's outline: its
 * points, the curves among them, and the fillStyle in force.
 */
interface FilledShape {
  style: string;
  points: Point[];
  curves: Curve[];
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  /** Every fillStyle in force at the moment `fill()` was called. */
  fills: string[];
  strokes: string[];
  texts: string[];
  /** Every text drawn, with where its baseline starts. */
  labels: { text: string; x: number; y: number }[];
  /** Every path stroked, in order. Enough to find where a line was drawn. */
  paths: StrokedPath[];
  /** Every shape filled that is not a glyph — a beam, a tie — in order. */
  shapes: FilledShape[];
  /** Every `fillRect`, with the fillStyle in force — a wash, the gutter. */
  rects: { style: string; x: number; width: number }[];
  /** Every paint, in order, as "fill:", "stroke:" or "rect:" and the style. */
  ops: string[];
}

/** What one render drew: the recording, the glyphs among it, and the view it drew. */
interface Drawn extends Recorder {
  glyphs: GlyphCall[];
  view: ScoreView;
}

interface CanvasState {
  offset: Point;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
}

function recordingContext(): Recorder {
  const fills: string[] = [];
  const strokes: string[] = [];
  const texts: string[] = [];
  const labels: { text: string; x: number; y: number }[] = [];
  const paths: StrokedPath[] = [];
  const shapes: FilledShape[] = [];
  const rects: { style: string; x: number; width: number }[] = [];
  const ops: string[] = [];
  // Only translation is tracked: the renderer places everything else itself.
  let state: CanvasState = {
    offset: { x: 0, y: 0 },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
  };
  const saved: CanvasState[] = [];
  let path: Point[] = [];
  let curves: Curve[] = [];
  const at = (x: number, y: number): Point => ({ x: state.offset.x + x, y: state.offset.y + y });

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
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
    },
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => void saved.push({ ...state }),
    restore: () => {
      state = saved.pop() ?? state;
    },
    translate: (x: number, y: number) => {
      state.offset = at(x, y);
    },
    rotate: () => {},
    scale: () => {},
    setTransform: () => {
      state.offset = { x: 0, y: 0 };
    },
    beginPath: () => {
      path = [];
      curves = [];
    },
    closePath: () => {},
    moveTo: (x: number, y: number) => void path.push(at(x, y)),
    lineTo: (x: number, y: number) => void path.push(at(x, y)),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
      const from = path[path.length - 1];
      if (from) curves.push({ from, control: at(cx, cy), to: at(x, y) });
      path.push(at(x, y));
    },
    bezierCurveTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    clearRect: () => {},
    fillRect: (x: number, _y: number, width: number) => {
      rects.push({ style: state.fillStyle, x: state.offset.x + x, width });
      ops.push(`rect:${state.fillStyle}`);
    },
    strokeRect: () => {},
    fill: () => {
      fills.push(state.fillStyle);
      ops.push(`fill:${state.fillStyle}`);
      if (!fillingGlyph) shapes.push({ style: state.fillStyle, points: path, curves });
    },
    stroke: () => {
      strokes.push(state.strokeStyle);
      ops.push(`stroke:${state.strokeStyle}`);
      paths.push({ style: state.strokeStyle, width: state.lineWidth, points: path });
    },
    fillText: (text: string, x: number, y: number) => {
      texts.push(text);
      labels.push({ text, ...at(x, y) });
    },
    measureText: () => ({ width: 40 }) as TextMetrics,
    clip: () => {},
    setLineDash: () => {},
  } as unknown as CanvasRenderingContext2D;

  return { ctx, fills, strokes, texts, labels, paths, shapes, rects, ops };
}

const LAYOUT_OPTS = {
  bpm: 60,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16',
  minMeasures: 1,
} as const satisfies LayoutOptions;

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
  options: LayoutOptions = LAYOUT_OPTS,
): ScoreLayout {
  const notes: NoteEvent[] = entries.map(([beat, beats, midi = 60], index) => ({
    id: `w${index}`,
    midi,
    startMs: beat * 1000,
    durationMs: beats * 1000,
    velocity: 0.7,
    staff,
  }));
  const score = layoutScore(notes, options);
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
  overrides: Partial<
    Pick<ScoreView, 'widthPx' | 'pxPerMs' | 'scrollMs' | 'systemBreakMs' | 'gutterPx'>
  > = {},
): Drawn {
  const geometry = computeScoreGeometry(layout, { staves, ...(chrome === null ? {} : { chrome }) });
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
  const from = glyphLog.length;
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
  return { ...recorder, glyphs: glyphLog.slice(from), view };
}

/** A glyph's box in staff spaces, `[left, bottom, right, top]`, y up — the font's own. */
const box = (name: MusicGlyphName) => MUSIC_GLYPH_METRICS[name].bbox;
/** How far right of its origin a glyph's ink is centred, in staff spaces. */
const centreOf = (name: MusicGlyphName): number => (box(name)[0] + box(name)[2]) / 2;
/** Half a glyph's ink width, in staff spaces. */
const halfOf = (name: MusicGlyphName): number => (box(name)[2] - box(name)[0]) / 2;

/** Half a black head's width, and a whole note's, in pixels. */
const HEAD_HALF = halfOf('noteheadBlack') * GAP;
const WHOLE_HALF = halfOf('noteheadWhole') * GAP;
/** The stem's width on screen. */
const STEM_W = 1.6;

interface Head {
  name: MusicGlyphName;
  /** Where the head is centred: its glyph's origin, plus half its width. */
  x: number;
  y: number;
  half: number;
  fill: string;
}

/** Every notehead drawn, by its centre. */
function heads(drawn: Drawn): Head[] {
  return drawn.glyphs
    .filter((glyph) => glyph.name.startsWith('notehead'))
    .map((glyph) => ({
      name: glyph.name,
      x: glyph.x + centreOf(glyph.name) * glyph.space,
      y: glyph.y,
      half: halfOf(glyph.name) * glyph.space,
      fill: glyph.fill,
    }));
}

const named = (drawn: Drawn, name: MusicGlyphName): GlyphCall[] =>
  drawn.glyphs.filter((glyph) => glyph.name === name);

/** A box of ink on the canvas, y down. */
interface Ink {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A glyph's ink as drawn: the font's box, placed and scaled. */
function inkOf(glyph: GlyphCall): Ink {
  const [left, bottom, right, top] = box(glyph.name);
  return {
    left: glyph.x + left * glyph.space,
    right: glyph.x + right * glyph.space,
    top: glyph.y - top * glyph.space,
    bottom: glyph.y - bottom * glyph.space,
  };
}

/** The box a path's points span: one stroked, or a shape filled. */
function pathInk(path: { points: readonly Point[] }): Ink {
  const xs = path.points.map((point) => point.x);
  const ys = path.points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** The colour of each head drawn, in the order drawn. */
const headFills = (drawn: Drawn): string[] => heads(drawn).map((head) => head.fill);

const { note, highlight } = SCORE_PALETTES.dark;

describe('drawScore note highlighting', () => {
  it('draws a head in the plain note colour by default', () => {
    expect(headFills(render(oneNote(60)))).toEqual([note]);
  });

  it('lights the head whose midi the user is holding', () => {
    expect(headFills(render(oneNote(60), { litMidis: new Set([60]) }))).toEqual([highlight]);
  });

  it('leaves a head alone when a different key is held', () => {
    expect(headFills(render(oneNote(60), { litMidis: new Set([62]) }))).toEqual([note]);
  });

  it('does not light the octave above — the written note is the written note', () => {
    expect(headFills(render(oneNote(60), { litMidis: new Set([72]) }))).toEqual([note]);
  });

  it('treats an empty held set as nothing held', () => {
    expect(headFills(render(oneNote(60), { litMidis: new Set() }))).toEqual([note]);
  });

  it('lights a head by which note it is, when asked by id', () => {
    expect(headFills(render(oneNote(60), { litNoteIds: new Set(['n']) }))).toEqual([highlight]);
  });

  it('lights by id instead of by pitch, never both', () => {
    // A lesson walking a line passes ids; a held key must not then light every
    // head of its pitch on top of them.
    const drawn = render(oneNote(60), { litNoteIds: new Set(), litMidis: new Set([60]) });
    expect(headFills(drawn)).toEqual([note]);
  });

  it('lights one of two heads of the same pitch, by id', () => {
    const drawn = render(bar([0, 1]), { litNoteIds: new Set(['n0']) });
    expect(headFills(drawn)).toEqual([highlight, note]);
    const both = render(bar([0, 1]), { litMidis: new Set([60]) });
    expect(headFills(both)).toEqual([highlight, highlight]);
  });

  it('fills a hollow head as the font draws it, rather than stroking an outline', () => {
    // The whole note's glyph carries its own hole, so it is filled like any
    // other; a whole note has no stem, so nothing at all is stroked in ink.
    const drawn = render(oneNote(60));
    expect(heads(drawn).map((head) => head.name)).toEqual(['noteheadWhole']);
    expect(drawn.strokes).not.toContain(note);
    const half = render(written([[0, 2]]));
    expect(heads(half).map((head) => head.name)).toEqual(['noteheadHalf']);
  });
});

describe('drawScore bare chrome', () => {
  it('prints no time signature and no measure number', () => {
    const drawn = render(oneNote(60));
    expect(drawn.glyphs.filter((glyph) => glyph.name.startsWith('timeSig'))).toEqual([]);
    expect(drawn.texts).toEqual([]);
  });
});

describe('drawScore single-staff filtering', () => {
  // A single-staff view collapses `bassTop` onto `trebleTop`, so a chord from
  // the staff it is not showing is not harmlessly off-canvas: it lands on the
  // staff that *is* drawn, measured from the other clef's reference line —
  // roughly a sixth from where it belongs, with nothing to say so.
  it('draws a note whose staff the view shows', () => {
    const drawn = render(oneNote(60, 'bass'), { litMidis: new Set([60]) }, 'bass');
    expect(headFills(drawn)).toEqual([highlight]);
  });

  it('leaves out a note belonging to the staff the view does not show', () => {
    // C4 with no hint resolves to the treble staff, so a bass-only view has
    // no business drawing it at all.
    const drawn = render(oneNote(60), { litMidis: new Set([60]) }, 'bass');
    expect(heads(drawn)).toEqual([]);
  });

  it('draws both staves of a grand view', () => {
    const bass = render(oneNote(53, 'bass'), { litMidis: new Set([53]) }, 'grand');
    expect(headFills(bass)).toEqual([highlight]);
    const treble = render(oneNote(60, 'treble'), { litMidis: new Set([60]) }, 'grand');
    expect(headFills(treble)).toEqual([highlight]);
  });
});

describe('drawScore clefs', () => {
  // The gutter names the clef in force with the font's clef, so which clef a
  // lesson snippet draws is assertable rather than something only a
  // screenshot sees.
  const clefs = (drawn: Drawn) =>
    drawn.glyphs.filter((glyph) => glyph.name.endsWith('Clef')).map((glyph) => glyph.name);

  it('draws a treble clef, and only that, for a treble view', () => {
    expect(clefs(render(oneNote(60), {}, 'treble'))).toEqual(['gClef']);
  });

  it('draws an F clef, and only that, for a bass view', () => {
    expect(clefs(render(oneNote(53, 'bass'), {}, 'bass'))).toEqual(['fClef']);
  });

  it('draws both clefs for a grand view', () => {
    expect(clefs(render(oneNote(60, 'treble'), {}, 'grand'))).toEqual(['gClef', 'fClef']);
  });

  it('sets each clef on the line it names, at the gutter’s start, in the dimmer ink', () => {
    const drawn = render(oneNote(60, 'treble'), {}, 'grand');
    const { noteDim } = SCORE_PALETTES.dark;
    const [g] = named(drawn, 'gClef');
    const [f] = named(drawn, 'fClef');
    // The G clef curls round the G line, the second from the bottom; the F
    // clef's dots stand either side of the F line, the second from the top.
    expect(g).toMatchObject({ x: 8, y: drawn.view.trebleTop + 3 * GAP, space: GAP, fill: noteDim });
    expect(f).toMatchObject({ x: 8, y: drawn.view.bassTop + GAP, space: GAP, fill: noteDim });
  });
});

describe('drawScore lesson chrome', () => {
  const { rest } = SCORE_PALETTES.dark;
  const rests = (drawn: Drawn) =>
    drawn.glyphs
      .filter((glyph) => glyph.name.startsWith('rest'))
      .map((glyph) => [glyph.name, glyph.fill]);

  it('draws the rests the engraver derived', () => {
    // A bar with a hole on beat two. `StaffSnippet` blanks rests by default,
    // because a worked example is not a performance — but the rhythm chapter
    // teaches the rest as a symbol, so it asks for them back.
    const drawn = render(bar([0, 2, 3]), {}, 'treble', 'lesson');
    expect(rests(drawn)).toEqual([['restQuarter', rest]]);
  });

  it('draws none once they are blanked', () => {
    const withRests = bar([0, 2, 3]);
    const drawn = render({ ...withRests, rests: [] }, {}, 'treble', 'lesson');
    expect(rests(drawn)).toEqual([]);
    expect(drawn.fills).not.toContain(rest);
  });

  it('prints the time signature under lesson chrome, and not under bare', () => {
    // 4/4 is two 4s, one over the other, on the single staff drawn.
    expect(named(render(bar([0, 1, 2, 3]), {}, 'treble', 'lesson'), 'timeSig4')).toHaveLength(2);
    // The regression guard: adding a third value changed nothing for 'bare'.
    expect(named(render(bar([0, 1, 2, 3]), {}, 'treble', 'bare'), 'timeSig4')).toEqual([]);
  });

  it('leaves the measure number off under lesson chrome', () => {
    const full = render(bar([0, 1, 2, 3]), {}, 'treble', 'full');
    const lesson = render(bar([0, 1, 2, 3]), {}, 'treble', 'lesson');
    expect(full.texts).toContain('1');
    expect(lesson.texts).toEqual([]);
  });

  it('suppresses the empty spill bar, as bare does', () => {
    // A bar that is exactly filled spills a second, empty measure into the
    // layout, and that measure brings a bar line and a whole rest with it. A
    // lesson draws the music, not the silence after it. (Its closing line
    // stands where the spill bar's opening one would, thick: see below.)
    const filled = bar([0, 1, 2, 3]);
    const spill = (drawn: Drawn) => ({
      lines: drawn.paths.filter(
        (path) => path.style === SCORE_PALETTES.dark.barLine && path.width === 1,
      ).length,
      rests: named(drawn, 'restWhole').length,
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
    expect(named(drawn, 'timeSig4')).toHaveLength(2);
    expect(drawn.texts).toContain('1');
    expect(drawn.fills).toContain(rest);
  });
});

describe('drawScore time signature', () => {
  const { noteDim } = SCORE_PALETTES.dark;
  const digits = (drawn: Drawn) => drawn.glyphs.filter((glyph) => glyph.name.startsWith('timeSig'));
  /** The ink of a row of digits drawn on one line, left and right. */
  const rowInk = (row: GlyphCall[]) => ({
    left: Math.min(...row.map((glyph) => glyph.x + box(glyph.name)[0] * glyph.space)),
    right: Math.max(...row.map((glyph) => glyph.x + box(glyph.name)[2] * glyph.space)),
  });

  it('centres each number on its half of the staff, full size where it fits', () => {
    const drawn = render(bar([0, 1, 2, 3]), {}, 'treble', 'lesson');
    const [upper, lower] = digits(drawn);
    const top = drawn.view.trebleTop;
    for (const [glyph, y] of [
      [upper, top + GAP],
      [lower, top + 3 * GAP],
    ] as const) {
      expect(glyph).toMatchObject({ name: 'timeSig4', y, space: GAP, fill: noteDim });
      // Centred 14 px in from the gutter's edge, by the digit's advance.
      const advance = MUSIC_GLYPH_METRICS.timeSig4.advance * GAP;
      expect((glyph?.x ?? 0) + advance / 2).toBeCloseTo(drawn.view.gutterPx - 14, 6);
    }
  });

  it('shrinks a number too wide for the gutter, both rows alike, clear of the clef', () => {
    // The gutter keeps its width, so Learn's bars per line do not move; 12/8
    // is set smaller instead.
    const twelveEight: TimeSignature = { numerator: 12, denominator: 8 };
    const drawn = render(bar([0, 1, 2, 3]), { timeSignature: twelveEight }, 'treble', 'lesson');
    const glyphs = digits(drawn);
    expect(glyphs.map((glyph) => glyph.name)).toEqual(['timeSig1', 'timeSig2', 'timeSig8']);
    const space = glyphs[0]?.space ?? GAP;
    expect(space).toBeLessThan(GAP);
    expect(glyphs.every((glyph) => glyph.space === space)).toBe(true);
    const twelve = rowInk(glyphs.slice(0, 2));
    // Clear of the G clef's ink, and inside the gutter's edge.
    const clefRight = 8 + box('gClef')[2] * GAP;
    expect(twelve.left).toBeGreaterThan(clefRight);
    expect(twelve.right).toBeLessThan(drawn.view.gutterPx);
    expect((twelve.left + twelve.right) / 2).toBeCloseTo(drawn.view.gutterPx - 14, 0);
  });
});

describe('drawScore gutter', () => {
  const { staffLine, gutterBg, barLine, noteDim } = SCORE_PALETTES.dark;

  /**
   * Paths stroked after the gutter's fill went down: the only ones it cannot
   * hide. Strokes are recorded in order in both `ops` and `paths`, so the
   * fill's place among the ops says where to start in the paths.
   */
  const strokedOverGutter = (drawn: Recorder): StrokedPath[] => {
    let strokes = 0;
    let afterFill = -1;
    for (const op of drawn.ops) {
      if (op === `rect:${gutterBg}`) afterFill = strokes;
      if (op.startsWith('stroke:')) strokes += 1;
    }
    return afterFill < 0 ? [] : drawn.paths.slice(afterFill);
  };
  const staffLinesIn = (paths: readonly StrokedPath[]) =>
    paths.filter(
      (path) =>
        path.style === staffLine &&
        path.points.length === 2 &&
        path.points[0]?.y === path.points[1]?.y,
    );

  it('runs a lesson’s staff lines through its gutter, under the clef and signature', () => {
    // Which line a sharp sits on is all a signature says, and the gutter's
    // fill used to leave it floating on blank ground.
    const gutterPx = gutterWidthFor(2);
    const drawn = render(oneNote(67), { keySignature: 2 }, 'treble', 'lesson', { gutterPx });
    const lines = staffLinesIn(strokedOverGutter(drawn));
    expect(lines).toHaveLength(5);
    for (const line of lines) {
      // From the system's edge, not the canvas's, to the end of the gutter.
      expect(line.points[0]?.x).toBeGreaterThan(0);
      expect(line.points[1]?.x).toBe(gutterPx);
    }
  });

  it('does the same under bare chrome, and for both staves of a grand view', () => {
    expect(staffLinesIn(strokedOverGutter(render(oneNote(67), {}, 'treble', 'bare')))).toHaveLength(
      5,
    );
    const grand = render(oneNote(60, 'treble'), {}, 'grand', 'lesson');
    expect(staffLinesIn(strokedOverGutter(grand))).toHaveLength(10);
  });

  it('leaves Play’s gutter covering its lines, since the music scrolls beneath it', () => {
    expect(staffLinesIn(strokedOverGutter(render(oneNote(67), {}, 'treble', null)))).toEqual([]);
    expect(staffLinesIn(strokedOverGutter(render(oneNote(67), {}, 'treble', 'full')))).toEqual([]);
  });

  it('draws a signature on an empty stave, with no bar of music after it', () => {
    // A key quiz's picture: two sharps and nothing else.
    const empty = (fifths: number): ScoreLayout => ({
      ...layoutScore([], { ...LAYOUT_OPTS, keySignature: fifths }),
      dynamics: [],
      hairpins: [],
      rests: [],
    });
    const sharps = (drawn: Drawn) =>
      named(drawn, 'accidentalSharp').map((glyph) => [glyph.fill, glyph.y]);
    const plain = render(empty(0), {}, 'treble', 'bare');
    const signed = render(empty(2), { keySignature: 2 }, 'treble', 'bare', {
      gutterPx: gutterWidthFor(2),
    });
    expect(sharps(plain)).toEqual([]);
    // F♯ on the top line, then C♯ in the third space.
    const top = signed.view.trebleTop;
    expect(sharps(signed)).toEqual([
      [noteDim, top],
      [noteDim, top + 1.5 * GAP],
    ]);
    // No bar line inside it and no rest: the stave just closes where its bar ends.
    expect(signed.paths.filter((path) => path.style === barLine && path.width === 1)).toEqual([]);
    expect(signed.glyphs.filter((glyph) => glyph.name.startsWith('rest'))).toEqual([]);
  });
});

describe('drawScore beams', () => {
  it('lights the head that is held and leaves the beam alone', () => {
    // The answer to "what colour is a half-lit beam": nothing. A head says
    // which note is sounding; a beam belongs to the group, so there is no half
    // of one to colour. Pinned so a later refactor cannot quietly change it.
    const drawn = render(eighths([60, 62]), { litMidis: new Set([60]) });
    expect(headFills(drawn)).toEqual([highlight, note]);
    // The one highlight fill is that head's: the beam is filled in ink.
    expect(drawn.fills.filter((fill) => fill === highlight)).toHaveLength(1);
    expect(drawn.fills.filter((fill) => fill === note).length).toBeGreaterThan(1);
  });

  it('leaves out a beam belonging to the staff the view does not show', () => {
    const grand = render(eighths([48, 50], 'bass'), {}, 'grand');
    const trebleOnly = render(eighths([48, 50], 'bass'), {}, 'treble');
    expect(trebleOnly.fills.length).toBeLessThan(grand.fills.length);
    expect(heads(trebleOnly)).toEqual([]);
  });
});

describe('drawScore glyph placement', () => {
  const { noteDim, record, ghost, recordWash } = SCORE_PALETTES.dark;
  /** Three bars of 4/4 across, a beat to 50 px. */
  const WIDE = { widthPx: 800, pxPerMs: 0.05 };
  const onsetX = (ms: number): number => gutterWidthFor(0) + SCORE_LEAD_IN + ms * WIDE.pxPerMs;
  /** Every stem drawn: ink-coloured strokes at the stem's width. */
  const stems = (drawn: Drawn) =>
    drawn.paths.filter((path) => path.style === note && path.width === STEM_W);

  it('stands a stem on the head’s edge, from the head’s stem anchor', () => {
    // C4 stems up: from the right edge of its head, less half the stem, and
    // from a hair above the head's centre, where the head's own anchor says.
    const drawn = render(written([[0, 1]]), {}, 'treble', 'bare', WIDE);
    const [head] = heads(drawn);
    expect(head?.x).toBeCloseTo(onsetX(0), 6);
    const [stem] = stems(drawn);
    const x = onsetX(0) + HEAD_HALF - STEM_W / 2;
    const [from, to] = stem?.points ?? [];
    expect(from?.x).toBeCloseTo(x, 6);
    expect(from?.y).toBeCloseTo((head?.y ?? 0) - STEM_ANCHOR_RISE_G * GAP, 6);
    expect(to?.x).toBeCloseTo(x, 6);
    expect(to?.y).toBeCloseTo((head?.y ?? 0) - 3.5 * GAP, 6);
  });

  it.each([
    [0.5, 1, 'flag8thUp'],
    [0.25, 2, 'flag16thUp'],
    [0.125, 3, 'flag32ndUp'],
    [0.0625, 4, 'flag64thUp'],
  ] as const)('hangs a %s-beat note’s flags from its stem as one glyph', (beats, count, flag) => {
    const drawn = render(
      written([[0, beats]], 'treble', { ...LAYOUT_OPTS, quantization: '1/64' }),
      {},
      'treble',
      'bare',
      WIDE,
    );
    const [head] = heads(drawn);
    const [stem] = stems(drawn);
    // A 32nd's and a 64th's flags stack up past a normal stem, and their
    // anchors say how much further the stem runs to meet them.
    const tip = (head?.y ?? 0) - flaggedStemG(count, false) * GAP;
    expect(stem?.points[1]?.y).toBeCloseTo(tip, 6);
    const glyphs = drawn.glyphs.filter((glyph) => glyph.name.startsWith('flag'));
    expect(glyphs).toHaveLength(1);
    // Its origin on the stem's left edge, as far short of the tip as its anchor says.
    expect(glyphs[0]).toMatchObject({ name: flag, space: GAP, fill: note });
    expect(glyphs[0]?.x).toBeCloseTo((stem?.points[0]?.x ?? 0) - STEM_W / 2, 6);
    expect(glyphs[0]?.y).toBeCloseTo(tip + flagAnchorYG(count, false) * GAP, 6);
  });

  it('hangs a down-stem flag from the stem on the head’s left', () => {
    // F5 stems down, from the head's left edge.
    const drawn = render(written([[0, 0.5, 77]]), {}, 'treble', 'bare', WIDE);
    const [head] = heads(drawn);
    const [stem] = stems(drawn);
    const x = onsetX(0) - HEAD_HALF + STEM_W / 2;
    expect(stem?.points[0]?.x).toBeCloseTo(x, 6);
    expect(stem?.points[0]?.y).toBeCloseTo((head?.y ?? 0) + STEM_ANCHOR_RISE_G * GAP, 6);
    const [flag] = named(drawn, 'flag8thDown');
    expect(flag?.x).toBeCloseTo(x - STEM_W / 2, 6);
    const tip = (head?.y ?? 0) + flaggedStemG(1, true) * GAP;
    expect(flag?.y).toBeCloseTo(tip + flagAnchorYG(1, true) * GAP, 6);
  });

  it('sets a dot clear of the head, in the space above a line note', () => {
    // A dotted half on C4, which sits on a ledger line.
    const drawn = render(written([[0, 3]]), {}, 'treble', 'bare', WIDE);
    const [head] = heads(drawn);
    const [dot] = named(drawn, 'augmentationDot');
    expect(dot?.x).toBeCloseTo((head?.x ?? 0) + HEAD_HALF + 0.4 * GAP, 6);
    expect(dot?.y).toBeCloseTo((head?.y ?? 0) - GAP / 2, 6);
  });

  it('right-aligns a chord’s accidentals, a column pitch apart', () => {
    const spelled = (id: string, midi: number, step: 'A' | 'B' | 'C' | 'F', alter: number) => ({
      id,
      midi,
      startMs: 0,
      durationMs: 1000,
      velocity: 0.7,
      spelling: { step, alter },
    });
    // C♯4 under B♭4 share the first column: their ink ends at the same x,
    // however different their widths.
    const shared = layoutScore([spelled('c', 61, 'C', 1), spelled('b', 70, 'B', -1)], LAYOUT_OPTS);
    const drawn = render({ ...shared, rests: [] }, {}, 'treble', 'bare', WIDE);
    const inkRight = (glyph: GlyphCall | undefined) =>
      glyph ? glyph.x + box(glyph.name)[2] * glyph.space : Number.NaN;
    const columnZero = onsetX(0) - HEAD_HALF - 0.25 * GAP;
    expect(inkRight(named(drawn, 'accidentalSharp')[0])).toBeCloseTo(columnZero, 6);
    expect(inkRight(named(drawn, 'accidentalFlat')[0])).toBeCloseTo(columnZero, 6);
    // F♯5 over A♯4 are too close for one column; the lower stands a column out.
    const stacked = layoutScore([spelled('f', 78, 'F', 1), spelled('a', 70, 'A', 1)], LAYOUT_OPTS);
    const two = render({ ...stacked, rests: [] }, {}, 'treble', 'bare', WIDE);
    const sharps = named(two, 'accidentalSharp')
      .map(inkRight)
      .sort((a, b) => a - b);
    expect(sharps[0]).toBeCloseTo(columnZero - 1.4 * GAP, 6);
    expect(sharps[1]).toBeCloseTo(columnZero, 6);
  });

  it('draws a held recording note and a ghost with the font’s black head', () => {
    const empty = { ...layoutScore([], LAYOUT_OPTS), dynamics: [], hairpins: [], rests: [] };
    const drawn = render(
      empty,
      {
        recording: true,
        playheadMs: 400,
        openNotes: [{ midi: 64, startMs: 0, durationMs: 400 }],
        ghosts: [{ midi: 67, life: 0.5 }],
      },
      'treble',
      null,
      WIDE,
    );
    expect(heads(drawn).map((head) => [head.name, head.fill])).toEqual([
      ['noteheadBlack', record],
      ['noteheadBlack', ghost],
    ]);
    // The held note's head sits at its start, over the wash that runs on to now.
    expect(heads(drawn)[0]?.x).toBeCloseTo(onsetX(0), 6);
    expect(drawn.rects.some((rect) => rect.style === recordWash && rect.x === onsetX(0))).toBe(
      true,
    );
    // The ghost fades with the life it has left.
    expect(named(drawn, 'noteheadBlack')[1]?.alpha).toBe(0.5);
  });

  it('numbers a tuplet with the font’s tuplet digits, centred on its beam', () => {
    // Six sixteenths in the time of four, declared, at C5: they stem down, so
    // the numeral goes under the beam.
    const sextuplet: NoteEvent[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      midi: 72,
      startMs: Math.round((i * 1000) / 6),
      durationMs: 166,
      velocity: 0.5,
      tuplet: { actual: 3, normal: 2, unit: 16 },
    }));
    const layout = layoutScore(sextuplet, { ...LAYOUT_OPTS, quantization: '1/64' });
    expect(layout.beams[0]?.tupletCount).toBe(6);
    const drawn = render({ ...layout, rests: [] }, {}, 'treble', 'bare', WIDE);
    const [six] = named(drawn, 'tuplet6');
    expect(six).toMatchObject({ space: 0.8 * GAP, fill: note });
    const tips = stems(drawn)
      .map((path) => path.points[1] as Point)
      .sort((a, b) => a.x - b.x);
    const first = tips[0] as Point;
    const last = tips[tips.length - 1] as Point;
    const advance = MUSIC_GLYPH_METRICS.tuplet6.advance * (six?.space ?? 0);
    expect((six?.x ?? 0) + advance / 2).toBeCloseTo((first.x + last.x) / 2, 6);
    // Its top clear below the beam, which is half a space thick.
    const top = (six?.y ?? 0) - box('tuplet6')[3] * (six?.space ?? 0);
    expect(top).toBeGreaterThan((first.y + last.y) / 2 + 0.25 * GAP);
  });

  it('writes a dynamic as the font’s one glyph, centred by its optical centre', () => {
    const layout: ScoreLayout = {
      ...bar([0, 1, 2, 3]),
      dynamics: [
        { atMs: 0, mark: 'fff' },
        { atMs: 2000, mark: 'p' },
      ],
    };
    const drawn = render(layout, {}, 'treble', null, WIDE);
    const space = 0.9 * GAP;
    const [fff] = named(drawn, 'dynamicFFF');
    const [p] = named(drawn, 'dynamicPiano');
    for (const mark of [fff, p]) {
      expect(mark).toMatchObject({ y: drawn.view.dynamicsRow, space, fill: noteDim });
    }
    const optical = (name: 'dynamicFFF' | 'dynamicPiano') =>
      MUSIC_GLYPH_ANCHORS[name].opticalCenter[0] * space;
    expect((p?.x ?? 0) + optical('dynamicPiano')).toBeCloseTo(onsetX(2000), 6);
    // An fff on the very first note would reach back under the gutter, which
    // is painted last; it is nudged clear, its ink two pixels off the edge.
    expect((fff?.x ?? 0) + box('dynamicFFF')[0] * space).toBeCloseTo(drawn.view.gutterPx + 2, 6);
  });

  it('labels an 8va with the font’s glyph and starts its line after it', () => {
    const layout: ScoreLayout = {
      ...bar([0, 1, 2, 3], 84),
      octaves: [{ staff: 'treble', fromMs: 0, toMs: 3000, up: true }],
    };
    const drawn = render(layout, {}, 'treble', null, WIDE);
    const space = 0.6 * GAP;
    const [label] = named(drawn, 'ottavaAlta');
    expect(label).toMatchObject({ space, fill: noteDim });
    expect(label?.x).toBeCloseTo(onsetX(0) - HEAD_HALF, 6);
    // Its ink centred on the line.
    const [, bottom, , top] = box('ottavaAlta');
    const lineY = (label?.y ?? 0) - ((bottom + top) / 2) * space;
    const dashed = drawn.paths.find((path) => path.style === noteDim && path.width === 1.1);
    const lineFrom = (label?.x ?? 0) + MUSIC_GLYPH_METRICS.ottavaAlta.advance * space + 0.4 * GAP;
    expect(dashed?.points[0]?.x).toBeCloseTo(lineFrom, 6);
    expect(dashed?.points[0]?.y).toBeCloseTo(lineY, 6);
  });
});

describe('drawScore octave lines', () => {
  const { noteDim, staffLine, rest } = SCORE_PALETTES.dark;
  /** Three bars of 4/4 across, a beat to 50 px. */
  const WIDE = { widthPx: 800, pxPerMs: 0.05 };
  /** The clear space an octave line's mark keeps from anything under it. */
  const CLEAR = 0.5 * GAP;

  /**
   * One octave line's mark: its label's ink, and the line and hook stroked
   * after it — the box they fill together.
   */
  const markOf = (drawn: Drawn, name: 'ottavaAlta' | 'ottavaBassaVb'): Ink => {
    const [label] = named(drawn, name);
    expect(label).toBeDefined();
    const strokes = drawn.paths
      .filter((path) => path.style === noteDim && path.width === 1.1)
      .map(pathInk);
    return [inkOf(label as GlyphCall), ...strokes].reduce((a, b) => ({
      left: Math.min(a.left, b.left),
      right: Math.max(a.right, b.right),
      top: Math.min(a.top, b.top),
      bottom: Math.max(a.bottom, b.bottom),
    }));
  };

  /**
   * The notes' ink out in the music: heads, accidentals, dots and flags, and
   * the stems and ledger lines stroked for them.
   */
  const noteInk = (drawn: Drawn): Ink[] => [
    ...drawn.glyphs
      .filter((glyph) => /^(notehead|accidental|augmentationDot|flag)/.test(glyph.name))
      .map(inkOf)
      .filter((ink) => ink.left > drawn.view.gutterPx),
    ...drawn.paths
      .map((path) => ({ path, ink: pathInk(path) }))
      .filter(
        ({ path, ink }) =>
          path.width === STEM_W || (path.style === staffLine && ink.right - ink.left < 3 * GAP),
      )
      .map(({ ink }) => ink),
  ];
  const highest = (inks: readonly Ink[]): number => Math.min(...inks.map((ink) => ink.top));
  const lowest = (inks: readonly Ink[]): number => Math.max(...inks.map((ink) => ink.bottom));

  /** A bar of C4, then a bar of C6s: written an octave down, on C5, under an 8va. */
  const intoBarTwo = (): ScoreLayout =>
    written([
      [0, 4, 60],
      [4, 1, 84],
      [5, 1, 84],
      [6, 1, 84],
      [7, 1, 84],
    ]);

  it('leaves the line 2.4 spaces up where nothing crowds it', () => {
    const layout = intoBarTwo();
    expect(layout.octaves).toEqual([{ staff: 'treble', fromMs: 4000, toMs: 7000, up: true }]);
    // A lesson draws no bar numbers, and the heads, on C5, sit in the staff.
    const drawn = render(layout, {}, 'treble', 'lesson', WIDE);
    const [label] = named(drawn, 'ottavaAlta');
    const [, bottom, , top] = box('ottavaAlta');
    const lineY = (label?.y ?? 0) - ((bottom + top) / 2) * 0.6 * GAP;
    expect(lineY).toBeCloseTo(drawn.view.trebleTop - 2.4 * GAP, 6);
  });

  it('rises clear of the heads and ledger lines it covers', () => {
    // C7s, written an octave down on C6's two ledger lines: 2.4 spaces up, the
    // line ran through their heads and the label sat on the first.
    const layout = bar([0, 1, 2, 3], 96);
    expect(layout.octaves).toEqual([{ staff: 'treble', fromMs: 0, toMs: 3000, up: true }]);
    const drawn = render(layout, {}, 'treble', 'lesson', WIDE);
    expect(markOf(drawn, 'ottavaAlta').bottom).toBeCloseTo(highest(noteInk(drawn)) - CLEAR, 6);
  });

  it('rises clear of an accidental standing taller than its head', () => {
    // B♭6s, written B♭5: the flat's ink reaches well above the head it alters.
    const notes: NoteEvent[] = [0, 1, 2, 3].map((beat) => ({
      id: `f${beat}`,
      midi: 94,
      startMs: beat * 1000,
      durationMs: 1000,
      velocity: 0.7,
      staff: 'treble',
      spelling: { step: 'B', alter: -1 },
    }));
    const layout = { ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [] };
    expect(layout.octaves).toHaveLength(1);
    const drawn = render(layout, {}, 'treble', 'lesson', WIDE);
    const [flat] = named(drawn, 'accidentalFlat');
    const [head] = heads(drawn);
    expect(inkOf(flat as GlyphCall).top).toBeLessThan((head?.y ?? 0) - GAP);
    expect(markOf(drawn, 'ottavaAlta').bottom).toBeCloseTo(highest(noteInk(drawn)) - CLEAR, 6);
  });

  it('rises clear of the stems and flags of an upper voice', () => {
    // Two voices, all of it above C6: E7 eighths stemming up over C7 quarters.
    // The upper stems reach three and a half spaces above heads already over the staff.
    const notes: NoteEvent[] = [0, 1, 2, 3].flatMap((beat): NoteEvent[] => [
      {
        id: `u${beat}`,
        midi: 100,
        startMs: beat * 1000,
        durationMs: 500,
        velocity: 0.7,
        staff: 'treble',
        voice: 0,
      },
      {
        id: `l${beat}`,
        midi: 96,
        startMs: beat * 1000,
        durationMs: 1000,
        velocity: 0.7,
        staff: 'treble',
        voice: 1,
      },
    ]);
    const layout = { ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [] };
    expect(layout.octaves).toHaveLength(1);
    const upper = layout.chords.filter((chord) => chord.voice === 0);
    expect(upper.every((chord) => !chord.stemDown && chord.beamId === null)).toBe(true);
    const drawn = render(layout, {}, 'treble', 'lesson', WIDE);
    expect(named(drawn, 'flag8thUp')).toHaveLength(4);
    expect(markOf(drawn, 'ottavaAlta').bottom).toBeCloseTo(highest(noteInk(drawn)) - CLEAR, 6);
  });

  it('takes the row above the bar numbers on the Play page', () => {
    // The label starts over bar 2's number. The heads under it are low enough
    // to leave the line where it stood; the number is not.
    const drawn = render(intoBarTwo(), {}, 'treble', null, WIDE);
    const number = drawn.labels.find((label) => label.text === '2');
    expect(number).toBeDefined();
    const mark = markOf(drawn, 'ottavaAlta');
    expect(Math.abs(mark.left - (number?.x ?? 0))).toBeLessThan(GAP);
    // A numeral's ink rises about three quarters of its size, 10 px, above its baseline.
    expect(mark.bottom).toBeCloseTo((number?.y ?? 0) - 7.5 - CLEAR, 6);
  });

  it('lifts a tempo mark over its bar above the line', () => {
    // Bar 2 goes to 90 bpm, and its four C6s go under an 8va.
    const beat = 60_000 / 90;
    const notes: NoteEvent[] = [
      { id: 'w', midi: 60, startMs: 0, durationMs: 4000, velocity: 0.7 },
      ...[0, 1, 2, 3].map((i) => ({
        id: `q${i}`,
        midi: 84,
        startMs: Math.round(4000 + i * beat),
        durationMs: Math.round(beat),
        velocity: 0.7,
      })),
    ];
    const score = layoutScore(notes, { ...LAYOUT_OPTS, tempoChanges: [{ atMs: 4000, bpm: 90 }] });
    const layout = { ...score, dynamics: [], hairpins: [] };
    expect(layout.octaves).toHaveLength(1);
    const drawn = render(layout, {}, 'treble', null, WIDE);
    const mark = markOf(drawn, 'ottavaAlta');
    const [quarter] = named(drawn, 'metNoteQuarterUp');
    const number = drawn.labels.find((label) => label.text === '= 90');
    expect(quarter).toBeDefined();
    // The number stands on the baseline, the note a pixel above it.
    expect(number?.y).toBeCloseTo(mark.top - CLEAR, 6);
    expect(inkOf(quarter as GlyphCall).bottom).toBeCloseTo(mark.top - CLEAR - 1, 6);
    // All of it still on the canvas.
    expect(inkOf(quarter as GlyphCall).top).toBeGreaterThanOrEqual(0);
  });

  it('keeps a line over the highest notes inside the canvas', () => {
    // C8s, written C7 an octave down, five ledger lines over the staff.
    const drawn = render(bar([0, 1, 2, 3], 108), {}, 'treble', null, WIDE);
    expect(markOf(drawn, 'ottavaAlta').top).toBeGreaterThanOrEqual(0);
  });

  /**
   * Quarters on the pitches given, the line over the two of them `covered`
   * names: the others stand beside it, where its label or hook can reach.
   */
  const beside = (midis: readonly number[], covered: readonly [number, number]): ScoreLayout => ({
    ...written(midis.map((midi, beat) => [beat, 1, midi] as const)),
    octaves: [{ staff: 'treble', fromMs: covered[0] * 1000, toMs: covered[1] * 1000, up: true }],
  });
  /** The notes' ink under a mark, however little of it. */
  const inkUnder = (drawn: Drawn, mark: Ink): Ink[] =>
    noteInk(drawn).filter((ink) => ink.left < mark.right && ink.right > mark.left);

  it('rises clear of every chord its hook stands over, however many', () => {
    // 6 px to the beat, the hook past the second C5 stands over the E4 after
    // it and over the B5 after that.
    const drawn = render(beside([72, 72, 64, 83], [0, 1]), {}, 'treble', 'lesson', {
      widthPx: 800,
      pxPerMs: 6 / 1000,
    });
    const mark = markOf(drawn, 'ottavaAlta');
    expect(mark.bottom).toBeCloseTo(highest(inkUnder(drawn, mark)) - CLEAR, 6);
    expect(mark.top).toBeGreaterThanOrEqual(0);
  });

  it('rises clear of every chord its label stands over, however many', () => {
    // 4 px to the beat, the label over the first C5 stands over the E4 before
    // it and the B5 before that.
    const drawn = render(beside([83, 64, 72, 72], [2, 3]), {}, 'treble', 'lesson', {
      widthPx: 800,
      pxPerMs: 4 / 1000,
    });
    const mark = markOf(drawn, 'ottavaAlta');
    expect(mark.bottom).toBeCloseTo(highest(inkUnder(drawn, mark)) - CLEAR, 6);
  });

  it('stays where it stood when a chord beside it is out of its reach', () => {
    // Spread out, the B5 after the line stands well clear of its hook.
    const drawn = render(beside([72, 72, 83, 64], [0, 1]), {}, 'treble', 'lesson', WIDE);
    const [label] = named(drawn, 'ottavaAlta');
    const [, bottom, , top] = box('ottavaAlta');
    const lineY = (label?.y ?? 0) - ((bottom + top) / 2) * 0.6 * GAP;
    expect(lineY).toBeCloseTo(drawn.view.trebleTop - 2.4 * GAP, 6);
  });

  it('sinks an 8vb clear of what it covers, and the pedal row under it', () => {
    // C1s, written an octave up on C2's two ledger lines under the bass staff,
    // under the sustain pedal.
    const notes: NoteEvent[] = [0, 1, 2, 3].map((beat) => ({
      id: `b${beat}`,
      midi: 24,
      startMs: beat * 1000,
      durationMs: 1000,
      velocity: 0.7,
      staff: 'bass',
    }));
    const score = layoutScore(notes, {
      ...LAYOUT_OPTS,
      pedals: [
        { atMs: 0, down: true },
        { atMs: 3900, down: false },
      ],
    });
    const layout = { ...score, dynamics: [], hairpins: [] };
    expect(layout.octaves).toEqual([{ staff: 'bass', fromMs: 0, toMs: 3000, up: false }]);
    expect(layout.pedals).toHaveLength(1);
    const drawn = render(layout, {}, 'grand', null, WIDE);
    const mark = markOf(drawn, 'ottavaBassaVb');
    expect(mark.top).toBeCloseTo(lowest(noteInk(drawn)) + CLEAR, 6);
    // The bracket, hooks and all, clear under the whole mark, and on the canvas.
    const pedal = drawn.paths
      .filter((path) => path.style === rest && path.width === 1.2)
      .map(pathInk);
    expect(pedal.length).toBeGreaterThan(0);
    expect(highest(pedal)).toBeGreaterThanOrEqual(mark.bottom + CLEAR - 1e-6);
    expect(lowest(pedal)).toBeLessThanOrEqual(drawn.view.heightPx);
  });
});

describe('drawScore rests', () => {
  /** Clear space a rest keeps from the ink either side of it. */
  const CLEAR = 0.25 * GAP;
  const onsetX = (ms: number, pxPerMs: number): number =>
    gutterWidthFor(0) + SCORE_LEAD_IN + ms * pxPerMs;
  const inks = (drawn: Drawn, name: MusicGlyphName): Ink[] =>
    named(drawn, name)
      .map(inkOf)
      .sort((a, b) => a.left - b.left);
  /** Where a glyph's ink is centred across. */
  const middle = (ink: Ink): number => (ink.left + ink.right) / 2;

  /** E4 eighths, one on each beat, each with the eighth rest that finishes its beat. */
  const eighthsAndRests = (): ScoreLayout =>
    written([
      [0, 0.5, 64],
      [1, 0.5, 64],
      [2, 0.5, 64],
      [3, 0.5, 64],
    ]);

  it('keeps a rest clear of the flag before it when the music is packed', () => {
    // 17 px from each eighth to its rest: the flag swings 13.2 px right of the
    // head's centre, and the rest reaches 4.4 px back — they touched.
    const layout = eighthsAndRests();
    expect(layout.chords.every((chord) => chord.beamId === null && !chord.stemDown)).toBe(true);
    const drawn = render(layout, {}, 'treble', null, { widthPx: 800, pxPerMs: 17 / 500 });
    const flags = inks(drawn, 'flag8thUp');
    const rests = inks(drawn, 'rest8th');
    const next = heads(drawn).slice(1);
    expect(flags).toHaveLength(4);
    expect(rests).toHaveLength(4);
    rests.forEach((restInk, i) => {
      expect(restInk.left - (flags[i] as Ink).right).toBeGreaterThanOrEqual(CLEAR - 1e-6);
      const head = next[i];
      if (head) expect(head.x - head.half - restInk.right).toBeGreaterThanOrEqual(CLEAR - 1e-6);
    });
  });

  it('leaves a rest on its time where the music gives it room', () => {
    const pxPerMs = 25 / 500;
    const drawn = render(eighthsAndRests(), {}, 'treble', null, { widthPx: 800, pxPerMs });
    const rests = inks(drawn, 'rest8th');
    expect(rests.map(middle)).toEqual(
      [500, 1500, 2500, 3500].map((ms) => expect.closeTo(onsetX(ms, pxPerMs), 6)),
    );
  });

  /**
   * The clear space before each of the first three rests, after its eighth's
   * flag, and after it, before the next eighth's head; and before it, after
   * the eighth's own head.
   */
  const gaps = (pxPerMs: number) => {
    const drawn = render(eighthsAndRests(), {}, 'treble', null, { widthPx: 800, pxPerMs });
    const flags = inks(drawn, 'flag8thUp');
    const rests = inks(drawn, 'rest8th');
    const all = heads(drawn);
    return [0, 1, 2].map((i) => {
      const restInk = rests[i] as Ink;
      const own = all[i] as Head;
      const next = all[i + 1] as Head;
      return {
        flag: restInk.left - (flags[i] as Ink).right,
        head: own.x + own.half - restInk.left,
        next: next.x - next.half - restInk.right,
      };
    });
  };

  it('stands a rest in the middle of the gap when it cannot keep its clear space', () => {
    // 14 px apart: room for the rest between the flag and the next head, but
    // not for its clear space either side as well.
    for (const gap of gaps(14 / 500)) {
      expect(gap.flag).toBeGreaterThanOrEqual(0);
      expect(gap.flag).toBeLessThan(CLEAR);
      expect(gap.flag).toBeCloseTo(gap.next, 6);
    }
  });

  it('keeps a rest off the next head rather than share the overlap with it', () => {
    // 12 px apart the flag swings out past the rest's own onset. Halving the
    // overlap would tuck the rest under the next head, which is drawn over it;
    // crossed by the flag instead, it still reads.
    for (const gap of gaps(12 / 500)) {
      expect(gap.flag).toBeLessThan(0);
      expect(gap.next).toBeCloseTo(0, 6);
    }
  });

  it('stands a rest midway between the heads when even they leave it no room', () => {
    for (const gap of gaps(8 / 500)) {
      expect(gap.next).toBeLessThan(0);
      expect(gap.head).toBeCloseTo(-gap.next, 6);
    }
  });

  it('keeps a rest clear of the accidental after it', () => {
    // An F♯ eighth half a beat after the rest: packed, its sharp hangs back
    // over where the rest stands.
    const layout = written([
      [0, 1, 64],
      [1.5, 0.5, 66],
    ]);
    const pxPerMs = 16 / 500;
    const drawn = render(layout, {}, 'treble', null, { widthPx: 800, pxPerMs });
    const [sharp] = inks(drawn, 'accidentalSharp');
    const [restInk] = inks(drawn, 'rest8th');
    const [first] = heads(drawn);
    expect((sharp as Ink).left).toBeLessThan(onsetX(1000, pxPerMs) + 4);
    expect((sharp as Ink).left - (restInk as Ink).right).toBeGreaterThanOrEqual(CLEAR - 1e-6);
    expect(
      (restInk as Ink).left - ((first as Head).x + (first as Head).half),
    ).toBeGreaterThanOrEqual(CLEAR - 1e-6);
  });

  it('stands a bar line clear of a rest where the rest was moved to', () => {
    // An eighth's flag pushes the rest after it on toward the bar line, and
    // the next bar opens on a quarter rest.
    const layout = written([
      [0, 3],
      [3, 0.5, 64],
      [5, 1],
    ]);
    const pxPerMs = 15 / 500;
    const drawn = render(layout, {}, 'treble', null, { widthPx: 800, pxPerMs });
    const [eighthRest] = inks(drawn, 'rest8th');
    const [quarterRest] = inks(drawn, 'restQuarter');
    const lines = drawn.paths
      .filter((path) => path.style === SCORE_PALETTES.dark.barLine && path.width === 1)
      .map((path) => (path.points[0] as Point).x)
      .filter((x) => Math.abs(x - onsetX(4000, pxPerMs)) < 20);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeGreaterThan((eighthRest as Ink).right);
    expect(lines[0]).toBeLessThan((quarterRest as Ink).left);
  });

  it('draws a rest moved into view whose onset has scrolled out of it', () => {
    // Zoomed out, a lone eighth's flag pushes the rests after it on by more
    // time than the view looks back: their onsets have gone past the left
    // edge, and where they are drawn has not.
    const pxPerMs = 0.02;
    const drawn = render(written([[0, 0.5, 64]]), {}, 'treble', null, {
      widthPx: 800,
      pxPerMs,
      scrollMs: 1500,
    });
    for (const name of ['rest8th', 'restQuarter'] as const) {
      const [restInk] = inks(drawn, name);
      expect(restInk).toBeDefined();
      expect(restInk?.left).toBeGreaterThan(drawn.view.gutterPx);
    }
  });

  it('draws the rhythm lesson’s rest on its beat, as it always stood', () => {
    // The densest line a lesson draws: 20 px to the beat.
    const pxPerMs = 20 / 1000;
    const drawn = render(bar([0, 2, 3]), {}, 'treble', 'lesson', { widthPx: 800, pxPerMs });
    const [restInk] = inks(drawn, 'restQuarter');
    expect(middle(restInk as Ink)).toBeCloseTo(onsetX(1000, pxPerMs), 6);
  });
});

describe('drawScore bar lines', () => {
  const { barLine, gutterBg, loopEdge, loopWash, playhead, noteDim } = SCORE_PALETTES.dark;
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
    expect(heads(drawn).some((head) => Math.abs(head.x - downbeat) < 1e-6)).toBe(true);
    const line = lineNear(drawn, 4000);
    expect(line).toBeLessThan(downbeat - HEAD_HALF);
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
        const drawnHeads = heads(drawn);
        expect(drawnHeads.length).toBeGreaterThan(0);
        for (const x of lines) {
          for (const head of drawnHeads) {
            // Each head by its own width: a whole note's is wider (0.844 of a
            // space either side, against a black head's 0.59).
            expect(Math.abs(x - head.x)).toBeGreaterThan(head.half);
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
    // The sharp's ink ends a quarter space before the whole note's head, and
    // the line keeps its lead before that ink — to the pixel it snaps to.
    const sharpLeft =
      onsetX(4000) - (WHOLE_HALF + 0.25 * GAP + halfOf('accidentalSharp') * 2 * GAP);
    expect(sharp).toBeLessThanOrEqual(sharpLeft - 0.6 * GAP + 1);
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
    expect(line).toBeGreaterThan(onsetX(3750, pxPerMs) + HEAD_HALF);
    expect(line).toBeLessThan(onsetX(4000, pxPerMs) - HEAD_HALF);
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
    expect(line).toBeGreaterThan(onsetX(3750, pxPerMs) + HEAD_HALF);
    expect(line).toBeLessThan(onsetX(4000, pxPerMs) - HEAD_HALF);
  });

  it('crosses a rest rather than a head when a rest overlaps the downbeat', () => {
    // A sixteenth rest 7 px before the downbeat, after a flagged, dotted
    // eighth: too little room for it either side, so it stands in the middle
    // of the gap, over the downbeat's head and the flag alike. The note heads
    // decide, and a rest is not one.
    const pxPerMs = 7 / 250;
    const packed = written([
      [0, 3],
      [3, 0.75],
      [4, 1],
    ]);
    expect(packed.rests.some((rest) => rest.displayStartMs === 3750)).toBe(true);
    const drawn = render(packed, {}, 'treble', null, { widthPx: 800, pxPerMs });
    const [sixteenthRest] = named(drawn, 'rest16th').map(inkOf);
    expect(sixteenthRest?.right).toBeGreaterThan(onsetX(4000, pxPerMs) - HEAD_HALF);
    const line = lineNear(drawn, 4000, pxPerMs);
    expect(line).toBeGreaterThan(sixteenthRest?.left ?? 0);
    expect(line).toBeLessThan(sixteenthRest?.right ?? 0);
    expect(line).toBeGreaterThan(onsetX(3000, pxPerMs) + HEAD_HALF);
    expect(line).toBeLessThan(onsetX(4000, pxPerMs) - HEAD_HALF);
  });

  it('looks as far as a chord stacks its accidentals', () => {
    // Four sharps a beat after a blank downbeat stack four columns deep, and
    // the outermost reaches back past the bar's own time.
    const stacked = written([
      [0, 4],
      [5, 1, 73],
      [5, 1, 75],
      [5, 1, 78],
      [5, 1, 80],
    ]);
    const columns = stacked.chords.flatMap((chord) =>
      chord.notes.map((note) => note.accidentalColumn),
    );
    expect(Math.max(...columns)).toBeGreaterThanOrEqual(3);
    const drawn = render({ ...stacked, rests: [] }, {}, 'treble', 'lesson', WIDE);
    // The outermost sharp's left edge, before any head displacement: right-
    // aligned a quarter space off the head, three columns out.
    const sharp =
      onsetX(5000) - (HEAD_HALF + 0.25 * GAP + 3 * 1.4 * GAP + halfOf('accidentalSharp') * 2 * GAP);
    expect(lineNear(drawn, 4000)).toBeLessThan(sharp);
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
    const [quarter] = named(drawn, 'metNoteQuarterUp');
    const space = 0.4 * GAP;
    expect(quarter).toMatchObject({ space, fill: SCORE_PALETTES.dark.measureNumber });
    // Its head centred where the drawn head used to be, over the downbeat...
    const mark = Math.round(onsetX(4000)) + 0.5 + 16;
    expect((quarter?.x ?? 0) + centreOf('metNoteQuarterUp') * space).toBeCloseTo(mark, 6);
    // ...and its foot a pixel above the baseline the number stands on.
    const baseline = drawn.view.trebleTop - 20;
    expect((quarter?.y ?? 0) - box('metNoteQuarterUp')[1] * space).toBeCloseTo(baseline - 1, 6);
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
    // The font's change clef, centred in that wash, on the bass staff's G line.
    const [clef] = named(drawn, 'gClefChange');
    expect(clef).toMatchObject({ space: GAP, fill: noteDim, y: drawn.view.bassTop + 3 * GAP });
    expect((clef?.x ?? 0) + centreOf('gClefChange') * GAP).toBeCloseTo(
      (wash?.x ?? 0) + (wash?.width ?? 0) / 2,
      6,
    );
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

  /** A bass line that turns to the treble clef for a note on beat `at`. */
  const turning = (tail: number, at: number): ScoreLayout => {
    const notes: NoteEvent[] = [
      { id: 'a', midi: 48, startMs: 0, durationMs: tail * 1000, velocity: 0.7, staff: 'bass' },
      {
        id: 'b',
        midi: 50,
        startMs: tail * 1000,
        durationMs: (4 - tail) * 1000,
        velocity: 0.7,
        staff: 'bass',
      },
      {
        id: 'c',
        midi: 67,
        startMs: at * 1000,
        durationMs: 1000,
        velocity: 0.7,
        staff: 'bass',
        clef: 'treble',
      },
    ];
    return { ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [], rests: [] };
  };
  const clefWash = (drawn: Recorder) =>
    drawn.rects.find((rect) => rect.style === gutterBg && rect.x > gutterWidthFor(0));

  it('makes room for a clef change where the bar leaves it', () => {
    // An eighth half a beat before the bar, and nothing until half a beat
    // after it: at the bar's own time the clef's wash would cover the eighth.
    const drawn = render(turning(3.5, 4.5), {}, 'grand', null, WIDE);
    const wash = clefWash(drawn);
    expect(wash).toBeDefined();
    expect(wash?.x).toBeGreaterThan(onsetX(3500) + HEAD_HALF);
    const line = barLines(drawn).find((x) => Math.abs(x - onsetX(4000)) < 25);
    expect(line).toBeDefined();
    expect((wash?.x ?? 0) + (wash?.width ?? 0)).toBeLessThanOrEqual(line ?? 0);
    expect(line).toBeLessThan(onsetX(4500) - HEAD_HALF);
  });

  it('lays the wash of a clef change under the music, so it never erases a note', () => {
    // A note a quarter of a beat before the downbeat's leaves no room for the
    // clef, so its wash reaches that note. The note is drawn over the wash.
    const drawn = render(turning(3.25, 4), {}, 'grand', null, WIDE);
    const wash = drawn.ops.indexOf(`rect:${gutterBg}`);
    const firstNote = drawn.ops.findIndex((op) => op.endsWith(`:${note}`));
    expect(wash).toBeGreaterThanOrEqual(0);
    expect(firstNote).toBeGreaterThan(wash);
  });

  it('numbers the first bar over its downbeat, whatever its opening chord carries', () => {
    // Two columns of sharps and a displaced head reach back past the lead-in,
    // so the first bar's line would have stood in the gutter. It has no line;
    // its number stays where it always was.
    const opening = written([
      [0, 4, 61],
      [0, 4, 63],
      [0, 4, 66],
      [0, 4, 68],
    ]);
    const drawn = render(opening, {}, 'treble', null, WIDE);
    expect(drawn.texts).toContain('1');
  });
});

describe('drawScore bar numbers and tempo marks', () => {
  const { noteDim, staffLine } = SCORE_PALETTES.dark;
  const noteInk = SCORE_PALETTES.dark.note;
  /** Clear space a bar number or a tempo mark keeps above the music under it. */
  const CLEAR = 0.25 * GAP;
  /** Clear space between marks stacked over one another: a number, an 8va, a tempo mark. */
  const STACKED = 0.5 * GAP;
  /** How far above the staff a number's baseline stands when nothing under it reaches that far. */
  const NUMBER_RISE = 8;
  /** How tall a numeral's ink stands in the marks' type: about three quarters of its 10 px. */
  const NUMERAL = 7.5;
  /** How wide the renderer allows a numeral to be in that type: a little over half its size. */
  const FIGURE = 5.5;
  /** How wide it allows the "= " before a tempo mark's number: about the type's size. */
  const EQUALS = 10;

  /** Drawn as the Play page draws a take at 100%: full chrome, both staves, its own spacing. */
  const play = (layout: ScoreLayout, scrollMs = 0): Drawn =>
    render(layout, {}, 'grand', null, { widthPx: 900, pxPerMs: basePxPerMsFor(layout), scrollMs });

  /** A stroke's ink: its points, thickened by half its width across the line. */
  const strokeInk = (path: StrokedPath): Ink => {
    const ink = pathInk(path);
    const half = path.width / 2;
    return ink.left === ink.right
      ? { ...ink, left: ink.left - half, right: ink.right + half }
      : { ...ink, top: ink.top - half, bottom: ink.bottom + half };
  };

  /**
   * The music's ink over the treble staff: heads, accidentals, dots, flags and
   * tuplet numerals, and the stems and ledger lines stroked for them. Beams
   * slope and ties arc, so they are measured where they run (`beamTopOver`,
   * `tieTopOver`).
   */
  const trebleInk = (drawn: Drawn): Ink[] =>
    [
      ...drawn.glyphs
        .filter((glyph) => /^(notehead|accidental|augmentationDot|flag|tuplet)/.test(glyph.name))
        .map(inkOf),
      ...drawn.paths
        .filter(
          (path) =>
            path.width === STEM_W ||
            (path.style === staffLine && pathInk(path).right - pathInk(path).left < 3 * GAP),
        )
        .map(strokeInk),
    ].filter((ink) => ink.right > drawn.view.gutterPx && ink.top < drawn.view.bassTop);

  /** The highest a beam's straight edges stand anywhere over `left`..`right`. */
  const beamTopOver = (shape: FilledShape, left: number, right: number): number => {
    let top = Number.POSITIVE_INFINITY;
    shape.points.forEach((from, i) => {
      const to = shape.points[(i + 1) % shape.points.length] as Point;
      const lo = Math.max(left, Math.min(from.x, to.x));
      const hi = Math.min(right, Math.max(from.x, to.x));
      if (hi < lo) return;
      const y = (x: number): number =>
        to.x === from.x
          ? Math.min(from.y, to.y)
          : from.y + ((x - from.x) / (to.x - from.x)) * (to.y - from.y);
      top = Math.min(top, y(lo), y(hi));
    });
    return top;
  };

  /** The highest a tie stands anywhere over `left`..`right`, or Infinity where it does not run. */
  const tieTopOver = (shape: FilledShape, left: number, right: number): number => {
    let top = Number.POSITIVE_INFINITY;
    for (const { from, control, to } of shape.curves) {
      const lo = Math.max(left, Math.min(from.x, to.x));
      const hi = Math.min(right, Math.max(from.x, to.x));
      for (let x = lo; x <= hi; x += Math.min(0.25, hi - lo) || 1) {
        // The control stands midway across, so x runs evenly with t.
        const t = (x - from.x) / (to.x - from.x);
        top = Math.min(top, (1 - t) ** 2 * from.y + 2 * t * (1 - t) * control.y + t ** 2 * to.y);
      }
    }
    return top;
  };

  /** How far two boxes overlap across. */
  const across = (a: Ink, b: Ink): number => Math.min(a.right, b.right) - Math.max(a.left, b.left);

  /**
   * Every piece of the music's ink under `mark` stands `clear` below it.
   *
   * A mark is placed where the music stands at its spacing, and then the view
   * rounds a bar line, and the number after it, to the pixel. So ink reaching
   * less than a pixel under the mark is beside it rather than under it, and a
   * beam or tie sloping up under it may stand a fraction of a pixel higher
   * where the mark is drawn than where it was placed.
   */
  const expectClearOver = (drawn: Drawn, mark: Ink, clear = CLEAR): void => {
    const sloping = 0.25;
    for (const ink of trebleInk(drawn)) {
      if (across(mark, ink) <= 1) continue;
      expect(
        mark.bottom,
        `ink at ${ink.left.toFixed(1)}–${ink.right.toFixed(1)}`,
      ).toBeLessThanOrEqual(ink.top - clear + 1e-6);
    }
    for (const beam of drawn.shapes.filter((shape) => shape.style === noteInk)) {
      if (across(mark, pathInk(beam)) <= 1) continue;
      const top = beamTopOver(beam, mark.left, mark.right);
      expect(mark.bottom, 'a beam').toBeLessThanOrEqual(top - clear + sloping);
    }
    for (const tie of drawn.shapes.filter((shape) => shape.style === noteDim)) {
      if (across(mark, pathInk(tie)) <= 1) continue;
      const top = tieTopOver(tie, mark.left, mark.right);
      expect(mark.bottom, 'a tie').toBeLessThanOrEqual(top - clear + sloping);
    }
  };

  const numberOf = (drawn: Drawn, n: number): { x: number; y: number } => {
    const label = drawn.labels.find((text) => text.text === String(n));
    expect(label, `bar ${n}’s number`).toBeDefined();
    return label as { x: number; y: number };
  };

  /** The bar line nearest before `number`'s middle. */
  const lineBefore = (drawn: Drawn, number: Ink): number => {
    const { barLine } = SCORE_PALETTES.dark;
    const middle = (number.left + number.right) / 2;
    const lines = drawn.paths
      .filter((path) => path.style === barLine && path.width === 1)
      .map((path) => (path.points[0] as Point).x)
      .filter((x) => x <= middle + 8);
    expect(lines.length).toBeGreaterThan(0);
    return Math.max(...lines);
  };

  /** A bar number's ink: its figures, standing on its baseline. */
  const numberBox = (drawn: Drawn, n: number): Ink => {
    const { x, y } = numberOf(drawn, n);
    return { left: x, right: x + String(n).length * FIGURE, top: y - NUMERAL, bottom: y };
  };

  /** A tempo mark's ink: its note, then the number after it, on one baseline. */
  const tempoBox = (drawn: Drawn, bpm: number): Ink => {
    const label = drawn.labels.find((text) => text.text === `= ${bpm}`);
    const [quarter] = named(drawn, 'metNoteQuarterUp');
    expect(label).toBeDefined();
    expect(quarter).toBeDefined();
    const note = inkOf(quarter as GlyphCall);
    const { x, y } = label as { x: number; y: number };
    return {
      left: note.left,
      right: x + EQUALS + String(bpm).length * FIGURE,
      top: Math.min(note.top, y - NUMERAL),
      bottom: y,
    };
  };

  /** Notes at `[beat, beats, midi]`, a beat to the second, on the treble staff. */
  const treble = (
    entries: readonly (readonly [beat: number, beats: number, midi: number])[],
  ): ScoreLayout => written(entries, 'treble');

  it('leaves a number where it always stood over a downbeat in the staff', () => {
    // F5, on the top line: its head reaches half a space over the staff,
    // three and a half pixels short of the number.
    const drawn = play(
      treble([
        [0, 4, 60],
        [4, 4, 77],
        [8, 4, 60],
      ]),
    );
    for (const n of [1, 2, 3]) {
      expect(numberOf(drawn, n).y).toBe(drawn.view.trebleTop - NUMBER_RISE);
    }
  });

  it('lifts a number clear of a high downbeat’s head and ledger lines', () => {
    // C6, on the second ledger line: its head covered the number.
    const drawn = play(
      treble([
        [0, 4, 60],
        [4, 4, 84],
        [8, 4, 60],
      ]),
    );
    const number = numberBox(drawn, 2);
    const head = heads(drawn).find((h) => h.y < drawn.view.trebleTop);
    expect(head).toBeDefined();
    // A quarter space over the top of the head, and clear of everything under it.
    expect(number.bottom).toBeCloseTo((head?.y ?? 0) - 0.5 * GAP - CLEAR, 6);
    expectClearOver(drawn, number);
    // Only that bar's number moves.
    expect(numberOf(drawn, 1).y).toBe(drawn.view.trebleTop - NUMBER_RISE);
    expect(numberOf(drawn, 3).y).toBe(drawn.view.trebleTop - NUMBER_RISE);
  });

  it('lifts a number clear of an accidental standing taller than its head', () => {
    // E♭5 sits in the staff, but its flat reaches up into the numbers' row.
    const notes: NoteEvent[] = [
      { id: 'a', midi: 60, startMs: 0, durationMs: 4000, velocity: 0.7, staff: 'treble' },
      {
        id: 'b',
        midi: 75,
        startMs: 4000,
        durationMs: 4000,
        velocity: 0.7,
        staff: 'treble',
        spelling: { step: 'E', alter: -1 },
      },
    ];
    const drawn = play({ ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [] });
    const [flat] = named(drawn, 'accidentalFlat');
    expect(flat).toBeDefined();
    const number = numberBox(drawn, 2);
    expect(number.bottom).toBeCloseTo(inkOf(flat as GlyphCall).top - CLEAR, 6);
    expectClearOver(drawn, number);
  });

  it('lifts a number clear of a tie arriving at its downbeat', () => {
    // An F5 held over the bar line: the tie arcs over the heads, and ends
    // under the number where the second head begins.
    const drawn = play(
      treble([
        [0, 3, 60],
        [3, 2, 77],
        [5, 3, 60],
      ]),
    );
    const ties = drawn.shapes.filter((shape) => shape.style === noteDim);
    expect(ties).toHaveLength(1);
    const number = numberBox(drawn, 2);
    expect(number.bottom).toBeLessThan(drawn.view.trebleTop - NUMBER_RISE);
    expectClearOver(drawn, number);
  });

  /** The stems rising from the heads, as stroked: up from under a head to a tip over it. */
  const upStems = (drawn: Drawn): Ink[] =>
    drawn.paths
      .filter(
        (path) => path.width === STEM_W && (path.points[1]?.y ?? 0) < (path.points[0]?.y ?? 0),
      )
      .map(strokeInk);

  it('steps the first bar’s number back from the stem over its downbeat', () => {
    // The first bar has no line, so its number stands over the downbeat
    // itself, where an A4's stem rises a pixel into the numbers' row. It
    // steps back rather than climb the stem.
    const layout = treble([
      [0, 1, 69],
      [1, 3, 60],
    ]);
    expect(layout.chords[0]?.stemDown).toBe(false);
    const drawn = play(layout);
    const number = numberBox(drawn, 1);
    expect(number.bottom).toBe(drawn.view.trebleTop - NUMBER_RISE);
    const [stem] = upStems(drawn);
    expect(number.right).toBeLessThanOrEqual((stem?.left ?? 0) - CLEAR + 1);
    // Still clear of the gutter the music starts after.
    expect(number.left).toBeGreaterThan(drawn.view.gutterPx);
    expectClearOver(drawn, number);
  });

  it('steps a number back from a beam over its downbeat', () => {
    // An upper voice of beamed eighths, stemmed up over a held E4.
    const upper = (id: string, midi: number, startMs: number, durationMs: number): NoteEvent => ({
      id,
      midi,
      startMs,
      durationMs,
      velocity: 0.7,
      staff: 'treble',
      voice: 0,
    });
    const notes: NoteEvent[] = [
      upper('u0', 72, 0, 500),
      upper('u1', 74, 500, 500),
      upper('u2', 72, 1000, 3000),
      { id: 'l', midi: 64, startMs: 0, durationMs: 4000, velocity: 0.7, staff: 'treble', voice: 1 },
    ];
    const layout = { ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [] };
    expect(layout.beams).toHaveLength(1);
    expect(layout.beams[0]?.stemDown).toBe(false);
    const drawn = play(layout);
    const number = numberBox(drawn, 1);
    expect(number.bottom).toBe(drawn.view.trebleTop - NUMBER_RISE);
    const [stem] = upStems(drawn);
    expect(number.right).toBeLessThanOrEqual((stem?.left ?? 0) - CLEAR + 1);
    expectClearOver(drawn, number);
  });

  it('steps a three-figure number back from the stem under it, and leaves a two-figure one beside it', () => {
    // Bars of C4, but for an A4 on the downbeat of bars 10 and 100. Its stem
    // rises into the numbers' row just right of the head: past the end of
    // "10", and under the last figure of "100".
    const entries: [number, number, number][] = [];
    for (let bar = 0; bar < 100; bar += 1) {
      if (bar === 9 || bar === 99) entries.push([bar * 4, 1, 69], [bar * 4 + 1, 3, 60]);
      else entries.push([bar * 4, 4, 60]);
    }
    const layout = treble(entries);
    const pxPerMs = basePxPerMsFor(layout);
    const at = (bar: number): Drawn => play(layout, (bar - 1) * 4000 - 400 / pxPerMs);

    const ten = at(10);
    expect(numberOf(ten, 10).y).toBe(ten.view.trebleTop - NUMBER_RISE);
    const stem = ten.paths
      .filter((path) => path.width === STEM_W)
      .map(strokeInk)
      .find((ink) => ink.left > numberOf(ten, 10).x);
    expect(stem).toBeDefined();
    expect(stem?.left).toBeGreaterThan(numberBox(ten, 10).right);

    // Stepped back no further than to where its middle meets the line.
    const hundred = at(100);
    const number = numberBox(hundred, 100);
    expect(number.bottom).toBe(hundred.view.trebleTop - NUMBER_RISE);
    const line = lineBefore(hundred, number);
    expect(number.left).toBeLessThan(line + 3);
    expect((number.left + number.right) / 2).toBeGreaterThanOrEqual(line - 0.5);
    const tip = upStems(hundred).find((ink) => ink.left > line);
    expect(number.right).toBeLessThanOrEqual((tip?.left ?? 0) - CLEAR + 1);
    expectClearOver(hundred, number);
  });

  it('climbs over the stem when stepping back would put it over another', () => {
    // An upper voice runs up to the bar line and on over it: a sixteenth D5
    // just before the line, then a D5 on the downbeat of bar 100, both stemmed
    // up far into the numbers' row. Stepped back, "100" would stand over the
    // sixteenth's flag, so it climbs over the downbeat's stem instead.
    const notes: NoteEvent[] = [];
    const add = (id: string, midi: number, beat: number, beats: number, voice: number): void => {
      notes.push({
        id,
        midi,
        startMs: beat * 1000,
        durationMs: beats * 1000,
        velocity: 0.7,
        staff: 'treble',
        voice,
      });
    };
    for (let bar = 0; bar < 99; bar += 1) add(`c${bar}`, 60, bar * 4, 4, 1);
    add('e', 60, 396, 4, 1);
    add('s', 74, 395.75, 0.25, 0);
    add('d', 74, 396, 1, 0);
    const layout = { ...layoutScore(notes, LAYOUT_OPTS), dynamics: [], hairpins: [] };
    const upper = layout.chords.filter((chord) => chord.voice === 0);
    expect(upper.map((chord) => chord.stemDown)).toEqual([false, false]);
    const drawn = play(layout, 99 * 4000 - 400 / basePxPerMsFor(layout));
    const number = numberBox(drawn, 100);
    expect(number.bottom).toBeLessThan(drawn.view.trebleTop - NUMBER_RISE);
    expectClearOver(drawn, number);
  });

  it('keeps a number down when the high note is the one before its bar line', () => {
    const drawn = play(
      treble([
        [0, 3, 60],
        [3, 1, 84],
        [4, 4, 60],
      ]),
    );
    expect(numberOf(drawn, 2).y).toBe(drawn.view.trebleTop - NUMBER_RISE);
  });

  /** Bar 2 goes to 90 bpm; `bar2` is its music, in beats of the new tempo. */
  const tempoChange = (
    bar2: readonly (readonly [beat: number, beats: number, midi: number])[],
  ): ScoreLayout => {
    const beat = 60_000 / 90;
    const notes: NoteEvent[] = [
      { id: 'w', midi: 60, startMs: 0, durationMs: 4000, velocity: 0.7, staff: 'treble' },
      ...bar2.map(([at, beats, midi], i): NoteEvent => ({
        id: `t${i}`,
        midi,
        startMs: Math.round(4000 + at * beat),
        durationMs: Math.round(beats * beat),
        velocity: 0.7,
        staff: 'treble',
      })),
    ];
    const score = layoutScore(notes, { ...LAYOUT_OPTS, tempoChanges: [{ atMs: 4000, bpm: 90 }] });
    return { ...score, dynamics: [], hairpins: [] };
  };

  it('leaves a tempo mark where it always stood over music in the staff', () => {
    const drawn = play(
      tempoChange([
        [0, 1, 60],
        [1, 1, 64],
        [2, 2, 67],
      ]),
    );
    expect(drawn.labels.find((text) => text.text === '= 90')?.y).toBe(drawn.view.trebleTop - 20);
  });

  it('lifts a tempo mark clear of a high note after the downbeat', () => {
    // A C6 a sixteenth into the bar stands under the mark's number.
    const drawn = play(
      tempoChange([
        [0, 0.25, 60],
        [0.25, 0.25, 84],
        [0.5, 0.5, 64],
        [1, 3, 60],
      ]),
    );
    const mark = tempoBox(drawn, 90);
    expect(mark.bottom).toBeLessThan(drawn.view.trebleTop - 20);
    expectClearOver(drawn, mark);
  });

  it('stands a tempo mark over its bar’s number when that is lifted', () => {
    // A C6 on the downbeat lifts bar 2's number; the tempo mark stays above it.
    const drawn = play(
      tempoChange([
        [0, 2, 84],
        [2, 2, 60],
      ]),
    );
    const number = numberBox(drawn, 2);
    expect(number.bottom).toBeLessThan(drawn.view.trebleTop - NUMBER_RISE);
    const mark = tempoBox(drawn, 90);
    expect(mark.bottom).toBeCloseTo(number.top - STACKED, 6);
    expectClearOver(drawn, mark);
    expect(mark.top).toBeGreaterThanOrEqual(0);
  });

  it('stands an 8va over the number it lifts clear of', () => {
    // C7s, written an octave down on C6: bar 1's number rises over the first
    // head, and the line over it.
    const drawn = play(bar([0, 1, 2, 3], 96));
    const number = numberBox(drawn, 1);
    expectClearOver(drawn, number);
    const [label] = named(drawn, 'ottavaAlta');
    expect(label).toBeDefined();
    expect(inkOf(label as GlyphCall).bottom).toBeLessThanOrEqual(number.top - STACKED + 1e-6);
  });

  it('keeps a number lifted over the highest downbeat on the canvas', () => {
    // A C7 alone — too few for an 8va — on five ledger lines.
    const layout = treble([
      [0, 1, 96],
      [1, 3, 60],
    ]);
    expect(layout.octaves).toEqual([]);
    const drawn = play(layout);
    const number = numberBox(drawn, 1);
    expectClearOver(drawn, number);
    expect(number.top).toBeGreaterThanOrEqual(0);
  });
});
