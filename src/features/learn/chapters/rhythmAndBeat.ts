import type { TrackEvent } from '@/features/library/trackBuilder';
import type { LearnChapter, LearnPhrase } from '../types';

/**
 * Chapter 6 — Rhythm & the Beat.
 *
 * The first chapter that grades *when* rather than *what*, and the first whose
 * notes are not all whole notes. Both roadmap validations are production —
 * tap the pulse, then play a written rhythm — because on a rhythm card the
 * answer is already printed on the staff, so there is nothing a recognition
 * quiz could ask that the picture does not already say.
 *
 * Everything is middle C. Pitch is chapters 4 and 5; putting a second note in
 * here would mean grading two things at once and teaching neither.
 *
 * Written at 60bpm in 4/4 — the tempo every Learn phrase has used since
 * chapter 4, and the tempo the runner clicks at, so a bar on the page and a
 * bar in the ear are the same thing.
 *
 * Authoring rules the catalog test enforces, each learned from a real failure
 * mode rather than guessed:
 *
 *  - A `listen` phrase must **sound on the final beat of its last bar**.
 *    `phraseDurationMs` is `max(startMs + durationMs)`, so a phrase ending in
 *    a rest re-enables the Listen button early and a second press overlaps the
 *    tail still ringing.
 *  - The written rhythm and the graded rhythm must agree. A picture that
 *    disagrees with the gate is the failure mode of a rhythm chapter, and it
 *    is invisible to every other test.
 *  - Treble only. `deriveRests` fills *both* staves, so a grand-staff phrase
 *    here would sprout a bar of bass whole rests the moment rests are shown.
 */

const MIDDLE_C = 60;
/** Beats per bar, and the click grid's numerator. The two must agree. */
const BAR = 4;

/** Middle C at `beat`, lasting `beats`. Every note in the chapter is one. */
function c(beat: number, beats: number): TrackEvent {
  return [beat, 'C4', beats, 0.7, 'treble'];
}

function bars(...events: readonly TrackEvent[]): LearnPhrase {
  return {
    bpm: 60,
    timeSignature: { numerator: 4, denominator: 4 },
    events,
  };
}

/** One bar of four quarter notes, starting at `bar`. */
function quarters(bar: number): readonly TrackEvent[] {
  return [0, 1, 2, 3].map((beat) => c(bar * BAR + beat, 1));
}

/** The chapter's closing rhythm: half, quarter, two eighths. */
function figure(bar: number): readonly TrackEvent[] {
  return [c(bar * BAR, 2), c(bar * BAR + 2, 1), c(bar * BAR + 3, 0.5), c(bar * BAR + 3.5, 0.5)];
}

const TWO_BARS_OF_QUARTERS = bars(...quarters(0), ...quarters(1));

export const RHYTHM_AND_BEAT: LearnChapter = {
  id: 'rhythmAndBeat',
  steps: [
    {
      id: 'thePulse',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // The click starts here, a step before anything is asked, so the pulse
      // is something you hear before it is something you are graded on.
      click: true,
    },
    {
      id: 'tapThePulse',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      // No pitch: the point is when, not what. This is also the only step that
      // exercises the "any key" branch of the hint and shift logic.
      spec: { kind: 'rhythm', beats: [0, 1, 2, 3], barBeats: BAR },
    },
    {
      id: 'theBar',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      click: true,
      visual: { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: TWO_BARS_OF_QUARTERS },
      listen: TWO_BARS_OF_QUARTERS,
    },
    {
      id: 'theTimeSignature',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // The step `chrome: 'lesson'` exists for: the time signature is the
      // subject, and it is the one piece of bar furniture a lesson wants.
      visual: { kind: 'staff', staves: 'treble', chrome: 'lesson', phrase: TWO_BARS_OF_QUARTERS },
    },
    {
      id: 'wholeAndHalf',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        phrase: bars(c(0, 4), c(4, 2), c(6, 2)),
      },
      listen: bars(c(0, 4), c(4, 2), c(6, 2)),
    },
    {
      id: 'quarterAndEighth',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // Eight eighths engrave as four two-note beams, not one long one:
      // `buildBeamGroups` groups by the beat in simple meter. That is correct
      // engraving, and it is the picture the prose describes.
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        phrase: bars(...quarters(0), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => c(4 + i * 0.5, 0.5))),
      },
      listen: bars(...quarters(0), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => c(4 + i * 0.5, 0.5))),
    },
    {
      id: 'playQuarters',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        phrase: bars(...quarters(0)),
      },
      listen: bars(...quarters(0)),
      spec: { kind: 'rhythm', beats: [0, 1, 2, 3], barBeats: BAR, midi: MIDDLE_C },
    },
    {
      id: 'theRest',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      // The rest sits in the middle of the bar, not at the end: a phrase that
      // stops sounding before its last beat re-enables Listen early, and a
      // silence you have to play *through* is the better lesson anyway.
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        rests: true,
        phrase: bars(c(0, 1), c(2, 1), c(3, 1)),
      },
      listen: bars(c(0, 1), c(2, 1), c(3, 1)),
    },
    {
      id: 'playWithARest',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        rests: true,
        phrase: bars(c(0, 1), c(2, 1), c(3, 1)),
      },
      listen: bars(c(0, 1), c(2, 1), c(3, 1)),
      // The hole at beat 1 is what ordered matching earns its keep on: graded
      // by nearest target, a press that fell in the gap would be credited.
      spec: { kind: 'rhythm', beats: [0, 2, 3], barBeats: BAR, midi: MIDDLE_C },
    },
    {
      id: 'mixedRhythm',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        phrase: bars(...figure(0)),
      },
      listen: bars(...figure(0)),
    },
    {
      id: 'playTheRhythm',
      kind: 'exercise',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        phrase: bars(...figure(0)),
      },
      listen: bars(...figure(0)),
      spec: { kind: 'rhythm', beats: [0, 2, 3, 3.5], barBeats: BAR, midi: MIDDLE_C },
    },
    {
      id: 'chapterComplete',
      kind: 'theory',
      anchorMidi: MIDDLE_C,
      visual: {
        kind: 'staff',
        staves: 'treble',
        chrome: 'lesson',
        phrase: bars(...figure(0), ...figure(1)),
      },
      listen: bars(...figure(0), ...figure(1)),
    },
  ],
};
