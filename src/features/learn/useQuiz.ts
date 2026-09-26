import { useState } from 'react';
import { majorTonicPitchClass } from '@/features/notation/keySignature';
import type { StaffMode } from '@/features/notation/scoreRenderer';
import { midiToNoteName } from '@/utils/midi';
import { triadMidis, type ChordQuality, type NamedChord, type PitchClass } from './exerciseSpec';
import { DEFAULT_STAFF_BASE_MIDI } from './drill';
import type { NoteSpelling } from './noteLabel';
import { roundEntryAt } from './rounds';
import { signaturePhrase, singleNotePhrase, staffModeFor } from './staffPhrase';
import type { LearnPhrase, QuizQuestion, QuizStep } from './types';

/** The octave the quiz draws its keys from — C4 up to B4. */
export const QUIZ_BASE_MIDI = 60;
export const QUIZ_LOW_MIDI = 60;
export const QUIZ_HIGH_MIDI = 72;

/**
 * One answer button: a note, named by its pitch class, or — for a question
 * asked of the ear — a chord's quality. The panel turns either into words. A
 * key is answered by its home note, so a key question's choices are pitch
 * classes too; `keys` says which key each one stands for.
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
  /** How the question is asked: a lit key, a note or a signature on a staff, or a chord heard. */
  kind: QuizQuestion['kind'];
  /** For a reading or key-signature round, the staff to draw. */
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
  /**
   * For a key-signature round, the signature drawn, in fifths: what a wrong
   * answer is corrected to, and what the staff's label says.
   */
  signature: number | null;
  /**
   * For a key-signature question, the key behind each of `choices`, index for
   * index. A home note alone cannot say whether it is F♯ major or G♭ major.
   */
  keys: readonly number[] | null;
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

const circleCache = new WeakMap<readonly number[], readonly number[]>();

/**
 * A key question's signatures in circle order — flats to sharps, the way the
 * sheet export's key chooser lists them — whatever order they are asked in.
 * Cached by pool, so the buttons keep one array for as long as the step does.
 */
function inCircleOrder(signatures: readonly number[]): readonly number[] {
  let ordered = circleCache.get(signatures);
  if (!ordered) {
    ordered = [...signatures].sort((a, b) => a - b);
    circleCache.set(signatures, ordered);
  }
  return ordered;
}

/** Everything one round shows and asks, whatever kind of question asks it. */
export interface QuizRound {
  correct: QuizChoice;
  choices: readonly QuizChoice[];
  midi: number;
  spelling: NoteSpelling;
  phrase: LearnPhrase | null;
  hear: LearnPhrase | null;
  staves: StaffMode;
  signature: number | null;
  keys: readonly number[] | null;
}

/** A round of a note question: a pitch class, lit on a key or drawn on a staff. */
function noteRound(
  pitchClasses: readonly PitchClass[],
  round: number,
  spelling: NoteSpelling | undefined,
): QuizRound {
  const pitchClass = quizPitchClassAt(pitchClasses, round);
  return {
    correct: pitchClass,
    choices: pitchClasses,
    midi: QUIZ_BASE_MIDI + pitchClass,
    spelling: spelling ?? 'sharp',
    phrase: null,
    hear: null,
    staves: 'treble',
    signature: null,
    keys: null,
  };
}

/**
 * What round `round` of a question shows and asks. Pure, like `drillRoundAt`,
 * and a `switch` so a new kind of question is a compile error here rather
 * than quietly asked as a note.
 */
export function quizRoundAt(question: QuizQuestion | undefined, round: number): QuizRound {
  switch (question?.kind) {
    case undefined:
      return noteRound(EMPTY_POOL, round, undefined);
    case 'nameTheKey':
      return noteRound(question.pitchClasses, round, question.spelling);
    case 'readNote': {
      const asked = noteRound(question.pitchClasses, round, question.spelling);
      const midi = (question.baseMidi ?? DEFAULT_STAFF_BASE_MIDI) + (asked.correct as PitchClass);
      return {
        ...asked,
        midi,
        phrase: singleNotePhrase(midi, question.staff),
        staves: staffModeFor(question.staff),
      };
    }
    case 'chordQuality': {
      const chord = roundEntryAt(question.chords, round);
      return {
        ...noteRound(EMPTY_POOL, round, undefined),
        correct: chord ? chord.quality : 0,
        choices: QUALITIES,
        hear: chord ? triadPhrase(chord) : null,
      };
    }
    case 'keySignature': {
      const signature = roundEntryAt(question.signatures, round);
      const keys = inCircleOrder(question.signatures);
      const tonic = (signature === undefined ? 0 : majorTonicPitchClass(signature)) as PitchClass;
      return {
        correct: tonic,
        choices: keys.map((key) => majorTonicPitchClass(key) as PitchClass),
        midi: QUIZ_BASE_MIDI + tonic,
        spelling: 'sharp',
        // The signature alone: a note on the staff would give the key away.
        phrase: signature === undefined ? null : signaturePhrase(signature),
        hear: null,
        staves: 'treble',
        signature: signature ?? null,
        keys,
      };
    }
  }
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

  const asked = quizRoundAt(question, round);
  // Each round's chord must be played before it can be answered — a new round
  // is a new question, so hearing the last one does not count.
  const needsHearing = asked.hear !== null && heardRound !== round && !satisfied;

  // A plain function: it only ever reaches an onClick, so nothing downstream
  // depends on its identity.
  const answer = (choice: QuizChoice): void => {
    // Refused here as well as by the disabled buttons: the rule is the quiz's,
    // not the panel's.
    if (satisfied || needsHearing) return;
    if (choice === asked.correct) {
      setRound((current) => current + 1);
      setWrong(null);
    } else {
      setWrong(choice);
    }
  };

  return {
    midi: asked.midi,
    choices: asked.choices,
    done: Math.min(round, total),
    total,
    satisfied,
    wrong,
    correct: asked.correct,
    spelling: asked.spelling,
    kind: question?.kind ?? 'nameTheKey',
    phrase: asked.phrase,
    hear: asked.hear,
    needsHearing,
    markHeard: () => setHeardRound(round),
    staves: asked.staves,
    signature: asked.signature,
    keys: asked.keys,
    answer,
  };
}
