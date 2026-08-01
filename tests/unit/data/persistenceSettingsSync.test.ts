import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MASTER_VOLUME, DEFAULT_REVERB_MIX } from '@/domain/takeTypes';

/**
 * The mocks below are registered once for the whole file rather than around
 * every boot. Re-registering them per test used to leave a window the module
 * runner could slip through: vi.doMock/vi.doUnmock only *queue* the change and
 * each resolves its path over its own round trip, so a boot racing that queue
 * could be handed the real AudioEngine while the mock was still settling — the
 * settings subscription then pushed the levels into an engine the spy never
 * saw. vi.mock is hoisted above the imports and never torn down, and
 * vi.resetModules() leaves the mock registry alone, so each boot below still
 * gets fresh module state over these same stubs.
 */
const { setMasterVolume, setReverbMix } = vi.hoisted(() => ({
  setMasterVolume: vi.fn(),
  setReverbMix: vi.fn(),
}));

vi.mock('@/data/takeRepository', () => ({
  getTake: vi.fn(async () => null),
  saveTake: vi.fn(async () => 1),
}));
vi.mock('@/data/metadataRepository', () => ({
  META_LAST_OPEN_TAKE: 'lastOpenTakeId',
  META_PERSIST_REQUESTED: 'persistentStorageRequested',
  getMetadata: vi.fn(async () => undefined),
  setMetadata: vi.fn(async () => undefined),
}));
vi.mock('@/data/audioCacheRepository', () => ({
  invalidateCachedAudio: vi.fn(async () => undefined),
}));
vi.mock('@/data/settingsRepository', () => ({
  loadSettings: vi.fn(async () => ({})),
  saveSettings: vi.fn(async () => undefined),
}));
vi.mock('@/audio/AudioEngine', async () => {
  const { DEFAULT_PIANO_INSTRUMENT_ID, pianoInstrument } = await import('@/audio/instruments');
  return {
    audioEngine: {
      setMasterVolume,
      setReverbMix,
      setInstrument: vi.fn(async () => undefined),
      markInstrumentRestored: vi.fn(),
      activeInstrument: pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID),
    },
  };
});
vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    restorePlayhead: vi.fn(),
    onRecordingFinalized: new Set<() => void>(),
  },
}));
vi.mock('@/i18n/languagePreference', () => ({
  applySystemLanguageIfUnpinned: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.resetModules();
});

/** A booted persistence service over stub storage, with the engine spied on. */
async function bootPersistence() {
  vi.resetModules();
  setMasterVolume.mockClear();
  setReverbMix.mockClear();

  // Sequential, not Promise.all: persistence imports both stores itself, and
  // racing that against the direct imports gives the module runner a second
  // chance to evaluate something in the shared graph twice.
  const { persistenceService } = await import('@/data/persistence');
  const { useSettingsStore } = await import('@/state/useSettingsStore');
  const { useTakeStore } = await import('@/state/useTakeStore');
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

  /**
   * Opening a take points the engine at the levels that take was heard at, and
   * mirrors them into the settings store (see activatePrepared). These cover
   * what goes wrong when that mirror is not maintained: the subscription writes
   * both levels together, so a settings row that disagreed with the take would
   * drag the untouched one along with it — and a slider could not move to a
   * value the stale row already held, because that is not a change at all.
   */
  describe('with a take open at its own levels', () => {
    beforeEach(() => {
      const { useSettingsStore, useTakeStore } = stores;
      const { take, setInstrumentSettings } = useTakeStore.getState();
      setInstrumentSettings({ ...take.instrument, masterVolume: 0.3, reverbMix: 0.9 });
      useSettingsStore.setState({ masterVolume: 0.3, reverbMix: 0.9 });
      setMasterVolume.mockClear();
      setReverbMix.mockClear();
    });

    it('keeps the reverb the user did not touch when the volume moves', () => {
      const { useSettingsStore, useTakeStore } = stores;

      useSettingsStore.getState().setMasterVolume(0.35);

      expect(setMasterVolume).toHaveBeenLastCalledWith(0.35);
      expect(useTakeStore.getState().take.instrument).toMatchObject({
        masterVolume: 0.35,
        reverbMix: 0.9,
      });
    });

    it('keeps the volume the user did not touch when the reverb moves', () => {
      const { useSettingsStore, useTakeStore } = stores;

      useSettingsStore.getState().setReverbMix(0.4);

      expect(setReverbMix).toHaveBeenLastCalledWith(0.4);
      expect(useTakeStore.getState().take.instrument).toMatchObject({
        masterVolume: 0.3,
        reverbMix: 0.4,
      });
    });

    it('lets a level leave the take value and come back to it', () => {
      const { useSettingsStore, useTakeStore } = stores;

      useSettingsStore.getState().setMasterVolume(0.85);
      useSettingsStore.getState().setMasterVolume(0.3);

      expect(setMasterVolume).toHaveBeenLastCalledWith(0.3);
      expect(useTakeStore.getState().take.instrument.masterVolume).toBe(0.3);
    });
  });
});
