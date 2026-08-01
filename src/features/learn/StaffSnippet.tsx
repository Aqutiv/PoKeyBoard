import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { themeController } from '@/app/theme';
import { layoutScore } from '@/features/notation/notationLayout';
import {
  computeScoreGeometry,
  drawScore,
  gutterWidthFor,
  SCORE_LEAD_IN,
  SCORE_PALETTES,
} from '@/features/notation/scoreRenderer';
import { phraseToNotes } from './phrase';
import type { LearnPhrase } from './types';

/** Far enough behind the start that `drawPlayhead` bails on its own guard. */
const NO_PLAYHEAD_MS = -1e9;

/**
 * Stated once and used twice, deliberately. `computeScoreGeometry` sizes the
 * canvas and `ScoreView` decides what is drawn into it; if the two disagree,
 * a one-staff picture lands in a two-staff canvas — gutter fill and all.
 */
const STAVES = 'treble' as const;
const RIGHT_PAD_PX = 16;

const subscribeTheme = (onChange: () => void): (() => void) => themeController.subscribe(onChange);
const getTheme = (): 'dark' | 'light' => themeController.getResolved();

interface StaffSnippetProps {
  phrase: LearnPhrase;
  ariaLabel: string;
}

/**
 * A short engraved example, drawn with the live score renderer rather than the
 * sheet one. The sheet path is print-monochrome and would render as a white
 * page inside a themed card; this path is theme-aware and carries no page
 * furniture to crop away.
 */
export function StaffSnippet({ phrase, ariaLabel }: StaffSnippetProps) {
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
  const geometry = useMemo(() => computeScoreGeometry(layout, { staves: STAVES }), [layout]);

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
          staves: STAVES,
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
        },
        SCORE_PALETTES[theme],
      );
    };

    draw();
    // A static canvas has no redraw loop of its own to catch a resize.
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [layout, geometry, phrase.timeSignature, theme]);

  return (
    <div className="learn-staff">
      <canvas ref={canvasRef} className="learn-staff__canvas" role="img" aria-label={ariaLabel} />
    </div>
  );
}
