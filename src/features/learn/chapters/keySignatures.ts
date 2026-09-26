import type { TrackEvent } from '@/features/library/trackBuilder';
import type { ExerciseSpec } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Intermediate chapter 2 — Key Signatures & the Circle of Fifths.
 *
 * Chapter 8 started the major pattern on D and needed two black keys. This is
 * where that stops costing a sharp sign per note: the key signature says it
 * once, after the clef, for every octave and the whole piece. The chapter
 * shows the same eight notes with and without one, so what moves is visibly
 * the ink and not the music.
 *
 * Its graded claims are the roadmap's. Naming the key from a signature is two
 * quizzes, sharps first and then both sides; playing its tonic is a drill that
 * draws a signature and takes the home note in any octave; playing its scale
 * is D and F major read from the page, where nothing beside the notes says
 * sharp or flat and the signature has to be applied. G major would be the
 * obvious first key, but its octave runs 19 semitones above a C and the
 * computer keyboard stops at 17 — D and F both fit.
 *
 * The circle closes it, as a picture and as something played: the home notes
 * of the sharp keys, clockwise from C.
 *
 * The hand-off is the first real piece most pianists meet with a signature:
 * Petzold's Minuet in G, whose right hand plays F♯ in two octaves with nothing
 * written beside either.
 */

const MIDDLE_C = 60;
const D4 = 62;
const D5 = 74;
const F4 = 65;
const F5 = 77;

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

/**
 * Chapter 8's scale from D — its own copy, since every chapter is a chunk of
 * its own. The sharps are in the names because a name is a pitch; whether a
 * sharp is *drawn* is the signature's business.
 */
const D_MAJOR = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5'];
const F_MAJOR = ['F4', 'G4', 'A4', 'Bb4', 'C5', 'D5', 'E5', 'F5'];

/** No signature, so a sharp is drawn beside the F and the C. */
const D_SPELLED_OUT = phrase(quarters(D_MAJOR));
/** The same eight notes under two sharps, drawn bare. */
const D_SIGNED = phrase(quarters(D_MAJOR), 2);
/** Under one flat: the B on the middle line is B♭ without a sign. */
const F_SIGNED = phrase(quarters(F_MAJOR), -1);

/** Every sharp and every flat, with no notes after them: the order is the picture. */
const ALL_SHARPS = phrase([], 7);
const ALL_FLATS = phrase([], -7);

/**
 * The home notes of the sharp keys, clockwise from C: each a fifth above the
 * last, dropped an octave when it climbs too high, so the walk stays in reach.
 * The last is held to the bar line.
 */
const FIFTHS_WALK = phrase([
  [0, 'C4', 1, 0.7, 'treble'],
  [1, 'G4', 1, 0.7, 'treble'],
  [2, 'D4', 1, 0.7, 'treble'],
  [3, 'A4', 1, 0.7, 'treble'],
  [4, 'E4', 1, 0.7, 'treble'],
  [5, 'B4', 3, 0.7, 'treble'],
]);

/** A scale, drawn with its clef, signature and time signature. */
function staff(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: line };
}

/** A signature alone: no notes, so no time signature either. */
function signature(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', chrome: 'bare', phrase: line };
}

function circle(
  highlight: readonly number[],
  highlightSecondary: readonly number[] = [],
): LearnVisual {
  return { kind: 'circle', highlight, highlightSecondary };
}

const untimed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line });

/**
 * The quizzes' and the drill's keys: up to four sharps or four flats. Written
 * in the order they are to be asked — the answer buttons are laid out in
 * circle order whatever this order is.
 *
 * Sharps alone first, stride 3: C, A, G, E, D.
 */
