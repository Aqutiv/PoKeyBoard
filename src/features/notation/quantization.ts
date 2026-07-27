import type { QuantizationSetting } from '@/domain/takeTypes';

/**
 * Visual quantization only: raw performance timing is never modified, these
 * helpers just decide where a note is DRAWN and which symbol it gets.
 */
export interface DurationSymbol {
  base: 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';
  dotted: boolean;
}

const SYMBOLS: Array<{ fraction: number; symbol: DurationSymbol }> = [
  { fraction: 1, symbol: { base: 'whole', dotted: false } },
  { fraction: 0.75, symbol: { base: 'half', dotted: true } },
  { fraction: 0.5, symbol: { base: 'half', dotted: false } },
  { fraction: 0.375, symbol: { base: 'quarter', dotted: true } },
  { fraction: 0.25, symbol: { base: 'quarter', dotted: false } },
  { fraction: 0.1875, symbol: { base: 'eighth', dotted: true } },
  { fraction: 0.125, symbol: { base: 'eighth', dotted: false } },
  { fraction: 0.09375, symbol: { base: 'sixteenth', dotted: true } },
  { fraction: 0.0625, symbol: { base: 'sixteenth', dotted: false } },
];

/** Every standard symbol, longest first — the values a note or rest may take. */
export const DURATION_SYMBOLS: readonly DurationSymbol[] = SYMBOLS.map((entry) => entry.symbol);

const BASE_FRACTION: Record<DurationSymbol['base'], number> = {
  whole: 1,
  half: 0.5,
  quarter: 0.25,
  eighth: 0.125,
  sixteenth: 0.0625,
};

/**
 * A symbol's written length in time-signature beats — the inverse of
 * `symbolForBeats`. What a note is *drawn* as, which is what decides where the
 * silence around it starts and ends; the raw performance duration says only
 * how long a key happened to be held.
 */
export function beatsForSymbol(symbol: DurationSymbol, denominator: number): number {
  return BASE_FRACTION[symbol.base] * (symbol.dotted ? 1.5 : 1) * denominator;
}

/**
 * Grid size in time-signature beats; null when off. The grid lives in beat
 * space so that it stays anchored to the music — bar lines and the tempo
 * changes that start on them included. An absolute millisecond grid only lines
 * up while one tempo runs the whole way. A whole note spans `denominator`
 * beats (four in 4/4, eight in 6/8).
 */
export function quantizeGridBeats(
  setting: QuantizationSetting,
  denominator: number,
): number | null {
  if (setting === 'off') return null;
  return denominator / (setting === '1/8' ? 8 : 16);
}

/**
 * Closest standard symbol for a length in time-signature beats (log-distance
 * nearest). Beats, not milliseconds: a note held across a tempo change is as
 * long as it is *written*, so it keeps the value it was played as instead of
 * gaining a dot from the slower tempo it ends in. A whole note spans
 * `denominator` beats.
 */
export function symbolForBeats(beats: number, denominator: number): DurationSymbol {
  const fraction = Math.max(beats / denominator, 0.0001);
  let best = SYMBOLS[SYMBOLS.length - 1]!.symbol;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const { fraction: f, symbol } of SYMBOLS) {
    const distance = Math.abs(Math.log(fraction / f));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = symbol;
    }
  }
  return best;
}
