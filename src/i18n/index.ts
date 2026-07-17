import { en } from './en';
import { es } from './es';
import { fr } from './fr';
import { mg } from './mg';
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

export const catalogs: Record<SupportedLanguage, Messages> = { en, es, fr, mg };

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
