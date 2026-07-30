/**
 * How a beat divides — into three rather than into two, and how finely.
 *
 * There are two ways to know. A score can *say*, in the `<time-modification>`
 * an import keeps on the note (`declaredDivisionOf`), and that is the end of the
 * question. A recording cannot: it knows only when keys went down, so a triplet
 * and a pair of straight quavers arrive looking the same — a list of times — and
 * the difference is only in where inside the beat those times fall
 * (`ternaryDivisionOf`, and the misfit arithmetic under it).
 *
 * This module owns both, so that "how is this beat divided" has one home.
 *
 * Pure arithmetic: positions or a ratio in, a verdict out. No timing, no
 * geometry.
 */

import type { NoteTuplet } from '@/domain/takeTypes';
import { exactValueForUnits, symbolForUnits, UNITS_PER_WHOLE, unitsPerBeat } from './rests';

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
 * Only as fine as a reading can be believed: halves and quarters of the beat
 * are eighths and sixteenths, thirds and sixths are their triplets. Offering
 * finer divisions than that does not make the reading more sensitive, it makes
 * it meaningless — a division into twelfths sits within a thirty-second of
 * almost any moment, so it fits everything and the test stops testing. Values
 * shorter than these divisions are still *written*; what they cannot do is be
 * evidence of a tuplet, and `MAX_MISFIT` is what keeps a run of 32nds from
 * being read as one.
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
 * How near those divisions a *sparse* hand must be to join a figure the other
 * hand has already established.
 *
 * Looser than the detection bound, because it answers a different question.
 * Detection asks "is there a triplet here at all", with nothing but these
 * onsets to go on, so it must be strict. This asks only "does this fragment
 * belong to the triplet already evidenced next door, or is it a different
 * rhythm" — and the evidence for the triplet has already been found. Holding a
 * fragment to the stricter bound would reject a note twenty milliseconds out at
 * 120bpm and then write it on the binary grid, leaving one hand's half of a
 * figure disagreeing with the other's about what the beat is.
 *
 * Still tight enough to rule out the thing that matters: two straight eighths
 * under a triplet sit a full 0.118 from any division in three.
 */
const MAX_INHERITED_MISFIT = 0.06;

/**
 * Whether a set of onsets actually sits on a given division of the beat.
 *
 * Asked of a hand that has too little in a beat to read it alone, before it is
 * allowed to take the other hand's answer. Two onsets are not enough to *claim*
 * a division, but they are plenty to rule one out — and a hand playing two
 * straight eighths against the other's triplets must not be dragged into them.
 *
 * Judged against `MAX_INHERITED_MISFIT` rather than the detection bound; see
 * the note there for why the two differ.
 */
export function fitsDivision(offsets: readonly BeatOffset[], division: number): boolean {
  return offsets.length === 0 || misfit(offsets, division) <= MAX_INHERITED_MISFIT;
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

/**
 * How finely a declared tuplet divides the beat it sits in, or null where this
 * notation cannot state it.
 *
 * A ratio is not yet a division: `actual` notes in the time of `normal` ones of
 * some value gives a slot length, and the division is how many of those slots
 * fill a beat. So the test is whether the notation can *state* that slot, not
 * whether the ratio looks familiar — and it is asked in integer units, which is
 * the only arithmetic the written values are exact in.
 *
 * What it refuses, and why each one is a refusal rather than an approximation:
 *
 * - A slot that is not a whole number of units. `UNITS_PER_WHOLE` is 384 = 2⁷·3,
 *   so thirds and sixths land exactly and fifths, sevenths and ninths cannot: a
 *   quintuplet sixteenth is 19.2 units. Those keep the reading they already had.
 * - A slot that does not divide the beat. The whole model anchors slots at the
 *   beat, so a tuplet counted in a value longer than the beat — a quarter-note
 *   triplet in 4/4, a duplet against 6/8 — has nowhere to sit.
 * - A slot that is already a plain value, which means the ratio cancels out
 *   (2:1 of eighths is just a quarter). Refusing it keeps the division ternary,
 *   and *that* is what stops a binary division reaching the rest filler, which
 *   would draw a dotted-32nd "triplet" rest: right length, absurd glyph.
 * - A slot no symbol states at all, which cannot be written either way.
 *
 * The survivors are the slots that are two thirds of a standard value, so every
 * division this returns is three times a power of two. `notationLayout` leans on
 * that: it means `exactValueForUnits` always stamps the plain 3:2 ratio, and
 * that two divisions meeting on one beat merge by keeping the finer.
 */
export function declaredDivisionOf(tuplet: NoteTuplet, denominator: number): number | null {
  const { actual, normal, unit } = tuplet;
  if (!Number.isInteger(unit) || unit < 1) return null;
  if (!Number.isInteger(actual) || !Number.isInteger(normal)) return null;
  if (actual < 1 || normal < 1) return null;

  const normalUnits = UNITS_PER_WHOLE / unit;
  const slot = (normal * normalUnits) / actual;
  if (!Number.isInteger(slot) || slot < 1) return null;

  const perBeat = unitsPerBeat(denominator);
  if (perBeat % slot !== 0) return null;
  if (symbolForUnits(slot) !== null) return null;
  if (exactValueForUnits(slot) === null) return null;

  return perBeat / slot;
}
