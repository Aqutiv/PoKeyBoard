import { getMetadata, META_LANGUAGE_EXPLICIT, setMetadata } from '@/data/metadataRepository';
import { useSettingsStore } from '@/state/useSettingsStore';
import { detectPreferredLanguage } from './detectLanguage';

/**
 * Language policy: the default follows the OS-preferred language on every
 * launch, until the user explicitly picks one in Settings. The explicit pick
 * is recorded as a metadata flag so later launches — and OS language changes —
 * leave a chosen language alone. See [[detectPreferredLanguage]].
 */

/** Whether the user has pinned a language rather than following the OS. */
export function isLanguageExplicit(): Promise<boolean | undefined> {
  return getMetadata<boolean>(META_LANGUAGE_EXPLICIT);
}

/**
 * Adopt the OS-preferred language into the store unless the user has pinned
 * one. Called during startup, before autosave is wired, so the detected
 * language is applied for display without being persisted (an unpinned
 * language is re-derived from the OS on the next launch).
 */
export async function applySystemLanguageIfUnpinned(): Promise<void> {
  if (await isLanguageExplicit()) return;
  const detected = detectPreferredLanguage();
  if (detected) useSettingsStore.getState().setLanguage(detected);
}

/** Record an explicit choice so the language stops following the OS. */
export function pinLanguage(): Promise<void> {
  return setMetadata(META_LANGUAGE_EXPLICIT, true);
}

/** Drop the explicit choice and re-adopt the OS-preferred language. */
export async function unpinLanguage(): Promise<void> {
  await setMetadata(META_LANGUAGE_EXPLICIT, false);
  const detected = detectPreferredLanguage();
  if (detected) useSettingsStore.getState().setLanguage(detected);
}
