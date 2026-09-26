import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  DEFAULT_REVERB_ROOM,
  type Take,
} from '@/domain/takeTypes';

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
const {
  setMasterVolume,
  setReverbMix,
  setReverbRoom,
  invalidateCachedAudio,
  getTake,
  getMetadata,
  loadSettings,
} = vi.hoisted(() => ({
  setMasterVolume: vi.fn(),
  setReverbMix: vi.fn(),
  setReverbRoom: vi.fn(),
  invalidateCachedAudio: vi.fn<(takeId: string) => Promise<void>>(async () => undefined),
  getTake: vi.fn<(id: string) => Promise<Take | null>>(async () => null),
  getMetadata: vi.fn<(key: string) => Promise<unknown>>(async () => undefined),
  loadSettings: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({})),
}));

vi.mock('@/data/takeRepository', () => ({
  getTake,
  saveTake: vi.fn(async () => 1),
}));
vi.mock('@/data/metadataRepository', () => ({
  META_LAST_OPEN_TAKE: 'lastOpenTakeId',
  META_PERSIST_REQUESTED: 'persistentStorageRequested',
  getMetadata,
  setMetadata: vi.fn(async () => undefined),
}));
vi.mock('@/data/audioCacheRepository', () => ({ invalidateCachedAudio }));
vi.mock('@/data/settingsRepository', () => ({
  loadSettings,
  saveSettings: vi.fn(async () => undefined),
}));
vi.mock('@/audio/AudioEngine', async () => {
  const { DEFAULT_PIANO_INSTRUMENT_ID, pianoInstrument } = await import('@/audio/instruments');
  return {
    audioEngine: {
      setMasterVolume,
      setReverbMix,
      setReverbRoom,
      setInstrument: vi.fn(async () => undefined),
      markInstrumentRestored: vi.fn(),
      subscribeSwitch: vi.fn(() => () => undefined),
      getSwitchState: vi.fn(() => ({ pending: null, failed: null })),
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

/** A persistence service booted over stub storage, with the engine spied on. */
async function launch() {
  vi.resetModules();
  setMasterVolume.mockClear();
  setReverbMix.mockClear();
  setReverbRoom.mockClear();

  // Sequential, not Promise.all: persistence imports both stores itself, and
  // racing that against the direct imports gives the module runner a second
  // chance to evaluate something in the shared graph twice.
  const { persistenceService } = await import('@/data/persistence');
  const { useSettingsStore } = await import('@/state/useSettingsStore');
  const { useTakeStore } = await import('@/state/useTakeStore');
  await persistenceService.init();
  return { persistenceService, useSettingsStore, useTakeStore };
}

/** As `launch`, with the engine's record wiped: only what happens after boot. */
async function bootPersistence() {
  const stores = await launch();
  // Init applies the stored levels once by hand, before the subscription exists.
  setMasterVolume.mockClear();
  setReverbMix.mockClear();
  setReverbRoom.mockClear();
  return stores;
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
    useSettingsStore.setState({ masterVolume: 0.2, reverbMix: 0.1, reverbRoom: 'hall' });

    expect(setMasterVolume).toHaveBeenCalledWith(0.2);
    expect(setReverbMix).toHaveBeenCalledWith(0.1);
    expect(setReverbRoom).toHaveBeenCalledWith('hall');
    // The take keeps its own copy of the levels — opening it restores them,
    // and the export renders its reverb — so a restore that moved the sliders
    // has to move these.
    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: 0.2,
      reverbMix: 0.1,
      reverbRoom: 'hall',
    });
  });

  it('still reaches the engine through the store setters', async () => {
    const { useSettingsStore, useTakeStore } = stores;

    useSettingsStore.getState().setMasterVolume(0.4);
    useSettingsStore.getState().setReverbMix(0.3);
    useSettingsStore.getState().setReverbRoom('cathedral');

    expect(setMasterVolume).toHaveBeenLastCalledWith(0.4);
    expect(setReverbMix).toHaveBeenLastCalledWith(0.3);
    expect(setReverbRoom).toHaveBeenLastCalledWith('cathedral');
    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: 0.4,
      reverbMix: 0.3,
      reverbRoom: 'cathedral',
    });
  });

  it('returns the engine and the take to the defaults on reset', async () => {
    const { useSettingsStore, useTakeStore } = stores;
    // Move the take off the defaults independently, so reset has to actively
    // pull it back rather than finding it already there.
    const { take, setInstrumentSettings } = useTakeStore.getState();
    setInstrumentSettings({
      ...take.instrument,
      masterVolume: 0.4,
      reverbMix: 0.3,
      reverbRoom: 'studio',
    });
    useSettingsStore.setState({ masterVolume: 0.4, reverbMix: 0.3, reverbRoom: 'studio' });

    useSettingsStore.getState().resetSettings();

    expect(setMasterVolume).toHaveBeenLastCalledWith(DEFAULT_MASTER_VOLUME);
    expect(setReverbMix).toHaveBeenLastCalledWith(DEFAULT_REVERB_MIX);
    expect(setReverbRoom).toHaveBeenLastCalledWith(DEFAULT_REVERB_ROOM);
    expect(useTakeStore.getState().take.instrument).toMatchObject({
      masterVolume: DEFAULT_MASTER_VOLUME,
      reverbMix: DEFAULT_REVERB_MIX,
      reverbRoom: DEFAULT_REVERB_ROOM,
    });
  });

  it('leaves the engine alone when an unrelated setting changes', async () => {
    const { useSettingsStore } = stores;

    useSettingsStore.getState().setShowNoteLabels(false);

    expect(setMasterVolume).not.toHaveBeenCalled();
    expect(setReverbMix).not.toHaveBeenCalled();
    expect(setReverbRoom).not.toHaveBeenCalled();
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
      setInstrumentSettings({
        ...take.instrument,
        masterVolume: 0.3,
        reverbMix: 0.9,
        reverbRoom: 'hall',
      });
      useSettingsStore.setState({ masterVolume: 0.3, reverbMix: 0.9, reverbRoom: 'hall' });
      setMasterVolume.mockClear();
      setReverbMix.mockClear();
      setReverbRoom.mockClear();
    });

    it('keeps both levels the user did not touch when the room changes', () => {
      const { useSettingsStore, useTakeStore } = stores;

      useSettingsStore.getState().setReverbRoom('studio');

      expect(setReverbRoom).toHaveBeenLastCalledWith('studio');
      expect(useTakeStore.getState().take.instrument).toMatchObject({
        masterVolume: 0.3,
        reverbMix: 0.9,
        reverbRoom: 'studio',
      });
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

    it('keeps the cached export through a volume change, which the export never hears', async () => {
      const { persistenceService, useSettingsStore, useTakeStore } = stores;
      // Saved as it stands, so each save below is measured against that.
      await persistenceService.flushSave();
      invalidateCachedAudio.mockClear();

      useSettingsStore.getState().setMasterVolume(0.35);
      await persistenceService.flushSave();
      // Saved with the take, so opening it again restores the level...
      expect(useTakeStore.getState().dirty).toBe(false);
      // ...but the audio it would render has not changed.
      expect(invalidateCachedAudio).not.toHaveBeenCalled();

      useSettingsStore.getState().setReverbMix(0.4);
      await persistenceService.flushSave();
      expect(invalidateCachedAudio).toHaveBeenCalledWith(useTakeStore.getState().take.id);
    });

    it('drops the cached export when the room changes, which the export renders', async () => {
      const { persistenceService, useSettingsStore, useTakeStore } = stores;
      await persistenceService.flushSave();
      invalidateCachedAudio.mockClear();

      useSettingsStore.getState().setReverbRoom('cathedral');
      await persistenceService.flushSave();
      expect(invalidateCachedAudio).toHaveBeenCalledWith(useTakeStore.getState().take.id);
    });
  });
});

