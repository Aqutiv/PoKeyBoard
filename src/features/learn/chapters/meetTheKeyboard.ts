import { DEFAULT_ONSET_WINDOW_MS } from '../exerciseSpec';
import type { LearnChapter } from '../types';

/**
 * Chapter 1 — Meet the Keyboard.
 *
 * For someone who has never touched a piano. The order is deliberate: sound
 * before theory, geography before names, and the pattern before the name of
 * the pattern. Step 1 cannot be failed, and it doubles as proof that the audio
 * actually works before anything is asked of the user.
 *
 * Reading music is explicitly not taught here — the single staff snippet at
 * the end is a bridge to chapter 2, not a lesson.
 *
 * Every simultaneity check allows a 400 ms roll as well as a true overlap: a
 * desktop mouse is one pointer and physically cannot hold two keys down.
 */
const TOGETHER = { overlap: true, onsetWindowMs: DEFAULT_ONSET_WINDOW_MS } as const;

/** Middle C, where every step parks the keyboard unless it says otherwise. */
const MIDDLE_C = 60;

export const MEET_THE_KEYBOARD: LearnChapter = {
  id: 'meetTheKeyboard',
  steps: [
    {
      id: 'makeSound',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'distinctKeys', count: 3 },
    },
    {
      id: 'highAndLow',
      kind: 'theory',
      visual: { kind: 'keyboard', lowMidi: 48, highMidi: 84 },
      // Two octaves below middle C, then two above: the point lands instantly.
      listen: {
        bpm: 80,
        timeSignature: { numerator: 4, denominator: 4 },
        events: [
          [0, 'C2', 1.5, 0.7],
          [2, 'C6', 1.5, 0.7],
        ],
      },
    },
    {
      id: 'lowThenHigh',
      kind: 'exercise',
      spec: { kind: 'risingLeap', minSemitoneGap: 12 },
    },
    {
      id: 'blackKeyGroups',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 84,
        highlight: [61, 63, 73, 75],
        highlightSecondary: [66, 68, 70, 78, 80, 82],
      },
    },
    {
      id: 'findGroupOfTwo',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'blackKeyGroup', size: 2, together: TOGETHER },
    },
    {
      id: 'findGroupOfThree',
      kind: 'exercise',
      spec: { kind: 'blackKeyGroup', size: 3, together: TOGETHER },
    },
    {
      id: 'meetC',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 48,
        highMidi: 72,
        highlight: [48, 60, 72],
        labels: [48, 60, 72],
      },
    },
    {
      id: 'findThreeCs',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      // No phone shows three Cs at once, which is the point: the range shifter
      // is taught here rather than mentioned, and credit survives the shift.
      spec: { kind: 'pitchClass', pitchClass: 0, octaves: 3 },
    },
    {
      id: 'octaves',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [60, 72],
        labels: [60, 72],
      },
      listen: {
        bpm: 90,
        timeSignature: { numerator: 4, denominator: 4 },
        events: [
          [0, 'C4', 1, 0.7],
          [1, 'C5', 1, 0.7],
          [2, ['C4', 'C5'], 2, 0.7],
        ],
      },
    },
    {
      id: 'playAnOctave',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'interval', semitones: 12, lowerPitchClass: 0, together: TOGETHER },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      // The one piece of notation in the chapter, and it is a teaser: this is
      // what the note you just found looks like written down.
      visual: {
        kind: 'staff',
        phrase: {
          bpm: 60,
          timeSignature: { numerator: 4, denominator: 4 },
          events: [[0, 'C4', 4, 0.7]],
        },
      },
    },
  ],
};
