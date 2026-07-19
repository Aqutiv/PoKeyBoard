import { beforeEach, describe, expect, it } from 'vitest';
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
    useSettingsStore.setState({ metronomeVolume: 0.25, showNoteLabels: false });
    await saveSettings(useSettingsStore.getState());
    const loaded = await loadSettings();
    expect(loaded.metronomeVolume).toBe(0.25);
    expect(loaded.showNoteLabels).toBe(false);
  });

  it('ignores unknown keys and wrong types on load', async () => {
    await db.settings.bulkPut([
      { key: 'notARealSetting', value: 123 },
      { key: 'metronomeVolume', value: 'loud' }, // wrong type
      { key: 'fixedVelocity', value: 0.5 },
      { key: 'masterVolume', value: 2 },
      { key: 'language', value: 'not-a-language' },
    ]);
    const loaded = await loadSettings();
    expect('notARealSetting' in loaded).toBe(false);
    expect(loaded.metronomeVolume).toBeUndefined();
    expect(loaded.fixedVelocity).toBe(0.5);
    expect(loaded.masterVolume).toBeUndefined();
    expect(loaded.language).toBeUndefined();
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
