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

function bestFit(
  offsets: readonly BeatOffset[],
  divisions: readonly number[],
): { division: number; misfit: number } {
  let best = { division: divisions[0] as number, misfit: Number.POSITIVE_INFINITY };
  for (const division of divisions) {
    const value = misfit(offsets, division);
    if (value < best.misfit) best = { division, misfit: value };
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
export const MIN_ONSETS_TO_DECIDE = 3;

/**
 * How near the ternary divisions the onsets must actually be.
 *
 * A backstop against winning by default. The comparison against the binary
 * reading only says which fits *better*, and a run of evenly spaced notes that
 * happens to start off the beat fits neither anchored grid well — so ternary
 * takes it on a poor score. Chopin's ornamental runs are exactly that: four
 * notes a clean quarter-beat apart, displaced, which is binary spacing and not
 * a triplet at all. Requiring the fit to be good in absolute terms rejects them
 * while leaving room for a player who is merely a little out.
 *
 * Set tight on purpose. Missing a triplet leaves the page as it already was;
 * inventing one puts a rhythm on it that nobody played.
 */
const MAX_MISFIT = 0.035;

/**
 * Whether a set of onsets actually sits on a given division of the beat.
 *
 * Asked of a hand that has too little in a beat to read it alone, before it is
 * allowed to take the other hand's answer. Two onsets are not enough to *claim*
 * a division, but they are plenty to rule one out — and a hand playing two
 * straight eighths against the other's triplets must not be dragged into them.
 */
export function fitsDivision(offsets: readonly BeatOffset[], division: number): boolean {
  return offsets.length === 0 || misfit(offsets, division) <= MAX_MISFIT;
}

/**
 * Whether a beat's onsets are better explained by dividing it in three.
 *
 * The case this has to get right is the one that fools a careless test: a
 * dotted eighth followed by a sixteenth sits at 0 and ¾ of the beat, and a
 * triplet at 0, ⅓ and ⅔. Both look "three-ish" if you only count notes. Only
 * the positions tell them apart, which is why this measures them.
 */
export function ternaryDivisionOf(offsets: readonly BeatOffset[]): number | null {
  if (offsets.length < MIN_ONSETS_TO_DECIDE) return null;

  const ternary = bestFit(offsets, TERNARY_DIVISIONS);
  const binary = bestFit(offsets, BINARY_DIVISIONS);

  // Playing loose enough to fit neither reading is not evidence for the rarer
  // one; leave it binary and let the ordinary grid round it.
  if (ternary.misfit > MAX_MISFIT) return null;
  return ternary.misfit < binary.misfit * TERNARY_MARGIN ? ternary.division : null;
}

/** Whether the beat divides in three at all; see `ternaryDivisionOf`. */
export function isTernaryBeat(offsets: readonly BeatOffset[]): boolean {
  return ternaryDivisionOf(offsets) !== null;
}
