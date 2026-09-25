import type { TrackEvent } from '@/features/library/trackBuilder';
import {
  ODE_TO_JOY_EVENTS,
  ODE_TO_JOY_FIRST_STEPS,
  ODE_TO_JOY_PHRASE_BEATS,
} from '@/features/library/tracks/odeToJoyFirstSteps';
import type { ExerciseSpec } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Chapter 7 — Your First Melody.
 *
 * Chapters 4–5 taught which note and chapter 6 taught when; this is the first
 * chapter that asks for both at once, which is what the `playAlong` spec
 * exists for. Nothing else in it is new: the tune is Ode to Joy in chapter
 * four's five-finger position, in chapter six's quarters and halves, at the
 * 60bpm every lesson is clicked at.
 *
 * The melody is imported from the Library track the chapter hands off to, so
 * the tune graded here and the one waiting on Play are the same array.
 *
 * Shape: hear it → find the notes with no clock → play it in time, phrase by
 * phrase, then whole. Phrases are the chapter's other subject, so the line is
 * taught as the question-and-answer it is, and each phrase is played on its
 * own before the join between them is asked for.
 *
 * Authoring rules the catalog test enforces:
 *
 *  - A step's picture and its gate are **the same phrase object**, so what is
 *    drawn is by construction what is graded — and lit.
 *  - Every Listen phrase sounds on its final beat (see chapter 6).
 *  - Treble only, C4–G4, quarters and halves, no note across a bar line.
 */

const MIDDLE_C = 60;

function phrase(events: readonly TrackEvent[]): LearnPhrase {
  return { bpm: 60, timeSignature: { numerator: 4, denominator: 4 }, events };
}

/** The melody's events from `from` up to `to`, moved to start at beat 0. */
function slice(from: number, to: number): LearnPhrase {
  return phrase(
    ODE_TO_JOY_EVENTS.filter(([beat]) => beat >= from && beat < to).map(
      ([beat, ...rest]): TrackEvent => [beat - from, ...rest],
    ),
  );
}

const OPENING = slice(0, 8);
const QUESTION = slice(0, ODE_TO_JOY_PHRASE_BEATS);
const ANSWER = slice(ODE_TO_JOY_PHRASE_BEATS, 2 * ODE_TO_JOY_PHRASE_BEATS);
const WHOLE = phrase(ODE_TO_JOY_EVENTS);

/** The time signature has been taught, so every stave here shows it. */
function staff(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: line };
}

const untimed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line });
const timed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line, timed: {} });

export const FIRST_MELODY: LearnChapter = {
  id: 'firstMelody',
  handoff: { trackId: ODE_TO_JOY_FIRST_STEPS.trackId, mode: 'training-right' },
  steps: [
    {
      id: 'pitchAndRhythm',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // The click starts a step before anything is graded against it, as in
      // chapter 6: the beat is something heard before it is something judged.
      click: true,
      visual: staff(OPENING),
      listen: OPENING,
    },
    {
      id: 'oneHandPosition',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [60, 62, 64, 65, 67],
        labelText: { 60: '1', 62: '2', 64: '3', 65: '4', 67: '5' },
      },
    },
    {
      id: 'phraseOne',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(QUESTION),
      listen: QUESTION,
    },
    {
      id: 'findPhraseOne',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      // No clock: the notes first, the time after. The lit heads show how far
      // a clean run has got, and a slip darkens them back to the start.
      visual: staff(QUESTION),
      listen: QUESTION,
      spec: untimed(QUESTION),
    },
    {
      id: 'playPhraseOne',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(QUESTION),
      listen: QUESTION,
      spec: timed(QUESTION),
    },
    {
      id: 'phraseTwo',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(ANSWER),
      listen: ANSWER,
    },
    {
      id: 'playPhraseTwo',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(ANSWER),
      listen: ANSWER,
      spec: timed(ANSWER),
    },
    {
      id: 'wholeMelody',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(WHOLE),
      listen: WHOLE,
    },
    {
      id: 'playTheMelody',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(WHOLE),
      listen: WHOLE,
      // No checkpoint at the second phrase: each phrase has had its own step,
      // and the join between them is exactly what this one is asking for.
      spec: timed(WHOLE),
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(WHOLE),
      listen: WHOLE,
    },
  ],
};
