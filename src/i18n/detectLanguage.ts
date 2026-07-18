import { isSupportedLanguage, type SupportedLanguage } from './types';

/**
 * The first OS/browser-preferred language PoKeyBoard can display, matched on
 * the primary subtag so regional tags collapse to their base ('fr-CA' → 'fr').
 * Returns null when none of the user's preferred languages has a catalog, in
 * which case callers keep the app default (English).
 */
export function detectPreferredLanguage(): SupportedLanguage | null {
  if (typeof navigator === 'undefined') return null;
  const preferences =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  for (const tag of preferences) {
    const primary = tag?.toLowerCase().split('-')[0];
    if (isSupportedLanguage(primary)) return primary;
  }
  return null;
}
