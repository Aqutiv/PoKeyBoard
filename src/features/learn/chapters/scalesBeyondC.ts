import type { TrackEvent } from '@/features/library/trackBuilder';
import { isBlackKey } from '@/utils/midi';
import type { ExerciseSpec, PitchClass } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Intermediate chapter 3 — Scales Beyond C.
 *
 * Chapter 8 taught the major scale as a pattern, and chapter 2 of this level
 * read D and F major from the page. This is where three scales become known
 * rather than read: G, D and F — C's nearest neighbours on the circle — each
 * played up one octave from memory, with no staff and no diagram. A `sequence`
 * that must climb grades them, so G major's F♯ has to be played, never an F.
 *
 * What the chapter teaches but cannot grade is the hand: where each scale's
 * black keys fall under the fingers, and why F major's thumb tuck comes a
 * note later than the others' — the thumb stays off the black keys. That is
 * taught on diagrams, as chapter 8 taught the tuck, and never gated.
 *
 * The grading is the roadmap's — each scale, one octave, with the right shape
 * — plus a drill that asks where a key's black notes land without walking up
 * from home, and D major up and down in time: the scale the hand-off's tune is
 * made of.
 *
 * G major's octave does not fit the computer keyboard: from its C the letter
 * rows reach up to the F an octave and a half above, one note short of G's top
 * two. The prompt says to press X after the E, and every step re-parks the
 * rows where it is written, so an X lasts only for the step it was pressed in.
 */

const MIDDLE_C = 60;
const D4 = 62;
const D5 = 74;
const F4 = 65;
const F5 = 77;
const G4 = 67;
const G5 = 79;

function phrase(events: readonly TrackEvent[], keySignature?: number): LearnPhrase {
  return {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events,
    ...(keySignature !== undefined ? { keySignature } : {}),
  };
}

/** One quarter note per name, from beat 0, on the treble staff. */
function quarters(names: readonly string[]): TrackEvent[] {
  return names.map((name, beat): TrackEvent => [beat, name, 1, 0.7, 'treble']);
}

/** Each scale up one octave, to listen to. The names are the pitches. */
const G_UP = phrase(quarters(['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5']));
const D_UP = phrase(quarters(['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5']));
const F_UP = phrase(quarters(['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5']));

/**
 * D major up and back down in four bars, under its two sharps: home on a half
 * note, so the line ends on its last beat.
 */
const D_UP_AND_DOWN = phrase(
  [
    ...quarters([
      'D4',
      'E4',
      'F#4',
      'G4',
      'A4',
      'B4',
      'C#5',
      'D5',
      'C#5',
      'B4',
      'A4',
      'G4',
      'F#4',
      'E4',
    ]),
    [14, 'D4', 2, 0.7, 'treble'],
  ],
  2,
);

/** The three scales by heart, as the pitch classes they climb through. */
const G_MAJOR: readonly PitchClass[] = [7, 9, 11, 0, 2, 4, 6, 7];
const D_MAJOR: readonly PitchClass[] = [2, 4, 6, 7, 9, 11, 1, 2];
const F_MAJOR: readonly PitchClass[] = [5, 7, 9, 10, 0, 2, 4, 5];

/**
 * A scale's octave on a diagram: its white keys painted, its black keys — the
 * ones its signature names — ringed, and every key named.
 */
function shape(
  lowMidi: number,
  midis: readonly number[],
  spelling: 'sharp' | 'flat',
  labelText?: Readonly<Record<number, string>>,
): LearnVisual {
  const black = midis.filter(isBlackKey);
  return {
    kind: 'keyboard',
    lowMidi,
    highMidi: lowMidi + 12,
    highlight: midis.filter((midi) => !black.includes(midi)),
    highlightSecondary: black,
    labels: [...midis],
    spelling,
    ...(labelText ? { labelText } : {}),
  };
}

/**
 * A scale's fingering on a diagram, as chapter 8 drew the tuck: every key
 * painted but the one the thumb tucks under to reach, which is ringed.
 */
function fingering(
  lowMidi: number,
  midis: readonly number[],
  tuck: number,
  fingers: Readonly<Record<number, string>>,
): LearnVisual {
  return {
    kind: 'keyboard',
    lowMidi,
    highMidi: lowMidi + 12,
    highlight: midis.filter((midi) => midi !== tuck),
    highlightSecondary: [tuck],
    labelText: fingers,
  };
}

