import { beforeEach, describe, expect, it } from 'vitest';
import { PIANO_INSTRUMENT_IDS } from '@/audio/instruments';
import { db } from '@/data/db';
import { META_LAST_OPEN_TAKE, setMetadata } from '@/data/metadataRepository';
import { loadSettings, restoreSettingsFromBackup, saveSettings } from '@/data/settingsRepository';
import { saveTake } from '@/data/takeRepository';
import { createEmptyTake } from '@/domain/noteEvents';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

beforeEach(async () => {
  await db.takes.clear();
  await db.settings.clear();
  await db.metadata.clear();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});

describe('settingsRepository', () => {
  it('round-trips settings', async () => {
    useSettingsStore.setState({
      metronomeVolume: 0.25,
      showNoteLabels: false,
      pianoInstrument: 'headroom-grand',
      backgroundPlayback: true,
    });
    await saveSettings(useSettingsStore.getState());
    const loaded = await loadSettings();
    expect(loaded.metronomeVolume).toBe(0.25);
    expect(loaded.showNoteLabels).toBe(false);
    expect(loaded.pianoInstrument).toBe('headroom-grand');
    expect(loaded.backgroundPlayback).toBe(true);
  });

  it('keeps every piano the app offers as it was chosen, Headroom and the Steinway alike', async () => {
    for (const pianoInstrument of PIANO_INSTRUMENT_IDS) {
      await db.settings.put({ key: 'pianoInstrument', value: pianoInstrument });
      expect((await loadSettings()).pianoInstrument).toBe(pianoInstrument);
      await restoreSettingsFromBackup({ pianoInstrument });
      expect((await loadSettings()).pianoInstrument).toBe(pianoInstrument);
    }
    expect(PIANO_INSTRUMENT_IDS).toContain('headroom-grand');
    expect(PIANO_INSTRUMENT_IDS).toContain('bitklavier-grand');
  });

  it('ignores unknown keys and wrong types on load', async () => {
    await db.settings.bulkPut([
      { key: 'notARealSetting', value: 123 },
      { key: 'metronomeVolume', value: 'loud' }, // wrong type
      { key: 'fixedVelocity', value: 0.5 },
      { key: 'masterVolume', value: 2 },
      { key: 'language', value: 'not-a-language' },
      // A piano that no longer ships must not leave the app fetching a dead pack.
      { key: 'pianoInstrument', value: 'bosendorfer-280' },
    ]);
    const loaded = await loadSettings();
    expect('notARealSetting' in loaded).toBe(false);
    expect(loaded.metronomeVolume).toBeUndefined();
    expect(loaded.fixedVelocity).toBe(0.5);
    expect(loaded.masterVolume).toBeUndefined();
    expect(loaded.language).toBeUndefined();
    expect(loaded.pianoInstrument).toBeUndefined();
  });

  it('keeps the reverb room, Room unless one was chosen, and drops one that does not exist', async () => {
    expect(SETTINGS_DEFAULTS.reverbRoom).toBe('room');
    // Stored right after the mix it goes with.
    const keys = Object.keys(SETTINGS_DEFAULTS);
    expect(keys.indexOf('reverbRoom')).toBe(keys.indexOf('reverbMix') + 1);

    useSettingsStore.getState().setReverbRoom('cathedral');
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).reverbRoom).toBe('cathedral');

    await db.settings.put({ key: 'reverbRoom', value: 'bathroom' });
    expect((await loadSettings()).reverbRoom).toBeUndefined();
    await restoreSettingsFromBackup({ reverbRoom: 'hall' });
    expect((await loadSettings()).reverbRoom).toBe('hall');
  });

  it('remembers the Settings section, Sound until another is shown, and keeps it through Reset', async () => {
    expect(SETTINGS_DEFAULTS.settingsSection).toBe('sound');
    // Stored beside its peers, the library folder and the Learn level.
    const keys = Object.keys(SETTINGS_DEFAULTS);
    expect(keys.indexOf('settingsSection')).toBe(keys.indexOf('learnLevel') + 1);

    useSettingsStore.getState().setSettingsSection('app');
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).settingsSection).toBe('app');

    await db.settings.put({ key: 'settingsSection', value: 'piano' });
    expect((await loadSettings()).settingsSection).toBeUndefined();
    await restoreSettingsFromBackup({ settingsSection: 'display' });
    expect((await loadSettings()).settingsSection).toBe('display');

    // Reset is pressed on App: everything else goes back, and the page stays.
    useSettingsStore.setState({ settingsSection: 'app', learnLevel: 'advanced', theme: 'light' });
    useSettingsStore.getState().resetSettings();
    expect(useSettingsStore.getState()).toMatchObject({
      settingsSection: 'app',
      learnLevel: 'beginner',
      theme: 'dark',
    });
  });

  it('remembers the audio export’s choices, MP3 at 128 kbps and Even until one is made', async () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({
      audioExportFormat: 'mp3',
      audioExportMp3Kbps: 128,
      audioExportFlacBits: 16,
      audioExportLoudness: 'normalized',
    });
    const settings = useSettingsStore.getState();
    settings.setAudioExportFormat('flac');
    settings.setAudioExportMp3Kbps(192);
    settings.setAudioExportFlacBits(24);
    settings.setAudioExportLoudness('asPlayed');
    await saveSettings(useSettingsStore.getState());
    expect(await loadSettings()).toMatchObject({
      audioExportFormat: 'flac',
      audioExportMp3Kbps: 192,
      audioExportFlacBits: 24,
      audioExportLoudness: 'asPlayed',
    });

    // A format, rate, depth or level the export does not offer loads as the default.
    await db.settings.bulkPut([
      { key: 'audioExportFormat', value: 'wav' },
      { key: 'audioExportMp3Kbps', value: 320 },
      { key: 'audioExportFlacBits', value: '24' },
      { key: 'audioExportLoudness', value: 'loud' },
    ]);
    const loaded = await loadSettings();
    expect(loaded.audioExportFormat).toBeUndefined();
    expect(loaded.audioExportMp3Kbps).toBeUndefined();
    expect(loaded.audioExportFlacBits).toBeUndefined();
    expect(loaded.audioExportLoudness).toBeUndefined();

    await restoreSettingsFromBackup({ audioExportFormat: 'flac', audioExportFlacBits: 24 });
    expect(await loadSettings()).toMatchObject({
      audioExportFormat: 'flac',
      audioExportFlacBits: 24,
    });
  });

  it('keeps Tone follows touch, on unless it was switched off, and drops a value that is not one', async () => {
    expect(SETTINGS_DEFAULTS.toneFollowsTouch).toBe(true);

    useSettingsStore.getState().setToneFollowsTouch(false);
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).toneFollowsTouch).toBe(false);

    // Anything else loads as nothing, so the default stands: the tone on.
    await db.settings.put({ key: 'toneFollowsTouch', value: 'no' });
    expect((await loadSettings()).toneFollowsTouch).toBeUndefined();
    await restoreSettingsFromBackup({ toneFollowsTouch: false });
    expect((await loadSettings()).toneFollowsTouch).toBe(false);
  });

  it('keeps velocity shading on keys, on unless it was switched off, and drops a value that is not one', async () => {
    expect(SETTINGS_DEFAULTS.velocityShading).toBe(true);

    useSettingsStore.getState().setVelocityShading(false);
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).velocityShading).toBe(false);

    // Anything else loads as nothing, so the default stands: the shading on.
    await db.settings.put({ key: 'velocityShading', value: 'no' });
    expect((await loadSettings()).velocityShading).toBeUndefined();
    await restoreSettingsFromBackup({ velocityShading: false });
    expect((await loadSettings()).velocityShading).toBe(false);
  });

  it('keeps finger numbers off until they are switched on, beside the note names', async () => {
    expect(SETTINGS_DEFAULTS.showFingerNumbers).toBe(false);
    const keys = Object.keys(SETTINGS_DEFAULTS);
    expect(keys.indexOf('showFingerNumbers')).toBe(keys.indexOf('showNoteLabels') + 1);

    useSettingsStore.getState().setShowFingerNumbers(true);
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).showFingerNumbers).toBe(true);

    // Anything else loads as nothing, so the default stands: no numbers.
    await db.settings.put({ key: 'showFingerNumbers', value: 'yes' });
    expect((await loadSettings()).showFingerNumbers).toBeUndefined();
    await restoreSettingsFromBackup({ showFingerNumbers: true });
    expect((await loadSettings()).showFingerNumbers).toBe(true);
  });

  it('remembers the Play page’s view, the score until the falling notes are chosen', async () => {
    expect(SETTINGS_DEFAULTS.playView).toBe('score');

    useSettingsStore.getState().setPlayView('waterfall');
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).playView).toBe('waterfall');

    // A view the page does not have loads as nothing, so the score stands.
    await db.settings.put({ key: 'playView', value: 'pianoRoll' });
    expect((await loadSettings()).playView).toBeUndefined();
    await restoreSettingsFromBackup({ playView: 'waterfall' });
    expect((await loadSettings()).playView).toBe('waterfall');
  });

  it('remembers how fast the notes fall, three seconds until changed', async () => {
    expect(SETTINGS_DEFAULTS.waterfallSeconds).toBe(3);

    useSettingsStore.getState().setWaterfallSeconds(1.5);
    await saveSettings(useSettingsStore.getState());
    expect((await loadSettings()).waterfallSeconds).toBe(1.5);

    // A time between the steps loads as nothing, so the default stands.
    await db.settings.put({ key: 'waterfallSeconds', value: 7 });
    expect((await loadSettings()).waterfallSeconds).toBeUndefined();
    await restoreSettingsFromBackup({ waterfallSeconds: 8 });
    expect((await loadSettings()).waterfallSeconds).toBe(8);
  });

  it('restores only known keys from a backup blob', async () => {
    await restoreSettingsFromBackup({ fixedVelocity: 0.9, metronomeVolume: -1, evil: 'x' });
    const loaded = await loadSettings();
    expect(loaded.fixedVelocity).toBe(0.9);
    expect(Object.keys(loaded)).not.toContain('evil');
    expect(loaded.metronomeVolume).toBeUndefined();
  });
});

describe('restore metadata', () => {
  it('stores and recalls the last open take id', async () => {
    const take = createEmptyTake({ title: 'Restore me' });
    await saveTake(take);
    await setMetadata(META_LAST_OPEN_TAKE, take.id);
    const row = await db.metadata.get(META_LAST_OPEN_TAKE);
    expect(row?.value).toBe(take.id);
  });
});
