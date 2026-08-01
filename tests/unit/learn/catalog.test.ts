import { describe, expect, it } from 'vitest';
import { MEET_THE_KEYBOARD } from '@/features/learn/chapters/meetTheKeyboard';
import {
  findLearnChapter,
  LEARN_CHAPTERS,
  LEARN_CHAPTERS_BY_LEVEL,
} from '@/features/learn/chapters';
import { loadChapterProse } from '@/features/learn/content';
import { goalTotal } from '@/features/learn/exerciseSpec';
import { LEARN_LEVEL_IDS } from '@/features/learn/levels';
import { catalogs } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/types';

describe('learn catalog', () => {
  it('ships nineteen chapters split ten beginner and nine advanced', () => {
    expect(LEARN_CHAPTERS).toHaveLength(19);
    expect(LEARN_CHAPTERS_BY_LEVEL.beginner).toHaveLength(10);
    expect(LEARN_CHAPTERS_BY_LEVEL.advanced).toHaveLength(9);
  });

  it('numbers each level contiguously from one', () => {
    for (const level of LEARN_LEVEL_IDS) {
      const orders = LEARN_CHAPTERS_BY_LEVEL[level].map((chapter) => chapter.order);
      expect(orders).toEqual(orders.map((_, index) => index + 1));
    }
  });

  it('uses a unique id per chapter', () => {
    const ids = LEARN_CHAPTERS.map((chapter) => chapter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('titles and blurbs every chapter in every locale', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const { chapterTitles, chapterBlurbs } = catalogs[language].learn;
      for (const chapter of LEARN_CHAPTERS) {
        expect(chapterTitles[chapter.id], `${language}/${chapter.id} title`).toBeTruthy();
        expect(chapterBlurbs[chapter.id], `${language}/${chapter.id} blurb`).toBeTruthy();
      }
    }
  });

  it('marks only the authored chapter as playable', () => {
    const playable = LEARN_CHAPTERS.filter((chapter) => chapter.load !== null);
    expect(playable.map((chapter) => chapter.id)).toEqual(['meetTheKeyboard']);
  });

  it('finds a chapter by id', () => {
    expect(findLearnChapter('meetTheKeyboard')?.order).toBe(1);
    expect(findLearnChapter('improvising')?.level).toBe('advanced');
  });
});

describe('chapter one', () => {
  it('alternates theory and exercises across eleven steps', () => {
    expect(MEET_THE_KEYBOARD.steps).toHaveLength(11);
    expect(MEET_THE_KEYBOARD.steps.filter((step) => step.kind === 'exercise')).toHaveLength(6);
  });

  it('gives every step a unique id', () => {
    const ids = MEET_THE_KEYBOARD.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of MEET_THE_KEYBOARD.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('lets a mouse finish every simultaneity exercise', () => {
    // A mouse is one pointer and cannot hold two keys, so anything asking for
    // notes at once must also accept a fast roll.
    for (const step of MEET_THE_KEYBOARD.steps) {
      if (step.kind !== 'exercise') continue;
      const { spec } = step;
      if (spec.kind !== 'interval' && spec.kind !== 'blackKeyGroup' && spec.kind !== 'exactKeys') {
        continue;
      }
      expect(spec.together?.onsetWindowMs, step.id).toBeGreaterThan(0);
    }
  });

  it('writes English prose with a prompt for every exercise', async () => {
    const prose = await loadChapterProse('meetTheKeyboard', 'en');
    for (const step of MEET_THE_KEYBOARD.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });

  it('falls back to English for a locale with no translation yet', async () => {
    const french = await loadChapterProse('meetTheKeyboard', 'fr');
    const english = await loadChapterProse('meetTheKeyboard', 'en');
    expect(Object.keys(french)).toEqual(Object.keys(english));
  });

  it('has no prose for an unauthored chapter', async () => {
    expect(await loadChapterProse('improvising', 'en')).toEqual({});
  });
});
