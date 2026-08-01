import { useCallback, useState } from 'react';
import type { PitchClass } from './exerciseSpec';
import type { NoteSpelling } from './noteLabel';
import { roundEntryAt } from './rounds';
import type { QuizStep } from './types';

/** The octave the quiz draws its keys from — C4 up to B4. */
export const QUIZ_BASE_MIDI = 60;
export const QUIZ_LOW_MIDI = 60;
export const QUIZ_HIGH_MIDI = 72;

const EMPTY_POOL: readonly PitchClass[] = [];

export interface QuizSession {
  /** The key currently highlighted, as a midi number. */
  midi: number;
  /** Answer buttons, in display order. */
  choices: readonly PitchClass[];
  done: number;
  total: number;
  satisfied: boolean;
  /** The last wrong answer, cleared once the round is answered correctly. */
  wrong: PitchClass | null;
  /** Which name the buttons and the diagram show a black key under. */
  spelling: NoteSpelling;
  answer: (choice: PitchClass) => void;
}

/** Which entry of the pool round `round` asks about. See `rounds.ts`. */
export function quizPitchClassAt(pool: readonly PitchClass[], round: number): PitchClass {
  return roundEntryAt(pool, round) ?? 0;
}

/**
 * Drive one recognition step.
 *
 * Questions are chosen deterministically rather than at random: every entry in
 * the pool gets asked, the e2e can assert exact answers, and repeating a
 * chapter repeats the lesson rather than rerolling it.
 *
 * A wrong answer does not advance the round — it names the key that was
 * actually highlighted and asks again, so nobody can get stuck, and no skip
 * affordance is needed.
 */
export function useQuiz(step: QuizStep | null): QuizSession {
  const [round, setRound] = useState(0);
  const [wrong, setWrong] = useState<PitchClass | null>(null);

  // Same render-phase reset as useExercise: an effect would paint the new step
  // once against the previous step's score.
  const [activeStep, setActiveStep] = useState(step);
  if (activeStep !== step) {
    setActiveStep(step);
    setRound(0);
    setWrong(null);
  }

  const pool = step?.question.pitchClasses ?? EMPTY_POOL;
  const total = step?.rounds ?? 0;
  const satisfied = total > 0 && round >= total;

  const pitchClass = quizPitchClassAt(pool, round);

  const answer = useCallback(
    (choice: PitchClass) => {
      if (satisfied) return;
      if (choice === pitchClass) {
        setRound((current) => current + 1);
        setWrong(null);
      } else {
        setWrong(choice);
      }
    },
    [satisfied, pitchClass],
  );

  return {
    midi: QUIZ_BASE_MIDI + pitchClass,
    choices: pool,
    done: Math.min(round, total),
    total,
    satisfied,
    wrong,
    spelling: step?.question.spelling ?? 'sharp',
    answer,
  };
}
