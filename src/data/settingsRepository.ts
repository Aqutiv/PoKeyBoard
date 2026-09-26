import { z } from 'zod';
import { PIANO_INSTRUMENT_IDS } from '@/audio/instruments';
import { REVERB_ROOMS } from '@/domain/takeTypes';
import {
  MIDI_VELOCITY_CURVES,
  MIN_MIDI_RANGE_SPAN,
  TOUCH_SENSITIVITIES,
} from '@/features/keyboard/velocityResponse';
import { LEARN_LEVEL_IDS } from '@/features/learn/levels';
import { LIBRARY_FOLDER_IDS } from '@/features/library/folders';
import { PLAYBACK_MODES, RECORD_MODES } from '@/features/transport/modes';
import { SETTINGS_DEFAULTS, type SettingsState } from '@/state/useSettingsStore';
import { db } from './db';

type PersistableSettings = typeof SETTINGS_DEFAULTS;
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as Array<keyof PersistableSettings>;

/** A note-on velocity: 0 is a release, never a strike. */
const STRIKE_VELOCITY = z.number().int().min(1).max(127);

const SETTING_SCHEMAS = {
  language: z.enum(['en', 'es', 'fr', 'mg']),
  theme: z.enum(['dark', 'light', 'system']),
  pianoInstrument: z.enum(PIANO_INSTRUMENT_IDS),
  masterVolume: z.number().min(0).max(1),
  reverbMix: z.number().min(0).max(1),
  reverbRoom: z.enum(REVERB_ROOMS),
  velocityMode: z.enum(['touch', 'fixed']),
  fixedVelocity: z.number().min(0.2).max(1),
  touchSensitivity: z.enum(TOUCH_SENSITIVITIES),
  midiVelocityCurve: z.enum(MIDI_VELOCITY_CURVES),
  // The span calibration insists on, so a stored range it would have turned
  // down loads as uncalibrated rather than as one too narrow to stretch.
  midiVelocityRange: z
    .object({ min: STRIKE_VELOCITY, max: STRIKE_VELOCITY })
    .refine(({ min, max }) => max - min >= MIN_MIDI_RANGE_SPAN)
    .nullable(),
  showNoteLabels: z.boolean(),
  keyboardFollowsPlayback: z.boolean(),
  scrubAudition: z.boolean(),
  backgroundPlayback: z.boolean(),
  gamepadInput: z.boolean(),
  midiInput: z.boolean(),
  metronomeVolume: z.number().min(0).max(1),
  keyboardAnchorMidi: z.number().int().min(21).max(108),
  sheetPaperSize: z.enum(['a4', 'letter']),
  libraryFolder: z.enum(LIBRARY_FOLDER_IDS),
  learnLevel: z.enum(LEARN_LEVEL_IDS),
  recordMode: z.enum(RECORD_MODES),
  playbackMode: z.enum(PLAYBACK_MODES),
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
