import { db, type AudioCacheRow } from './db';

const MIN_PLAUSIBLE_BYTES = 2_000;

/** A cached export, or null when missing or implausible. */
export async function getCachedAudio(takeId: string): Promise<AudioCacheRow | null> {
  const row = await db.audioCache.get(takeId);
  if (!row) return null;
  if (!(row.blob instanceof Blob) || row.blob.size < MIN_PLAUSIBLE_BYTES) {
    await db.audioCache.delete(takeId);
    return null;
  }
  return row;
}

export async function putCachedAudio(row: AudioCacheRow): Promise<void> {
  await db.audioCache.put(row);
}

export async function invalidateCachedAudio(takeId: string): Promise<void> {
  await db.audioCache.delete(takeId);
}
