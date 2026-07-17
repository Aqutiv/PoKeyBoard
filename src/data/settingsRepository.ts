import { SETTINGS_DEFAULTS, type SettingsState } from '@/state/useSettingsStore';
import { db } from './db';

type PersistableSettings = typeof SETTINGS_DEFAULTS;
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof PersistableSettings>;

/** Load persisted settings, ignoring unknown keys and bad values. */
export async function loadSettings(): Promise<Partial<PersistableSettings>> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) {
      const defaultValue = SETTINGS_DEFAULTS[row.key as keyof PersistableSettings];
      if (typeof row.value === typeof defaultValue) {
        out[row.key] = row.value;
      }
    }
  }
  return out as Partial<PersistableSettings>;
}

export async function saveSettings(state: SettingsState): Promise<void> {
  await db.settings.bulkPut(SETTING_KEYS.map((key) => ({ key, value: state[key] })));
}

export async function getAllSettingsForBackup(): Promise<Record<string, unknown>> {
  const rows = await db.settings.toArray();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function restoreSettingsFromBackup(values: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(values).filter(([key]) =>
    (SETTING_KEYS as string[]).includes(key),
  );
  await db.settings.bulkPut(entries.map(([key, value]) => ({ key, value })));
}
