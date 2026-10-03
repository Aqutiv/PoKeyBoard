import { en } from './en';
import type { Messages, SupportedLanguage } from './types';

export type { Messages, SupportedLanguage } from './types';
export {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  type ErrorMessageKey,
  type Repair,
  type RepairCode,
} from './types';

/**
 * Every catalog but English is fetched when it is first needed: a visitor reads
 * the app in one language, and the other three are ~120 KB of text that would
 * otherwise sit in the code every launch parses. English stays bundled — the
 * fallback, and what the app shows until another language has arrived.
 */
const LOADERS: Record<Exclude<SupportedLanguage, 'en'>, () => Promise<Messages>> = {
  es: () => import('./es').then((module) => module.es),
  fr: () => import('./fr').then((module) => module.fr),
  mg: () => import('./mg').then((module) => module.mg),
};

const loaded: Partial<Record<SupportedLanguage, Messages>> = { en };
const loading = new Map<SupportedLanguage, Promise<Messages>>();
const arrivalListeners = new Set<() => void>();
let arrivals = 0;

/** Hear each catalog arrive (for `useSyncExternalStore`, with `catalogArrivals`). */
export function subscribeCatalogs(listener: () => void): () => void {
  arrivalListeners.add(listener);
  return () => arrivalListeners.delete(listener);
}

/** How many catalogs have arrived so far: changes whenever one does. */
export function catalogArrivals(): number {
  return arrivals;
}

/** The catalog for `language` if it has arrived, else undefined. */
export function loadedCatalog(language: SupportedLanguage): Messages | undefined {
  return loaded[language];
}

/**
 * The catalog for `language`, fetched once and shared by every caller. A failed
 * fetch (offline before the chunk was ever cached) falls back to English and
 * may be tried again later.
 */
export function loadCatalog(language: SupportedLanguage): Promise<Messages> {
  const ready = loaded[language];
  if (ready) return Promise.resolve(ready);
  let pending = loading.get(language);
  if (!pending) {
    pending = LOADERS[language as Exclude<SupportedLanguage, 'en'>]()
      .then((messages) => {
        loaded[language] = messages;
        arrivals += 1;
        for (const listener of arrivalListeners) listener();
        return messages;
      })
      .catch((error: unknown) => {
        console.error(`Could not load the ${language} catalog:`, error);
        return en;
      })
      .finally(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

/** BCP-47 tags for `document.documentElement.lang` and Intl-based formatting. */
export const BCP47: Record<SupportedLanguage, string> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  mg: 'mg',
};

/** Dropdown options, in the order the app presents them. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: SupportedLanguage; label: string }> = [
  { value: 'en', label: en.languageNames.en },
  { value: 'es', label: en.languageNames.es },
  { value: 'fr', label: en.languageNames.fr },
  { value: 'mg', label: en.languageNames.mg },
];
