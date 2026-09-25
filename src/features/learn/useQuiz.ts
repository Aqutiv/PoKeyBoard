import { useState } from 'react';
import type { StaffMode } from '@/features/notation/scoreRenderer';
import { midiToNoteName } from '@/utils/midi';
import { triadMidis, type ChordQuality, type NamedChord, type PitchClass } from './exerciseSpec';
import { DEFAULT_STAFF_BASE_MIDI } from './drill';
import type { NoteSpelling } from './noteLabel';
import { roundEntryAt } from './rounds';
import { singleNotePhrase, staffModeFor } from './staffPhrase';
import type { LearnPhrase, QuizQuestion, QuizStep } from './types';

/** The octave the quiz draws its keys from — C4 up to B4. */
export const QUIZ_BASE_MIDI = 60;
export const QUIZ_LOW_MIDI = 60;
export const QUIZ_HIGH_MIDI = 72;

/**
 * One answer button: a note, named by its pitch class, or — for a question
 * asked of the ear — a chord's quality. The panel turns either into words.
 */
export type QuizChoice = PitchClass | ChordQuality;

const EMPTY_POOL: readonly PitchClass[] = [];
const QUALITIES: readonly ChordQuality[] = ['major', 'minor'];

export interface QuizSession {
  /** The key currently highlighted, as a midi number. Unused by an ear round. */
  midi: number;
  /** Answer buttons, in display order. */
  choices: readonly QuizChoice[];
  done: number;
  total: number;
  satisfied: boolean;
  /** The last wrong answer, cleared once the round is answered correctly. */
  wrong: QuizChoice | null;
  /** This round's right answer — what a wrong one is corrected to. */
  correct: QuizChoice;
  /** Which name the buttons and the diagram show a black key under. */
  spelling: NoteSpelling;
  /** How the question is asked: a lit key, a note on a staff, or a chord heard. */
  kind: QuizQuestion['kind'];
  /** For a reading round, the staff to draw. */
  phrase: LearnPhrase | null;
  /**
   * For an ear round, the chord to play when asked. Never drawn: a triad on a
   * staff can be told major or minor by counting, and this question is about
   * what it sounds like.
   */
  hear: LearnPhrase | null;
  /**
   * An ear round whose chord has not been played yet. Its answers wait: a
   * listening question answered without listening grades a memorised answer
   * order, not the ear.
   */
  needsHearing: boolean;
  /** Record that this round's chord was played. */
  markHeard: () => void;
  /** Which staves that phrase is drawn on. */
  staves: StaffMode;
  answer: (choice: QuizChoice) => void;
}

/** Which entry of the pool round `round` asks about. See `rounds.ts`. */
export function quizPitchClassAt(pool: readonly PitchClass[], round: number): PitchClass {
  return roundEntryAt(pool, round) ?? 0;
}

const triadCache = new Map<string, LearnPhrase>();

/**
 * A triad to listen to: two beats, root position, rooted in the octave above
 * middle C. Long enough to hear its quality, short enough that a six-round
 * quiz is not spent waiting for the Hear button to come back. Cached so its
 * identity holds for as long as the round does — the same reason
 * `singleNotePhrase` caches.
 */
export function triadPhrase(chord: NamedChord): LearnPhrase {
  const key = `${chord.root}|${chord.quality}`;
  let phrase = triadCache.get(key);
  if (!phrase) {
    const names = triadMidis(QUIZ_BASE_MIDI + chord.root, chord.quality).map(midiToNoteName);
    phrase = {
      bpm: 60,
      timeSignature: { numerator: 4, denominator: 4 },
      events: [[0, names, 2, 0.7, 'treble']],
    };
    triadCache.set(key, phrase);
  }
  return phrase;
}

/**
 * Drive one recognition step.
 *
 * Questions are chosen deterministically rather than at random: every entry in
 * the pool gets asked, the e2e can assert exact answers, and repeating a
 * chapter repeats the lesson rather than rerolling it.
 *
 * A wrong answer does not advance the round — it names the right answer and
 * asks again, so nobody can get stuck, and no skip affordance is needed.
 */
export function useQuiz(step: QuizStep | null): QuizSession {
  const [round, setRound] = useState(0);
  const [wrong, setWrong] = useState<QuizChoice | null>(null);
  /** The last round whose chord was played; -1 before any. */
  const [heardRound, setHeardRound] = useState(-1);

  // Same render-phase reset as useExercise: an effect would paint the new step
  // once against the previous step's score.
  const [activeStep, setActiveStep] = useState(step);
  if (activeStep !== step) {
    setActiveStep(step);
    setRound(0);
    setWrong(null);
    setHeardRound(-1);
  }

  const question = step?.question;
  const total = step?.rounds ?? 0;
  const satisfied = total > 0 && round >= total;

  const asked =
    question?.kind === 'chordQuality' ? roundEntryAt(question.chords, round) : undefined;
  // Each round's chord must be played before it can be answered — a new round
  // is a new question, so hearing the last one does not count.
  const needsHearing = asked !== undefined && heardRound !== round && !satisfied;
  const pool =
    question !== undefined && question.kind !== 'chordQuality' ? question.pitchClasses : EMPTY_POOL;
  const pitchClass = quizPitchClassAt(pool, round);
  const correct: QuizChoice = asked ? asked.quality : pitchClass;

  // A plain function: it only ever reaches an onClick, so nothing downstream
  // depends on its identity.
  const answer = (choice: QuizChoice): void => {
    // Refused here as well as by the disabled buttons: the rule is the quiz's,
    // not the panel's.
    if (satisfied || needsHearing) return;
    if (choice === correct) {
      setRound((current) => current + 1);
      setWrong(null);
    } else {
      setWrong(choice);
    }
  };

  const reading = question?.kind === 'readNote';
  const midi =
    (reading ? (question.baseMidi ?? DEFAULT_STAFF_BASE_MIDI) : QUIZ_BASE_MIDI) + pitchClass;
  const staff = reading ? question.staff : undefined;

  return {
    midi,
    choices: question?.kind === 'chordQuality' ? QUALITIES : pool,
    done: Math.min(round, total),
    total,
    satisfied,
    wrong,
    correct,
    spelling:
      question !== undefined && 'spelling' in question ? (question.spelling ?? 'sharp') : 'sharp',
    kind: question?.kind ?? 'nameTheKey',
    phrase: reading ? singleNotePhrase(midi, staff) : null,
    hear: asked ? triadPhrase(asked) : null,
    needsHearing,
    markHeard: () => setHeardRound(round),
    staves: staffModeFor(staff),
    answer,
  };
}
