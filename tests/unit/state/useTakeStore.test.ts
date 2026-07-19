import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { useTakeStore } from '@/state/useTakeStore';

beforeEach(() => {
  useTakeStore.getState().setTake(createEmptyTake());
});

describe('take mutation generations', () => {
  it('does not mark a newer edit saved with an older generation', () => {
    useTakeStore.getState().setTake(createEmptyTake({ title: 'First' }), { dirty: true });
    const first = useTakeStore.getState();
    useTakeStore.getState().setTitle('Edited during save');

    useTakeStore.getState().markSaved(first.take.id, first.mutationGeneration);
    expect(useTakeStore.getState().dirty).toBe(true);

    const current = useTakeStore.getState();
    current.markSaved(current.take.id, current.mutationGeneration);
    expect(useTakeStore.getState().dirty).toBe(false);
    expect(useTakeStore.getState().savedGeneration).toBe(current.mutationGeneration);
  });

  it('undoes the last pass notes and pedals and clamps its playhead', () => {
    const pedal = { atMs: 50, down: true };
    useTakeStore.getState().beginRecordingPass();
    useTakeStore
      .getState()
      .appendRecordedNotes(
        [{ id: 'pass-note', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
        [pedal],
        ['pass-note'],
      );
    useTakeStore.getState().setPlayheadMs(100);

    useTakeStore.getState().undoLastPass();
    const take = useTakeStore.getState().take;
    expect(take.notes).toEqual([]);
    expect(take.pedalEvents).toEqual([]);
    expect(take.display.playheadMs).toBe(0);
  });
});
