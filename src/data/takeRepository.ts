import { isLibraryTakeId } from '@/domain/libraryTakes';
import { parseTakeJsonString } from '@/domain/takeSchema';
import type { Take } from '@/domain/takeTypes';
import { UNTITLED_TAKE_TITLE } from '@/domain/noteEvents';
import { QuotaExceededStorageError, StorageError } from '@/utils/errors';
import { newId } from '@/utils/ids';
import { db, isQuotaError, type TakeRow } from './db';

export interface TakeSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  bpm: number;
  noteCount: number;
  isDraft: boolean;
}

const WRITE_RETRY_DELAY_MS = 250;

/** One retry for transient failures; quota errors surface immediately. */
async function withWriteRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isQuotaError(error)) {
      throw new QuotaExceededStorageError({ cause: error });
    }
    await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_DELAY_MS));
    try {
      return await operation();
    } catch (retryError) {
      if (isQuotaError(retryError)) throw new QuotaExceededStorageError({ cause: retryError });
      throw new StorageError('Take write failed after retry', { cause: retryError });
    }
  }
}

function rowFromTake(take: Take, revision: number): TakeRow {
  return {
    id: take.id,
    title: take.title,
    createdAt: take.createdAt,
    updatedAt: take.updatedAt,
    durationMs: take.durationMs,
    bpm: take.tempo.bpm,
    noteCount: take.notes.length,
    takeJson: JSON.stringify(take),
    revision,
    isDraft: take.title === UNTITLED_TAKE_TITLE ? 1 : 0,
  };
}

export async function saveTake(take: Take): Promise<number> {
  // Last line of defense: bundled library tracks must never gain a stored
  // row. Every legitimate path forks or launders the id before saving.
  if (isLibraryTakeId(take.id)) {
    throw new StorageError(`Refusing to persist library take ${take.id}`);
  }
  return withWriteRetry(() =>
    db.transaction('rw', db.takes, async () => {
      const existing = await db.takes.get(take.id);
      const revision = (existing?.revision ?? 0) + 1;
      await db.takes.put(rowFromTake(take, revision));
      return revision;
    }),
  );
}

/** Load and re-validate a take (imports of the row go through the schema). */
export async function getTake(id: string): Promise<Take | null> {
  const row = await db.takes.get(id);
  if (!row) return null;
  const { take } = parseTakeJsonString(row.takeJson);
  return take;
}

export async function listTakeSummaries(): Promise<TakeSummary[]> {
  const rows = await db.takes.orderBy('updatedAt').reverse().toArray();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    durationMs: row.durationMs,
    bpm: row.bpm,
    noteCount: row.noteCount,
    isDraft: row.isDraft === 1,
  }));
}

export async function deleteTake(id: string): Promise<void> {
  await withWriteRetry(() =>
    db.transaction('rw', db.takes, db.audioCache, async () => {
      await db.takes.delete(id);
      await db.audioCache.delete(id);
    }),
  );
}

export async function renameTake(id: string, title: string): Promise<Take | null> {
  const take = await getTake(id);
  if (!take) return null;
  const renamed: Take = { ...take, title, updatedAt: new Date().toISOString() };
  await saveTake(renamed);
  return renamed;
}

export async function duplicateTake(id: string): Promise<Take | null> {
  const take = await getTake(id);
  if (!take) return null;
  const now = new Date().toISOString();
  const copy: Take = {
    ...take,
    id: newId(),
    title: `${take.title} copy`,
    createdAt: now,
    updatedAt: now,
  };
  await saveTake(copy);
  return copy;
}

export async function takeExists(id: string): Promise<boolean> {
  return (await db.takes.get(id)) !== undefined;
}

export async function getAllTakesForBackup(): Promise<Take[]> {
  const rows = await db.takes.toArray();
  const takes: Take[] = [];
  for (const row of rows) {
    try {
      takes.push(parseTakeJsonString(row.takeJson).take);
    } catch {
      // A corrupt row must not block backing up the healthy ones.
      console.error('Skipping unreadable take during backup:', row.id);
    }
  }
  return takes;
}
