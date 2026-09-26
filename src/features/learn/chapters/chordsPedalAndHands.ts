import type { NoteStaff } from '@/domain/takeTypes';
import type { TrackEvent } from '@/features/library/trackBuilder';
import type { ExerciseSpec, Togetherness } from '../exerciseSpec';
import { momentsOf } from '../phrase';
import type { LearnChapter, LearnPhrase, LearnVisual } from '../types';

/**
 * Chapter 10 — Chords, Pedal & Hands Together. The last Beginner chapter.
 *
 * Three things chapter 9 left in the right hand now meet: the I–V–vi–IV
 * progression (C, G, A minor, F), the sustain pedal changed with the harmony,
 * and the left hand playing those chords under a right-hand tune.
 *
 * The pedal is graded on order, never on time: a chord's notes, *then* a fresh
 * press of the pedal. Held straight through a change it leaves no new press —
 * the blur the chapter is teaching against — and the next chord breaks the run.
 *
 * Two hands need about two octaves. No phone held upright shows that many keys
 * at a playable width, and the computer keyboard reaches an octave and a half,
 * so those steps are `wide`: untimed, notes gathered in any order (Play's
 * Training rules), and a portrait phone is asked to turn sideways. The prose
 * says plainly what they want: touch, a MIDI keyboard, or the mouse.
 *
 * The chord steps stay in the right-hand register of chapter 9, where the
 * computer keyboard reaches all four from its C4 base; only the left-hand and
 * two-hand steps go wide.
 */

const MIDDLE_C = 60;
/** F2 — the lowest note of the left hand's chords. */
const LOW_F = 41;

/** Held together, or rolled inside the window: a mouse is one pointer. */
const TOGETHER: Togetherness = { overlap: true, onsetWindowMs: 400 };

/** C4 up to E5: the four chords in chapter 9's register. */
const TREBLE_CHORDS = { lowMidi: MIDDLE_C, highMidi: 76 } as const;
/** F2 up to G3: the four chords for the left hand, all inside the bass staff. */
const BASS_CHORDS = { lowMidi: LOW_F, highMidi: 55 } as const;
/** F2 up to G4: both hands at once — sixteen white keys. */
const BOTH_HANDS = { lowMidi: LOW_F, highMidi: 67 } as const;

type Bar = readonly string[];

function phrase(events: readonly TrackEvent[]): LearnPhrase {
  return { bpm: 60, timeSignature: { numerator: 4, denominator: 4 }, events };
}

/** One whole-note chord per bar, on the staff given. */
function chords(staff: NoteStaff, ...bars: readonly Bar[]): LearnPhrase {
  return phrase(bars.map((names, bar): TrackEvent => [bar * 4, [...names], 4, 0.7, staff]));
}

/** I–V–vi–IV in chapter 9's register, root position. */
const C = ['C4', 'E4', 'G4'];
const G = ['G4', 'B4', 'D5'];
const AM = ['A4', 'C5', 'E5'];
const F = ['F4', 'A4', 'C5'];
const PROGRESSION = chords('treble', C, G, AM, F);

/** The same four for the left hand: root position, inside the bass staff. */
const LH_C = ['C3', 'E3', 'G3'];
const LH_G = ['G2', 'B2', 'D3'];
const LH_AM = ['A2', 'C3', 'E3'];
const LH_F = ['F2', 'A2', 'C3'];
const LEFT_HAND = chords('bass', LH_C, LH_G, LH_AM, LH_F);

const ONE_CHORD = chords('treble', C);

/**
 * Blurred, then clean, by ear. Bars 1–2 hold C straight on into G — what a
 * pedal left down through the change does — and bars 3–4 let each chord go as
 * the next arrives. No stave: the blur crosses a bar line on purpose.
 */
const BLUR_THEN_CLEAN = phrase([
  [0, C, 8, 0.7, 'treble'],
  [4, G, 4, 0.7, 'treble'],
  [8, C, 4, 0.7, 'treble'],
  [12, G, 4, 0.7, 'treble'],
]);

/**
 * The piece: an original for the course, by Claude Opus 5.5. Left-hand chords,
 * one to a bar, walk I–V–vi–IV and then I–IV–V–I home; the right hand sings
 * over them in chapter 4's five-finger position, a chord tone on every
 * downbeat. The two hands never share a pitch, so no column is ever one note
 * asked for twice.
 */
