import { useEffect, useMemo, useRef, useState } from 'react';
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

const BASE_PX_PER_MS = 0.09;
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

  // Everything the rAF loop reads lives in refs, written from effects only.
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const layoutBoxRef = useRef<LayoutBox>({ layout, geometry, version: 0 });
  const stateRef = useRef<TransportState>(state);
  const tempoRef = useRef<TempoSettings>(tempo);
  const keyRef = useRef(keySignature);
  const zoomRef = useRef(zoom);
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
  }, [layout, geometry]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);
  useEffect(() => {
    keyRef.current = keySignature;
  }, [keySignature]);
  useEffect(() => {
    zoomRef.current = zoom;
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
      }),
    [],
  );

  // The render loop: always scheduled, draws only when something changed.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const { width, height, dpr } = sizeRef.current;
      if (!canvas || !ctx || width <= 0) return;

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

      const pxPerMs = BASE_PX_PER_MS * zoomRef.current;
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
        ghosts.length,
        openNotes.length,
        theme,
      ].join('|');
      const animating = ghosts.length > 0 || openNotes.length > 0;
      if (signature === lastSignatureRef.current && !animating) return;
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
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onScorePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = transportController.getState();
    if (current !== 'idle' && current !== 'paused' && current !== 'scrubbing') return;
    inertiaRef.current = null;
    if (!scrubController.isActive && !scrubController.begin()) return;
    event.currentTarget.setPointerCapture(event.pointerId);
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
    const pxPerMs = BASE_PX_PER_MS * zoomRef.current * fitRef.current;
    const dx = event.clientX - drag.startClientX;
    scrubController.update(drag.playhead0 - dx / pxPerMs);
    const clampedTime = transportController.getPlayheadMs();
    scrollMsRef.current = Math.max(0, drag.scroll0 + (clampedTime - drag.playhead0));
    drag.samples.push({ t: performance.now(), x: event.clientX });
    if (drag.samples.length > 6) drag.samples.shift();
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
      const pxPerMs = BASE_PX_PER_MS * zoomRef.current * fitRef.current;
      velocity = -((last.x - first.x) / (last.t - first.t)) / pxPerMs;
    }
    if (Math.abs(velocity) > INERTIA_MIN_VELOCITY) {
      inertiaRef.current = { velocity, lastT: performance.now() };
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
      {lastNoteName ? (
        <div className="score__notename" aria-live="polite">
          {lastNoteName}
        </div>
      ) : null}
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
        </select>
      </label>
      {showEmptyHint ? <div className="score__empty">{m.score.emptyHint}</div> : null}
    </div>
  );
}
