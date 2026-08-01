import { describe, expect, it } from 'vitest';
import { MEET_THE_KEYBOARD } from '@/features/learn/chapters/meetTheKeyboard';
import {
  findLearnChapter,
  LEARN_CHAPTERS,
  LEARN_CHAPTERS_BY_LEVEL,
  LEARN_SECTIONS_BY_LEVEL,
} from '@/features/learn/chapters';
import { HALF_STEPS_WHOLE_STEPS } from '@/features/learn/chapters/halfStepsWholeSteps';
import { MUSICAL_ALPHABET } from '@/features/learn/chapters/musicalAlphabet';
import { stepWhites } from '@/features/keyboard/keyboardGeometry';
import { loadChapterProse } from '@/features/learn/content';
import { goalTotal } from '@/features/learn/exerciseSpec';
import { LEARN_LEVEL_IDS } from '@/features/learn/levels';
import { catalogs } from '@/i18n';
import { SUPPORTED_LANGUAGES } from '@/i18n/types';

describe('learn catalog', () => {
  it('ships thirty chapters, ten per level', () => {
    expect(LEARN_CHAPTERS).toHaveLength(30);
    for (const level of LEARN_LEVEL_IDS) {
      expect(LEARN_CHAPTERS_BY_LEVEL[level], level).toHaveLength(10);
    }
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

  it('marks only the authored chapters as playable', () => {
    const playable = LEARN_CHAPTERS.filter((chapter) => chapter.load !== null);
    expect(playable.map((chapter) => chapter.id)).toEqual([
      'meetTheKeyboard',
      'musicalAlphabet',
      'halfStepsWholeSteps',
    ]);
  });

  it('finds a chapter by id', () => {
    expect(findLearnChapter('meetTheKeyboard')?.order).toBe(1);
    expect(findLearnChapter('keySignatures')?.level).toBe('intermediate');
    expect(findLearnChapter('improvising')?.level).toBe('advanced');
  });
});

describe('learn parts', () => {
  it('splits every level into three parts', () => {
    for (const level of LEARN_LEVEL_IDS) {
      expect(LEARN_SECTIONS_BY_LEVEL[level], level).toHaveLength(3);
    }
  });

  it('covers every chapter exactly once, in order', () => {
    for (const level of LEARN_LEVEL_IDS) {
      const flattened = LEARN_SECTIONS_BY_LEVEL[level].flatMap((section) => section.chapters);
      expect(flattened).toEqual(LEARN_CHAPTERS_BY_LEVEL[level]);
    }
  });

  it('keeps each part a single consecutive run', () => {
    // Sections are built by walking the ordered chapters, so a part split in
    // two would surface here as a repeated heading rather than silently
    // reordering the course.
    for (const level of LEARN_LEVEL_IDS) {
      const parts = LEARN_SECTIONS_BY_LEVEL[level].map((section) => section.part);
      expect(new Set(parts).size, level).toBe(parts.length);
    }
  });

  it('names every part in every locale', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const { partTitles } = catalogs[language].learn;
      for (const chapter of LEARN_CHAPTERS) {
        expect(partTitles[chapter.part], `${language}/${chapter.part}`).toBeTruthy();
      }
    }
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

describe('chapter two', () => {
  it('mixes theory, exercises and one recognition step', () => {
    const kinds = MUSICAL_ALPHABET.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(10);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(4);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
  });

  it('gives every step a unique id', () => {
    const ids = MUSICAL_ALPHABET.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of MUSICAL_ALPHABET.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('asks its scale walks in the right direction', () => {
    const specs = MUSICAL_ALPHABET.steps
      .filter((step) => step.kind === 'exercise')
      .map((step) => step.spec);
    const sequences = specs.filter((spec) => spec.kind === 'sequence');
    expect(sequences).toHaveLength(3);
    expect(sequences[0]).toMatchObject({ direction: 'up' });
    // Walking down starts on the upper C, so the line fits the window a phone
    // shows without the user having to shift the keyboard mid-scale.
    expect(sequences[2]).toMatchObject({ direction: 'down' });
  });

  it('never asks the quiz for more rounds than its pool can name', () => {
    for (const step of MUSICAL_ALPHABET.steps) {
      if (step.kind !== 'quiz') continue;
      expect(step.rounds).toBeGreaterThan(0);
      expect(step.question.pitchClasses.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('writes English prose with a prompt for every exercise', async () => {
    const prose = await loadChapterProse('musicalAlphabet', 'en');
    for (const step of MUSICAL_ALPHABET.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});

describe('chapter three', () => {
  it('runs theory, exercises, a quiz and a drill', () => {
    const kinds = HALF_STEPS_WHOLE_STEPS.steps.map((step) => step.kind);
    expect(kinds).toHaveLength(11);
    expect(kinds.filter((kind) => kind === 'exercise')).toHaveLength(3);
    expect(kinds.filter((kind) => kind === 'quiz')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'drill')).toHaveLength(1);
  });

  it('gives every step a unique id', () => {
    const ids = HALF_STEPS_WHOLE_STEPS.steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a reachable goal for every exercise', () => {
    for (const step of HALF_STEPS_WHOLE_STEPS.steps) {
      if (step.kind !== 'exercise') continue;
      expect(goalTotal(step.spec), step.id).toBeGreaterThan(0);
    }
  });

  it('leaves the step intervals free of a simultaneity rule', () => {
    // Chapter 1 needs `together` because it asks for notes held at once. These
    // must NOT have it: an interval with no togetherness reads the cumulative
    // candidate set, which is what makes it "any two keys a semitone apart"
    // rather than one pinned pair, and what lets a one-pointer mouse play it.
    const intervals = HALF_STEPS_WHOLE_STEPS.steps
      .filter((step) => step.kind === 'exercise')
      .map((step) => step.spec)
      .filter((spec) => spec.kind === 'interval');
    expect(intervals).toHaveLength(2);
    for (const spec of intervals) expect(spec.together).toBeUndefined();
    expect(intervals.map((spec) => spec.semitones)).toEqual([1, 2]);
  });

  it('anchors the touching-pairs line where a small phone can reach all of it', () => {
    // E4–D5 is the seven white keys a 320px screen shows; anchored at middle C
    // the closing C5 would sit off the edge.
    const step = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.id === 'playTouchingPairs');
    expect(step?.anchorMidi).toBe(64);
    expect(stepWhites(64, 7, 1)).toBeGreaterThanOrEqual(72);
  });

  it('drills the same five black keys the quiz names, in the other spelling', () => {
    const quiz = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.kind === 'quiz');
    const drill = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.kind === 'drill');
    expect(quiz?.question.pitchClasses).toEqual([1, 3, 6, 8, 10]);
    expect(quiz?.question.spelling).toBe('sharp');
    expect(drill?.drill.pitchClasses).toEqual([1, 3, 6, 8, 10]);
    expect(drill?.drill.spelling).toBe('flat');
    expect(drill?.rounds).toBeGreaterThan(0);
  });

  it('gives the drill no Listen phrase', () => {
    // "Show me" fires the step's `listen`, which would be one fixed phrase
    // against a target that changes every round.
    const drill = HALF_STEPS_WHOLE_STEPS.steps.find((s) => s.kind === 'drill');
    expect(drill?.listen).toBeUndefined();
  });

  it('writes English prose, with a prompt for every exercise', async () => {
    const prose = await loadChapterProse('halfStepsWholeSteps', 'en');
    for (const step of HALF_STEPS_WHOLE_STEPS.steps) {
      const text = prose[step.id];
      expect(text?.heading, step.id).toBeTruthy();
      expect(text?.body.length ?? 0, step.id).toBeGreaterThan(0);
      // A drill's prompt is generated from its round, not written per chapter.
      if (step.kind === 'exercise') expect(text?.prompt, step.id).toBeTruthy();
    }
  });
});
