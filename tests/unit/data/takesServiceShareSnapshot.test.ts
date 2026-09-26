import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIANO_INSTRUMENT_ID, pianoInstrument } from '@/audio/instruments';
import { createEmptyTake } from '@/domain/noteEvents';
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

async function loadService(stored: Take | null) {
  vi.resetModules();
  const getTake = vi.fn(async () => stored);
  const saveTake = vi.fn(async () => undefined);
  const handleInterruption = vi.fn();
  const allNotesOff = vi.fn();

  vi.doMock('@/data/takeRepository', () => ({
    deleteTake: vi.fn(),
    duplicateTake: vi.fn(),
    getAllTakesForBackup: vi.fn(),
    getTake,
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
    audioEngine: {
      allNotesOff,
      setMasterVolume: vi.fn(),
      setReverbMix: vi.fn(),
      // useTakeStore.setTake stamps the take with the selected piano.
      activeInstrument: pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID),
    },
  }));
  vi.doMock('@/features/transport/transportController', () => ({
    transportController: { handleInterruption, restorePlayhead: vi.fn() },
  }));
  vi.doMock('@/features/notation/scrubController', () => ({
    scrubController: { isActive: false, end: vi.fn() },
  }));

  // One import at a time: imports started together race over the queued
  // doMock/doUnmock calls, and a late replay of the previous test's doUnmock
  // could bind the service to the real transport controller.
  const service = await import('@/features/takes/takesService');
  const { useTakeStore } = await import('@/state/useTakeStore');
  return { service, useTakeStore, getTake, saveTake, handleInterruption, allNotesOff };
}

describe('preparing a take file to share', () => {
  it('leaves the transport alone when the take is the one playing', async () => {
    const { service, useTakeStore, getTake, saveTake, handleInterruption, allNotesOff } =
      await loadService(null);
    const active: Take = createEmptyTake({
      title: 'Still playing',
      notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 100, velocity: 0.7 }],
    });
    useTakeStore.getState().setTake(active, { dirty: true });

    const file = await service.takeJsonFile(active.id);

    // The Takes row prepares this file as soon as it opens; stopping playback
    // there interrupted whatever the user was listening to.
    expect(handleInterruption).not.toHaveBeenCalled();
    expect(allNotesOff).not.toHaveBeenCalled();
    // The in-memory copy is the freshest there is, so nothing is read or saved.
    expect(getTake).not.toHaveBeenCalled();
    expect(saveTake).not.toHaveBeenCalled();

    const parsed = JSON.parse(await (file as File).text()) as Take;
    expect(parsed.id).toBe(active.id);
    expect(parsed.title).toBe('Still playing');
    expect(parsed.notes).toHaveLength(1);
  });

  it('reads any other take from storage', async () => {
    const stored: Take = createEmptyTake({ title: 'Stored take' });
    const { service, getTake, handleInterruption } = await loadService(stored);

    const file = await service.takeJsonFile(stored.id);

    expect(getTake).toHaveBeenCalledWith(stored.id);
    expect(handleInterruption).not.toHaveBeenCalled();
    expect((JSON.parse(await (file as File).text()) as Take).title).toBe('Stored take');
  });
});
