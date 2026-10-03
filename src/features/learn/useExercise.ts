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
export function useExercise(
  spec: ExerciseSpec | null,
  /** Converts an audio-clock time to fractional click beats; `null` when no
   *  click is running. Must be referentially stable — see `LessonClick`. */
  beatsAt?: (audioTimeSeconds: number) => number | null,
): ExerciseSession {
  const [state, setState] = useState<ExerciseState>(initExercise);
  /**
   * How far the player's patience has run since it was last renewed (`epoch`):
   * 0, then 1 once a hint is due, 2 once a skip is. Two timers move it on, so a
   * lesson renders when help is offered rather than every second until then.
   */
  const [patience, setPatience] = useState({ epoch: 0, stage: 0 });
  const renewPatience = useCallback(
    () => setPatience((previous) => ({ epoch: previous.epoch + 1, stage: 0 })),
    [],
  );
  const heldRef = useRef<Set<number>>(new Set());

  const reset = useCallback(() => {
    setState(initExercise());
    renewPatience();
  }, [renewPatience]);

  // Dropping state when a prop changes belongs in render, not an effect: an
  // effect would paint the new step once against the old step's progress.
  //
  // `current` matters as much as the reset. Reading `state` here would report
  // the *previous* spec's progress for one render — harmless when a step
  // changes on a click, but a drill hands over a new spec the instant a round
  // is satisfied, and a stale "satisfied" would make it skip a round.
  const [activeSpec, setActiveSpec] = useState(spec);
  // The furthest this step has got, so patience runs out on someone going
  // round in circles as surely as on someone doing nothing.
  const [bestDone, setBestDone] = useState(0);
  let current = state;
  if (activeSpec !== spec) {
    current = initExercise();
    setActiveSpec(spec);
    setState(current);
    renewPatience();
    setBestDone(0);
  }

  useEffect(() => {
    if (!spec) return;
    // Keys already down when the step opens must not be credited, but their
    // eventual release still has to balance the held set.
    heldRef.current = new Set(audioEngine.getActiveNotes());

    // The pedal as one pedal: whichever of the on-screen button, Space or a
    // MIDI pedal moved it. The per-source `sustain` input events below would
    // report a second source going down as a press while the first still
    // held the dampers up — no change at all to the ear, so none to the
    // lesson. The engine's combined state reports only real changes, and
    // also a panic reset, which emits no input event at all.
    const stopPedal = audioEngine.subscribeSustain((down) => {
      const audioTime = audioEngine.currentTime;
      const input: ExerciseInput = {
        kind: 'pedal',
        down,
        atMs: audioTime * 1000,
        atBeats: beatsAt?.(audioTime) ?? null,
      };
      setState((current) => reduceExercise(spec, current, input));
    });

    const stopKeys = audioEngine.subscribeInput((event) => {
      if (event.type === 'sustain') return;
      const atMs = event.audioTime * 1000;
      // From seconds, not from `atMs`: the grid speaks audio-clock seconds, so
      // routing through the rounded millisecond value would lose precision for
      // nothing.
      const atBeats = beatsAt?.(event.audioTime) ?? null;
      const held = heldRef.current;
      let input: ExerciseInput;

      if (event.type === 'on') {
        // A repeated note-on with no note-off between is the shape a doubled
        // keyboard would take; ignoring it costs nothing and immunizes us.
        if (held.has(event.midi)) return;
        held.add(event.midi);
        input = { kind: 'press', midi: event.midi, atMs, atBeats, held: new Set(held) };
      } else {
        // `AudioEngine.noteOff` emits unconditionally, even for a note that
        // never sounded because no sample was decoded for it.
        if (!held.delete(event.midi)) return;
        input = { kind: 'release', midi: event.midi, atMs, atBeats, held: new Set(held) };
      }

      // The reducer is pure, so a double invocation under StrictMode is safe.
      setState((current) => reduceExercise(spec, current, input));
    });
    return () => {
      stopPedal();
      stopKeys();
    };
    // `beatsAt` must be referentially stable — `useLessonClick` returns a
    // ref-backed callback for exactly this reason. An unstable one would
    // resubscribe on every render and drop the held set with each rebuild.
  }, [spec, beatsAt]);

  const progress = spec ? progressOf(spec, current) : IDLE_PROGRESS;

  // Only getting further than ever before buys more patience. Resetting on any
  // change meant a timed line — where every slip sends the readout back to
  // nothing — never offered help to the person retrying it hardest.
  if (progress.done > bestDone) {
    setBestDone(progress.done);
    renewPatience();
  }

  const satisfied = progress.satisfied;
  const { epoch } = patience;
  useEffect(() => {
    if (!spec || satisfied) return;
    const runOutTo = (stage: number) => () =>
      setPatience((previous) =>
        previous.epoch === epoch ? { epoch, stage: Math.max(previous.stage, stage) } : previous,
      );
    const hint = window.setTimeout(runOutTo(1), HINT_AFTER_MS);
    const skip = window.setTimeout(runOutTo(2), SKIP_AFTER_MS);
    return () => {
      window.clearTimeout(hint);
      window.clearTimeout(skip);
    };
  }, [spec, satisfied, epoch]);

  return {
    state: current,
    progress,
    hintAvailable: !satisfied && patience.stage >= 1,
    skipAvailable: !satisfied && patience.stage >= 2,
    reset,
  };
}
