import type { SupportedLanguage } from '@/i18n/types';
import type { LearnChapterId } from '../types';
import type { ChapterProse } from './types';

/**
 * Lesson prose, per chapter and language.
 *
 * Long-form teaching text deliberately does not live in the `Messages`
 * catalog. Two reasons, both structural: `src/i18n/index.ts` imports all four
 * catalogs eagerly, so prose there would ship every locale's lesson text to
 * every user; and the parity test walks arrays by index, which would length-lock
 * every paragraph across all four locales and make an English-only chapter
 * impossible to ship.
 *
 * Chapter titles and blurbs — the browsable surface — stay in `Messages` and
 * are translated. Only the inside of a chapter falls back.
 */
const PROSE: Partial<
  Record<LearnChapterId, Partial<Record<SupportedLanguage, () => Promise<ChapterProse>>>>
> = {
  meetTheKeyboard: {
    en: () => import('./en/meetTheKeyboard').then((m) => m.meetTheKeyboardEn),
    // Other locales land here as they are written; until then this chapter
    // reads in English rather than not at all.
  },
  musicalAlphabet: {
    en: () => import('./en/musicalAlphabet').then((m) => m.musicalAlphabetEn),
  },
  halfStepsWholeSteps: {
    en: () => import('./en/halfStepsWholeSteps').then((m) => m.halfStepsWholeStepsEn),
  },
  trebleStaff: {
    en: () => import('./en/trebleStaff').then((m) => m.trebleStaffEn),
  },
  bassAndGrandStaff: {
    en: () => import('./en/bassAndGrandStaff').then((m) => m.bassAndGrandStaffEn),
  },
  rhythmAndBeat: {
    en: () => import('./en/rhythmAndBeat').then((m) => m.rhythmAndBeatEn),
  },
};

/**
 * The prose for a chapter, in the requested language where it exists.
 *
 * The spread merge gives per-*string* fallback rather than per-chapter: a
 * translation that has not caught up with a newly inserted step falls back to
 * English for that one step and stays translated everywhere else.
 */
export async function loadChapterProse(
  id: LearnChapterId,
  language: SupportedLanguage,
): Promise<ChapterProse> {
  const entry = PROSE[id];
  const english = (await entry?.en?.()) ?? {};
  const localized = language === 'en' ? undefined : entry?.[language];
  return localized ? { ...english, ...(await localized()) } : english;
}
