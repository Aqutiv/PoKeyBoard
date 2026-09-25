import type { StaffMode } from '@/features/notation/scoreRenderer';
import {
  DEFAULT_ONSET_WINDOW_MS,
  type ExerciseSpec,
  type NamedChord,
  type PitchClass,
  type Togetherness,
} from './exerciseSpec';
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
  /** For a degree round, the degree asked for — the prompt names it, not a note. */
  degree?: number;
  /** For a chord round, the chord asked for — the prompt names it. */
  chord?: NamedChord;
}

/**
 * How "a chord" is judged in a drill round: held together, or rolled inside
 * the onset window — a desktop mouse is one pointer and cannot hold three keys.
 */
const CHORD_TOGETHER: Togetherness = { overlap: true, onsetWindowMs: DEFAULT_ONSET_WINDOW_MS };

/** Semitones above the tonic of each degree of a major scale: W W H W W W H. */
export const MAJOR_SCALE_STEPS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * What round `round` asks for. Pure, so the whole round order is testable
 * without React or an audio context.
 *
 * Each round is an ordinary `ExerciseSpec`, which is the point: everything
 * about matching, held notes and hints comes from the existing exercise
 * machinery, and a drill only decides what to ask next.
 */
export function drillRoundAt(pool: DrillPool, round: number): DrillRound | null {
  if (pool.kind === 'namedChord') {
    const chord = roundEntryAt(pool.chords, round);
    if (chord === undefined) return null;
    return { spec: { kind: 'chord', chord, together: CHORD_TOGETHER }, label: '', chord };
  }

  if (pool.kind === 'scaleDegree') {
    const degree = roundEntryAt(pool.degrees, round);
    const offset = degree === undefined ? undefined : MAJOR_SCALE_STEPS[degree - 1];
    if (degree === undefined || offset === undefined) return null;
    // Any octave: the question is where degree 5 lives in the scale, and the
    // same key an octave up is the same degree. Nothing is drawn, and no note
    // is named — the name would be the answer.
    const pitchClass = ((pool.tonic + offset) % 12) as PitchClass;
    return { spec: { kind: 'pitchClass', pitchClass }, label: '', degree };
  }

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
