import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTransportState } from '@/app/hooks/useTransport';
import { themeController } from '@/app/theme';
import { audioEngine } from '@/audio/AudioEngine';
import { useMessages } from '@/i18n/i18nContext';
import { transportController } from '@/features/transport/transportController';
import type { QuantizationSetting, TempoSettings } from '@/domain/takeTypes';
import { useTakeStore } from '@/state/useTakeStore';
import { midiToNoteName } from '@/utils/midi';
import { detectFifths } from './keyDetection';
import { normalizeFifths } from './keySignature';
import { layoutScore, type ScoreLayout } from './notationLayout';
import { basePxPerMsFor, MAX_DISPLAY_ZOOM, MIN_DISPLAY_ZOOM, nextZoom } from './scoreZoom';
import {
  computeScoreGeometry,
  drawScore,
  gutterWidthFor,
  SCORE_LEAD_IN,
  SCORE_PALETTES,
  type ScoreGeometry,
  type ScoreView,
} from './scoreRenderer';
import { scrubController } from './scrubController';
import type { TransportState } from '@/features/transport/transportMachine';
import './notation.css';

/**
 * How far the score may be scaled down to fit the height it is given.
 *
 * The layout is written in design pixels (`GAP`) and scaled at draw time, so
 * a short view shrinks the staves rather than clipping them — and sees
 * proportionally more music. The container's min-height is this fraction of
 * the layout's, so the scale can never fall below the floor either.
 */
const MIN_SCORE_SCALE = 0.62;
const GHOST_LIFE_MS = 1300;
/** Playhead rests at this fraction of the scrolling region while moving. */
const PLAYHEAD_ANCHOR = 0.42;
/** Flick releases faster than this (take-ms per real-ms) coast with inertia. */
const INERTIA_MIN_VELOCITY = 0.15;
const INERTIA_STOP_VELOCITY = 0.02;
const INERTIA_DECAY_PER_FRAME = 0.94;

interface LiveGhost {
  midi: number;
  bornAt: number;
}

interface LayoutBox {
  layout: ScoreLayout;
  geometry: ScoreGeometry;
  version: number;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  playhead0: number;
  scroll0: number;
  samples: Array<{ t: number; x: number }>;
}

interface InertiaState {
  /** Take-ms advanced per real millisecond (signed). */
  velocity: number;
  lastT: number;
}

