import { createTakeTempoMap } from '@/domain/tempoMap';
import type { PlaybackLoop, Take, TempoSettings } from '@/domain/takeTypes';
import { effectivePlaybackDurationMs } from './sustainPedal';
import { MIN_LOOP_MS } from './transportClock';

/**
 * The beat nearest `ms`. A loop is marked by ear — a tap as the passage
 * starts, another as it ends — and lands on the music's own pulse, so it
 * repeats in time rather than a few milliseconds off every pass.
 */
export function nearestBeatMs(tempo: TempoSettings, ms: number): number {
  const map = createTakeTempoMap(tempo);
  return Math.round(map.msAtBeat(Math.round(map.beatAtMs(Math.max(0, ms)))));
}

/**
 * The loop two marks make, whichever came first: inside the take, and a beat
 * long at least — two taps on the same beat still make a passage. Null when
 * the take is too short for one.
 */
export function loopBetween(take: Take, a: number, b: number): PlaybackLoop | null {
  const map = createTakeTempoMap(take.tempo);
  const startMs = Math.max(0, Math.min(a, b));
  let endMs = Math.max(a, b);
  if (endMs - startMs < MIN_LOOP_MS) {
    endMs = Math.round(map.msAtBeat(Math.round(map.beatAtMs(startMs)) + 1));
  }
  endMs = Math.min(endMs, effectivePlaybackDurationMs(take));
  return endMs - startMs >= MIN_LOOP_MS ? { startMs, endMs } : null;
}
