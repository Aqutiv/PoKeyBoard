import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { themeController } from '@/app/theme';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  gutterWidthFor,
  SCORE_LEAD_IN,
  SCORE_PALETTES,
  type StaffMode,
} from '@/features/notation/scoreRenderer';
import { phraseToNotes } from './phrase';
import type { LearnPhrase } from './types';

/** Far enough behind the start that `drawPlayhead` bails on its own guard. */
const NO_PLAYHEAD_MS = -1e9;

const RIGHT_PAD_PX = 16;

const subscribeTheme = (onChange: () => void): (() => void) => themeController.subscribe(onChange);
const getTheme = (): 'dark' | 'light' => themeController.getResolved();

interface StaffSnippetProps {
  phrase: LearnPhrase;
  ariaLabel: string;
  /**
   * Keys the user is holding, drawn lit where they match a written note.
   *
   * Passed only where the stave is the *answer*. A reading quiz shows a note
   * and asks for its letter, so lighting the head there would let the whole
   * thing be brute-forced on the keyboard — `QuizPanel` never passes this.
   */
  litMidis?: ReadonlySet<number>;
  /**
   * Which staves to draw. `'treble'` by default, because every chapter before
   * the bass staff draws exactly one.
   *
   * Taken once and used twice, deliberately. `computeScoreGeometry` sizes the
   * canvas and `ScoreView` decides what is drawn into it; if the two disagree,
   * a one-staff picture lands in a two-staff canvas — gutter fill and all.
   */
  staves?: StaffMode;
}

/**
 * A short engraved example, drawn with the live score renderer rather than the
 * sheet one. The sheet path is print-monochrome and would render as a white
 * page inside a themed card; this path is theme-aware and carries no page
 * furniture to crop away.
 */
export function StaffSnippet({
  phrase,
  ariaLabel,
  litMidis,
  staves = 'treble',
}: StaffSnippetProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);

  const layout = useMemo(() => {
    const score = layoutScore(phraseToNotes(phrase), {
      bpm: phrase.bpm,
      timeSignature: phrase.timeSignature,
      quantization: '1/16',
      minMeasures: 1,
    });
    // `layoutScore` reads dynamics off how hard the keys were struck, which is
    // right for a performance and wrong for a worked example — a lesson about
    // where middle C sits should not also be shouting `f`. Blanking them also
    // drops the dynamics row from the computed height.
    //
    // Rests go the same way, and the renderer's own staff filter is not enough
    // on its own: that only drops the *bass* rests, while a phrase shorter than
    // its bar also leaves treble ones. `deriveRests` answers "what silence did
    // this performance leave over", and a worked example is not a performance.
    return { ...score, dynamics: [], hairpins: [], rests: [] };
  }, [phrase]);
  const geometry = useMemo(() => computeScoreGeometry(layout, { staves }), [layout, staves]);

  // Kept in a ref so the ResizeObserver can be created once and still call the
  // current closure. The runner re-renders on every note-on and note-off, and
  // rebuilding the observer — and reallocating the canvas backing store — that
  // often is exactly the churn `staffPhrase.ts` was written to avoid.
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = (): void => {
      const widthPx = canvas.clientWidth;
      if (widthPx === 0) return;
      const heightPx = geometry.minHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(widthPx * dpr);
      canvas.height = Math.round(heightPx * dpr);
      canvas.style.height = `${heightPx}px`;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, widthPx, heightPx);

      const gutterPx = gutterWidthFor(0);
      // Fit the whole phrase in the space left after the fixed prefix.
      const usablePx = Math.max(1, widthPx - gutterPx - SCORE_LEAD_IN - RIGHT_PAD_PX);
      const pxPerMs = usablePx / Math.max(1, layout.totalMs);

      drawScore(
        context,
        {
          widthPx,
          heightPx,
          pxPerMs,
          scrollMs: 0,
          trebleTop: geometry.trebleTop,
          bassTop: geometry.bassTop,
          pedalRow: geometry.pedalRow,
          dynamicsRow: geometry.dynamicsRow,
          gutterPx,
          staves,
          chrome: 'bare',
        },
        {
          layout,
          timeSignature: phrase.timeSignature,
          keySignature: 0,
          playheadMs: NO_PLAYHEAD_MS,
          recording: false,
          openNotes: [],
          ghosts: [],
          litMidis,
        },
        SCORE_PALETTES[theme],
      );
    };

    drawRef.current = draw;
    draw();
    // `litMidis` is safe to depend on by identity: the engine replaces its
    // active-note set only when the set actually changes, so an equal-but-new
    // object never reaches here.
  }, [layout, geometry, phrase.timeSignature, theme, litMidis, staves]);

  // A static canvas has no redraw loop of its own to catch a resize. Created
  // once and left alone; it calls whichever draw closure is current.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="learn-staff">
      <canvas ref={canvasRef} className="learn-staff__canvas" role="img" aria-label={ariaLabel} />
    </div>
  );
}
