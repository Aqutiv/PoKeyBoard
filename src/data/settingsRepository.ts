import { z } from 'zod';
import { SETTINGS_DEFAULTS, type SettingsState } from '@/state/useSettingsStore';
import { db } from './db';

type PersistableSettings = typeof SETTINGS_DEFAULTS;
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof PersistableSettings>;
const SETTING_SCHEMAS = {
  language: z.enum(['en', 'es', 'fr', 'mg']),
  theme: z.enum(['dark', 'light', 'system']),
  masterVolume: z.number().min(0).max(1),
  reverbMix: z.number().min(0).max(1),
  velocityMode: z.enum(['touch', 'fixed']),
  fixedVelocity: z.number().min(0.2).max(1),
  showNoteLabels: z.boolean(),
  scrubAudition: z.boolean(),
  metronomeVolume: z.number().min(0).max(1),
  displayQuantization: z.enum(['off', '1/8', '1/16']),
  keyboardAnchorMidi: z.number().int().min(21).max(108),
  sheetPaperSize: z.enum(['a4', 'letter']),
} satisfies Record<keyof PersistableSettings, z.ZodType>;

/** Load persisted settings, ignoring unknown keys and bad values. */
export async function loadSettings(): Promise<Partial<PersistableSettings>> {
  const rows = await db.settings.toArray();
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if ((SETTING_KEYS as string[]).includes(row.key)) {
      const key = row.key as keyof PersistableSettings;
      const result = SETTING_SCHEMAS[key].safeParse(row.value);
      if (result.success) out[row.key] = result.data;
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
  const entries = Object.entries(values).flatMap(([rawKey, value]) => {
    if (!(SETTING_KEYS as string[]).includes(rawKey)) return [];
    const key = rawKey as keyof PersistableSettings;
    const result = SETTING_SCHEMAS[key].safeParse(value);
    return result.success ? [{ key, value: result.data }] : [];
  });
  await db.settings.bulkPut(entries);
}