export function MusicScore() {
  const m = useMessages();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const state = useTransportState();
  const notes = useTakeStore((s) => s.take.notes);
  const pedalEvents = useTakeStore((s) => s.take.pedalEvents);
  const tempo = useTakeStore((s) => s.take.tempo);
  const zoom = useTakeStore((s) => s.take.display.zoom);
  const quantization = useTakeStore((s) => s.take.display.quantization);
  const setDisplayQuantization = useTakeStore((s) => s.setDisplayQuantization);
  const setDisplayZoom = useTakeStore((s) => s.setDisplayZoom);
  const [lastNoteName, setLastNoteName] = useState<string | null>(null);

  // An imported score says which key it is in; a recording never does, so the
  // notes are read for one. Both views spell from the same answer, so the
  // score on screen and the printed page never disagree about a flat.
  const keySignature = useMemo(
    () =>
      tempo.keySignature !== undefined ? normalizeFifths(tempo.keySignature) : detectFifths(notes),
    [tempo.keySignature, notes],
  );

  const layout = useMemo(
    () =>
      layoutScore(notes, {
        bpm: tempo.bpm,
        timeSignature: tempo.timeSignature,
        tempoChanges: tempo.changes,
        quantization,
        keySignature,
        pedals: pedalEvents,
      }),
    [notes, tempo.bpm, tempo.timeSignature, tempo.changes, quantization, keySignature, pedalEvents],
  );
  const geometry = useMemo(() => computeScoreGeometry(layout), [layout]);
  const basePxPerMs = useMemo(() => basePxPerMsFor(layout), [layout]);

  // Everything the rAF loop reads lives in refs, written from effects only.
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const layoutBoxRef = useRef<LayoutBox>({ layout, geometry, version: 0 });
  const stateRef = useRef<TransportState>(state);
  const tempoRef = useRef<TempoSettings>(tempo);
  const keyRef = useRef(keySignature);
  const zoomRef = useRef(zoom);
  const baseRef = useRef(basePxPerMs);
  /** Schedule a frame if none is coming; see the render loop below. */
  const wakeRef = useRef<() => void>(() => {});
  const ghostsRef = useRef<LiveGhost[]>([]);
  const scrollMsRef = useRef(0);
  /** Design pixels → screen pixels; written by the render loop. */
  const fitRef = useRef(1);
  const lastSignatureRef = useRef('');
  const durationRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const inertiaRef = useRef<InertiaState | null>(null);
  const durationMs = useTakeStore((s) => s.take.durationMs);
  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    layoutBoxRef.current = { layout, geometry, version: layoutBoxRef.current.version + 1 };
    baseRef.current = basePxPerMs;
    wakeRef.current();
  }, [layout, geometry, basePxPerMs]);
  useEffect(() => {
    stateRef.current = state;
    wakeRef.current();
  }, [state]);
  useEffect(() => {
    tempoRef.current = tempo;
    wakeRef.current();
  }, [tempo]);
  useEffect(() => {
    keyRef.current = keySignature;
    wakeRef.current();
  }, [keySignature]);
  useEffect(() => {
    zoomRef.current = zoom;
    wakeRef.current();
  }, [zoom]);

  // Canvas sizing with DPR backing store.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const apply = (width: number, height: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      lastSignatureRef.current = '';
      wakeRef.current();
    };
    apply(container.clientWidth, container.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) apply(rect.width, rect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Ghost notes + current note name from live input.
  useEffect(
    () =>
      audioEngine.subscribeInput((event) => {
        if (event.type !== 'on') return;
        setLastNoteName(midiToNoteName(event.midi));
        if (transportController.getState() === 'recording') return;
        ghostsRef.current.push({ midi: event.midi, bornAt: performance.now() });
        wakeRef.current();
      }),
    [],
  );

  // The render loop. It runs while anything on the score moves — playback,
  // recording, a scrub coasting to rest, a ghost note fading — and sleeps
  // otherwise, rather than waking every frame to find nothing changed. Whatever
  // does change the picture wakes it: the transport, the take, the theme, a
  // resize, a key played, a finger on the score.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      if (draw()) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    /** Draw if anything changed; true while there is more to come. */
    const draw = (): boolean => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const { width, height, dpr } = sizeRef.current;
      // Nothing to draw on yet; the resize that sizes the canvas wakes the loop.
      if (!canvas || !ctx || width <= 0) return false;

      // Inertial scrubbing: keep coasting and auditioning between frames.
      const inertia = inertiaRef.current;
      if (inertia && scrubController.isActive) {
        const nowI = performance.now();
        const dt = Math.min(64, nowI - inertia.lastT);
        inertia.lastT = nowI;
        const current = transportController.getPlayheadMs();
        const next = current + inertia.velocity * dt;
        scrubController.update(next);
        scrollMsRef.current = Math.max(0, scrollMsRef.current + inertia.velocity * dt);
        inertia.velocity *= Math.pow(INERTIA_DECAY_PER_FRAME, dt / 16.7);
        const hitEdge = next <= 0 || next >= durationRef.current;
        if (Math.abs(inertia.velocity) < INERTIA_STOP_VELOCITY || hitEdge) {
          inertiaRef.current = null;
          scrubController.end();
        }
      } else if (inertia) {
        inertiaRef.current = null;
      }

      const currentState = stateRef.current;
      const playheadMs = transportController.getPlayheadMs();
      const now = performance.now();
      ghostsRef.current = ghostsRef.current.filter((g) => now - g.bornAt < GHOST_LIFE_MS);
      const ghosts = ghostsRef.current;
      const openNotes = transportController.getOpenRecordingNotes();

      const box = layoutBoxRef.current;
      // Everything below is in design pixels; `fit` is the only bridge to the
      // screen. Capped at 1, so a view with room to spare draws life size.
      const fit =
        height > 0 ? Math.min(1, Math.max(MIN_SCORE_SCALE, height / box.geometry.minHeight)) : 1;
      fitRef.current = fit;
      const viewWidth = width / fit;

      const pxPerMs = baseRef.current * zoomRef.current;
      const gutterPx = gutterWidthFor(keyRef.current);
      const musicLeft = gutterPx + SCORE_LEAD_IN;
      const anchorOffsetMs = ((viewWidth - musicLeft) * PLAYHEAD_ANCHOR) / pxPerMs;
      const moving = currentState === 'playing' || currentState === 'recording';
      if (moving) {
        scrollMsRef.current = Math.max(0, playheadMs - anchorOffsetMs);
      } else {
        const x = musicLeft + (playheadMs - scrollMsRef.current) * pxPerMs;
        if (x < gutterPx - 1 || x > viewWidth - 20) {
          scrollMsRef.current = Math.max(0, playheadMs - anchorOffsetMs);
        }
      }

      const theme = themeController.getResolved();
      const signature = [
        currentState,
        playheadMs.toFixed(1),
        scrollMsRef.current.toFixed(1),
        box.version,
        width,
        height,
        fit.toFixed(3),
        pxPerMs.toFixed(5),
        ghosts.length,
        openNotes.length,
        theme,
      ].join('|');
      const animating = ghosts.length > 0 || openNotes.length > 0;
      const more =
        moving || currentState === 'scrubbing' || inertiaRef.current !== null || animating;
      if (signature === lastSignatureRef.current && !animating) return more;
      lastSignatureRef.current = signature;

      ctx.setTransform(dpr * fit, 0, 0, dpr * fit, 0, 0);
      const view: ScoreView = {
        widthPx: viewWidth,
        heightPx: height / fit,
        pxPerMs,
        scrollMs: scrollMsRef.current,
        trebleTop: box.geometry.trebleTop,
        bassTop: box.geometry.bassTop,
        pedalRow: box.geometry.pedalRow,
        dynamicsRow: box.geometry.dynamicsRow,
        gutterPx,
      };
      drawScore(
        ctx,
        view,
        {
          layout: box.layout,
          timeSignature: tempoRef.current.timeSignature,
          keySignature: keyRef.current,
          playheadMs,
          recording: currentState === 'recording',
          openNotes,
          ghosts: ghosts.map((g) => ({
            midi: g.midi,
            life: 1 - (now - g.bornAt) / GHOST_LIFE_MS,
          })),
        },
        SCORE_PALETTES[theme],
      );
      return more;
    };
    wakeRef.current = wake;
    wake();
    const unsubscribeTransport = transportController.subscribeState(wake);
    const unsubscribeTheme = themeController.subscribe(wake);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribeTransport();
      unsubscribeTheme();
      wakeRef.current = () => {};
    };
  }, []);

  /**
   * Zoom by `steps` (see `nextZoom`), keeping the moment at `anchorX` — design
   * pixels across the view, the pointer for a wheel — where it is on screen.
   * While the playhead moves it holds its own place, so there is nothing to keep.
   */
  const zoomBy = useCallback(
    (steps: number, anchorX?: number) => {
      const next = nextZoom(zoomRef.current, steps);
      if (next === zoomRef.current) return;
      const moving = stateRef.current === 'playing' || stateRef.current === 'recording';
      if (anchorX !== undefined && !moving) {
        const musicLeft = gutterWidthFor(keyRef.current) + SCORE_LEAD_IN;
        const before = baseRef.current * zoomRef.current;
        const after = baseRef.current * next;
        const atMs = scrollMsRef.current + (anchorX - musicLeft) / before;
        scrollMsRef.current = Math.max(0, atMs - (anchorX - musicLeft) / after);
      }
      zoomRef.current = next;
      setDisplayZoom(next);
      wakeRef.current();
    },
    [setDisplayZoom],
  );

  // Ctrl/⌘ + wheel zooms, as it does in any document — and it is what a
  // trackpad pinch arrives as. Native and not passive, so the page itself
  // does not zoom instead.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchorX = (event.clientX - rect.left) / fitRef.current;
      // A notch of a wheel is about 100; a pinch sends many small deltas.
      zoomBy(-event.deltaY / 100, anchorX);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onScorePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = transportController.getState();
    if (current !== 'idle' && current !== 'paused' && current !== 'scrubbing') return;
    inertiaRef.current = null;
    if (!scrubController.isActive && !scrubController.begin()) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    wakeRef.current();
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      playhead0: transportController.getPlayheadMs(),
      scroll0: scrollMsRef.current,
      samples: [{ t: performance.now(), x: event.clientX }],
    };
  };

  const onScorePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // The drag is in screen pixels, so the rate has to be too — the music
    // must keep up with the finger whatever the score is scaled to.
    const pxPerMs = baseRef.current * zoomRef.current * fitRef.current;
    const dx = event.clientX - drag.startClientX;
    scrubController.update(drag.playhead0 - dx / pxPerMs);
    const clampedTime = transportController.getPlayheadMs();
    scrollMsRef.current = Math.max(0, drag.scroll0 + (clampedTime - drag.playhead0));
    drag.samples.push({ t: performance.now(), x: event.clientX });
    if (drag.samples.length > 6) drag.samples.shift();
    wakeRef.current();
  };

  const onScorePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!scrubController.isActive) return;
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    let velocity = 0;
    if (first && last && last.t > first.t && performance.now() - last.t < 120) {
      const pxPerMs = baseRef.current * zoomRef.current * fitRef.current;
      velocity = -((last.x - first.x) / (last.t - first.t)) / pxPerMs;
    }
    if (Math.abs(velocity) > INERTIA_MIN_VELOCITY) {
      inertiaRef.current = { velocity, lastT: performance.now() };
      wakeRef.current();
    } else {
      scrubController.end();
    }
  };

  const onScorePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    inertiaRef.current = null;
    scrubController.end();
  };

  const showEmptyHint = notes.length === 0 && state === 'idle';

  return (
    <div
      ref={containerRef}
      className="score"
      style={{ minHeight: Math.round(geometry.minHeight * MIN_SCORE_SCALE) }}
    >
      <canvas
        ref={canvasRef}
        className="score__canvas"
        role="img"
        aria-label={m.score.label({ count: notes.length })}
        onPointerDown={onScorePointerDown}
        onPointerMove={onScorePointerMove}
        onPointerUp={onScorePointerUp}
        onPointerCancel={onScorePointerCancel}
      />
      {/* A visual echo only: as a live region it announced every note played,
          over the very notes it was naming. */}
      {lastNoteName ? <div className="score__notename">{lastNoteName}</div> : null}
      <div className="score__zoom" role="group" aria-label={m.score.zoom}>
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          disabled={zoom <= MIN_DISPLAY_ZOOM}
          aria-label={m.score.zoomOut}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1)}
          disabled={zoom >= MAX_DISPLAY_ZOOM}
          aria-label={m.score.zoomIn}
        >
          +
        </button>
      </div>
      <label className="score__quant">
        <span className="visually-hidden">{m.score.displayQuantization}</span>
        <select
          value={quantization}
          onChange={(event) => setDisplayQuantization(event.target.value as QuantizationSetting)}
          aria-label={m.score.displayQuantization}
        >
          <option value="off">{m.score.noGrid}</option>
          <option value="1/8">{m.score.grid8}</option>
          <option value="1/16">{m.score.grid16}</option>
          <option value="1/32">{m.score.grid32}</option>
          <option value="1/64">{m.score.grid64}</option>
        </select>
      </label>
      {showEmptyHint ? <div className="score__empty">{m.score.emptyHint}</div> : null}
    </div>
  );
}
