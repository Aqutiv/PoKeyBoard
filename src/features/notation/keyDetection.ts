import { MAX_FIFTHS, type NoteEvent } from '@/domain/takeTypes';

/**
 * Guessing the key a take is in, for scores that never said.
 *
 * A recording knows which keys were pressed and nothing else, so the only
 * evidence is which pitch classes turn up and for how long. Correlating that
 * against the twenty-four major and minor profiles is the standard way to read
 * it, and it is right often enough to be worth doing: a wrong guess costs a few
 * misspelled accidentals, and the export lets the player say otherwise.
 */

/**
 * Krumhansl–Kessler key profiles: how strongly listeners rate each scale
 * degree as belonging to a major (and a minor) key.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Below this many notes there is nothing to read a key from. */
const MIN_NOTES_TO_DETECT = 12;

/** Fifths in the key signature of each major tonic, C first. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
/** And of each minor tonic — the relative major, three semitones up. */
const MINOR_FIFTHS = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2];

function correlate(weights: readonly number[], profile: readonly number[], tonic: number): number {
  let total = 0;
  for (let i = 0; i < 12; i += 1) {
    total += (weights[(i + tonic) % 12] as number) * (profile[i] as number);
  }
  return total;
}

/**
 * The key signature a take is most likely written in, as fifths.
 *
 * Pitch classes are weighted by how long they sound rather than how often they
 * are struck, so a bass note held under a run counts for what it is worth.
 * Silence — an empty take — is C major, which is also what spelling falls back
 * to everywhere else.
 */
export function detectFifths(notes: readonly NoteEvent[]): number {
  // Too little to go on reads as C major. Without this the live score would
  // pick a key from the first two notes of a recording and then keep changing
  // its mind as more arrived, respelling what is already on screen each time.
  if (notes.length < MIN_NOTES_TO_DETECT) return 0;

  const weights = new Array<number>(12).fill(0);
  let total = 0;
  for (const note of notes) {
    const weight = Math.max(1, note.durationMs);
    const pitchClass = ((note.midi % 12) + 12) % 12;
    weights[pitchClass] = (weights[pitchClass] as number) + weight;
    total += weight;
  }
  if (total === 0) return 0;

  let bestFifths = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const candidates = [
      { score: correlate(weights, MAJOR_PROFILE, tonic), fifths: MAJOR_FIFTHS[tonic] as number },
      { score: correlate(weights, MINOR_PROFILE, tonic), fifths: MINOR_FIFTHS[tonic] as number },
    ];
    for (const candidate of candidates) {
      // Ties go to the simpler signature: with nothing to choose between two
      // readings, the one with fewer accidentals is the one to print.
      const better =
        candidate.score > bestScore ||
        (candidate.score === bestScore && Math.abs(candidate.fifths) < Math.abs(bestFifths));
      if (better) {
        bestScore = candidate.score;
        bestFifths = candidate.fifths;
      }
    }
  }
  return Math.max(-MAX_FIFTHS, Math.min(MAX_FIFTHS, bestFifths));
}
