import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectPreferredLanguage } from '@/i18n/detectLanguage';

/** Override navigator.languages for one test; restored in afterEach. */
function stubLanguages(languages: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectPreferredLanguage', () => {
  it('matches a supported language on its primary subtag', () => {
    stubLanguages(['fr-CA']);
    expect(detectPreferredLanguage()).toBe('fr');
  });

  it('picks the first supported language in preference order', () => {
    stubLanguages(['de', 'es-ES', 'fr']);
    expect(detectPreferredLanguage()).toBe('es');
  });

  it('returns null when no preferred language is supported', () => {
    stubLanguages(['de', 'ja', 'zh-Hans']);
    expect(detectPreferredLanguage()).toBeNull();
  });

  it('falls back to navigator.language when languages is empty', () => {
    stubLanguages([]);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('mg-MG');
    expect(detectPreferredLanguage()).toBe('mg');
  });
});