describe('the reverb room at launch', () => {
  it('plays the stored room, and a new take starts in it', async () => {
    loadSettings.mockResolvedValueOnce({ reverbRoom: 'cathedral' });

    const { useSettingsStore, useTakeStore } = await launch();

    expect(setReverbRoom).toHaveBeenLastCalledWith('cathedral');
    expect(useSettingsStore.getState().reverbRoom).toBe('cathedral');
    expect(useTakeStore.getState().take.instrument.reverbRoom).toBe('cathedral');
  });

  it('plays the room of the take it reopens, whatever the settings row says', async () => {
    const take = createEmptyTake({
      title: 'In the hall',
      instrument: { id: 'grand-piano', masterVolume: 0.5, reverbMix: 0.3, reverbRoom: 'hall' },
    });
    loadSettings.mockResolvedValueOnce({ reverbRoom: 'studio' });
    getMetadata.mockResolvedValueOnce(take.id);
    getTake.mockResolvedValueOnce(take);

    const { useSettingsStore, useTakeStore } = await launch();

    expect(useTakeStore.getState().take.id).toBe(take.id);
    expect(setReverbRoom).toHaveBeenLastCalledWith('hall');
    expect(useSettingsStore.getState().reverbRoom).toBe('hall');
    // Opening it is not an edit to it.
    expect(useTakeStore.getState().dirty).toBe(false);
  });

  it('reopens a take from before rooms in Room', async () => {
    const take = createEmptyTake({
      title: 'Before rooms',
      instrument: { id: 'grand-piano', masterVolume: 0.5, reverbMix: 0.3 },
    });
    loadSettings.mockResolvedValueOnce({ reverbRoom: 'cathedral' });
    getMetadata.mockResolvedValueOnce(take.id);
    getTake.mockResolvedValueOnce(take);

    const { useSettingsStore, useTakeStore } = await launch();

    expect(setReverbRoom).toHaveBeenLastCalledWith('room');
    expect(useSettingsStore.getState().reverbRoom).toBe('room');
    expect(useTakeStore.getState().take.instrument).not.toHaveProperty('reverbRoom');
    expect(useTakeStore.getState().dirty).toBe(false);
  });
});
