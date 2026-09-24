import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  firstAtOrAfter,
  gutterWidthFor,
  SCORE_PALETTES,
} from '@/features/notation/scoreRenderer';
import {
  BASE_PX_PER_MS,
  basePxPerMsFor,
  MAX_DISPLAY_ZOOM,
  MIN_DISPLAY_ZOOM,
  MIN_ONSET_GAP_PX,
  nextZoom,
} from '@/features/notation/scoreZoom';

const OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16',
  minMeasures: 1,
} as const;

/** `count` notes `gapMs` apart on the treble staff. */
function run(count: number, gapMs: number): NoteEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    midi: 72 + (i % 5),
    startMs: i * gapMs,
    durationMs: gapMs,
    velocity: 0.6,
    staff: 'treble' as const,
  }));
}

describe('score spacing', () => {
  it('leaves music with room to breathe at the base rate', () => {
    // Quarters at 120 bpm: half a second apart, far wider than a head.
    expect(basePxPerMsFor(layoutScore(run(32, 500), OPTS))).toBe(BASE_PX_PER_MS);
  });

  it('spreads a run of sixteenths until their heads stand clear', () => {
    // 125 ms apart is 11 px at the base rate; a head is 11.5.
    const pxPerMs = basePxPerMsFor(layoutScore(run(64, 125), OPTS));
    expect(pxPerMs * 125).toBeCloseTo(MIN_ONSET_GAP_PX, 6);
  });

  it('stretches no more than threefold, however fast the music', () => {
    const pxPerMs = basePxPerMsFor(layoutScore(run(64, 31), { ...OPTS, quantization: '1/64' }));
    expect(pxPerMs).toBeCloseTo(BASE_PX_PER_MS * 3, 9);
  });
});

describe('zoom steps', () => {
  it('steps by a quarter and comes back to exactly where it began', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(nextZoom(nextZoom(1, 3), -2), -1)).toBe(1);
  });

  it('stays inside the range a take can store', () => {
    expect(nextZoom(3.9, 5)).toBe(MAX_DISPLAY_ZOOM);
    expect(nextZoom(0.3, -5)).toBe(MIN_DISPLAY_ZOOM);
  });
});

describe('drawing deep into a long take', () => {
  it('finds each pass’s place by search, not by walking from the first bar', () => {
    expect(firstAtOrAfter([10, 20, 30, 40], 25, (value) => value)).toBe(2);
    expect(firstAtOrAfter([10, 20, 30, 40], 50, (value) => value)).toBe(4);
    expect(firstAtOrAfter([10, 20, 30, 40], 0, (value) => value)).toBe(0);
  });

  it('draws the bars, rests and notes in view four hundred bars in', () => {
    // A note on beat one of every bar, rests after it: 400 bars of 2 s.
    const notes = Array.from({ length: 400 }, (_, i) => ({
      id: `b${i}`,
      midi: 72,
      startMs: i * 2000,
      durationMs: 500,
      velocity: 0.6,
      staff: 'treble' as const,
    }));
    const layout = layoutScore(notes, OPTS);
    const geometry = computeScoreGeometry(layout);
    const texts: string[] = [];
    const fills: string[] = [];
    const state = { fillStyle: '' };
    const ctx = new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === 'fillStyle') return state.fillStyle;
          if (name === 'fillText') return (text: string) => texts.push(text);
          if (name === 'fill') return () => fills.push(state.fillStyle);
          if (name === 'measureText') return () => ({ width: 40 });
          return () => {};
        },
        set: (_target, name, value) => {
          if (name === 'fillStyle') state.fillStyle = value as string;
          return true;
        },
      },
    ) as CanvasRenderingContext2D;
    drawScore(
      ctx,
      {
        widthPx: 900,
        heightPx: geometry.minHeight,
        pxPerMs: 0.09,
        scrollMs: 300 * 2000,
        trebleTop: geometry.trebleTop,
        bassTop: geometry.bassTop,
        pedalRow: geometry.pedalRow,
        dynamicsRow: geometry.dynamicsRow,
        gutterPx: gutterWidthFor(0),
      },
      {
        layout,
        timeSignature: OPTS.timeSignature,
        keySignature: 0,
        playheadMs: 0,
        recording: false,
        openNotes: [],
        ghosts: [],
      },
      SCORE_PALETTES.dark,
    );
    // Bar numbers from 301 on, and none from the start of the take.
    expect(texts).toContain('301');
    expect(texts).toContain('302');
    expect(texts).not.toContain('2');
    expect(fills).toContain(SCORE_PALETTES.dark.rest);
    expect(fills).toContain(SCORE_PALETTES.dark.note);
  });
});
