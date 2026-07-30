import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIANO_INSTRUMENT_ID, pianoInstrument } from '@/audio/instruments';
import { DEFAULT_MASTER_VOLUME, DEFAULT_REVERB_MIX } from '@/domain/takeTypes';

const setMasterVolume = vi.fn();
const setReverbMix = vi.fn();

afterEach(() => {
  vi.doUnmock('@/data/takeRepository');
  vi.doUnmock('@/data/metadataRepository');
  vi.doUnmock('@/data/audioCacheRepository');
  vi.doUnmock('@/data/settingsRepository');
  vi.doUnmock('@/audio/AudioEngine');
  vi.doUnmock('@/features/transport/transportController');
  vi.doUnmock('@/i18n/languagePreference');
  vi.resetModules();
});

/** A booted persistence service over stub storage, with the engine spied on. */
async function bootPersistence() {
  vi.resetModules();
  setMasterVolume.mockClear();
  setReverbMix.mockClear();

  vi.doMock('@/data/takeRepository', () => ({
    getTake: vi.fn(async () => null),
    saveTake: vi.fn(async () => 1),
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
  vi.doMock('@/data/settingsRepository', () => ({
    loadSettings: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => undefined),
  }));
  vi.doMock('@/audio/AudioEngine', () => ({
    audioEngine: {
      setMasterVolume,
      setReverbMix,
      setInstrument: vi.fn(async () => undefined),
      markInstrumentRestored: vi.fn(),
      activeInstrument: pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID),
    },
  }));
  vi.doMock('@/features/transport/transportController', () => ({
    transportController: {
      restorePlayhead: vi.fn(),
      onRecordingFinalized: new Set<() => void>(),
    },
  }));
  vi.doMock('@/i18n/languagePreference', () => ({
    applySystemLanguageIfUnpinned: vi.fn(async () => undefined),
  }));

  const [{ persistenceService }, { useSettingsStore }, { useTakeStore }] = await Promise.all([
    import('@/data/persistence'),
    import('@/state/useSettingsStore'),
    import('@/state/useTakeStore'),
  ]);
  await persistenceService.init();
  // Only what happens *after* boot is under test; init applies the stored
  // levels once by hand, before the subscription exists.
  setMasterVolume.mockClear();
  setReverbMix.mockClear();
  return { useSettingsStore, useTakeStore };
}

describe('settings-driven audio levels', () => {
  let stores: Awaited<ReturnType<typeof bootPersistence>>;

  beforeEach(async () => {
    stores = await bootPersistence();
  });

  it('follows a bare setState, the way restoring a backup writes the store', async () => {
    const { useSettingsStore, useTakeStore } = stores;

    // Exactly what restoreBackupFile does: the whole loaded row at once,
    // through setState rather than the setters.
    useSettingsStore.setState({ masterVolume: 0.2, reverbMix: 0.1 });

    expect(setMasterVolume).toHaveBeenCalledWith(0.2);
    expect(setReverbMix).toHaveBeenCalledWith(0.1);
    // The export renderer reads the levels off the take and the export cache
    // key hashes them, so a restore that moved the sliders has to move these.
    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: 0.2,
      reverbMix: 0.1,
    });
  });

  it('still reaches the engine through the store setters', async () => {
    const { useSettingsStore, useTakeStore } = stores;

    useSettingsStore.getState().setMasterVolume(0.4);
    useSettingsStore.getState().setReverbMix(0.3);

    expect(setMasterVolume).toHaveBeenLastCalledWith(0.4);
    expect(setReverbMix).toHaveBeenLastCalledWith(0.3);
    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: 0.4,
      reverbMix: 0.3,
    });
  });

  it('returns the engine and the take to the defaults on reset', async () => {
    const { useSettingsStore, useTakeStore } = stores;
    // Move the take off the defaults independently, so reset has to actively
    // pull it back rather than finding it already there.
    const { take, setInstrumentSettings } = useTakeStore.getState();
    setInstrumentSettings({ ...take.instrument, masterVolume: 0.4, reverbMix: 0.3 });
    useSettingsStore.setState({ masterVolume: 0.4, reverbMix: 0.3 });

    useSettingsStore.getState().resetSettings();

    expect(setMasterVolume).toHaveBeenLastCalledWith(DEFAULT_MASTER_VOLUME);
    expect(setReverbMix).toHaveBeenLastCalledWith(DEFAULT_REVERB_MIX);
    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: DEFAULT_MASTER_VOLUME,
      reverbMix: DEFAULT_REVERB_MIX,
    });
  });

  it('leaves the engine alone when an unrelated setting changes', async () => {
    const { useSettingsStore } = stores;

    useSettingsStore.getState().setShowNoteLabels(false);

    expect(setMasterVolume).not.toHaveBeenCalled();
    expect(setReverbMix).not.toHaveBeenCalled();
  });
});
