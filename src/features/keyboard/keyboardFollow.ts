import { FULL_RANGE_LOW, maxLowMidiFor, snapToWhite, stepWhites } from './keyboardGeometry';

/** How far past the playhead the key bed looks when deciding where to be. */
export const FOLLOW_LOOKAHEAD_MS = 1_500;

/** The fewest milliseconds between two moves, so the bed never shuffles. */
export const FOLLOW_MIN_INTERVAL_MS = 700;

/** How long after the player moves the bed by hand it is left where they put it. */
export const FOLLOW_MANUAL_HOLD_MS = 4_000;

/** The keys the take is sounding, and those it is about to. */
export interface FollowPitches {
  now: readonly number[];
  soon: readonly number[];
}

/**
 * Where the key bed should move to show what playback is playing and about to
 * play — the lowest key of the new window — or null to stay where it is.
 *
 * It moves only when something sounding, or about to, is off the bed, and then
 * to the window that holds the most of it: notes sounding now count twice,
 * since they are what the eye is looking for. Ties go to the window nearest
 * where it already is. A take spread wider than the bed shows where most of it
 * is happening, and the edge markers point to the rest.
 */
export function followAnchor(
  pitches: FollowPitches,
  lowMidi: number,
  visibleWhites: number,
): number | null {
  const all = [...pitches.now, ...pitches.soon];
  if (all.length === 0) return null;
  const highOf = (low: number) => stepWhites(low, visibleWhites, 1);
  const inside = (midi: number, low: number) => midi >= low && midi <= highOf(low);
  if (all.every((midi) => inside(midi, lowMidi))) return null;

  const score = (low: number): number => {
    let total = 0;
    for (const midi of pitches.now) if (inside(midi, low)) total += 2;
    for (const midi of pitches.soon) if (inside(midi, low)) total += 1;
    return total;
  };
  const clampLow = (low: number) =>
    Math.min(maxLowMidiFor(visibleWhites), Math.max(FULL_RANGE_LOW, low));

  // A best window has a note on one edge or the other: try both for each.
  let best = lowMidi;
  let bestScore = score(lowMidi);
  for (const midi of all) {
    for (const candidate of [
      clampLow(snapToWhite(midi, -1)),
      clampLow(stepWhites(snapToWhite(midi, 1), visibleWhites, -1)),
    ]) {
      const candidateScore = score(candidate);
      if (
        candidateScore > bestScore ||
        (candidateScore === bestScore &&
          best !== lowMidi &&
          Math.abs(candidate - lowMidi) < Math.abs(best - lowMidi))
      ) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
  }
  return best === lowMidi ? null : best;
}
