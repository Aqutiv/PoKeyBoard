import {
  parsePracticeRecords,
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
  return db.transaction('rw', db.metadata, async () => {
    const { records, best, last, newBest } = withScore(
      await loadPracticeRecords(),
      takeId,
      mode,
      score,
    );
    await setMetadata(META_PRACTICE_RESULTS, records);
    return { best, last, newBest };
  });
}
