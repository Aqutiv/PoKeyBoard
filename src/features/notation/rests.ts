import type { TimeSignature } from '@/domain/takeTypes';
import { beatsForSymbol, DURATION_SYMBOLS, type DurationSymbol } from './quantization';

/**
 * Choosing the rests that fill a silence, in the one place both renderers can
 * share. Pure arithmetic — no timing, no geometry.
 *
 * Positions here are counted in 32nd notes rather than beats. Every value the
 * app writes is a whole number of them (a dotted sixteenth is three), so
 * "does this rest start where a rest of its length may start" is exact integer
 * arithmetic instead of a float comparison against beats that arrived by way of
 * rounded milliseconds.
 */
export const UNITS_PER_WHOLE = 32;

/** The shortest rest that can be written; anything less is not drawn. */
const SMALLEST_UNITS = 2;

export interface RestSpan {
  /** 32nd notes from the start of the measure. */
  startUnits: number;
  lengthUnits: number;
  symbol: DurationSymbol;
}

const VALUES: readonly { symbol: DurationSymbol; units: number }[] = DURATION_SYMBOLS.map(
  (symbol) => ({ symbol, units: Math.round(beatsForSymbol(symbol, UNITS_PER_WHOLE)) }),
);

const WHOLE_REST: DurationSymbol = { base: 'whole', dotted: false };

/** A measure's length in 32nd notes. */
export function barUnits(timeSignature: TimeSignature): number {
  return (timeSignature.numerator * UNITS_PER_WHOLE) / timeSignature.denominator;
}

/** Convert time-signature beats to 32nd notes. */
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
 */
function choose(
  p: number,
  remaining: number,
  midpoint: number | null,
): { symbol: DurationSymbol; units: number } | null {
  let fallback: { symbol: DurationSymbol; units: number } | null = null;
  for (const value of VALUES) {
    if (value.units > remaining) continue;
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
 */
export function valuesForSpan(
  fromUnits: number,
  toUnits: number,
  timeSignature: TimeSignature,
): RestSpan[] {
  // Only an even meter has a middle to protect; 3/4 counts in threes and a
  // value across its centre is how it is written.
  const midpoint = timeSignature.numerator % 2 === 0 ? barUnits(timeSignature) / 2 : null;

  const spans: RestSpan[] = [];
  let p = fromUnits;
  while (toUnits - p >= SMALLEST_UNITS) {
    const pick = choose(p, toUnits - p, midpoint);
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
): RestSpan[] {
  const bar = barUnits(timeSignature);
  if (fromUnits <= 0 && toUnits >= bar) {
    return [{ startUnits: 0, lengthUnits: bar, symbol: WHOLE_REST }];
  }
  return valuesForSpan(fromUnits, toUnits, timeSignature);
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