const SHARP_KEYS: readonly number[] = [0, 1, 2, 3, 4];
/** Both sides, stride 2: G, F, C, E, A♭, A, E♭, D, B♭ — every one once. */
const ANY_KEYS: readonly number[] = [1, 3, -1, -3, 0, 2, 4, -2, -4];
/** The same nine for the drill, stride 2 from D: D, F, G, E, A♭, B♭ in six rounds. */
const TONIC_KEYS: readonly number[] = [2, -2, -1, 3, 1, -3, 4, 0, -4];

export const KEY_SIGNATURES: LearnChapter = {
  id: 'keySignatures',
  handoff: {
    trackId: 'score-bach-minuet-in-g-major-bwv-anh-114',
    mode: 'training-right',
  },
  steps: [
    {
      id: 'sharpsEverywhere',
      kind: 'theory',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      visual: staff(D_SPELLED_OUT),
      listen: D_SPELLED_OUT,
    },
    {
      id: 'theSignature',
      kind: 'theory',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      visual: staff(D_SIGNED),
      listen: D_SIGNED,
    },
    {
      id: 'readInD',
      kind: 'exercise',
      anchorMidi: D4,
      fit: { lowMidi: D4, highMidi: D5 },
      visual: staff(D_SIGNED),
      listen: D_SIGNED,
      spec: untimed(D_SIGNED),
    },
    {
      id: 'orderOfSharps',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: signature(ALL_SHARPS),
    },
    {
      id: 'lastSharp',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // A major's three sharps ringed, and home — a half step above the last
      // of them, G♯ — painted.
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [69],
        highlightSecondary: [61, 66, 68],
        labels: [61, 66, 68, 69],
        spelling: 'sharp',
      },
    },
    {
      id: 'nameSharpKeys',
      kind: 'quiz',
      anchorMidi: MIDDLE_C,
      rounds: SHARP_KEYS.length,
      question: { kind: 'keySignature', signatures: SHARP_KEYS },
    },
    {
      id: 'orderOfFlats',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: signature(ALL_FLATS),
    },
    {
      id: 'secondToLastFlat',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // E♭ major's three flats: the second-to-last, E♭, painted as the key it
      // names, and the other two ringed.
      visual: {
        kind: 'keyboard',
        lowMidi: 60,
        highMidi: 72,
        highlight: [63],
        highlightSecondary: [68, 70],
        labels: [63, 68, 70],
        spelling: 'flat',
      },
    },
    {
      id: 'readInF',
      kind: 'exercise',
      anchorMidi: F4,
      fit: { lowMidi: F4, highMidi: F5 },
      visual: staff(F_SIGNED),
      listen: F_SIGNED,
      spec: untimed(F_SIGNED),
    },
    {
      id: 'nameAnyKey',
      kind: 'quiz',
      anchorMidi: MIDDLE_C,
      rounds: ANY_KEYS.length,
      question: { kind: 'keySignature', signatures: ANY_KEYS },
    },
    {
      id: 'playTheTonic',
      kind: 'drill',
      anchorMidi: MIDDLE_C,
      rounds: 6,
      // No `listen`: "Show me" would fire one fixed phrase at a key that
      // changes every round.
      drill: { kind: 'keyTonic', signatures: TONIC_KEYS },
    },
    {
      id: 'theCircle',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // The sharp side painted, the flat side ringed; C and the meeting point
      // at the bottom left plain.
      visual: circle([1, 2, 3, 4, 5], [-1, -2, -3, -4, -5]),
    },
    {
      id: 'aFifthApart',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // C and its two neighbours, which share six of its seven notes.
      visual: circle([0], [1, -1]),
      listen: FIFTHS_WALK,
    },
    {
      id: 'walkTheCircle',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: circle([0, 1, 2, 3, 4, 5]),
      listen: FIFTHS_WALK,
      // Any octave and either direction: the walk is in the order, not the
      // register, and seven half steps up from D is off a small phone.
      spec: { kind: 'sequence', pitchClasses: [0, 7, 2, 9, 4, 11] },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // G, one sharp: the key of the piece the closing button opens.
      visual: circle([1]),
    },
  ],
};
