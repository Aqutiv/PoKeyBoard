import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistenceService } from '@/data/persistence';
import { createEmptyTake } from '@/domain/noteEvents';
import { transportController } from '@/features/transport/transportController';
import { useTakeStore } from '@/state/useTakeStore';

/** Each take write, held until the test lets it finish. */
const writes = vi.hoisted(() => ({ pending: [] as Array<() => void>, count: 0 }));

vi.mock('@/data/takeRepository', () => ({
  getTake: vi.fn(async () => undefined),
  saveTake: vi.fn(
    () =>
      new Promise<number>((resolve) => {
        writes.count += 1;
        writes.pending.push(() => resolve(1));
      }),
  ),
}));
vi.mock('@/data/metadataRepository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data/metadataRepository')>()),
  setMetadata: vi.fn(async () => undefined),
}));
vi.mock('@/data/audioCacheRepository', () => ({
  invalidateCachedAudio: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('autosave while recording', () => {
  it('saves at most every ten seconds, not at every pause', () => {
    vi.useFakeTimers();
    vi.spyOn(transportController, 'getState').mockReturnValue('recording');
    const flush = vi.spyOn(persistenceService, 'flushSave').mockResolvedValue();
    for (let i = 0; i < 20; i += 1) {
      persistenceService.scheduleSave();
      vi.advanceTimersByTime(900); // a pause longer than the debounce
    }
    // 18 s of playing: one save at 10 s; the next change after it, at 10.8 s,
    // is saved at 20.8 s.
    expect(flush).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_799);
    expect(flush).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('keeps the short debounce otherwise', () => {
    vi.useFakeTimers();
    vi.spyOn(transportController, 'getState').mockReturnValue('idle');
    const flush = vi.spyOn(persistenceService, 'flushSave').mockResolvedValue();
    persistenceService.scheduleSave();
    vi.advanceTimersByTime(500);
    persistenceService.scheduleSave();
    vi.advanceTimersByTime(799);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledOnce();
  });

  it('leaves notes recorded during a slow write to the next save', async () => {
    vi.spyOn(transportController, 'getState').mockReturnValue('recording');
    vi.spyOn(persistenceService, 'scheduleSave').mockImplementation(() => undefined);
    writes.count = 0;
    writes.pending = [];
    const note = (id: string, startMs: number) => ({
      id,
      midi: 60,
      startMs,
      durationMs: 100,
      velocity: 0.7,
    });
    useTakeStore.getState().setTake(createEmptyTake());
    useTakeStore.getState().appendRecordedNotes([note('a', 0)], [], ['a']);

    const flushing = persistenceService.flushSave();
    await vi.waitFor(() => expect(writes.count).toBe(1));
    // A note let go while the write is still under way.
    useTakeStore.getState().appendRecordedNotes([note('b', 200)], [], ['a', 'b']);
    writes.pending.shift()?.();
    await flushing;
    expect(writes.count).toBe(1);
    expect(useTakeStore.getState().dirty).toBe(true);
    // Nor does it claim the newest note is saved.
    expect(persistenceService.getStatus().status).toBe('idle');

    // Stopped, a save writes it straight away.
    vi.mocked(transportController.getState).mockReturnValue('idle');
    const final = persistenceService.flushSave();
    await vi.waitFor(() => expect(writes.count).toBe(2));
    writes.pending.shift()?.();
    await final;
    expect(useTakeStore.getState().dirty).toBe(false);
    expect(persistenceService.getStatus().status).toBe('saved');
  });

  it('still saves a note whose timer ran out during a write longer than ten seconds', async () => {
    vi.useFakeTimers();
    vi.spyOn(transportController, 'getState').mockReturnValue('recording');
    writes.count = 0;
    writes.pending = [];
    const note = (id: string, startMs: number) => ({
      id,
      midi: 60,
      startMs,
      durationMs: 100,
      velocity: 0.7,
    });
    useTakeStore.getState().setTake(createEmptyTake());
    useTakeStore.getState().appendRecordedNotes([note('a', 0)], [], ['a']);

    const flushing = persistenceService.flushSave();
    await vi.waitFor(() => expect(writes.count).toBe(1));
    // A note let go mid-write arms its save (as the store subscription does)…
    useTakeStore.getState().appendRecordedNotes([note('b', 200)], [], ['a', 'b']);
    persistenceService.scheduleSave();
    // …which comes due while that slow write is still under way, and joins it.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes.count).toBe(1);
    writes.pending.shift()?.();
    await flushing;
    expect(useTakeStore.getState().dirty).toBe(true);

    // Another save is still coming for it, without another note to ask.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes.count).toBe(2);
    writes.pending.shift()?.();
    await vi.waitFor(() => expect(useTakeStore.getState().dirty).toBe(false));
  });
});
