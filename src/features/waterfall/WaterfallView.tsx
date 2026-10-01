import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { subscribeFrame } from '@/app/frameClock';
import { useTransportState } from '@/app/hooks/useTransport';
import { themeController } from '@/app/theme';
import { noteFingers } from '@/domain/fingering';
import type { PlaybackLoop } from '@/domain/takeTypes';
import { barStartsBetween, createTakeTempoMap } from '@/domain/tempoMap';
import { layoutKeyboard } from '@/features/keyboard/keyboardGeometry';
import { scoreSpellings, spellingName } from '@/features/notation/scoreSpelling';
import { wheelZoomSteps, ZOOM_STEP } from '@/features/notation/scoreZoom';
import { scrubController } from '@/features/notation/scrubController';
import { playableLoop } from '@/features/transport/practiceLoop';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { TooltipButton } from '@/ui/TooltipButton';
import {
  FASTEST_FALL_SECONDS,
  SLOWEST_FALL_SECONDS,
  stepWaterfallSeconds,
  waterfallSecondsAfter,
  type WaterfallSeconds,
} from './fallSpeed';
import {
  EMPTY_SCENE,
  layoutWaterfall,
  type WaterfallCues,
  type WaterfallTimeline,
} from './waterfallLayout';
import { paintWaterfall } from './waterfallPainter';
import { WATERFALL_PALETTES } from './waterfallPalette';
import './waterfall.css';

/** Past this a sharper canvas only costs memory, for a difference nobody sees. */
const MAX_DPR = 2;

/** How long the glow on a note a Training hold waits for takes to swell and ebb. */
const GLOW_PERIOD_MS = 1200;

/** The reader's ask for less motion, which holds the glow still; null where a browser cannot say. */
function lessMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
}

function prefersLessMotion(): boolean {
  return lessMotionQuery()?.matches ?? false;
}

/** How bright the glow is at `nowMs`: swelling and ebbing, or steady for less motion. */
function glowAt(nowMs: number): number {
  if (prefersLessMotion()) return 1;
  return 0.55 + 0.45 * Math.sin((2 * Math.PI * nowMs) / GLOW_PERIOD_MS);
}

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

/** Safari's own pinch: a trackpad's arrives as this, not as Ctrl + wheel. */
interface SafariGestureEvent extends UIEvent {
  scale: number;
}

/** A drag on the notes: the pointer, where it came down, and the playhead then. */
interface Drag {
  readonly pointerId: number;
  readonly startY: number;
  readonly playhead0: number;
}

/**
 * Where the view stands now, and how fast the take falls through it. A note
 * takes `fallMs` (the fall speed) to fall at any playback speed, so the view
 * shows less of the take when it plays slower. While a recording counts in,
 * the clock already runs toward the recording's start, so the take's notes
 * fall in to meet it; recording itself runs straight through at the take's
 * own speed. A run falls at its own rate and round its own loop, and what it
 * does not play — a note held from before where its pass began — falls as an
 * outline. A scrub goes round the loop as the drag carries it, outlining what
 * it has not crossed, and a transport at rest shows what pressing play would
 * play: from past a loop's end, the loop from its top.
 */
function timelineNow(loopAtRest: PlaybackLoop | null, fallMs: number): WaterfallTimeline {
  const state = transportController.getState();
  const { clock } = transportController;
  const passStartMs = transportController.getPassStartMs();
  if (state === 'countIn')
    return { nowMs: clock.currentTakeMs(), spanMs: fallMs, loop: null, passStartMs };
  const nowMs = transportController.getPlayheadMs();
  if (state === 'recording') return { nowMs, spanMs: fallMs, loop: null, passStartMs };
  if (state === 'playing')
    return { nowMs, spanMs: fallMs * clock.rate, loop: clock.loop, passStartMs };
  const spanMs = fallMs * transportController.getSpeed();
  if (state === 'scrubbing') {
    return { nowMs, spanMs, loop: loopAtRest, passStartMs: scrubController.getPassStartMs() };
  }
  return { nowMs: passStartMs, spanMs, loop: loopAtRest, passStartMs };
}

/**
 * The take's notes falling onto the keys below, each bar standing over its
 * key and reaching it as the key lights. It sits straight on the key bed
 * (index.css joins the two) and is told the bed's range, so the two line up
 * key for key as the bed moves. − and + (or Ctrl/⌘ + wheel) set how fast the
 * notes fall, and a drag up or down scrubs, the notes following the finger.
 */