const LH_BARS: readonly Bar[] = [LH_C, LH_G, LH_AM, LH_F, LH_C, LH_F, LH_G, LH_C];
const RH_BARS: readonly (readonly (readonly [string, number])[])[] = [
  [
    ['G4', 1],
    ['E4', 1],
    ['C4', 2],
  ],
  [
    ['D4', 1],
    ['E4', 1],
    ['F4', 1],
    ['D4', 1],
  ],
  [
    ['E4', 1],
    ['D4', 1],
    ['C4', 2],
  ],
  [
    ['F4', 1],
    ['E4', 1],
    ['D4', 1],
    ['C4', 1],
  ],
  [
    ['E4', 1],
    ['G4', 1],
    ['E4', 1],
    ['C4', 1],
  ],
  [
    ['F4', 1],
    ['E4', 1],
    ['F4', 2],
  ],
  [
    ['D4', 1],
    ['G4', 1],
    ['F4', 1],
    ['D4', 1],
  ],
  [['C4', 4]],
];

function piece(barCount: number): LearnPhrase {
  const events: TrackEvent[] = [];
  for (let bar = 0; bar < barCount; bar += 1) {
    events.push([bar * 4, [...(LH_BARS[bar] ?? [])], 4, 0.55, 'bass']);
    let beat = bar * 4;
    for (const [name, beats] of RH_BARS[bar] ?? []) {
      events.push([beat, name, beats, beat % 4 === 0 ? 0.72 : 0.64, 'treble']);
      beat += beats;
    }
  }
  return phrase(events);
}

const OPENING = piece(2);
const PIECE = piece(8);

/** Moment indices where bars 1, 3, 5 and 7 begin: a slip costs two bars, not eight. */
const EVERY_TWO_BARS = momentsOf(PIECE)
  .map((moment, index) => ({ beat: moment.beat, index }))
  .filter(({ beat }) => beat % 8 === 0)
  .map(({ index }) => index);

function staff(line: LearnPhrase, staves: 'treble' | 'bass' | 'grand'): LearnVisual {
  return { kind: 'staff', staves, phrase: line };
}

const blocks = (line: LearnPhrase, pedal?: 'changeEach'): ExerciseSpec => ({
  kind: 'playAlong',
  phrase: line,
  together: TOGETHER,
  ...(pedal ? { pedal } : {}),
});

export const CHORDS_PEDAL_AND_HANDS: LearnChapter = {
  id: 'chordsPedalAndHands',
  // Its first section *is* I–V–vi–IV: the chords this chapter ends on.
  handoff: { trackId: 'a-beautiful-day', mode: 'training-both' },
  steps: [
    {
      id: 'fourChords',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: TREBLE_CHORDS,
      visual: staff(PROGRESSION, 'treble'),
      listen: PROGRESSION,
    },
    {
      id: 'playTheProgression',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      fit: TREBLE_CHORDS,
      visual: staff(PROGRESSION, 'treble'),
      listen: PROGRESSION,
      spec: blocks(PROGRESSION),
    },
    {
      id: 'thePedal',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: TREBLE_CHORDS,
      listen: ONE_CHORD,
    },
    {
      id: 'pressThePedal',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      fit: TREBLE_CHORDS,
      visual: staff(ONE_CHORD, 'treble'),
      spec: blocks(ONE_CHORD, 'changeEach'),
    },
    {
      id: 'changeWithTheHarmony',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      fit: TREBLE_CHORDS,
      listen: BLUR_THEN_CLEAN,
    },
    {
      id: 'pedalTheProgression',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      fit: TREBLE_CHORDS,
      visual: staff(PROGRESSION, 'treble'),
      listen: PROGRESSION,
      spec: blocks(PROGRESSION, 'changeEach'),
    },
    {
      id: 'leftHandChords',
      kind: 'theory',
      anchorMidi: LOW_F,
      fit: BASS_CHORDS,
      visual: staff(LEFT_HAND, 'bass'),
      listen: LEFT_HAND,
    },
    {
      id: 'leftHandProgression',
      kind: 'exercise',
      anchorMidi: LOW_F,
      fit: BASS_CHORDS,
      // Nine white keys fit a phone, but the computer keyboard's octave and a
      // half from F2's C cannot reach the G3 of the C chord.
      wide: true,
      visual: staff(LEFT_HAND, 'bass'),
      listen: LEFT_HAND,
      spec: { kind: 'playAlong', phrase: LEFT_HAND },
    },
    {
      id: 'readingBothStaves',
      kind: 'theory',
      anchorMidi: LOW_F,
      fit: BOTH_HANDS,
      wide: true,
      visual: staff(OPENING, 'grand'),
      listen: OPENING,
    },
    {
      id: 'playThePiece',
      kind: 'exercise',
      anchorMidi: LOW_F,
      fit: BOTH_HANDS,
      wide: true,
      visual: staff(PIECE, 'grand'),
      listen: PIECE,
      spec: { kind: 'playAlong', phrase: PIECE, checkpoints: EVERY_TWO_BARS },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: LOW_F,
      fit: BOTH_HANDS,
      wide: true,
      visual: staff(PIECE, 'grand'),
      listen: PIECE,
    },
  ],
};
