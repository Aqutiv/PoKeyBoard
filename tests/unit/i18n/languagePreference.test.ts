import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { getMetadata, META_LANGUAGE_EXPLICIT } from '@/data/metadataRepository';
import {
  applySystemLanguageIfUnpinned,
  isLanguageExplicit,
  pinLanguage,
  unpinLanguage,
} from '@/i18n/languagePreference';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

function stubLanguages(languages: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

beforeEach(async () => {
  await db.metadata.clear();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('language preference policy', () => {
  it('adopts the OS language when nothing is pinned', async () => {
    stubLanguages(['fr-FR']);
    await applySystemLanguageIfUnpinned();
    expect(useSettingsStore.getState().language).toBe('fr');
  });

  it('leaves the language untouched when the user has pinned one', async () => {
    stubLanguages(['fr-FR']);
    useSettingsStore.getState().setLanguage('es');
    await pinLanguage();
    await applySystemLanguageIfUnpinned();
    expect(useSettingsStore.getState().language).toBe('es');
  });

  it('keeps English when the OS language is unsupported', async () => {
    stubLanguages(['de-DE', 'ja']);
    await applySystemLanguageIfUnpinned();
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('pin then unpin re-adopts the OS language and clears the flag', async () => {
    stubLanguages(['es-ES']);
    useSettingsStore.getState().setLanguage('mg');
    await pinLanguage();
    expect(await isLanguageExplicit()).toBe(true);

    await unpinLanguage();
    expect(await getMetadata(META_LANGUAGE_EXPLICIT)).toBe(false);
    expect(useSettingsStore.getState().language).toBe('es');
  });
});
