import { useEffect, useMemo, type ReactNode } from 'react';
import { useSettingsStore } from '@/state/useSettingsStore';
import { BCP47, catalogs } from './index';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from './types';
import { I18nContext, type I18nValue } from './i18nContext';

/**
 * Supplies the active message catalog to the tree. The language is read from
 * the persisted settings store, so it re-renders when persistence rehydrates
 * the saved choice one tick after first paint. Also mirrors the language onto
 * `document.documentElement.lang` for assistive tech and native form controls.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const rawLanguage = useSettingsStore((s) => s.language);
  const language = isSupportedLanguage(rawLanguage) ? rawLanguage : DEFAULT_LANGUAGE;

  useEffect(() => {
    document.documentElement.lang = BCP47[language];
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({ language, locale: BCP47[language], m: catalogs[language] }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
