/**
 * Deciding whether a beat was played in three rather than in two.
 *
 * Nothing in a take says so. A recording knows only when keys went down, and an
 * imported score has already been flattened to milliseconds, so a triplet and a
 * pair of straight quavers arrive looking the same — a list of times. The
 * difference is only in where inside the beat those times fall.
 *
 * Pure arithmetic: positions in, a verdict out. No timing, no geometry.
 */

/** Where a note starts, as a fraction of the beat it falls in (0 ≤ at < 1). */
export type BeatOffset = number;

/**
 * How far a set of offsets sits from the nearest division of the beat.
 *
 * Root mean square rather than a plain sum, so that one badly placed note in a
 * run counts for less than a whole run being slightly out — which is the
 * difference between a slip and a different rhythm.
 */
function misfit(offsets: readonly BeatOffset[], divisions: number): number {
  let total = 0;
  for (const offset of offsets) {
    const scaled = offset * divisions;
    const distance = Math.abs(scaled - Math.round(scaled)) / divisions;
    total += distance * distance;
  }
  return Math.sqrt(total / offsets.length);
}

/**
 * Binary divisions of a beat, and ternary ones.
 *
 * Only as fine as the app can actually write: halves and quarters of the beat
 * are eighths and sixteenths, thirds and sixths are their triplets. Offering
 * finer divisions than that does not make the reading more sensitive, it makes
 * it meaningless — a division into twelfths sits within a thirty-second of
 * almost any moment, so it fits everything and the test stops testing.
 */
const BINARY_DIVISIONS = [2, 4];
const TERNARY_DIVISIONS = [3, 6];

function bestMisfit(offsets: readonly BeatOffset[], divisions: readonly number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const division of divisions) {
    const value = misfit(offsets, division);
    if (value < best) best = value;
  }
  return best;
}

/**
 * How much better the ternary reading has to be before it is believed.
 *
 * A margin and not a simple comparison, because binary is the default and the
 * cost of the two mistakes is not the same: writing straight quavers as
 * triplets is a wrong rhythm on the page, while missing a triplet leaves the
 * page as it already was.
 */
const TERNARY_MARGIN = 0.6;

/**
 * A beat with fewer onsets than this cannot say anything. One note says
 * nothing at all; two can land on thirds by accident often enough to matter.
 */
const MIN_ONSETS = 3;

/** How far off the grid a set of onsets may sit before neither reading is trusted. */
const MAX_MISFIT = 0.06;

/**
 * Whether a beat's onsets are better explained by dividing it in three.
 *
 * The case this has to get right is the one that fools a careless test: a
 * dotted eighth followed by a sixteenth sits at 0 and ¾ of the beat, and a
 * triplet at 0, ⅓ and ⅔. Both look "three-ish" if you only count notes. Only
 * the positions tell them apart, which is why this measures them.
 */
export function isTernaryBeat(offsets: readonly BeatOffset[]): boolean {
  if (offsets.length < MIN_ONSETS) return false;

  const ternary = bestMisfit(offsets, TERNARY_DIVISIONS);
  const binary = bestMisfit(offsets, BINARY_DIVISIONS);

  // Playing loose enough to fit neither reading is not evidence for the rarer
  // one; leave it binary and let the ordinary grid round it.
  if (ternary > MAX_MISFIT) return false;
  return ternary < binary * TERNARY_MARGIN;
}
