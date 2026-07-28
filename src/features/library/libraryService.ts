import { libraryTakeId } from '@/domain/libraryTakes';
import { activateTake } from '@/features/takes/takesService';
import { resolveLibraryTake } from './catalog';

/**
 * Open a library track on the Play screen. The catalog hands out a pristine
 * in-memory `Take`; nothing is written to storage — recording over it forks
 * a fresh user take, and other edits evaporate on the next activation.
 *
 * A vendored score is fetched and parsed on the way, so this can reject when
 * the network is unreachable; the caller surfaces that.
 */
export async function openLibraryTrack(trackId: string): Promise<boolean> {
  const take = await resolveLibraryTake(libraryTakeId(trackId));
  if (!take) return false;
  await activateTake(take);
  return true;
}
