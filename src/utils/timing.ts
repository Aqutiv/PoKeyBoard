import type { TempoSettings, TimeSignature } from '@/domain/takeTypes';

/**
 * Duration of one beat in milliseconds. The beat unit is the time signature's
 * denominator note (quarter in 4/4, eighth in 6/8); bpm counts those beats.
 */
export function beatDurationMs(bpm: number, timeSignature: TimeSignature): number {
  const quarterMs = 60_000 / bpm;
  return quarterMs * (4 / timeSignature.denominator);
}

export function barDurationMs(bpm: number, timeSignature: TimeSignature): number {
  return beatDurationMs(bpm, timeSignature) * timeSignature.numerator;
}

export function countInDurationMs(tempo: TempoSettings): number {
  return barDurationMs(tempo.bpm, tempo.timeSignature) * tempo.countInBars;
}

/** Duration of a whole note, the basis for quantization grids. */
export function wholeNoteDurationMs(bpm: number): number {
  return 4 * (60_000 / bpm);
}

/** "1:23" or, with tenths, "1:23.4". Negative inputs clamp to zero. */
export function formatDurationMs(ms: number, withTenths = false): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  if (!withTenths) return base;
  const tenths = Math.floor((clamped % 1000) / 100);
  return `${base}.${tenths}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
