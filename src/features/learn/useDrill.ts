import { useMemo, useState } from 'react';
import { drillRoundAt, type DrillRound } from './drill';
import type { ExerciseProgress } from './exerciseMatcher';
import type { ExerciseSpec } from './exerciseSpec';
import type { DrillStep } from './types';
import { useExercise, type ExerciseSession } from './useExercise';

const IDLE_PROGRESS: ExerciseProgress = { done: 0, total: 0, satisfied: false };

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

  // Same render-phase reset the other Learn hooks use: an effect would paint
  // the new step once against the previous one's score.
  const [activeStep, setActiveStep] = useState(step);
  if (activeStep !== step) {
    setActiveStep(step);
    setRound(0);
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

  // Advancing in render rather than an effect keeps a satisfied round from
  // being painted before the next question replaces it. This cannot loop:
  // `useExercise` reports the new spec's own fresh progress in the very same
  // render, so `satisfied` is false again immediately.
  if (play.progress.satisfied && !satisfied) setRound(round + 1);

  return {
    spec: current?.spec ?? null,
    round: current,
    play,
    progress: step ? { done: Math.min(round, total), total, satisfied } : IDLE_PROGRESS,
  };
}
