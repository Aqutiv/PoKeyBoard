import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useSettingsStore } from '@/state/useSettingsStore';
import { BCP47, catalogArrivals, loadCatalog, loadedCatalog, subscribeCatalogs } from './index';
import { DEFAULT_LANGUAGE, isSupportedLanguage, type SupportedLanguage } from './types';
import { I18nContext, type I18nValue } from './i18nContext';

/**
 * Supplies the active message catalog to the tree. The language is read from
 * the persisted settings store, so it re-renders when persistence rehydrates
 * the saved choice one tick after first paint. Also mirrors the language onto
 * `document.documentElement.lang` for assistive tech and native form controls.
 *
 * A catalog other than English is fetched on first use (`loadCatalog`). Startup
 * waits for the saved one before the app shows, so a switch in Settings is the
 * only time one is still on its way — and then the page stays in the language
 * it was in until the new one has arrived, a moment later, rather than
 * flickering through English.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const rawLanguage = useSettingsStore((s) => s.language);
  const wanted = isSupportedLanguage(rawLanguage) ? rawLanguage : DEFAULT_LANGUAGE;
  // Re-render as catalogs arrive.
  useSyncExternalStore(subscribeCatalogs, catalogArrivals);
  // The language last shown, which a switch still loading keeps showing.
  const [shown, setShown] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
  const ready = loadedCatalog(wanted) !== undefined;
  if (ready && shown !== wanted) setShown(wanted);
  const language = ready ? wanted : shown;

  useEffect(() => {
    if (!loadedCatalog(wanted)) void loadCatalog(wanted);
  }, [wanted]);

  useEffect(() => {
    document.documentElement.lang = BCP47[language];
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({ language, locale: BCP47[language], m: loadedCatalog(language)! }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
