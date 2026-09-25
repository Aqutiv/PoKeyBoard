import type { LibraryTrackDef, TrackEvent } from '../trackBuilder';

/**
 * "Ode to Joy" — Ludwig van Beethoven, Symphony No. 9 (1824), public domain.
 *
 * The first eight bars, simplified for the right hand alone in the C position:
 * every note is one of C4 D4 E4 F4 G4, the five a beginner reads in Learn
 * chapter four. Quarters and halves only — the dotted `E. D` that closes the
 * first phrase is written as two half notes, since dotted rhythms are a later
 * chapter's subject.
 *
 * Learn chapter seven teaches exactly these events, and imports them from
 * here: the melody a lesson grades and the track its hand-off opens on Play
 * are one array, so they cannot drift apart.
 */

/** [note, beats] per bar, as the two phrases read. */
const PHRASES: readonly (readonly (readonly [string, number])[])[] = [
  // The question: four bars that stop on D, unfinished.
  [
    ['E4', 1],
    ['E4', 1],
    ['F4', 1],
    ['G4', 1],
    ['G4', 1],
    ['F4', 1],
    ['E4', 1],
    ['D4', 1],
    ['C4', 1],
    ['C4', 1],
    ['D4', 1],
    ['E4', 1],
    ['E4', 2],
    ['D4', 2],
  ],
  // The answer: the same start, home on C.
  [
    ['E4', 1],
    ['E4', 1],
    ['F4', 1],
    ['G4', 1],
    ['G4', 1],
    ['F4', 1],
    ['E4', 1],
    ['D4', 1],
    ['C4', 1],
    ['C4', 1],
    ['D4', 1],
    ['E4', 1],
    ['D4', 2],
    ['C4', 2],
  ],
];

/** Beats in one phrase: four bars of 4/4. */
export const ODE_TO_JOY_PHRASE_BEATS = 16;

function writePhrases(): TrackEvent[] {
  const out: TrackEvent[] = [];
  let beat = 0;
  for (const phrase of PHRASES) {
    for (const [note, beats] of phrase) {
      // A little weight on each downbeat, so the Listen demo and the Library
      // track both sound like a tune rather than a typewriter.
      const velocity = beat % 4 === 0 ? 0.72 : 0.64;
      out.push([beat, note, beats, velocity, 'treble']);
      beat += beats;
    }
  }
  return out;
}

/** The whole melody: eight bars, both phrases, at beat 0. */
export const ODE_TO_JOY_EVENTS: readonly TrackEvent[] = writePhrases();

export const ODE_TO_JOY_FIRST_STEPS: LibraryTrackDef = {
  trackId: 'ode-to-joy-first-steps',
  title: 'Ode to Joy (first steps)',
  composer: 'Ludwig van Beethoven',
  folder: 'classics',
  descriptionKey: 'odeToJoyFirstSteps',
  // The lesson's own tempo, so the track plays back as it was learned. Play's
  // speed menu is there for anyone ready to take it faster.
  bpm: 60,
  timeSignature: { numerator: 4, denominator: 4 },
  events: [...ODE_TO_JOY_EVENTS],
};
