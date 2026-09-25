import type { TrackEvent } from '@/features/library/trackBuilder';
import type { ExerciseSpec } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Chapter 8 — The C Major Scale.
 *
 * Chapter 2 walked C to C along the white keys as an alphabet; this is the same
 * walk understood as a *pattern* — whole, whole, half, whole, whole, whole,
 * half — which is what makes it portable to every other key later. Chapter 3's
 * two places where white keys touch turn out to be exactly the pattern's two
 * half steps, and that is the whole reason C major needs no black key.
 *
 * Technique appears as guidance only. The thumb tuck is the point of a scale
 * for the hand, but the app has no camera and no per-finger signal, so it is
 * taught on a card and never gated.
 *
 * The octave is eight white keys and a 320px phone shows seven, while a scale
 * is the one line nobody can pause to shift the keyboard in. So every step
 * carries `fit`: the keyboard narrows its keys until C4–C5 is on screen whole.
 */

const MIDDLE_C = 60;
const HIGH_C = 72;
/** The whole octave, shown whole on any screen. */
const OCTAVE = { lowMidi: MIDDLE_C, highMidi: HIGH_C } as const;

/** C D E F G A B C, as midis. */
const C_MAJOR = [60, 62, 64, 65, 67, 69, 71, 72] as const;

function phrase(...events: readonly TrackEvent[]): LearnPhrase {
  return { bpm: 60, timeSignature: { numerator: 4, denominator: 4 }, events };
}

/** One quarter note per name, from beat 0. */
function quarters(names: readonly string[]): TrackEvent[] {
  return names.map((name, beat): TrackEvent => [beat, name, 1, 0.7, 'treble']);
}

const SCALE_UP = phrase(...quarters(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']));
const SCALE_DOWN = phrase(...quarters(['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4']));
/** Up and back in four bars, home on a half note so the phrase ends on its last beat. */
const UP_AND_DOWN = phrase(
  ...quarters(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4']),
  [14, 'C4', 2, 0.7, 'treble'],
);
/**
 * The same pattern from D: two black keys this time. Spelled as sharps on
 * purpose — a scale uses each letter once, so F♯ rather than G♭.
 */
const D_MAJOR_UP = phrase(...quarters(['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5']));

/** The octave on a diagram, the scale's own keys lit. */
function octave(extra: Partial<Extract<LearnVisual, { kind: 'keyboard' }>> = {}): LearnVisual {
  return { kind: 'keyboard', lowMidi: MIDDLE_C, highMidi: HIGH_C, highlight: C_MAJOR, ...extra };
}

function staff(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: line };
}

const untimed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line });
const timed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line, timed: {} });

export const C_MAJOR_SCALE: LearnChapter = {
  id: 'cMajorScale',
  steps: [
    {
      id: 'whatIsAScale',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      visual: octave({ labels: C_MAJOR }),
      listen: SCALE_UP,
    },
    {
      id: 'thePattern',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      // The two half steps in the second tint: E–F and B–C, chapter 3's
      // touching white keys.
      visual: octave({ labels: C_MAJOR, highlightSecondary: [64, 65, 71, 72] }),
    },
    {
      id: 'whyAllWhite',
      kind: 'theory',
      // The live keyboard stays on C's octave; D major is only the picture.
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      // Not a lesson in D major — that is Intermediate chapter 3 — only the
      // proof that the pattern, not the white keys, is what makes a scale.
      visual: {
        kind: 'keyboard',
        lowMidi: 62,
        highMidi: 74,
        highlight: [62, 64, 66, 67, 69, 71, 73, 74],
        highlightSecondary: [66, 73],
        labels: [62, 64, 66, 67, 69, 71, 73, 74],
        spelling: 'sharp',
      },
      listen: D_MAJOR_UP,
    },
    {
      id: 'degrees',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      visual: octave({
        labelText: { 60: '1', 62: '2', 64: '3', 65: '4', 67: '5', 69: '6', 71: '7', 72: '8' },
      }),
    },
    {
      id: 'playDegrees',
      kind: 'drill',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      rounds: 5,
      // 8 is 1 again, so asking for it would be asking for 1 twice.
      drill: { kind: 'scaleDegree', tonic: 0, degrees: [1, 2, 3, 4, 5, 6, 7] },
    },
    {
      id: 'thumbTuck',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      // The F the thumb passes under to reach, in the second tint.
      visual: octave({
        highlightSecondary: [65],
        labelText: { 60: '1', 62: '2', 64: '3', 65: '1', 67: '2', 69: '3', 71: '4', 72: '5' },
      }),
      listen: SCALE_UP,
    },
    {
      id: 'scaleUp',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      visual: staff(SCALE_UP),
      listen: SCALE_UP,
      spec: untimed(SCALE_UP),
    },
    {
      id: 'crossingBack',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      // Each key keeps the finger it had on the way up; only the crossing
      // changes direction, so the same labels read correctly both ways.
      visual: octave({
        highlightSecondary: [64],
        labelText: { 60: '1', 62: '2', 64: '3', 65: '1', 67: '2', 69: '3', 71: '4', 72: '5' },
      }),
      listen: SCALE_DOWN,
    },
    {
      id: 'scaleDown',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      visual: staff(SCALE_DOWN),
      listen: SCALE_DOWN,
      spec: untimed(SCALE_DOWN),
    },
    {
      id: 'scaleInTime',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      visual: staff(UP_AND_DOWN),
      listen: UP_AND_DOWN,
      spec: timed(UP_AND_DOWN),
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: OCTAVE,
      visual: staff(UP_AND_DOWN),
      listen: UP_AND_DOWN,
    },
  ],
};
