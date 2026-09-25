import type { TrackEvent } from '@/features/library/trackBuilder';
import type { ExerciseSpec, NamedChord, Togetherness } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Chapter 9 — Triads: Major and Minor.
 *
 * A chord is chapter 8's scale taken every other step: 1, 3 and 5. Everything
 * in the chapter hangs off one fact — the third decides the mood — so it is
 * taught three ways: by counting half steps on the keyboard, by ear in the
 * one quiz the course asks of the ear alone, and by hand, moving a single note
 * to turn a chord major or minor.
 *
 * All six chords of the chapter — C, F and G major; A, D and E minor — live on
 * white keys, which is why these six and not others. The only black keys are
 * the ones the chapter moves a third onto, and they are written as the flat or
 * sharp that keeps each chord's letters stacked (C–E♭–G, D–F♯–A): spelling is
 * authored, never guessed, since a context speller could as well write D♯.
 *
 * Root position only. The same notes stacked another way are an inversion,
 * and inversions are Intermediate chapter 6.
 */

const MIDDLE_C = 60;

/**
 * How a chord is judged when played: held together, or rolled inside the
 * onset window — a desktop mouse is one pointer and cannot hold three keys.
 */
const TOGETHER: Togetherness = { overlap: true, onsetWindowMs: 400 };

const C_MAJOR: NamedChord = { root: 0, quality: 'major' };
const F_MAJOR: NamedChord = { root: 5, quality: 'major' };
const G_MAJOR: NamedChord = { root: 7, quality: 'major' };
const A_MINOR: NamedChord = { root: 9, quality: 'minor' };
const D_MINOR: NamedChord = { root: 2, quality: 'minor' };
const E_MINOR: NamedChord = { root: 4, quality: 'minor' };

/** One whole-note chord per bar, on the treble staff. */
function chords(...bars: readonly (readonly string[])[]): LearnPhrase {
  return {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events: bars.map((names, bar): TrackEvent => [bar * 4, [...names], 4, 0.7, 'treble']),
  };
}

const C = ['C4', 'E4', 'G4'];
const F = ['F4', 'A4', 'C5'];
const G = ['G4', 'B4', 'D5'];
const AM = ['A4', 'C5', 'E5'];
const DM = ['D4', 'F4', 'A4'];
const EM = ['E4', 'G4', 'B4'];

const C_CHORD = chords(C);
const THREE_MAJORS = chords(C, F, G, C);
const THREE_MINORS = chords(AM, DM, EM, AM);
/** The third comes down a half step: the one move from major to minor. */
const C_TO_MINOR = chords(C, ['C4', 'Eb4', 'G4']);
/** And up a half step, the other way. */
const D_TO_MAJOR = chords(DM, ['D4', 'F#4', 'A4']);
/** Chapter 10's four chords, as a first look. */
const FOUR_CHORDS = chords(C, G, AM, F);

function staff(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', phrase: line };
}

const block = (line: LearnPhrase): ExerciseSpec => ({
  kind: 'playAlong',
  phrase: line,
  together: TOGETHER,
});

export const TRIADS: LearnChapter = {
  id: 'triads',
  steps: [
    {
      id: 'stackingThirds',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // Chapter 8's degree numbers: a chord is 1, 3 and 5 of the scale.
      visual: {
        kind: 'keyboard',
        lowMidi: MIDDLE_C,
        highMidi: 72,
        highlight: [60, 64, 67],
        labelText: { 60: '1', 64: '3', 67: '5' },
      },
      listen: C_CHORD,
    },
    {
      id: 'rootThirdFifth',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(C_CHORD),
      listen: C_CHORD,
    },
    {
      id: 'playCMajor',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(C_CHORD),
      listen: C_CHORD,
      spec: block(C_CHORD),
    },
    {
      id: 'threeMajors',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(THREE_MAJORS),
      listen: THREE_MAJORS,
    },
    {
      id: 'majorAndMinorThirds',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // C major in the first tint, D minor in the second, side by side: count
      // the half steps in each and the thirds come out the other way round.
      visual: {
        kind: 'keyboard',
        lowMidi: MIDDLE_C,
        highMidi: 72,
        highlight: [60, 64, 67],
        highlightSecondary: [62, 65, 69],
        labels: [60, 62, 64, 65, 67, 69],
      },
      listen: chords(C, DM),
    },
    {
      id: 'hearTheMood',
      kind: 'quiz',
      rounds: 6,
      // Ordered so the stride asks them major, minor, minor, major, minor,
      // major — no pattern to answer from but the sound.
      question: {
        kind: 'chordQuality',
        chords: [C_MAJOR, F_MAJOR, A_MINOR, G_MAJOR, D_MINOR, E_MINOR],
      },
    },
    {
      id: 'threeMinors',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(THREE_MINORS),
      listen: THREE_MINORS,
    },
    {
      id: 'playNamedTriads',
      kind: 'drill',
      anchorMidi: MIDDLE_C,
      // A minor, the highest, tops out at E5: ten white keys from middle C,
      // and within the computer keyboard's reach from a C4 base.
      fit: { lowMidi: MIDDLE_C, highMidi: 76 },
      rounds: 6,
      drill: {
        kind: 'namedChord',
        chords: [C_MAJOR, A_MINOR, F_MAJOR, D_MINOR, G_MAJOR, E_MINOR],
      },
    },
    {
      id: 'majorToMinor',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(C_TO_MINOR),
      listen: C_TO_MINOR,
    },
    {
      id: 'makeItMinor',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(C_TO_MINOR),
      listen: C_TO_MINOR,
      spec: block(C_TO_MINOR),
    },
    {
      id: 'makeItMajor',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(D_TO_MAJOR),
      listen: D_TO_MAJOR,
      spec: block(D_TO_MAJOR),
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(FOUR_CHORDS),
      listen: FOUR_CHORDS,
    },
  ],
};
