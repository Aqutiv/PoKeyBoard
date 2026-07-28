import { libraryTakeId } from '@/domain/libraryTakes';
import { activateTake } from '@/features/takes/takesService';
import { resolveLibraryTake } from './catalog';

/**
 * Open a library track on the Play screen. The catalog hands out a pristine
 * in-memory `Take`; nothing is written to storage — recording over it forks
 * a fresh user take, and other edits evaporate on the next activation.
 *
 * A vendored score is fetched and parsed on the way, so this can reject when
 * the network is unreachable; the caller surfaces that. `signal` gives the
 * caller a way out: an abort that lands before activation leaves the active
 * take alone, so walking away from a slow download changes nothing.
 */
export async function openLibraryTrack(trackId: string, signal?: AbortSignal): Promise<boolean> {
  const take = await resolveLibraryTake(libraryTakeId(trackId), signal);
  if (!take || signal?.aborted === true) return false;
  await activateTake(take);
  return true;
}
