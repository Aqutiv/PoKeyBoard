import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { loopBetween, nearestBeatMs, playableLoop } from '@/features/transport/practiceLoop';
import { MIN_LOOP_MS } from '@/features/transport/transportClock';
import { useTakeStore } from '@/state/useTakeStore';

/** 120 bpm in 4/4, four seconds of notes: a beat every 500 ms. */
function take() {
  return createEmptyTake({
    notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 4000, velocity: 0.6 }],
    durationMs: 4000,
  });
}

describe('marking a loop', () => {
  it('lands each mark on the nearest beat', () => {
    const { tempo } = take();
    expect(nearestBeatMs(tempo, 1180)).toBe(1000);
    expect(nearestBeatMs(tempo, 1260)).toBe(1500);
    expect(nearestBeatMs(tempo, -40)).toBe(0);
  });

  it('makes a loop of two marks, whichever came first', () => {
    expect(loopBetween(take(), 2500, 1000)).toEqual({ startMs: 1000, endMs: 2500 });
  });

  it('makes two marks on one beat a loop of that beat', () => {
    expect(loopBetween(take(), 1500, 1500)).toEqual({ startMs: 1500, endMs: 2000 });
  });

  it('takes as many beats as a loop needs where one beat is too short', () => {
    // 240 bpm in 4/16: a beat is 62.5 ms, so a loop needs two of them.
    const fast = take();
    fast.tempo = { ...fast.tempo, bpm: 240, timeSignature: { numerator: 4, denominator: 16 } };
    const loop = loopBetween(fast, 1000, 1000);
    expect(loop).toEqual({ startMs: 1000, endMs: 1125 });
    expect(loop!.endMs - loop!.startMs).toBeGreaterThanOrEqual(MIN_LOOP_MS);
    // Marks on neighbouring beats, 1000 and 1062.5 ms, make the same loop.
    expect(loopBetween(fast, 1000, 1063)).toEqual({ startMs: 1000, endMs: 1125 });
    // Too near the take's end for one, there is still none.
    expect(loopBetween(fast, 3938, 3938)).toBeNull();
  });

  it('keeps a loop inside the take', () => {
    expect(loopBetween(take(), 3000, 9000)).toEqual({ startMs: 3000, endMs: 4000 });
    expect(loopBetween(take(), 4000, 4000)).toBeNull();
  });
});

describe('a loop playback can play', () => {
  it('is the loop as it was set, while it lies inside the take', () => {
    const inside = take();
    inside.display = { ...inside.display, loop: { startMs: 1000, endMs: 3000 } };
    expect(playableLoop(inside)).toEqual({ startMs: 1000, endMs: 3000 });
  });

  it('ends where the take does', () => {
    const over = take();
    over.display = { ...over.display, loop: { startMs: 3000, endMs: 9000 } };
    expect(playableLoop(over)).toEqual({ startMs: 3000, endMs: 4000 });
  });

  it('is none at all past the end, so nothing shows one as set', () => {
    // Imported that way, or stranded when notes were cleared from under it.
    const past = take();
    past.display = { ...past.display, loop: { startMs: 5000, endMs: 6000 } };
    expect(playableLoop(past)).toBeNull();
    expect(playableLoop(take())).toBeNull();
  });
});

describe('the take store', () => {
  it('saves speed and loop without touching what an export hears', () => {
    useTakeStore.getState().setTake(take());
    const revision = useTakeStore.getState().contentRevision;
    useTakeStore.getState().setPlaybackSpeed(0.6);
    useTakeStore.getState().setPlaybackLoop({ startMs: 0, endMs: 1000 });
    const state = useTakeStore.getState();
    expect(state.take.display.speed).toBe(0.6);
    expect(state.take.display.loop).toEqual({ startMs: 0, endMs: 1000 });
    expect(state.dirty).toBe(true);
    expect(state.contentRevision).toBe(revision);
    useTakeStore.getState().setPlaybackLoop(null);
    expect(useTakeStore.getState().take.display.loop).toBeUndefined();
  });
});
