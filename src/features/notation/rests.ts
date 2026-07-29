import type { TimeSignature } from '@/domain/takeTypes';
import { beatsForSymbol, DURATION_SYMBOLS, type DurationSymbol } from './quantization';

/**
 * Choosing the rests that fill a silence, in the one place both renderers can
 * share. Pure arithmetic — no timing, no geometry.
 *
 * Positions here are counted in three-hundred-and-eighty-fourths of a whole
 * note rather than in beats. Every value the app writes is a whole number of
 * them, so "does this rest start where a rest of its length may start" is exact
 * integer arithmetic instead of a float comparison against beats that arrived
 * by way of rounded milliseconds.
 *
 * 384 and not 32, which would be enough for the binary values alone: it also
 * divides into three, and a tuplet is a division into three. It is not 192
 * either, which reaches the 64th but leaves a *dotted* 64th at four and a half.
 * So: a 64th is 6 units, a sixteenth 24, a quarter 96 — and a triplet eighth is
 * 32, a triplet 64th 4, exactly.
 */
export const UNITS_PER_WHOLE = 384;

/** The shortest rest that can be written; anything less is not drawn. */
export const SMALLEST_UNITS = UNITS_PER_WHOLE / 64;

export interface RestSpan {
  /** Units (see `UNITS_PER_WHOLE`) from the start of the measure. */
  startUnits: number;
  lengthUnits: number;
  symbol: DurationSymbol;
}

const VALUES: readonly { symbol: DurationSymbol; units: number }[] = DURATION_SYMBOLS.map(
  (symbol) => ({ symbol, units: Math.round(beatsForSymbol(symbol, UNITS_PER_WHOLE)) }),
);

const WHOLE_REST: DurationSymbol = { base: 'whole', dotted: false };

/** A measure's length in units. */
export function barUnits(timeSignature: TimeSignature): number {
  return (timeSignature.numerator * UNITS_PER_WHOLE) / timeSignature.denominator;
}

/** Convert time-signature beats to units. */
export function unitsPerBeat(denominator: number): number {
  return UNITS_PER_WHOLE / denominator;
}

/**
 * The longest rest that may stand at `p`. An engraver reads a bar by its
 * divisions, so a rest starts only where one of its own length could start
 * (`p` a multiple of the value) and never swallows the middle of the bar,
 * which is the division a reader counts from. Where nothing qualifies — a
 * silence that starts off the grid — the longest value that fits is better
 * than nothing.
 *
 * Nothing shorter than `minUnits` is ever chosen; the caller's grid says how
 * fine the reading is meant to be, and a value under it would claim a precision
 * the rest of the page does not have.
 */
function choose(
  p: number,
  remaining: number,
  midpoint: number | null,
  minUnits: number,
): { symbol: DurationSymbol; units: number } | null {
  let fallback: { symbol: DurationSymbol; units: number } | null = null;
  for (const value of VALUES) {
    if (value.units > remaining || value.units < minUnits) continue;
    fallback ??= value;
    if (p % value.units !== 0) continue;
    if (midpoint !== null && p < midpoint && p + value.units > midpoint) continue;
    return value;
  }
  return fallback;
}

/**
 * The written values that fill `[fromUnits, toUnits)` of one measure, in order.
 *
 * Used for silence and for sound alike: the rests inside a gap, and the tied
 * pieces a held note is written as. Both answer the same question — which
 * standard values add up to this span, laid out so the bar still reads.
 *
 * `minUnits` is the shortest value that may appear, which is the display grid's
 * own step where there is one: a page written on a 1/16 grid says nothing
 * happens between sixteenths, so a sliver left over by rounding is dropped
 * exactly as it was before shorter values existed, rather than surfacing as a
 * 32nd rest nothing else on the page could have produced.
 */
export function valuesForSpan(
  fromUnits: number,
  toUnits: number,
  timeSignature: TimeSignature,
  minUnits: number = SMALLEST_UNITS,
): RestSpan[] {
  // Only an even meter has a middle to protect; 3/4 counts in threes and a
  // value across its centre is how it is written.
  const midpoint = timeSignature.numerator % 2 === 0 ? barUnits(timeSignature) / 2 : null;
  const floor = Math.max(SMALLEST_UNITS, minUnits);

  const spans: RestSpan[] = [];
  let p = fromUnits;
  while (toUnits - p >= floor) {
    const pick = choose(p, toUnits - p, midpoint, floor);
    if (pick === null) break;
    spans.push({ startUnits: p, lengthUnits: pick.units, symbol: pick.symbol });
    p += pick.units;
  }
  return spans;
}

/**
 * The rests filling a gap. As `valuesForSpan`, except that a bar silent the
 * whole way through takes a single whole rest whatever the meter is — the
 * glyph means "this bar", not "four beats" — which is also what the
 * empty-measure path draws, so the two agree.
 */
export function restsForGap(
  fromUnits: number,
  toUnits: number,
  timeSignature: TimeSignature,
  minUnits: number = SMALLEST_UNITS,
): RestSpan[] {
  const bar = barUnits(timeSignature);
  if (fromUnits <= 0 && toUnits >= bar) {
    return [{ startUnits: 0, lengthUnits: bar, symbol: WHOLE_REST }];
  }
  return valuesForSpan(fromUnits, toUnits, timeSignature, minUnits);
}

/**
 * The one symbol that is exactly `units` long, if there is one.
 *
 * A note takes this over a filled span wherever it can: a dotted half is a
 * dotted half whether or not it happens to cover the middle of the bar, and
 * splitting it into a tied half and quarter would be wrong. The span filler is
 * only for the lengths no single symbol reaches.
 */
export function symbolForUnits(units: number): DurationSymbol | null {
  for (const value of VALUES) {
    if (value.units === units) return value.symbol;
  }
  return null;
}

/**
 * Where a rest sits on the staff, in steps above the bottom line. A whole rest
 * hangs under the second line from the top; everything else is read from the
 * middle line.
 */
export function restStep(symbol: DurationSymbol): number {
  return symbol.base === 'whole' ? 6 : 4;
}
