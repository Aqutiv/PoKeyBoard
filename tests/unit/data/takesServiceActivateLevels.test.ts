import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIANO_INSTRUMENT_ID, pianoInstrument } from '@/audio/instruments';
import { createEmptyTake } from '@/domain/noteEvents';
import { DEFAULT_MASTER_VOLUME, DEFAULT_REVERB_MIX, DEFAULT_REVERB_ROOM } from '@/domain/takeTypes';

afterEach(() => {
  vi.doUnmock('@/data/persistence');
  vi.doUnmock('@/data/takeRepository');
  vi.doUnmock('@/data/metadataRepository');
  vi.doUnmock('@/audio/AudioEngine');
  vi.doUnmock('@/features/transport/transportController');
  vi.doUnmock('@/features/notation/scrubController');
  vi.resetModules();
});

/**
 * The levels the engine actually plays at are driven off the settings store by
 * the persistence subscription, which only reacts to a *change*. Opening a take
 * moves the levels, so it has to move the store with them — a store left
 * disagreeing would make the next slider move compare against a stale value,
 * dragging the untouched level along and leaving the moved one unable to return
 * to what the store already held.
 */
/**
 * Load the service against mocked storage and audio. `flush` stands in for the
 * pending-save flush activation waits on, so a test can act in the middle of it.
 */
async function loadService(flush: () => Promise<void> = async () => undefined) {
  vi.resetModules();
  const setMetadata = vi.fn(async () => undefined);

  vi.doMock('@/data/persistence', () => ({
    persistenceService: {
      flushSaveOrThrow: vi.fn(flush),
      flushSave: vi.fn(async () => undefined),
    },
  }));
  vi.doMock('@/data/takeRepository', () => ({
    getTake: vi.fn(async () => null),
    saveTake: vi.fn(async () => 1),
    takeExists: vi.fn(async () => false),
  }));
  vi.doMock('@/data/metadataRepository', () => ({
    META_LAST_OPEN_TAKE: 'lastOpenTakeId',
    setMetadata,
  }));
  vi.doMock('@/audio/AudioEngine', () => ({
    audioEngine: {
      allNotesOff: vi.fn(),
      setMasterVolume: vi.fn(),
      setReverbMix: vi.fn(),
      activeInstrument: pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID),
    },
  }));
  vi.doMock('@/features/transport/transportController', () => ({
    transportController: { handleInterruption: vi.fn(), restorePlayhead: vi.fn() },
  }));
  vi.doMock('@/features/notation/scrubController', () => ({
    scrubController: { isActive: false, end: vi.fn() },
  }));

  // One import at a time. vitest applies the queued doMock/doUnmock calls
  // inside whichever imports start while they are pending, and imports started
  // together race over them: a late replay of the previous test's doUnmock
  // could leave takesService bound to the real persistence module.
  const { activateTake, createNewTake } = await import('@/features/takes/takesService');
  const { useSettingsStore } = await import('@/state/useSettingsStore');
  const { useTakeStore } = await import('@/state/useTakeStore');
  return { activateTake, createNewTake, useSettingsStore, useTakeStore, setMetadata };
}

/**
 * The levels the engine actually plays at are driven off the settings store by
 * the persistence subscription, which only reacts to a *change*. Opening a take
 * moves the levels, so it has to move the store with them — a store left
 * disagreeing would make the next slider move compare against a stale value,
 * dragging the untouched level along and leaving the moved one unable to return
 * to what the store already held.
 */
describe('activating a take', () => {
  it('mirrors the take levels into the settings store', async () => {
    const { activateTake, useSettingsStore, useTakeStore } = await loadService();

    expect(useSettingsStore.getState().masterVolume).toBe(DEFAULT_MASTER_VOLUME);
    expect(useSettingsStore.getState().reverbMix).toBe(DEFAULT_REVERB_MIX);
    expect(useSettingsStore.getState().reverbRoom).toBe(DEFAULT_REVERB_ROOM);

    await activateTake(
      createEmptyTake({
        title: 'Quiet, wet take',
        instrument: { id: 'grand-piano', masterVolume: 0.3, reverbMix: 0.9, reverbRoom: 'hall' },
      }),
    );

    expect(useSettingsStore.getState().masterVolume).toBe(0.3);
    expect(useSettingsStore.getState().reverbMix).toBe(0.9);
    expect(useSettingsStore.getState().reverbRoom).toBe('hall');
    // Opening a take is not an edit to it.
    expect(useTakeStore.getState().dirty).toBe(false);
  });

  it('opens a take from before rooms in Room', async () => {
    const { activateTake, useSettingsStore, useTakeStore } = await loadService();
    useSettingsStore.setState({ reverbRoom: 'cathedral' });

    await activateTake(
      createEmptyTake({
        title: 'Before rooms',
        instrument: { id: 'grand-piano', masterVolume: 0.5, reverbMix: 0.2 },
      }),
    );

    expect(useSettingsStore.getState().reverbRoom).toBe('room');
    expect(useTakeStore.getState().take.instrument).not.toHaveProperty('reverbRoom');
  });

  it('starts a new take in the room being played', async () => {
    const { createNewTake, useSettingsStore, useTakeStore } = await loadService();
    useSettingsStore.setState({ masterVolume: 0.6, reverbMix: 0.4, reverbRoom: 'studio' });

    await createNewTake();

    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: 0.6,
      reverbMix: 0.4,
      reverbRoom: 'studio',
    });
  });

  it('leaves the active take alone when the caller walks away during the save', async () => {
    // A Library row left mid-open, or a Learn chapter closed on its hand-off:
    // the abort lands while the pending save flushes, after the early check.
    const controller = new AbortController();
    const { activateTake, useTakeStore, setMetadata } = await loadService(async () => {
      controller.abort();
    });
    const before = useTakeStore.getState().take;

    const opened = await activateTake(
      createEmptyTake({ title: 'No longer asked for' }),
      controller.signal,
    );

    expect(opened).toBe(false);
    expect(useTakeStore.getState().take).toBe(before);
    expect(setMetadata).not.toHaveBeenCalled();
  });
});
