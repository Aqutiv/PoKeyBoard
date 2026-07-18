import { db } from './db';

export async function getMetadata<T>(key: string): Promise<T | undefined> {
  const row = await db.metadata.get(key);
  return row?.value as T | undefined;
}

export async function setMetadata(key: string, value: unknown): Promise<void> {
  await db.metadata.put({ key, value });
}

export const META_LAST_OPEN_TAKE = 'lastOpenTakeId';
export const META_PERSIST_REQUESTED = 'persistentStorageRequested';
/** Set once the user picks a language in Settings; until then the app follows the OS. */
export const META_LANGUAGE_EXPLICIT = 'languageExplicitlyChosen';
