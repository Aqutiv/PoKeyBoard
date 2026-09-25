import { createTakeTempoMap } from '@/domain/tempoMap';
import type { PlaybackLoop, Take, TempoSettings } from '@/domain/takeTypes';
import { effectivePlaybackDurationMs } from './sustainPedal';
import { MIN_LOOP_MS } from './transportClock';

/**
 * A take's loop as playback can play it: inside the take, and long enough to
 * repeat; or null. The one answer for everything that shows or plays a loop,
 * so a loop left past the end of a take — imported that way, or stranded by
 * notes cleared from under it — never shows as set while playback runs
 * straight through it.
 */
export function playableLoop(take: Take): PlaybackLoop | null {
  const loop = take.display.loop;
  if (!loop) return null;
  const endMs = Math.min(loop.endMs, effectivePlaybackDurationMs(take));
  return endMs - loop.startMs >= MIN_LOOP_MS ? { startMs: loop.startMs, endMs } : null;
}

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
 * long at least — two taps on the same beat still make a passage. Where one
 * beat is shorter than a loop can be, fast in sixteenths, it takes as many
 * whole beats as a loop needs. Null when the take is too short for one.
 */
export function loopBetween(take: Take, a: number, b: number): PlaybackLoop | null {
  const map = createTakeTempoMap(take.tempo);
  const startMs = Math.max(0, Math.min(a, b));
  let endMs = Math.max(a, b);
  if (endMs - startMs < MIN_LOOP_MS) {
    const beat = Math.round(map.beatAtMs(startMs));
    const endBeat = Math.max(beat + 1, Math.ceil(map.beatAtMs(startMs + MIN_LOOP_MS)));
    endMs = Math.round(map.msAtBeat(endBeat));
  }
  endMs = Math.min(endMs, effectivePlaybackDurationMs(take));
  return endMs - startMs >= MIN_LOOP_MS ? { startMs, endMs } : null;
}
