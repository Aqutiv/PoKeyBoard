import { useEffect, useMemo, useRef } from 'react';
import { subscribeFrame } from '@/app/frameClock';
import { useTransportState } from '@/app/hooks/useTransport';
import { themeController } from '@/app/theme';
import type { PlaybackLoop } from '@/domain/takeTypes';
import { layoutKeyboard } from '@/features/keyboard/keyboardGeometry';
import { playableLoop } from '@/features/transport/practiceLoop';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { layoutWaterfall, type WaterfallScene, type WaterfallTimeline } from './waterfallLayout';
import { paintWaterfall } from './waterfallPainter';
import { WATERFALL_PALETTES } from './waterfallPalette';
import './waterfall.css';

/** How long a note takes to fall from the top of the view onto its key, in real ms. */
export const FALL_SPAN_MS = 3000;

/** Past this a sharper canvas only costs memory, for a difference nobody sees. */
const MAX_DPR = 2;

const NO_SCENE: WaterfallScene = { bars: [], markers: [], octaveXs: [], restartYs: [] };

/** The keys under the view, as `PianoKeyboard` reports its window. */
export interface KeyRange {
  readonly lowMidi: number;
  readonly highMidi: number;
}

/** The transport states that move the notes: the view follows the frame clock only through these. */
function moves(state: TransportState): boolean {
  return (
    state === 'playing' || state === 'recording' || state === 'countIn' || state === 'scrubbing'
  );
}

/**
 * Where the view stands now, and how fast the take falls through it. A note
 * takes `FALL_SPAN_MS` to fall at any speed, so the view shows less of the
 * take when it plays slower. While a recording counts in, the clock already
 * runs toward the recording's start, so the take's notes fall in to meet it;
 * recording itself runs straight through at the take's own speed. A run falls
 * at its own rate and round its own loop, and what it does not play — a note
 * held from before where its pass began — falls as an outline. A scrub shows
 * the take as written where it is dragged, and a transport at rest shows what
 * pressing play would play: from past a loop's end, the loop from its top.
 */
function timelineNow(loopAtRest: PlaybackLoop | null): WaterfallTimeline {
  const state = transportController.getState();
  const { clock } = transportController;
  const passStartMs = transportController.getPassStartMs();
  if (state === 'countIn')
    return { nowMs: clock.currentTakeMs(), spanMs: FALL_SPAN_MS, loop: null, passStartMs };
  const nowMs = transportController.getPlayheadMs();
  if (state === 'recording') return { nowMs, spanMs: FALL_SPAN_MS, loop: null, passStartMs };
  if (state === 'playing')
    return { nowMs, spanMs: FALL_SPAN_MS * clock.rate, loop: clock.loop, passStartMs };
  const spanMs = FALL_SPAN_MS * transportController.getSpeed();
  if (state === 'scrubbing') {
    return { nowMs, spanMs, loop: loopAtRest, passStartMs: Number.NEGATIVE_INFINITY };
  }
  return { nowMs: passStartMs, spanMs, loop: loopAtRest, passStartMs };
}

/**
 * The take's notes falling onto the keys below, each bar standing over its
 * key and reaching it as the key lights. It sits straight on the key bed
 * (index.css joins the two) and is told the bed's range, so the two line up
 * key for key as the bed moves.
 */
export function WaterfallView({ range }: { range: KeyRange | null }) {
  const m = useMessages();
  const state = useTransportState();
  const take = useTakeStore((s) => s.take);
  const { notes } = take;
  // Only a loop playback will play is folded round; see `playableLoop`.
  const loop = useMemo(() => playableLoop(take), [take]);
  const followsVelocity = useSettingsStore((s) => s.velocityShading);
  const lowMidi = range?.lowMidi;
  const highMidi = range?.highMidi;
  const keys = useMemo(
    () =>
      lowMidi === undefined || highMidi === undefined ? null : layoutKeyboard(lowMidi, highMidi),
    [lowMidi, highMidi],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Everything the frame loop reads lives in refs, written from effects only.
  const sizeRef = useRef({ width: 0, height: 0 });
  const notesRef = useRef(notes);
  const loopRef = useRef(loop);
  const keysRef = useRef(keys);
  const followsRef = useRef(followsVelocity);
  /** Draw on the next frame if nothing else will; see the render loop below. */
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    notesRef.current = notes;
    wakeRef.current();
  }, [notes]);
  useEffect(() => {
    loopRef.current = loop;
    wakeRef.current();
  }, [loop]);
  useEffect(() => {
    keysRef.current = keys;
    wakeRef.current();
  }, [keys]);
  useEffect(() => {
    followsRef.current = followsVelocity;
    wakeRef.current();
  }, [followsVelocity]);

  // Measured in fractional pixels, as the keys are placed by percentages: a
  // width rounded to whole pixels would drift a bar off its key across a
  // wide bed.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = (width: number, height: number) => {
      sizeRef.current = { width, height };
      wakeRef.current();
    };
    const rect = container.getBoundingClientRect();
    apply(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The render loop. It runs on the frame clock while the notes move —
  // playback, recording, a count-in, a scrub — and otherwise draws once when
  // something changes and sleeps: the transport, the take, the theme, the
  // size, the key bed, the shading.
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const { width, height } = sizeRef.current;
      if (!canvas || !ctx || width <= 0 || height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const backingWidth = Math.max(1, Math.round(width * dpr));
      const backingHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      ctx.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0);
      const keyBed = keysRef.current;
      const scene = keyBed
        ? layoutWaterfall(notesRef.current, timelineNow(loopRef.current), {
            widthPx: width,
            heightPx: height,
            keys: keyBed,
          })
        : NO_SCENE;
      paintWaterfall(ctx, scene, {
        widthPx: width,
        heightPx: height,
        palette: WATERFALL_PALETTES[themeController.getResolved()],
        followsVelocity: followsRef.current,
      });
    };

    let stopFrames: (() => void) | null = null;
    let pending = 0;
    const drawSoon = () => {
      if (stopFrames || pending !== 0) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        draw();
      });
    };
    const sync = () => {
      const moving = moves(transportController.getState());
      if (moving && !stopFrames) {
        stopFrames = subscribeFrame(draw);
      } else if (!moving && stopFrames) {
        stopFrames();
        stopFrames = null;
      }
      // A seek, a change of speed or loop, or a run just ended: draw where it is now.
      drawSoon();
    };
    wakeRef.current = drawSoon;
    sync();
    const unsubscribeTransport = transportController.subscribeState(sync);
    const unsubscribeTheme = themeController.subscribe(drawSoon);
    return () => {
      unsubscribeTransport();
      unsubscribeTheme();
      stopFrames?.();
      if (pending !== 0) cancelAnimationFrame(pending);
      wakeRef.current = () => {};
    };
  }, []);

  const showEmptyHint = notes.length === 0 && state === 'idle';

  return (
    <div ref={containerRef} className="waterfall">
      <canvas
        ref={canvasRef}
        className="waterfall__canvas"
        role="img"
        aria-label={m.play.fallingLabel({ count: notes.length })}
      />
      {showEmptyHint ? <div className="waterfall__empty">{m.play.fallingEmpty}</div> : null}
    </div>
  );
}
