import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';

afterEach(() => {
  vi.doUnmock('@/data/takeRepository');
  vi.doUnmock('@/data/metadataRepository');
  vi.doUnmock('@/data/audioCacheRepository');
  vi.resetModules();
});

describe('serialized persistence', () => {
  it('loops and saves edits made while an earlier write is pending', async () => {
    vi.resetModules();
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: Take[] = [];
    const saveTake = vi.fn(async (take: Take) => {
      writes.push(take);
      if (writes.length === 1) await firstWrite;
      return writes.length;
    });

    vi.doMock('@/data/takeRepository', () => ({
      getTake: vi.fn(async () => null),
      saveTake,
    }));
    vi.doMock('@/data/metadataRepository', () => ({
      META_LAST_OPEN_TAKE: 'lastOpenTakeId',
      META_PERSIST_REQUESTED: 'persistentStorageRequested',
      getMetadata: vi.fn(async () => undefined),
      setMetadata: vi.fn(async () => undefined),
    }));
    vi.doMock('@/data/audioCacheRepository', () => ({
      invalidateCachedAudio: vi.fn(async () => undefined),
    }));

    const [{ persistenceService }, { useTakeStore }] = await Promise.all([
      import('@/data/persistence'),
      import('@/state/useTakeStore'),
    ]);
    useTakeStore.getState().setTake(createEmptyTake({ title: 'Before' }), { dirty: true });

    const firstFlush = persistenceService.flushSaveOrThrow();
    await vi.waitFor(() => expect(saveTake).toHaveBeenCalledTimes(1));
    useTakeStore.getState().setTitle('During write');
    const concurrentFlush = persistenceService.flushSaveOrThrow();
    releaseFirst();

    await Promise.all([firstFlush, concurrentFlush]);
    expect(writes.map((take) => take.title)).toEqual(['Before', 'During write']);
    expect(useTakeStore.getState().dirty).toBe(false);
  });
});
