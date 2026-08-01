import { z } from 'zod';
import type { LearnChapterId, LearnChapterMeta } from './types';

/**
 * Where the user has got to, as one compact record for the whole curriculum.
 *
 * `step` is kept alongside `done` so reopening a half-finished chapter lands
 * where it was left rather than at the beginning.
 */
export interface LearnProgress {
  v: 1;
  chapters: Record<string, { step: number; done: boolean }>;
}

export const learnProgressSchema = z.object({
  v: z.literal(1),
  chapters: z.record(z.string(), z.object({ step: z.number().int().min(0), done: z.boolean() })),
});

export const EMPTY_LEARN_PROGRESS: LearnProgress = { v: 1, chapters: {} };

export type ChapterStatus = 'comingSoon' | 'completed' | 'inProgress' | 'available';

/**
 * "Not written yet" and "not started yet" are different states and get
 * different words — telling someone to come back later for a chapter that is
 * simply untouched would be nonsense.
 */
export function chapterStatus(chapter: LearnChapterMeta, progress: LearnProgress): ChapterStatus {
  if (chapter.load === null) return 'comingSoon';
  const record = progress.chapters[chapter.id];
  if (record?.done) return 'completed';
  if (record !== undefined && record.step > 0) return 'inProgress';
  return 'available';
}

export function chapterStep(id: LearnChapterId, progress: LearnProgress): number {
  return progress.chapters[id]?.step ?? 0;
}

export function withChapterStep(
  progress: LearnProgress,
  id: LearnChapterId,
  step: number,
): LearnProgress {
  const done = progress.chapters[id]?.done ?? false;
  return { ...progress, chapters: { ...progress.chapters, [id]: { step, done } } };
}

export function withChapterDone(progress: LearnProgress, id: LearnChapterId): LearnProgress {
  const step = progress.chapters[id]?.step ?? 0;
  return { ...progress, chapters: { ...progress.chapters, [id]: { step, done: true } } };
}
