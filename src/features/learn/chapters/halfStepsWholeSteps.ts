import type { PitchClass } from '../exerciseSpec';
import type { LearnChapter } from '../types';

/**
 * Chapter 3 — Half Steps, Whole Steps & the Black Keys.
 *
 * The last chapter about the instrument itself, before the course turns to
 * reading. Order is deliberate: the concept (half step) before its name
 * (sharp), the rule (white keys are a whole step apart) before its two
 * exceptions, and recognition before production — so the closing drill can
 * lean on names the user has already had to recall.
 *
 * The step exercises deliberately carry no `together`: an `interval` with no
 * `lowerPitchClass` and no togetherness reads the cumulative candidate set,
 * which is what makes it "any two keys a semitone apart" rather than one
 * pinned pair — and is what lets a one-pointer mouse play it at all.
 */
const MIDDLE_C = 60;

/** C♯ D♯ F♯ G♯ A♯ — the five black keys, in order. */
const BLACK_PITCH_CLASSES: readonly PitchClass[] = [1, 3, 6, 8, 10];

export const HALF_STEPS_WHOLE_STEPS: LearnChapter = {
  id: 'halfStepsWholeSteps',
  steps: [
    {
      id: 'smallestStep',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        // One white→black pair and one white→white pair, so "the very next key"
        // reads as a rule rather than as something about black keys.
        highlight: [60, 61],
        highlightSecondary: [64, 65],
      },
      listen: {
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        events: [
          [0, 'C4', 1, 0.65],
          [1, 'C#4', 1, 0.65],
          [2, 'E4', 1, 0.65],
          [3, 'F4', 1, 0.65],
        ],
      },
    },
    {
      id: 'playHalfStep',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'interval', semitones: 1 },
    },
    {
      id: 'wholeSteps',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [60, 62],
        // The key you step over, shown apart from the two you play.
        highlightSecondary: [61],
        labels: [60, 62],
      },
    },
    {
      id: 'playWholeStep',
      kind: 'exercise',
      spec: { kind: 'interval', semitones: 2 },
    },
    {
      id: 'whiteKeysTouch',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [64, 65],
        highlightSecondary: [71, 72],
        labels: [64, 65, 71, 72],
      },
    },
    {
      id: 'playTouchingPairs',
      kind: 'exercise',
      // E4 rather than middle C: `stepWhites(64, 7, 1)` is 74, so even the
      // seven white keys a 320px phone shows span E4–D5 and hold all four
      // notes. Anchored at middle C the closing C5 would fall off the edge.
      anchorMidi: 64,
      spec: { kind: 'sequence', pitchClasses: [4, 5, 11, 0], direction: 'up' },
    },
    {
      id: 'sharps',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [61, 63, 66, 68, 70],
        labels: [61, 63, 66, 68, 70],
        spelling: 'sharp',
      },
    },
    {
      id: 'nameTheBlackKey',
      kind: 'quiz',
      rounds: 5,
      question: { kind: 'nameTheKey', pitchClasses: BLACK_PITCH_CLASSES, spelling: 'sharp' },
    },
    {
      id: 'flats',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [61, 63, 66, 68, 70],
        labels: [61, 63, 66, 68, 70],
        spelling: 'flat',
      },
    },
    {
      id: 'findNamedKeys',
      kind: 'drill',
      anchorMidi: MIDDLE_C,
      rounds: 5,
      // Flat names, so the round that asks for D♭ lands on the key they called
      // C♯ two steps ago — the point of the whole chapter, played rather than
      // read. No `listen`: "Show me" would fire one fixed phrase at a target
      // that changes every round.
      drill: { kind: 'namedKey', pitchClasses: BLACK_PITCH_CLASSES, spelling: 'flat' },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      visual: {
        kind: 'staff',
        // Sharp side on purpose: StaffSnippet engraves in C major, so a flat
        // would come out spelled as its sharp and contradict the lesson.
        phrase: {
          bpm: 100,
          timeSignature: { numerator: 4, denominator: 4 },
          events: [
            [0, 'C4', 1, 0.7],
            [1, 'C#4', 1, 0.7],
            [2, 'D4', 2, 0.7],
          ],
        },
      },
    },
  ],
};
