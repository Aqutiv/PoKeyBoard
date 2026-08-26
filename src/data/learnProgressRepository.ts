import {
  EMPTY_LEARN_PROGRESS,
  learnProgressSchema,
  type LearnProgress,
} from '@/features/learn/progress';
import { getMetadata, META_LEARN_PROGRESS, setMetadata } from './metadataRepository';

/**
 * Learn progress lives in `metadata` rather than `settings` because it is an
 * evolving object rather than a scalar preference. `getMetadata` does no
 * validation of its own, so the Zod parse here is the only thing standing
 * between a corrupted row and a crash on the Learn tab: a bad record simply
 * starts the user over rather than blocking the page.
 *
 * Consequence to know: metadata is device-local and is not carried by the
 * settings backup, the same as the last-open take id.
 */
export async function loadLearnProgress(): Promise<LearnProgress> {
  const raw = await getMetadata<unknown>(META_LEARN_PROGRESS);
  if (raw === undefined) return EMPTY_LEARN_PROGRESS;
  const parsed = learnProgressSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_LEARN_PROGRESS;
}

export async function saveLearnProgress(progress: LearnProgress): Promise<void> {
  await setMetadata(META_LEARN_PROGRESS, progress);
}
