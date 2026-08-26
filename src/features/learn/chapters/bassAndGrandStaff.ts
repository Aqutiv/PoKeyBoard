import type { NoteStaff } from '@/domain/takeTypes';
import type { TrackEvent } from '@/features/library/trackBuilder';
import type { PitchClass } from '../exerciseSpec';
import type { LearnChapter, LearnPhrase } from '../types';

/**
 * Chapter 5 — The Bass Staff & the Grand Staff.
 *
 * The mirror of chapter 4, then the join. Chapter 4's shape is reused
 * deliberately — clef, landmark, five-finger position, quiz, drill, run — so
 * the second staff feels like the same skill in a new place rather than a new
 * skill. Recognition still comes before production.
 *
 * Every note is a whole note filling its bar, as in chapter 4: rhythm is
 * chapter 6, and a shorter note would leave rests on the staff beside it.
 *
 * Unlike chapter 4, **the staff is stated on every note**. `midiToStaffPosition`
 * splits at middle C when no hint is given, which is right for a performance
 * and wrong for a lesson whose whole subject is that middle C can be written
 * either side of the join. Stating it everywhere means no note's position
 * depends on a rule the reader has not been taught.
 *
 * One looseness, accepted: `bassRun` uses `sequence`, which matches pitch
 * classes in any octave, so the run would also pass played an octave up. There
 * is no ordered-exact spec and chapter 4's runs have the same latitude; the
 * anchor and the drawn bass staff are what steer it.
 */

/** C3 — the left hand's five-finger position, little finger down. */
const LOW_C = 48;
const MIDDLE_C = 60;
/** F3, the note the bass clef's two dots straddle. */
const BASS_F = 53;

/** C D E F G — the same five degrees chapter 4 read in the right hand. */
const FIVE_FINGER: readonly PitchClass[] = [0, 2, 4, 5, 7];

/** Four beats at 60bpm: one note, one bar, no rests beside it. */
function on(staff: NoteStaff, ...names: readonly string[]): LearnPhrase {
  return {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events: names.map((name, index): TrackEvent => [index * 4, name, 4, 0.7, staff]),
  };
}

const bass = (...names: readonly string[]): LearnPhrase => on('bass', ...names);

/**
 * Bars of one note per hand. Both staves sound in every bar, so neither is
 * ever left blank — which is what keeps `StaffSnippet` blanking rests honest.
 */
function grand(...bars: readonly (readonly [string, string])[]): LearnPhrase {
  return {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events: bars.flatMap(([low, high], index): TrackEvent[] => [
      [index * 4, low, 4, 0.7, 'bass'],
      [index * 4, high, 4, 0.7, 'treble'],
    ]),
  };
}

export const BASS_AND_GRAND_STAFF: LearnChapter = {
  id: 'bassAndGrandStaff',
  steps: [
    {
      id: 'secondStaff',
      kind: 'theory',
      anchorMidi: LOW_C,
      // Two As an octave apart: low then high, so chapter 4's one rule is
      // visibly still in force before any note here has a name. Both sit on
      // the staff proper — A2 in the first space, A3 on the top line.
      visual: { kind: 'staff', staves: 'bass', phrase: bass('A2', 'A3') },
    },
    {
      id: 'bassClef',
      kind: 'theory',
      visual: { kind: 'staff', staves: 'bass', phrase: bass('F3') },
    },
    {
      id: 'playBassF',
      kind: 'exercise',
      anchorMidi: LOW_C,
      // The stave is repeated rather than left on the previous card: the prose
      // says "the note above", and it should be.
      visual: { kind: 'staff', staves: 'bass', phrase: bass('F3') },
      // Exact, for chapter 4's reason: the drawing is octave-pinned, and any
      // other F would finish the step with the drawn head still dark.
      spec: { kind: 'exactKeys', midis: [BASS_F] },
    },
    {
      id: 'middleCAbove',
      kind: 'theory',
      // The hinge of the chapter, and the reason the staff hint exists: this
      // is the same middle C chapter 4 hung *below* the treble staff, written
      // one ledger line *above* this one.
      visual: { kind: 'staff', staves: 'bass', phrase: bass('C4') },
    },
    {
      id: 'leftHandFive',
      kind: 'theory',
      anchorMidi: LOW_C,
      visual: { kind: 'staff', staves: 'bass', phrase: bass('C3', 'D3', 'E3', 'F3', 'G3') },
    },
    {
      id: 'leftHandFingers',
      kind: 'theory',
      anchorMidi: LOW_C,
      // Numbered the other way round from chapter 4: both thumbs are 1, so the
      // left hand climbs 5 to 1. The one thing a right-hand reader gets wrong.
      visual: {
        kind: 'keyboard',
        lowMidi: 48,
        highMidi: 60,
        highlight: [48, 50, 52, 53, 55],
        labelText: { 48: '5', 50: '4', 52: '3', 53: '2', 55: '1' },
      },
    },
    {
      id: 'whichBassNote',
      kind: 'quiz',
      rounds: 5,
      question: { kind: 'readNote', pitchClasses: FIVE_FINGER, baseMidi: LOW_C, staff: 'bass' },
    },
    {
      id: 'playWhatYouRead',
      kind: 'drill',
      anchorMidi: LOW_C,
      rounds: 5,
      drill: { kind: 'readNote', pitchClasses: FIVE_FINGER, baseMidi: LOW_C, staff: 'bass' },
    },
    {
      id: 'bassRun',
      kind: 'exercise',
      anchorMidi: LOW_C,
      visual: { kind: 'staff', staves: 'bass', phrase: bass('C3', 'D3', 'E3', 'F3', 'G3') },
      spec: { kind: 'sequence', pitchClasses: [0, 2, 4, 5, 7], direction: 'up' },
    },
    {
      id: 'grandStaff',
      kind: 'theory',
      anchorMidi: BASS_F,
      visual: { kind: 'staff', staves: 'grand', phrase: grand(['F3', 'C4']) },
    },
    {
      id: 'handsTogether',
      kind: 'exercise',
      // F3 rather than C3: `stepWhites(53, 7, 1)` is 64, so the seven white
      // keys a 320px phone shows span F3–E4 and hold both notes. C3 with
      // middle C above it is eight white keys and would not fit — the same
      // squeeze chapter 3's `playTouchingPairs` solves the same way.
      anchorMidi: BASS_F,
      visual: { kind: 'staff', staves: 'grand', phrase: grand(['F3', 'C4']) },
      listen: grand(['F3', 'C4']),
      // `together` is not decoration: a desktop mouse is one pointer, so
      // without the onset window a mouse user could never finish this at all.
      spec: {
        kind: 'exactKeys',
        midis: [BASS_F, MIDDLE_C],
        together: { overlap: true, onsetWindowMs: 400 },
      },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: BASS_F,
      // G3 is the top space of the bass staff and E4 the bottom line of the
      // treble one, so both hands close on a note sitting plainly on its own
      // staff rather than out on a ledger line.
      visual: { kind: 'staff', staves: 'grand', phrase: grand(['F3', 'C4'], ['G3', 'E4']) },
    },
  ],
};
