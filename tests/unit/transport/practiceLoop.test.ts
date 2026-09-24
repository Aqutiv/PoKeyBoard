import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { loopBetween, nearestBeatMs } from '@/features/transport/practiceLoop';
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

  it('keeps a loop inside the take', () => {
    expect(loopBetween(take(), 3000, 9000)).toEqual({ startMs: 3000, endMs: 4000 });
    expect(loopBetween(take(), 4000, 4000)).toBeNull();
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