const G_KEYS = [67, 69, 71, 72, 74, 76, 78, 79];
const D_KEYS = [62, 64, 66, 67, 69, 71, 73, 74];
const F_KEYS = [65, 67, 69, 70, 72, 74, 76, 77];

/** C's fingering: three, tuck, five. G and D keep it. */
const G_FINGERS = { 67: '1', 69: '2', 71: '3', 72: '1', 74: '2', 76: '3', 78: '4', 79: '5' };
const D_FINGERS = { 62: '1', 64: '2', 66: '3', 67: '1', 69: '2', 71: '3', 73: '4', 74: '5' };
/** F's shifts a note: four, tuck, four — or the thumb would land on B♭. */
const F_FINGERS = { 65: '1', 67: '2', 69: '3', 70: '4', 72: '1', 74: '2', 76: '3', 77: '4' };

function staff(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: line };
}

const byHeart = (pitchClasses: readonly PitchClass[]): ExerciseSpec => ({
  kind: 'sequence',
  pitchClasses,
  direction: 'up',
});

export const SCALES_BEYOND_C: LearnChapter = {
  id: 'scalesBeyondC',
  handoff: {
    trackId: 'score-canon-in-d-easy',
    mode: 'training-right',
  },
  steps: [
    {
      id: 'oneStaircase',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // C's three nearest keys: G and D on the sharp side, F on the flat.
      visual: { kind: 'circle', highlight: [1, 2], highlightSecondary: [-1] },
    },
    {
      id: 'gMajor',
      kind: 'theory',
      anchorMidi: G4,
      fit: { lowMidi: G4, highMidi: G5 },
      visual: shape(G4, G_KEYS, 'sharp'),
      listen: G_UP,
    },
    {
      id: 'gFingering',
      kind: 'theory',
      anchorMidi: G4,
      fit: { lowMidi: G4, highMidi: G5 },
      visual: fingering(G4, G_KEYS, 72, G_FINGERS),
      listen: G_UP,
    },
    {
      id: 'playG',
      kind: 'exercise',
      anchorMidi: G4,
      fit: { lowMidi: G4, highMidi: G5 },
      listen: G_UP,
      spec: byHeart(G_MAJOR),
    },
    {
      id: 'dMajor',
      kind: 'theory',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      // The shape and the fingers at once: C's fingering again, with the two
      // black keys under 3 and 4.
      visual: shape(D4, D_KEYS, 'sharp', D_FINGERS),
      listen: D_UP,
    },
    {
      id: 'playD',
      kind: 'exercise',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      listen: D_UP,
      spec: byHeart(D_MAJOR),
    },
    {
      id: 'fMajor',
      kind: 'theory',
      anchorMidi: F4,
      fit: { lowMidi: F4, highMidi: F5 },
      visual: shape(F4, F_KEYS, 'flat'),
      listen: F_UP,
    },
    {
      id: 'fFingering',
      kind: 'theory',
      anchorMidi: F4,
      fit: { lowMidi: F4, highMidi: F5 },
      visual: fingering(F4, F_KEYS, 72, F_FINGERS),
      listen: F_UP,
    },
    {
      id: 'playF',
      kind: 'exercise',
      anchorMidi: F4,
      fit: { lowMidi: F4, highMidi: F5 },
      listen: F_UP,
      spec: byHeart(F_MAJOR),
    },
    {
      id: 'blackKeys',
      kind: 'drill',
      anchorMidi: MIDDLE_C,
      rounds: 7,
      // Written for the stride of three over seven, so the rounds ask G 7,
      // F 4, D 3, G 3, D 7, F 7, D 5: every black key, never the same answer
      // twice running, and white ones among them so black is not a giveaway.
      // No `listen`: "Show me" would fire one fixed phrase at a note that
      // changes every round.
      drill: {
        kind: 'keyDegree',
        questions: [
          { key: 1, degree: 7 },
          { key: -1, degree: 7 },
          { key: 1, degree: 3 },
          { key: -1, degree: 4 },
          { key: 2, degree: 5 },
          { key: 2, degree: 7 },
          { key: 2, degree: 3 },
        ],
      },
    },
    {
      id: 'dInTime',
      kind: 'exercise',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      visual: staff(D_UP_AND_DOWN),
      listen: D_UP_AND_DOWN,
      spec: { kind: 'playAlong', phrase: D_UP_AND_DOWN, timed: {} },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      visual: staff(D_UP_AND_DOWN),
      listen: D_UP_AND_DOWN,
    },
  ],
};
