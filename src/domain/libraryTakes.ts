import { newId } from '@/utils/ids';
import type { Take } from './takeTypes';

/**
 * Built-in library tracks are ordinary `Take` objects whose id carries this
 * prefix. They are bundled with the app and must never be written to the
 * takes store — the persistence layer skips them and the transport forks
 * them into a fresh user take before any recording pass.
 */
export const LIBRARY_ID_PREFIX = 'library:';

export function libraryTakeId(trackId: string): string {
  return `${LIBRARY_ID_PREFIX}${trackId}`;
}

export function isLibraryTakeId(id: string): boolean {
  return id.startsWith(LIBRARY_ID_PREFIX);
}

/**
 * Fork a library track into a user-owned take: fresh id and timestamps, same
 * title and content. The bundled original stays pristine by construction.
 */
export function forkLibraryTake(take: Take): Take {
  const now = new Date().toISOString();
  return { ...take, id: newId(), createdAt: now, updatedAt: now };
}

/**
 * Imported or restored takes must never claim a library id — a stored row
 * wearing one would masquerade as a built-in track and shadow the catalog.
 */
export function ensureNotLibraryTake(take: Take): Take {
  return isLibraryTakeId(take.id) ? { ...take, id: newId() } : take;
}
