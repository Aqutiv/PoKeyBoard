import type { LearnChapter } from '../types';

/**
 * Chapter 2 — The Musical Alphabet.
 *
 * Builds only on chapter 1: finding C, the black-key groups, and octaves. The
 * arc is name → produce → recognise → produce from the map → reverse it, so
 * the seven letters get approached from every side rather than recited.
 *
 * Both scale walks are `sequence` steps, the only ordered spec kind: a set
 * cannot express "C then D", nor a line whose first and last note are both C.
 */
const MIDDLE_C = 60;

/** The white keys, in alphabet order from C. */
const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;

export const MUSICAL_ALPHABET: LearnChapter = {
  id: 'musicalAlphabet',
  steps: [
    {
      id: 'sevenLetters',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        labels: [60, 62, 64, 65, 67, 69, 71],
      },
      listen: {
        bpm: 132,
        timeSignature: { numerator: 4, denominator: 4 },
        events: [
          [0, 'C4', 1, 0.65],
          [1, 'D4', 1, 0.65],
          [2, 'E4', 1, 0.65],
          [3, 'F4', 1, 0.65],
          [4, 'G4', 1, 0.65],
          [5, 'A4', 1, 0.65],
          [6, 'B4', 1, 0.65],
          [7, 'C5', 2, 0.7],
        ],
      },
    },
    {
      id: 'walkUp',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'sequence', pitchClasses: [0, 2, 4, 5, 7, 9, 11, 0], direction: 'up' },
    },
    {
      id: 'whereLettersHide',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        // The pair and the triple tinted apart, with every white key named:
        // this one diagram is the whole landmark map.
        highlight: [61, 63],
        highlightSecondary: [66, 68, 70],
        labels: [60, 62, 64, 65, 67, 69, 71],
      },
    },
    {
      id: 'nameTheKey',
      kind: 'quiz',
      rounds: 5,
      question: { kind: 'nameTheKey', pitchClasses: WHITE_PITCH_CLASSES },
    },
    {
      id: 'findDFA',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      // Order matters, height does not: any D, then any F, then any A.
      spec: { kind: 'sequence', pitchClasses: [2, 5, 9] },
    },
    {
      id: 'walkingBackDown',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      listen: {
        bpm: 132,
        timeSignature: { numerator: 4, denominator: 4 },
        events: [
          [0, 'C5', 1, 0.65],
          [1, 'B4', 1, 0.65],
          [2, 'A4', 1, 0.65],
          [3, 'G4', 1, 0.65],
          [4, 'F4', 1, 0.65],
          [5, 'E4', 1, 0.65],
          [6, 'D4', 1, 0.65],
          [7, 'C4', 2, 0.7],
        ],
      },
    },
    {
      id: 'walkDown',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      // Starts on the upper C, so the whole line fits the window a phone shows.
      spec: { kind: 'sequence', pitchClasses: [0, 11, 9, 7, 5, 4, 2, 0], direction: 'down' },
    },
    {
      id: 'sameSevenEverywhere',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 48,
        highMidi: 72,
        highlight: [57, 69],
        labels: [57, 69],
      },
    },
    {
      id: 'twoDifferentAs',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'pitchClass', pitchClass: 9, octaves: 2 },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      visual: {
        kind: 'staff',
        phrase: {
          bpm: 100,
          timeSignature: { numerator: 4, denominator: 4 },
          events: [
            [0, 'C4', 1, 0.7],
            [1, 'D4', 1, 0.7],
            [2, 'E4', 2, 0.7],
          ],
        },
      },
    },
  ],
};
