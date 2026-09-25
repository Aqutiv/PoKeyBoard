import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { loadSettings, restoreSettingsFromBackup, saveSettings } from '@/data/settingsRepository';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

beforeEach(async () => {
  await db.settings.clear();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});

/** What startup does with the stored rows: lay them over the defaults. */
async function launch() {
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  useSettingsStore.setState(await loadSettings());
  return useSettingsStore.getState();
}

describe('velocity response settings', () => {
  it('default to how every input has always played', () => {
    expect(SETTINGS_DEFAULTS.touchSensitivity).toBe('normal');
    expect(SETTINGS_DEFAULTS.midiVelocityCurve).toBe('normal');
    expect(SETTINGS_DEFAULTS.midiVelocityRange).toBeNull();
  });

  it('round-trip through the settings repository', async () => {
    const store = useSettingsStore.getState();
    store.setTouchSensitivity('firm');
    store.setMidiVelocityCurve('heavy');
    store.setMidiVelocityRange({ min: 12, max: 110 });
    await saveSettings(useSettingsStore.getState());

    const loaded = await launch();

    expect(loaded.touchSensitivity).toBe('firm');
    expect(loaded.midiVelocityCurve).toBe('heavy');
    expect(loaded.midiVelocityRange).toEqual({ min: 12, max: 110 });
  });

  it('keep an uncalibrated keyboard uncalibrated', async () => {
    useSettingsStore.getState().setMidiVelocityRange({ min: 12, max: 110 });
    useSettingsStore.getState().setMidiVelocityRange(null);
    await saveSettings(useSettingsStore.getState());

    expect(await loadSettings()).toHaveProperty('midiVelocityRange', null);
  });

  it('accept a calibrated span of exactly the minimum, at either end of the range', async () => {
    await db.settings.put({ key: 'midiVelocityRange', value: { min: 1, max: 17 } });
    expect((await launch()).midiVelocityRange).toEqual({ min: 1, max: 17 });

    await db.settings.put({ key: 'midiVelocityRange', value: { min: 111, max: 127 } });
    expect((await launch()).midiVelocityRange).toEqual({ min: 111, max: 127 });
  });

  it('drop a sensitivity or curve that does not exist', async () => {
    await db.settings.bulkPut([
      { key: 'touchSensitivity', value: 'feather' },
      { key: 'midiVelocityCurve', value: 'firm' }, // a touch sensitivity, not a curve
    ]);

    const loaded = await loadSettings();

    expect(loaded.touchSensitivity).toBeUndefined();
    expect(loaded.midiVelocityCurve).toBeUndefined();
    const launched = await launch();
    expect(launched.touchSensitivity).toBe('normal');
    expect(launched.midiVelocityCurve).toBe('normal');
  });

  it.each([
    ['a span under the minimum', { min: 40, max: 55 }],
    ['a loudest below the softest', { min: 100, max: 20 }],
    ['a velocity of 0', { min: 0, max: 64 }],
    ['a velocity above 127', { min: 10, max: 128 }],
    ['a fractional velocity', { min: 10.5, max: 60 }],
    ['a missing end', { min: 10 }],
    ['a bare number', 64],
    ['a string', '10-100'],
  ])('load %s as an uncalibrated range', async (_, value) => {
    await db.settings.put({ key: 'midiVelocityRange', value });

    expect(await loadSettings()).not.toHaveProperty('midiVelocityRange');
    expect((await launch()).midiVelocityRange).toBeNull();
  });

  it('skip an invalid range in a restored backup', async () => {
    await restoreSettingsFromBackup({
      midiVelocityRange: { min: 40, max: 50 },
      midiVelocityCurve: 'light',
    });

    const loaded = await loadSettings();

    expect(loaded).not.toHaveProperty('midiVelocityRange');
    expect(loaded.midiVelocityCurve).toBe('light');
  });
});
