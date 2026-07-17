import type { QuantizationSetting } from '@/domain/takeTypes';
import { wholeNoteDurationMs } from '@/utils/timing';

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

/** Grid size in ms for a quantization setting; null when off. */
export function quantizeGridMs(setting: QuantizationSetting, bpm: number): number | null {
  if (setting === 'off') return null;
  const whole = wholeNoteDurationMs(bpm);
  return setting === '1/8' ? whole / 8 : whole / 16;
}

/** Snap a start time to the visual grid (identity when quantization is off). */
export function quantizeStartMs(startMs: number, setting: QuantizationSetting, bpm: number): number {
  const grid = quantizeGridMs(setting, bpm);
  if (grid === null) return startMs;
  return Math.round(startMs / grid) * grid;
}

/** Closest standard symbol for a sounded duration (log-distance nearest). */
export function durationToSymbol(durationMs: number, bpm: number): DurationSymbol {
  const whole = wholeNoteDurationMs(bpm);
  const fraction = Math.max(durationMs / whole, 0.0001);
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
