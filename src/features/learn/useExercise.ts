import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import {
  initExercise,
  progressOf,
  reduceExercise,
  type ExerciseInput,
  type ExerciseProgress,
  type ExerciseState,
} from './exerciseMatcher';
import type { ExerciseSpec } from './exerciseSpec';

/** Long enough to think, short enough not to feel abandoned. */
const HINT_AFTER_MS = 15_000;
/** Nobody should be trapped on step one of a beginner course. */
const SKIP_AFTER_MS = 30_000;
const TICK_MS = 1000;

const IDLE_PROGRESS: ExerciseProgress = { done: 0, total: 0, satisfied: false };

export interface ExerciseSession {
  state: ExerciseState;
  progress: ExerciseProgress;
  hintAvailable: boolean;
  skipAvailable: boolean;
  reset: () => void;
}

/**
 * Drive one exercise from live keyboard input.
 *
 * Matching lives entirely in the pure reducer; this hook owns only the
 * subscription, the held-note bookkeeping the engine does not do for us, and
 * the two patience timers. Idle time is counted in ticks rather than read off
 * a clock, so nothing here is impure at render time.
 */
export function useExercise(spec: ExerciseSpec | null): ExerciseSession {
  const [state, setState] = useState<ExerciseState>(initExercise);
  const [idleTicks, setIdleTicks] = useState(0);
  const heldRef = useRef<Set<number>>(new Set());

  const reset = useCallback(() => {
    setState(initExercise());
    setIdleTicks(0);
  }, []);

  // Dropping state when a prop changes belongs in render, not an effect: an
  // effect would paint the new step once against the old step's progress.
  //
  // `current` matters as much as the reset. Reading `state` here would report
  // the *previous* spec's progress for one render — harmless when a step
  // changes on a click, but a drill hands over a new spec the instant a round
  // is satisfied, and a stale "satisfied" would make it skip a round.
  const [activeSpec, setActiveSpec] = useState(spec);
  let current = state;
  if (activeSpec !== spec) {
    current = initExercise();
    setActiveSpec(spec);
    setState(current);
    setIdleTicks(0);
  }

  useEffect(() => {
    if (!spec) return;
    // Keys already down when the step opens must not be credited, but their
    // eventual release still has to balance the held set.
    heldRef.current = new Set(audioEngine.getActiveNotes());

    return audioEngine.subscribeInput((event) => {
      if (event.type === 'sustain') return;
      const atMs = event.audioTime * 1000;
      const held = heldRef.current;
      let input: ExerciseInput;

      if (event.type === 'on') {
        // A repeated note-on with no note-off between is the shape a doubled
        // keyboard would take; ignoring it costs nothing and immunizes us.
        if (held.has(event.midi)) return;
        held.add(event.midi);
        input = { kind: 'press', midi: event.midi, atMs, held: new Set(held) };
      } else {
        // `AudioEngine.noteOff` emits unconditionally, even for a note that
        // never sounded because no sample was decoded for it.
        if (!held.delete(event.midi)) return;
        input = { kind: 'release', midi: event.midi, atMs, held: new Set(held) };
      }

      // The reducer is pure, so a double invocation under StrictMode is safe.
      setState((current) => reduceExercise(spec, current, input));
    });
  }, [spec]);

  const progress = spec ? progressOf(spec, current) : IDLE_PROGRESS;

  // Any forward progress buys more patience before we start offering help.
  const [lastDone, setLastDone] = useState(progress.done);
  if (lastDone !== progress.done) {
    setLastDone(progress.done);
    setIdleTicks(0);
  }

  const satisfied = progress.satisfied;
  useEffect(() => {
    if (!spec || satisfied) return;
    const id = window.setInterval(() => setIdleTicks((ticks) => ticks + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [spec, satisfied]);

  const idleMs = idleTicks * TICK_MS;

  return {
    state: current,
    progress,
    hintAvailable: !satisfied && idleMs >= HINT_AFTER_MS,
    skipAvailable: !satisfied && idleMs >= SKIP_AFTER_MS,
    reset,
  };
}
