import type { ExerciseSpec } from './exerciseSpec';
import { noteLabel } from './noteLabel';
import { roundEntryAt } from './rounds';
import type { DrillPool } from './types';

export interface DrillRound {
  /** What the user has to play. Handed straight to the exercise matcher. */
  spec: ExerciseSpec;
  /** Filled into the one generic "Play {note}." message. */
  label: string;
}

/**
 * What round `round` asks for. Pure, so the whole round order is testable
 * without React or an audio context.
 *
 * Each round is an ordinary `ExerciseSpec`, which is the point: everything
 * about matching, held notes and hints comes from the existing exercise
 * machinery, and a drill only decides what to ask next.
 */
export function drillRoundAt(pool: DrillPool, round: number): DrillRound | null {
  const pitchClass = roundEntryAt(pool.pitchClasses, round);
  if (pitchClass === undefined) return null;
  return {
    spec: { kind: 'pitchClass', pitchClass },
    label: noteLabel(pitchClass, pool.spelling),
  };
}
