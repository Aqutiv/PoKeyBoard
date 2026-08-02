import { useEffect, useMemo, useState } from 'react';
import { drillRoundAt, type DrillRound } from './drill';
import type { ExerciseProgress } from './exerciseMatcher';
import type { ExerciseSpec } from './exerciseSpec';
import type { DrillStep } from './types';
import { useExercise, type ExerciseSession } from './useExercise';

const IDLE_PROGRESS: ExerciseProgress = { done: 0, total: 0, satisfied: false };

/** Long enough to see the note you just found light up, short enough to keep
 *  a five-round drill feeling brisk. */
const HOLD_MS = 500;

export interface DrillSession {
  /** The current round's spec, or null once every round is done. */
  spec: ExerciseSpec | null;
  round: DrillRound | null;
  /** Live matching for the current round — hints, timers and all. */
  play: ExerciseSession;
  /** Counted in rounds, not notes: "3 of 6". */
  progress: ExerciseProgress;
}

/**
 * Run a drill: ask for a note, wait for it to be played, ask for the next.
 *
 * Almost none of this is new machinery. Each round is an ordinary
 * `ExerciseSpec` handed to `useExercise`, which already resets everything it
 * owns whenever the spec identity changes — so a new round arrives clean, with
 * its own patience timers and its own hint, for free.
 */
export function useDrill(step: DrillStep | null): DrillSession {
  const [round, setRound] = useState(0);
  /** The round whose answer is being held on screen; -1 when none is. */
  const [scored, setScored] = useState(-1);

  // Same render-phase reset the other Learn hooks use: an effect would paint
  // the new step once against the previous one's score.
  const [activeStep, setActiveStep] = useState(step);
  if (activeStep !== step) {
    setActiveStep(step);
    setRound(0);
    setScored(-1);
  }

  const total = step?.rounds ?? 0;
  const satisfied = total > 0 && round >= total;

  // Memoized so the identity holds *within* a round; a fresh identity is
  // precisely what starts the next one.
  const current = useMemo(
    () => (step && !satisfied ? drillRoundAt(step.drill, round) : null),
    [step, round, satisfied],
  );

  const play = useExercise(current?.spec ?? null);

  // Mark the round answered in render, so the readout ticks on the same frame
  // the note lands. Advancing happens later — see below.
  const holding = scored === round && !satisfied;
  if (play.progress.satisfied && !satisfied && scored !== round) setScored(round);

  // Hold the answer on screen before moving on. Advancing straight away — as
  // this did — replaced the question in the same render that satisfied it, so
  // the moment being celebrated never painted: the note the user just found
  // never got to light up. The timeout is cancelled by leaving the step or
  // unmounting, so a drill can never advance into a chapter it has left.
  useEffect(() => {
    if (scored !== round) return;
    const id = window.setTimeout(() => setRound((current) => current + 1), HOLD_MS);
    return () => window.clearTimeout(id);
  }, [scored, round]);

  return {
    spec: current?.spec ?? null,
    round: current,
    play,
    progress: step
      ? { done: Math.min(round + (holding ? 1 : 0), total), total, satisfied }
      : IDLE_PROGRESS,
  };
}
