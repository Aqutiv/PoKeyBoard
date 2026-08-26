import type { PitchClass } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase } from '../types';

/**
 * Chapter 4 — Reading the Treble Staff.
 *
 * The chapter the rest of the course leans on: from here on, a lesson can show
 * a note rather than name one. Recognition (the quiz) comes before production
 * (the drill), as in chapter 3.
 *
 * Every note is a whole note filling its bar. Rhythm is chapter 6 — and a
 * shorter note would leave rests on the staff beside it, which is noise in a
 * chapter about reading one note at a time.
 *
 * Every note is also C4 or above, so `midiToStaffPosition` puts all of them on
 * the treble staff without a hint; a note below middle C would silently appear
 * on a staff chapter 5 has not introduced yet. A test pins this.
 */
const MIDDLE_C = 60;

/** C D E F G — the right hand's five-finger position. */
const FIVE_FINGER: readonly PitchClass[] = [0, 2, 4, 5, 7];

/** Four beats at 60bpm: one note, one bar, no rests beside it. */
function staff(...names: readonly string[]): LearnPhrase {
  return {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events: names.map((name, index) => [index * 4, name, 4, 0.7]),
  };
}

export const TREBLE_STAFF: LearnChapter = {
  id: 'trebleStaff',
  steps: [
    {
      id: 'fiveLines',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // Low then high, so the one rule that makes a staff readable is visible
      // before any note has a name.
      visual: { kind: 'staff', phrase: staff('E4', 'G5') },
    },
    {
      id: 'trebleClef',
      kind: 'theory',
      visual: { kind: 'staff', phrase: staff('G4') },
    },
    {
      id: 'middleCBelow',
      kind: 'theory',
      visual: { kind: 'staff', phrase: staff('C4') },
    },
    {
      id: 'playMiddleC',
      // The exact key, for the same reason the reading drill below is exact:
      // the stave shows one particular C on one particular ledger line, and
      // any other C would complete the step with the drawn note still dark.
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      spec: { kind: 'exactKeys', midis: [MIDDLE_C] },
    },
    {
      id: 'fiveNotes',
      kind: 'theory',
      visual: { kind: 'staff', phrase: staff('C4', 'D4', 'E4', 'F4', 'G4') },
    },
    {
      id: 'fingerNumbers',
      kind: 'theory',
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [60, 62, 64, 65, 67],
        labelText: { 60: '1', 62: '2', 64: '3', 65: '4', 67: '5' },
      },
    },
    {
      id: 'whichNote',
      kind: 'quiz',
      rounds: 5,
      question: { kind: 'readNote', pitchClasses: FIVE_FINGER, baseMidi: MIDDLE_C },
    },
    {
      id: 'playWhatYouRead',
      kind: 'drill',
      anchorMidi: MIDDLE_C,
      rounds: 5,
      drill: { kind: 'readNote', pitchClasses: FIVE_FINGER, baseMidi: MIDDLE_C },
    },
    {
      id: 'runUp',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: { kind: 'staff', phrase: staff('C4', 'D4', 'E4', 'F4', 'G4') },
      spec: { kind: 'sequence', pitchClasses: [0, 2, 4, 5, 7], direction: 'up' },
    },
    {
      id: 'runDown',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: { kind: 'staff', phrase: staff('G4', 'F4', 'E4', 'D4', 'C4') },
      spec: { kind: 'sequence', pitchClasses: [7, 5, 4, 2, 0], direction: 'down' },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      visual: { kind: 'staff', phrase: staff('C4', 'E4', 'G4') },
    },
  ],
};
