import { libraryTakeId } from '@/domain/libraryTakes';
import { createTakeTempoMap } from '@/domain/tempoMap';
import type { PlaybackLoop, Take } from '@/domain/takeTypes';
import { libraryTrackSummary } from '@/features/library/catalog';
import { openLibraryTrack } from '@/features/library/libraryService';
import { loopBetween } from '@/features/transport/practiceLoop';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import type { LearnHandoff } from './types';

/**
 * The title of the track a hand-off opens — an authored Library track and a
 * vendored Classics score alike — or undefined for one the Library does not
 * have, which leaves the closing card with its plain "Try it on Play".
 */
export function handoffTitle(trackId: string): string | undefined {
  return libraryTrackSummary(libraryTakeId(trackId))?.title;
}

/**
 * Open the Library at the folder a hand-off's track lives in. For when the
 * track would not open — a Classics score is fetched the first time it is
 * opened, so offline it cannot be — the player lands where it is listed, not
 * a folder away from it.
 */
export function revealHandoffInLibrary(trackId: string): void {
  const folder = libraryTrackSummary(libraryTakeId(trackId))?.folder;
  if (folder) useSettingsStore.getState().setLibraryFolder(folder);
}

/**
 * The loop a hand-off asks for, on the take it opened: its beats turned into
 * the take's own milliseconds through the take's tempo map, then made into a
 * loop exactly as Play's loop button makes one — so what the chapter sets up
 * is indistinguishable from what the player could have marked by hand.
 */
export function handoffLoop(
  take: Take,
  [from, to]: readonly [number, number],
): PlaybackLoop | null {
  const map = createTakeTempoMap(take.tempo);
  return loopBetween(take, Math.round(map.msAtBeat(from)), Math.round(map.msAtBeat(to)));
}

/**
 * Open a chapter's hand-off track on Play, set up the way the chapter taught
 * it to be practised. Resolves whether the track opened.
 *
 * Every setting goes through the same calls Play's own controls make — the
 * Modes menu, the speed menu, the loop button — so Play is in exactly the
 * state it would be had the player chosen each by hand. None is applied once
 * `signal` has aborted: a chapter closed mid-open must not reach into Play's
 * saved mode behind the player's back.
 */
export async function openHandoff(handoff: LearnHandoff, signal: AbortSignal): Promise<boolean> {
  const opened = await openLibraryTrack(handoff.trackId, signal);
  if (!opened || signal.aborted) return false;

  useSettingsStore.getState().setPlaybackMode(handoff.mode);
  transportController.refreshTrainingMode();
  if (handoff.speed !== undefined) transportController.setSpeed(handoff.speed);
  if (handoff.loopBeats) {
    const loop = handoffLoop(useTakeStore.getState().take, handoff.loopBeats);
    if (loop) {
      transportController.setLoop(loop);
      // Parked where the loop begins, so the first press of Play is the
      // passage, not the introduction before it.
      transportController.seek(loop.startMs);
    }
  }
  return true;
}
