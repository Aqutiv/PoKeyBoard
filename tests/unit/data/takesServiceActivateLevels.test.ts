import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIANO_INSTRUMENT_ID, pianoInstrument } from '@/audio/instruments';
import { createEmptyTake } from '@/domain/noteEvents';
import { DEFAULT_MASTER_VOLUME, DEFAULT_REVERB_MIX } from '@/domain/takeTypes';

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
describe('activating a take', () => {
  it('mirrors the take levels into the settings store', async () => {
    vi.resetModules();

    vi.doMock('@/data/persistence', () => ({
      persistenceService: {
        flushSaveOrThrow: vi.fn(async () => undefined),
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
      setMetadata: vi.fn(async () => undefined),
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

    const [{ activateTake }, { useSettingsStore }, { useTakeStore }] = await Promise.all([
      import('@/features/takes/takesService'),
      import('@/state/useSettingsStore'),
      import('@/state/useTakeStore'),
    ]);

    expect(useSettingsStore.getState().masterVolume).toBe(DEFAULT_MASTER_VOLUME);
    expect(useSettingsStore.getState().reverbMix).toBe(DEFAULT_REVERB_MIX);

    await activateTake(
      createEmptyTake({
        title: 'Quiet, wet take',
        instrument: { id: 'grand-piano', masterVolume: 0.3, reverbMix: 0.9 },
      }),
    );

    expect(useSettingsStore.getState().masterVolume).toBe(0.3);
    expect(useSettingsStore.getState().reverbMix).toBe(0.9);
    // Opening a take is not an edit to it.
    expect(useTakeStore.getState().dirty).toBe(false);
  });
});
