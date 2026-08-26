import { describe, expect, it } from 'vitest';
import type { NoteEvent, NoteStaff } from '@/domain/takeTypes';
import { layoutScore, type ScoreLayout } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  gutterWidthFor,
  SCORE_PALETTES,
  type ScoreRenderInput,
  type ScoreView,
  type StaffMode,
} from '@/features/notation/scoreRenderer';

/**
 * The first test to actually call `drawScore`. It records what the renderer
 * asks the context to do rather than what it paints, which is enough to pin
 * *why* a head is the colour it is — the thing that has no other net.
 */
interface Recorder {
  ctx: CanvasRenderingContext2D;
  /** Every fillStyle in force at the moment `fill()` was called. */
  fills: string[];
  strokes: string[];
  texts: string[];
}

function recordingContext(): Recorder {
  const fills: string[] = [];
  const strokes: string[] = [];
  const texts: string[] = [];
  const state = { fillStyle: '#000', strokeStyle: '#000' };

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
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setTransform: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fill: () => void fills.push(state.fillStyle),
    stroke: () => void strokes.push(state.strokeStyle),
    fillText: (text: string) => void texts.push(text),
    // Constant, because the renderer caches its glyph-support probe at module
    // scope — a varying width would make the first suite to run decide for all.
    measureText: () => ({ width: 40 }) as TextMetrics,
    clip: () => {},
    setLineDash: () => {},
  } as unknown as CanvasRenderingContext2D;

  return { ctx, fills, strokes, texts };
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

function render(
  layout: ScoreLayout,
  extra: Partial<ScoreRenderInput> = {},
  staves: StaffMode = 'treble',
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
    chrome: 'bare',
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
