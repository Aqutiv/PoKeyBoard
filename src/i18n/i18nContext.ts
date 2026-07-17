import { createContext, useContext } from 'react';
import type { Messages, SupportedLanguage } from './types';

export interface I18nValue {
  language: SupportedLanguage;
  /** BCP-47 tag for Intl formatting (dates, numbers). */
  locale: string;
  m: Messages;
}

export const I18nContext = createContext<I18nValue | null>(null);

/** Full i18n context: active language, its BCP-47 locale, and the catalog. */
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

/** Convenience hook returning just the active message catalog. */
export function useMessages(): Messages {
  return useI18n().m;
}
