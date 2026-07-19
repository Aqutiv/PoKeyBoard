import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { QuotaExceededStorageError } from '@/utils/errors';
import type { Take } from '@/domain/takeTypes';

afterEach(() => {
  vi.doUnmock('@/data/takeRepository');
  vi.doUnmock('@/data/metadataRepository');
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/audio/AudioEngine');
  vi.doUnmock('@/features/transport/transportController');
  vi.doUnmock('@/features/notation/scrubController');
  vi.resetModules();
});

describe('deleting the active take while saving fails', () => {
  it('still deletes when the pre-flush write rejects (quota full)', async () => {
    vi.resetModules();
    const repoDeleteTake = vi.fn(async () => undefined);
    // A large recording overflowed the quota, so every write now rejects.
    const saveTake = vi.fn(async () => {
      throw new QuotaExceededStorageError();
    });

    vi.doMock('@/data/takeRepository', () => ({
      deleteTake: repoDeleteTake,
      duplicateTake: vi.fn(),
      getAllTakesForBackup: vi.fn(),
      getTake: vi.fn(async () => null),
      renameTake: vi.fn(),
      saveTake,
      takeExists: vi.fn(async () => false),
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
    vi.doMock('@/audio/AudioEngine', () => ({
      audioEngine: { allNotesOff: vi.fn(), setMasterVolume: vi.fn(), setReverbMix: vi.fn() },
    }));
    vi.doMock('@/features/transport/transportController', () => ({
      transportController: { handleInterruption: vi.fn(), restorePlayhead: vi.fn() },
    }));
    vi.doMock('@/features/notation/scrubController', () => ({
      scrubController: { isActive: false, end: vi.fn() },
    }));

    const [{ deleteTake }, { useTakeStore }] = await Promise.all([
      import('@/features/takes/takesService'),
      import('@/state/useTakeStore'),
    ]);

    const active: Take = createEmptyTake({
      title: 'Doomed take',
      notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
    });
    useTakeStore.getState().setTake(active, { dirty: true });

    await expect(deleteTake(active.id)).resolves.toBeUndefined();

    expect(saveTake).toHaveBeenCalledTimes(1); // the pre-flush was attempted…
    expect(repoDeleteTake).toHaveBeenCalledWith(active.id); // …and did not block the delete
    const current = useTakeStore.getState();
    expect(current.take.id).not.toBe(active.id); // reset to a fresh empty take
    expect(current.dirty).toBe(false);
  });
});
