import type { TrackEvent } from '@/features/library/trackBuilder';
import type { ExerciseSpec } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Intermediate chapter 1 — How to Practise.
 *
 * A chapter about method rather than material, so its material is borrowed:
 * the first theme of "A Beautiful Day", the Library piece the Beginner course
 * hands off to. The player has just been given it; this is how to learn it.
 *
 * Its one graded claim is the roadmap's: the same passage at 60, 80 and 100
 * bpm against the click. Everything else — slow first, in chunks, hands apart,
 * a little every day — is taught as method on cards, because none of it can
 * be checked from a keyboard, and dressing a card up as a gate would only
 * teach people to satisfy the gate.
 *
 * The tempo steps are what `tempo` on a step exists for: the click, the demo
 * and the grading all move together, and a catalog check holds a timed line
 * and its Listen phrase to the tempo their step clicks at.
 *
 * The hand-off sets Play up the way the chapter practised: right-hand
 * Training, slowed down, looping these very bars of the piece.
 */

const MIDDLE_C = 60;

/**
 * Bars 3–6 of A Beautiful Day, right hand — its tune's first statement — as
 * `[note, beats]` per bar. Quarters and halves, C4 to A4: one hand, no shift.
 * A catalog check holds every note to the Library track itself.
 */
const THEME: readonly (readonly (readonly [string, number])[])[] = [
  [
    ['E4', 1],
    ['G4', 1],
    ['A4', 1],
    ['G4', 1],
  ],
  [
    ['F4', 1],
    ['E4', 1],
    ['D4', 2],
  ],
  [
    ['C4', 1],
    ['E4', 1],
    ['A4', 1],
    ['G4', 1],
  ],
  [
    ['F4', 1],
    ['A4', 1],
    ['G4', 2],
  ],
];

/** Where the theme begins in the Library track: bar 3, after the introduction. */
export const THEME_TRACK_BEAT = 8;

/** The theme's bars `from` up to `to`, from beat 0, at `bpm`. */
function theme(bpm: number, from = 0, to = THEME.length): LearnPhrase {
  const events: TrackEvent[] = [];
  let beat = 0;
  THEME.slice(from, to).forEach((bar) => {
    for (const [name, beats] of bar) {
      events.push([beat, name, beats, 0.7, 'treble']);
      beat += beats;
    }
  });
  return { bpm, timeSignature: { numerator: 4, denominator: 4 }, events };
}

/** The whole passage at each tempo the chapter steps it up through. */
const AT_60 = theme(60);
const AT_80 = theme(80);
const AT_100 = theme(100);
/** The two chunks: a question of two bars, and its answer. */
const CHUNK_ONE = theme(60, 0, 2);
const CHUNK_TWO = theme(60, 2, 4);

function staff(line: LearnPhrase): LearnVisual {
  return { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: line };
}

const untimed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line });
const timed = (line: LearnPhrase): ExerciseSpec => ({ kind: 'playAlong', phrase: line, timed: {} });

export const HOW_TO_PRACTISE: LearnChapter = {
  id: 'howToPractise',
  handoff: {
    trackId: 'a-beautiful-day',
    mode: 'training-right',
    speed: 0.6,
    loopBeats: [THEME_TRACK_BEAT, THEME_TRACK_BEAT + 16],
  },
  steps: [
    {
      id: 'playingIsNotPractising',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(AT_60),
      listen: AT_60,
    },
    {
      id: 'startSlow',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      click: true,
      visual: staff(AT_60),
      listen: AT_60,
    },
    {
      id: 'chunkOne',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(CHUNK_ONE),
      listen: CHUNK_ONE,
      spec: untimed(CHUNK_ONE),
    },
    {
      id: 'chunkTwo',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(CHUNK_TWO),
      listen: CHUNK_TWO,
      spec: untimed(CHUNK_TWO),
    },
    {
      id: 'joinTheChunks',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(AT_60),
      listen: AT_60,
    },
    {
      id: 'atSixty',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: staff(AT_60),
      listen: AT_60,
      spec: timed(AT_60),
    },
    {
      id: 'turnItUp',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      click: true,
      tempo: 80,
      visual: staff(AT_80),
      listen: AT_80,
    },
    {
      id: 'atEighty',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      tempo: 80,
      visual: staff(AT_80),
      listen: AT_80,
      spec: timed(AT_80),
    },
    {
      id: 'atHundred',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      tempo: 100,
      visual: staff(AT_100),
      listen: AT_100,
      spec: timed(AT_100),
    },
    {
      id: 'handsSeparate',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
    },
    {
      id: 'yourTools',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
    },
    {
      id: 'comeBackTomorrow',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: staff(AT_60),
      listen: AT_60,
    },
  ],
};