export function WaterfallView({ range }: { range: KeyRange | null }) {
  const m = useMessages();
  const state = useTransportState();
  const take = useTakeStore((s) => s.take);
  const { notes } = take;
  // Only a loop playback will play is folded round; see `playableLoop`.
  const loop = useMemo(() => playableLoop(take), [take]);
  const followsVelocity = useSettingsStore((s) => s.velocityShading);
  const showNames = useSettingsStore((s) => s.showNoteLabels);
  const showFingerNumbers = useSettingsStore((s) => s.showFingerNumbers);
  const { tempo, pedalEvents } = take;
  // Where each bar starts, as the score's own tempo map puts it.
  const barsBetween = useMemo(() => {
    const map = createTakeTempoMap({
      bpm: tempo.bpm,
      timeSignature: tempo.timeSignature,
      changes: tempo.changes,
    });
    return (fromMs: number, toMs: number) =>
      barStartsBetween(map, tempo.timeSignature, fromMs, toMs);
  }, [tempo.bpm, tempo.timeSignature, tempo.changes]);
  // Each note's name as the score spells it, worked out only while names show.
  const keySignature = tempo.keySignature;
  const names = useMemo(() => {
    if (!showNames) return undefined;
    const spellings = scoreSpellings(notes, { keySignature }, pedalEvents);
    return new Map([...spellings].map(([id, spelling]) => [id, spellingName(spelling)]));
  }, [showNames, notes, keySignature, pedalEvents]);
  // Each note's finger, the score's own or one worked out, only while they show.
  const fingerNumbers = useMemo(
    () => (showFingerNumbers ? noteFingers(notes) : undefined),
    [showFingerNumbers, notes],
  );
  const seconds = useSettingsStore((s) => s.waterfallSeconds);
  const setSeconds = useSettingsStore((s) => s.setWaterfallSeconds);
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
  const barsRef = useRef(barsBetween);
  const namesRef = useRef(names);
  const fingerNumbersRef = useRef(fingerNumbers);
  const fallMsRef = useRef(seconds * 1000);
  /** Draw on the next frame if nothing else will; see the render loop below. */
  const wakeRef = useRef<() => void>(() => {});
  const dragRef = useRef<Drag | null>(null);
  /** Wheel travel not yet a whole step of the fall speed: a pinch sends it in slivers. */
  const wheelStepsRef = useRef(0);
  /** The fingers on the notes, by pointer: a touch screen's, not a trackpad's. */
  const fingersRef = useRef(new Set<number>());

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
  useEffect(() => {
    barsRef.current = barsBetween;
    wakeRef.current();
  }, [barsBetween]);
  useEffect(() => {
    namesRef.current = names;
    wakeRef.current();
  }, [names]);
  useEffect(() => {
    fingerNumbersRef.current = fingerNumbers;
    wakeRef.current();
  }, [fingerNumbers]);
  useEffect(() => {
    fallMsRef.current = seconds * 1000;
    wakeRef.current();
  }, [seconds]);

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
      const waiting = transportController.isWaitingForTraining();
      const cues: WaterfallCues = {
        barsBetween: barsRef.current,
        awaited: waiting ? transportController.getTrainingTargets() : undefined,
      };
      const scene = keyBed
        ? layoutWaterfall(
            notesRef.current,
            timelineNow(loopRef.current, fallMsRef.current),
            { widthPx: width, heightPx: height, keys: keyBed },
            cues,
          )
        : EMPTY_SCENE;
      paintWaterfall(ctx, scene, {
        widthPx: width,
        heightPx: height,
        palette: WATERFALL_PALETTES[themeController.getResolved()],
        followsVelocity: followsRef.current,
        names: namesRef.current,
        fingers: fingerNumbersRef.current,
        glow: waiting ? glowAt(performance.now()) : 0,
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
      // A Training hold keeps the frames coming too, for its glow to swell and
      // ebb, unless the reader asked for less motion.
      const moving =
        moves(transportController.getState()) ||
        (transportController.isWaitingForTraining() && !prefersLessMotion());
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
    // Asking for less motion partway through a hold stills its glow, and
    // asking no longer sets it going again.
    const lessMotion = lessMotionQuery();
    lessMotion?.addEventListener('change', sync);
    return () => {
      unsubscribeTransport();
      unsubscribeTheme();
      lessMotion?.removeEventListener('change', sync);
      stopFrames?.();
      if (pending !== 0) cancelAnimationFrame(pending);
      wakeRef.current = () => {};
    };
  }, []);

  // Ctrl/⌘ + wheel sets the fall speed, as it zooms the score: in, and the
  // notes fall faster in taller bars. Native and not passive, so the page
  // itself does not zoom instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      wheelStepsRef.current += wheelZoomSteps(event.deltaY, event.deltaMode);
      while (Math.abs(wheelStepsRef.current) >= 1) {
        const faster = wheelStepsRef.current > 0;
        wheelStepsRef.current -= faster ? 1 : -1;
        const settings = useSettingsStore.getState();
        settings.setWaterfallSeconds(stepWaterfallSeconds(settings.waterfallSeconds, faster));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Safari sends a trackpad pinch as gestures of its own, which set the fall
  // speed as the wheel does: a step for each ZOOM_STEP the fingers spread or
  // close, as the score's zoom takes them. It sends them for fingers on a
  // touch screen too, alongside their pointers; there they are only stopped,
  // or the page would zoom instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let from: WaterfallSeconds | null = null;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      from = fingersRef.current.size > 0 ? null : useSettingsStore.getState().waterfallSeconds;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const { scale } = event as SafariGestureEvent;
      if (from === null || !(scale > 0)) return;
      const steps = Math.round(Math.log(scale) / Math.log(ZOOM_STEP));
      const settings = useSettingsStore.getState();
      const next = waterfallSecondsAfter(from, steps);
      if (next !== settings.waterfallSeconds) settings.setWaterfallSeconds(next);
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      from = null;
    };
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    canvas.addEventListener('gestureend', onGestureEnd);
    return () => {
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
      canvas.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // A drag cut short by the view going away still lets the scrub go.
  useEffect(
    () => () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      scrubController.end();
    },
    [],
  );

  /**
   * A drag scrubs, at rest. It starts from where the view stands — Play's own
   * start, which is a loop's top for a playhead parked past its end — and goes
   * round the loop as the view draws it, so the notes never jump under the
   * finger. A scrub still running from elsewhere ends where it is, and this
   * one begins there afresh: it may not go round the loop.
   */
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') {
      // A new touch's first finger: any left over, whose lifting never reached
      // the notes, are gone.
      if (event.isPrimary) fingersRef.current.clear();
      fingersRef.current.add(event.pointerId);
    }
    if (!event.isPrimary || event.button !== 0) return;
    const current = transportController.getState();
    if (current !== 'idle' && current !== 'paused' && current !== 'scrubbing') return;
    if (scrubController.isActive) scrubController.end();
    const standMs = transportController.getPassStartMs();
    if (standMs !== transportController.getPlayheadMs()) transportController.seek(standMs);
    if (!scrubController.begin(loopRef.current)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      playhead0: transportController.getPlayheadMs(),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const { height } = sizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId || height <= 0) return;
    // The notes follow the finger: down brings the music on toward the keys.
    const spanMs = fallMsRef.current * transportController.getSpeed();
    scrubController.update(drag.playhead0 + ((event.clientY - drag.startY) * spanMs) / height);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    fingersRef.current.delete(event.pointerId);
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    scrubController.end();
  };

  const showEmptyHint = notes.length === 0 && state === 'idle';

  return (
    <div ref={containerRef} className="waterfall">
      <canvas
        ref={canvasRef}
        className="waterfall__canvas"
        role="img"
        aria-label={m.play.fallingLabel({ count: notes.length })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
      {showEmptyHint ? <div className="waterfall__empty">{m.play.fallingEmpty}</div> : null}
      <div className="waterfall__speed" role="group" aria-label={m.play.fallSpeed}>
        <TooltipButton
          type="button"
          onClick={() => setSeconds(stepWaterfallSeconds(seconds, false))}
          disabled={seconds >= SLOWEST_FALL_SECONDS}
          aria-label={m.play.fallSlower}
        >
          −
        </TooltipButton>
        <TooltipButton
          type="button"
          onClick={() => setSeconds(stepWaterfallSeconds(seconds, true))}
          disabled={seconds <= FASTEST_FALL_SECONDS}
          aria-label={m.play.fallFaster}
        >
          +
        </TooltipButton>
      </div>
    </div>
  );
}
