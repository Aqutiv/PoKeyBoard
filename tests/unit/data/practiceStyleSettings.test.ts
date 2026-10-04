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

describe('practice style setting', () => {
  it('waits for the player until Keep time is chosen, stored beside the playback mode', () => {
    expect(SETTINGS_DEFAULTS.practiceStyle).toBe('wait');
    const keys = Object.keys(SETTINGS_DEFAULTS);
    expect(keys.indexOf('practiceStyle')).toBe(keys.indexOf('playbackMode') + 1);
  });

  it('round-trips through the settings repository', async () => {
    useSettingsStore.getState().setPracticeStyle('playAlong');
    await saveSettings(useSettingsStore.getState());

    expect((await launch()).practiceStyle).toBe('playAlong');
  });

  it('drops a style that does not exist, so Wait for me stands', async () => {
    await db.settings.put({ key: 'practiceStyle', value: 'keepTime' });

    expect(await loadSettings()).not.toHaveProperty('practiceStyle');
    expect((await launch()).practiceStyle).toBe('wait');

    // A restored backup is held to the same rule, its good rows kept.
    await restoreSettingsFromBackup({ practiceStyle: 'freestyle', playbackMode: 'training-left' });
    const loaded = await loadSettings();
    expect(loaded).not.toHaveProperty('practiceStyle');
    expect(loaded.playbackMode).toBe('training-left');
  });

  it('goes back to Wait for me on Reset', () => {
    useSettingsStore.getState().setPracticeStyle('playAlong');
    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().practiceStyle).toBe('wait');
  });

  it('keeps a Keep time playback mode, as it keeps a training one', async () => {
    useSettingsStore.getState().setPlaybackMode('playalong-both');
    await saveSettings(useSettingsStore.getState());
    expect((await launch()).playbackMode).toBe('playalong-both');

    await restoreSettingsFromBackup({ playbackMode: 'playalong-left' });
    expect((await loadSettings()).playbackMode).toBe('playalong-left');
  });
});
