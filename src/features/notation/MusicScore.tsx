import { useEffect, useMemo, useRef, useState } from 'react';
import { useTransportState } from '@/app/hooks/useTransport';
import { audioEngine } from '@/audio/AudioEngine';
import { transportController } from '@/features/transport/transportController';
import type { QuantizationSetting, TempoSettings } from '@/domain/takeTypes';
import { useTakeStore } from '@/state/useTakeStore';
import { midiToNoteName } from '@/utils/midi';
import { layoutScore, type ScoreLayout } from './notationLayout';
import { drawScore, GUTTER, SCORE_MIN_HEIGHT, type ScoreView } from './scoreRenderer';
import { scrubController } from './scrubController';
import type { TransportState } from '@/features/transport/transportMachine';
import './notation.css';

const BASE_PX_PER_MS = 0.09;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const state = useTransportState();
  const notes = useTakeStore((s) => s.take.notes);
  const tempo = useTakeStore((s) => s.take.tempo);
  const zoom = useTakeStore((s) => s.take.display.zoom);
  const quantization = useTakeStore((s) => s.take.display.quantization);
  const setDisplayQuantization = useTakeStore((s) => s.setDisplayQuantization);
  const [lastNoteName, setLastNoteName] = useState<string | null>(null);

  const layout = useMemo(
    () =>
      layoutScore(notes, {
        bpm: tempo.bpm,
        timeSignature: tempo.timeSignature,
        quantization,
      }),
    [notes, tempo.bpm, tempo.timeSignature, quantization],
  );

  // Everything the rAF loop reads lives in refs, written from effects only.
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const layoutBoxRef = useRef<LayoutBox>({ layout, version: 0 });
  const stateRef = useRef<TransportState>(state);
  const tempoRef = useRef<TempoSettings>(tempo);
  const zoomRef = useRef(zoom);
  const ghostsRef = useRef<LiveGhost[]>([]);
  const scrollMsRef = useRef(0);
  const lastSignatureRef = useRef('');
  const durationRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const inertiaRef = useRef<InertiaState | null>(null);
  const durationMs = useTakeStore((s) => s.take.durationMs);
  useEffect(() => {
    durationRef.current = durationMs;
  }, [durationMs]);

  useEffect(() => {
    layoutBoxRef.current = { layout, version: layoutBoxRef.current.version + 1 };
  }, [layout]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);
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

      const pxPerMs = BASE_PX_PER_MS * zoomRef.current;
      const anchorOffsetMs = ((width - GUTTER) * PLAYHEAD_ANCHOR) / pxPerMs;
      const moving = currentState === 'playing' || currentState === 'recording';
      if (moving) {
        scrollMsRef.current = Math.max(0, playheadMs - anchorOffsetMs);
      } else {
        const x = GUTTER + (playheadMs - scrollMsRef.current) * pxPerMs;
        if (x < GUTTER - 1 || x > width - 20) {
          scrollMsRef.current = Math.max(0, playheadMs - anchorOffsetMs);
        }
      }

      const box = layoutBoxRef.current;
      const signature = [
        currentState,
        playheadMs.toFixed(1),
        scrollMsRef.current.toFixed(1),
        box.version,
        width,
        height,
        ghosts.length,
        openNotes.length,
      ].join('|');
      const animating = ghosts.length > 0 || openNotes.length > 0;
      if (signature === lastSignatureRef.current && !animating) return;
      lastSignatureRef.current = signature;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const view: ScoreView = {
        widthPx: width,
        heightPx: height,
        pxPerMs,
        scrollMs: scrollMsRef.current,
      };
      drawScore(ctx, view, {
        layout: box.layout,
        timeSignature: tempoRef.current.timeSignature,
        playheadMs,
        recording: currentState === 'recording',
        openNotes,
        ghosts: ghosts.map((g) => ({
          midi: g.midi,
          life: 1 - (now - g.bornAt) / GHOST_LIFE_MS,
        })),
      });
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
    const pxPerMs = BASE_PX_PER_MS * zoomRef.current;
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
      const pxPerMs = BASE_PX_PER_MS * zoomRef.current;
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
    <div ref={containerRef} className="score" style={{ minHeight: SCORE_MIN_HEIGHT }}>
      <canvas
        ref={canvasRef}
        className="score__canvas"
        role="img"
        aria-label={`Grand staff score with ${notes.length} note${notes.length === 1 ? '' : 's'}`}
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
        <span className="visually-hidden">Display quantization</span>
        <select
          value={quantization}
          onChange={(event) => setDisplayQuantization(event.target.value as QuantizationSetting)}
          aria-label="Display quantization"
        >
          <option value="off">No grid</option>
          <option value="1/8">1/8 grid</option>
          <option value="1/16">1/16 grid</option>
        </select>
      </label>
      {showEmptyHint ? (
        <div className="score__empty">Play the keys, or press record to capture a take.</div>
      ) : null}
    </div>
  );
}
