import { describe, expect, it } from 'vitest';
import { createTakeTempoMap } from '@/domain/tempoMap';
import { handoffLoop } from '@/features/learn/handoff';
import { buildLibraryTake } from '@/features/library/trackBuilder';
import { A_BEAUTIFUL_DAY } from '@/features/library/tracks/aBeautifulDay';
import { loopBetween } from '@/features/transport/practiceLoop';

describe('handoffLoop', () => {
  const take = buildLibraryTake(A_BEAUTIFUL_DAY);
  const map = createTakeTempoMap(take.tempo);

  it('loops the bars asked for, in the take’s own milliseconds', () => {
    // Bars 3–6 at 92bpm: the tune's first statement, after the introduction.
    const loop = handoffLoop(take, [8, 24]);
    expect(loop).toEqual({
      startMs: Math.round(map.msAtBeat(8)),
      endMs: Math.round(map.msAtBeat(24)),
    });
  });

  it('makes exactly the loop Play’s own loop button would, marking the same two points', () => {
    const startMs = Math.round(map.msAtBeat(8));
    const endMs = Math.round(map.msAtBeat(24));
    expect(handoffLoop(take, [8, 24])).toEqual(loopBetween(take, startMs, endMs));
  });

  it('keeps a loop reaching past the end inside the take', () => {
    const lastBeat = Math.floor(map.beatAtMs(take.durationMs));
    const loop = handoffLoop(take, [lastBeat - 8, lastBeat + 16]);
    expect(loop?.endMs).toBeLessThanOrEqual(take.durationMs);
  });
});
