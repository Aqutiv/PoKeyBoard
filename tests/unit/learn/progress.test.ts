import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { loadLearnProgress, saveLearnProgress } from '@/data/learnProgressRepository';
import { META_LEARN_PROGRESS, setMetadata } from '@/data/metadataRepository';
import { findLearnChapter } from '@/features/learn/chapters';
import {
  chapterStatus,
  chapterStep,
  EMPTY_LEARN_PROGRESS,
  withChapterDone,
  withChapterStep,
} from '@/features/learn/progress';

const chapterOne = findLearnChapter('meetTheKeyboard');
/** Authored chapters keep moving; this one is deliberately still a stub. */
const unwritten = findLearnChapter('halfStepsWholeSteps');

describe('chapterStatus', () => {
  it('calls an unauthored chapter coming soon, not locked', () => {
    // "Not written yet" and "not started yet" are different states: telling
    // someone to come back later for an untouched chapter would be nonsense.
    expect(chapterStatus(unwritten!, EMPTY_LEARN_PROGRESS)).toBe('comingSoon');
  });

  it('calls an untouched authored chapter available', () => {
    expect(chapterStatus(chapterOne!, EMPTY_LEARN_PROGRESS)).toBe('available');
  });

  it('reports a part-finished chapter as in progress', () => {
    const progress = withChapterStep(EMPTY_LEARN_PROGRESS, 'meetTheKeyboard', 3);
    expect(chapterStatus(chapterOne!, progress)).toBe('inProgress');
    expect(chapterStep('meetTheKeyboard', progress)).toBe(3);
  });

  it('reports a finished chapter as completed even at step zero', () => {
    const progress = withChapterDone(EMPTY_LEARN_PROGRESS, 'meetTheKeyboard');
    expect(chapterStatus(chapterOne!, progress)).toBe('completed');
  });

  it('keeps the step when marking done, and the done flag when moving step', () => {
    const started = withChapterStep(EMPTY_LEARN_PROGRESS, 'meetTheKeyboard', 5);
    expect(withChapterDone(started, 'meetTheKeyboard').chapters.meetTheKeyboard).toEqual({
      step: 5,
      done: true,
    });
    const finished = withChapterDone(EMPTY_LEARN_PROGRESS, 'meetTheKeyboard');
    expect(withChapterStep(finished, 'meetTheKeyboard', 2).chapters.meetTheKeyboard).toEqual({
      step: 2,
      done: true,
    });
  });
});

describe('learn progress repository', () => {
  beforeEach(async () => {
    await db.metadata.clear();
  });

  it('starts empty when nothing was ever saved', async () => {
    expect(await loadLearnProgress()).toEqual(EMPTY_LEARN_PROGRESS);
  });

  it('round-trips a record', async () => {
    const progress = withChapterStep(EMPTY_LEARN_PROGRESS, 'meetTheKeyboard', 4);
    await saveLearnProgress(progress);
    expect(await loadLearnProgress()).toEqual(progress);
  });

  it('starts over rather than throwing on a corrupted record', async () => {
    // `getMetadata` does no validation, so the Zod parse is the only thing
    // between a bad row and a crash on the Learn tab.
    await setMetadata(META_LEARN_PROGRESS, { v: 99, chapters: 'nonsense' });
    expect(await loadLearnProgress()).toEqual(EMPTY_LEARN_PROGRESS);
  });

  it('rejects a record with a negative step', async () => {
    await setMetadata(META_LEARN_PROGRESS, {
      v: 1,
      chapters: { meetTheKeyboard: { step: -2, done: false } },
    });
    expect(await loadLearnProgress()).toEqual(EMPTY_LEARN_PROGRESS);
  });
});
