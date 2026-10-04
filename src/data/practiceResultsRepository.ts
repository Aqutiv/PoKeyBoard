import {
  parsePracticeRecords,
  withoutOtherContent,
  withScore,
  type PracticeModeKey,
  type PracticeRecords,
  type PracticeScore,
  type ResultRecord,
} from '@/features/practice/practiceRecords';
import { db } from './db';
import { getMetadata, META_PRACTICE_RESULTS, setMetadata } from './metadataRepository';

/**
 * Practice results live in `metadata`, as Learn progress does: one evolving
 * record for every Library track, not a preference. `getMetadata` does no
 * validation of its own, so each read goes through `parsePracticeRecords`,
 * which keeps every entry it can and drops the rest: a corrupted row costs
 * the results it spoils, never the Library.
 *
 * Consequence to know: metadata is device-local and is not carried by a
 * backup, which holds the takes and the settings alone. The results stay on
 * the device they were played on.
 */
export async function loadPracticeRecords(): Promise<PracticeRecords> {
  return parsePracticeRecords(await getMetadata<unknown>(META_PRACTICE_RESULTS));
}

const listeners = new Set<(records: PracticeRecords) => void>();

/**
 * Hear the records each time they are written: a result kept, or a track's
 * results of other notes put away. Told once the write is done, with the
 * records as written, so a page that read them before, the Library opened
 * while a Keep-time run's last notes were still being judged, catches up.
 */
export function subscribePracticeRecords(listener: (records: PracticeRecords) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Tell every listener; one that fails is reported, and keeps the write from no one. */
function tell(records: PracticeRecords): void {
  for (const listener of [...listeners]) {
    try {
      listener(records);
    } catch (error) {
      console.error('A practice records listener failed:', error);
    }
  }
}

/**
 * Keep a run's score as the last of `takeId` practised in `mode`, and as its
 * best if it is better; see `withScore`. Read, merged and written in one
 * transaction: `setMetadata` is a blind put, so two results kept at once would
 * otherwise each write over the other with the records as it found them.
 */
export async function recordPracticeScore(
  takeId: string,
  mode: PracticeModeKey,
  score: PracticeScore,
): Promise<ResultRecord> {
  const { records, best, last, newBest } = await db.transaction('rw', db.metadata, async () => {
    const kept = withScore(await loadPracticeRecords(), takeId, mode, score);
    await setMetadata(META_PRACTICE_RESULTS, kept.records);
    return kept;
  });
  tell(records);
  return { best, last, newBest };
}

/**
 * Put away `takeId`'s results of notes other than `content`'s, a version of
 * the track since changed (`withoutOtherContent`), in one transaction as a
 * result is kept. Resolves to whether there were any: with none, nothing is
 * written, and nobody told.
 */
export async function prunePracticeRecords(takeId: string, content: string): Promise<boolean> {
  const records = await db.transaction('rw', db.metadata, async () => {
    const pruned = withoutOtherContent(await loadPracticeRecords(), takeId, content);
    if (pruned !== null) await setMetadata(META_PRACTICE_RESULTS, pruned);
    return pruned;
  });
  if (records === null) return false;
  tell(records);
  return true;
}
