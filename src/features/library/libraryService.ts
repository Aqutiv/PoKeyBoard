import { libraryTakeId } from '@/domain/libraryTakes';
import { activateTake } from '@/features/takes/takesService';
import { getLibraryTake } from './catalog';

/**
 * Open a library track on the Play screen. The catalog hands out a pristine
 * in-memory `Take`; nothing is written to storage — recording over it forks
 * a fresh user take, and other edits evaporate on the next activation.
 */
export async function openLibraryTrack(trackId: string): Promise<boolean> {
  const take = getLibraryTake(libraryTakeId(trackId));
  if (!take) return false;
  await activateTake(take);
  return true;
}
