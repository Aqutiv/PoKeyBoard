import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { layoutScore, type ScoreLayout } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  gutterWidthFor,
  SCORE_PALETTES,
  type ScoreRenderInput,
  type ScoreView,
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
function oneNote(midi: number): ScoreLayout {
  const note: NoteEvent = { id: 'n', midi, startMs: 0, durationMs: 4000, velocity: 0.7 };
  const score = layoutScore([note], LAYOUT_OPTS);
  return { ...score, dynamics: [], hairpins: [], rests: [] };
}

function render(layout: ScoreLayout, extra: Partial<ScoreRenderInput> = {}): Recorder {
  const geometry = computeScoreGeometry(layout, { staves: 'treble' });
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
    staves: 'treble',
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
