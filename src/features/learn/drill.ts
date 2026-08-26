import type { StaffMode } from '@/features/notation/scoreRenderer';
import type { ExerciseSpec } from './exerciseSpec';
import { noteLabel } from './noteLabel';
import { roundEntryAt } from './rounds';
import { singleNotePhrase, staffModeFor } from './staffPhrase';
import type { DrillPool, LearnPhrase } from './types';

/** Middle C — where the first reading chapter's five notes start. */
export const DEFAULT_STAFF_BASE_MIDI = 60;

export interface DrillRound {
  /** What the user has to play. Handed straight to the exercise matcher. */
  spec: ExerciseSpec;
  /** Filled into the one generic "Play {note}." message. Empty when the
   *  question is a picture, since naming it would be the answer. */
  label: string;
  /** A staff showing the note to play, for reading rounds. */
  phrase?: LearnPhrase;
  /** Which staves that phrase is drawn on. Treble unless the pool says. */
  staves?: StaffMode;
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

  if (pool.kind === 'readNote') {
    const midi = (pool.baseMidi ?? DEFAULT_STAFF_BASE_MIDI) + pitchClass;
    // The exact note, not its pitch class: the drawing is octave-pinned, and a
    // reading round is precisely about *which line the note sits on*. Accepting
    // the octave above would complete the round while the drawn head stayed
    // dark, teaching the opposite of the lesson.
    //
    // No label either — the staff *is* the question, and writing the note's
    // name beside it would hand over the answer.
    return {
      spec: { kind: 'exactKeys', midis: [midi] },
      label: '',
      phrase: singleNotePhrase(midi, pool.staff),
      staves: staffModeFor(pool.staff),
    };
  }
  return {
    spec: { kind: 'pitchClass', pitchClass },
    label: noteLabel(pitchClass, pool.spelling),
  };
}
