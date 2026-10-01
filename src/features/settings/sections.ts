/**
 * Settings sections, in switch order. This module must stay free of imports:
 * the settings store and its repository take the id type from here, and they
 * load with the app shell, long before the Settings page itself.
 */
export const SETTINGS_SECTION_IDS = ['sound', 'playing', 'display', 'app'] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'sound';
