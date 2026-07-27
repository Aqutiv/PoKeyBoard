import { libraryTakeId } from '@/domain/libraryTakes';
import type { Take } from '@/domain/takeTypes';
import type { LibraryFolderId } from './folders';
import { buildLibraryTake, type LibraryTrackDef } from './trackBuilder';
import { A_BEAUTIFUL_DAY } from './tracks/aBeautifulDay';
import { BLUES_IN_C } from './tracks/bluesInC';
import { CROOKED_LANTERN_WALTZ } from './tracks/crookedLanternWaltz';
import { EVENING_TIDE } from './tracks/eveningTide';
import { FORWARD_GENTLY } from './tracks/forwardGently';
import { FUR_ELISE } from './tracks/furElise';
import { GOOD_NIGHT } from './tracks/goodNight';
import { GYMNOPEDIE_1 } from './tracks/gymnopedie1';
import { MOONLIGHT_SONATA } from './tracks/moonlightSonata';

/**
 * The built-in library, in display order. This module must stay free of
 * service imports: the persistence layer imports it to rebuild a library
 * take at startup.
 */
export const LIBRARY_TRACKS: readonly LibraryTrackDef[] = [
  A_BEAUTIFUL_DAY,
  EVENING_TIDE,
  FORWARD_GENTLY,
  CROOKED_LANTERN_WALTZ,
  FUR_ELISE,
  GYMNOPEDIE_1,
  BLUES_IN_C,
  GOOD_NIGHT,
  MOONLIGHT_SONATA,
];

export interface LibraryTrackSummary {
  trackId: string;
  takeId: string;
  title: string;
  composer: string;
  folder: LibraryFolderId;
  descriptionKey: LibraryTrackDef['descriptionKey'];
  bpm: number;
  durationMs: number;
  noteCount: number;
}

/** List metadata, derived once — the list view never rebuilds full takes. */
export const LIBRARY_TRACK_SUMMARIES: readonly LibraryTrackSummary[] = LIBRARY_TRACKS.map((def) => {
  const take = buildLibraryTake(def);
  return {
    trackId: def.trackId,
    takeId: take.id,
    title: def.title,
    composer: def.composer,
    folder: def.folder,
    descriptionKey: def.descriptionKey,
    bpm: def.bpm,
    durationMs: take.durationMs,
    noteCount: take.notes.length,
  };
});

function summariesIn(folder: LibraryFolderId): readonly LibraryTrackSummary[] {
  return LIBRARY_TRACK_SUMMARIES.filter((summary) => summary.folder === folder);
}

/**
 * The summaries shelved by folder, each folder keeping the catalog's display
 * order. Derived once, so the list view never filters on render; spelled out a
 * key at a time so a new folder id fails to compile until it is filed here.
 */
export const LIBRARY_FOLDER_SUMMARIES: Record<LibraryFolderId, readonly LibraryTrackSummary[]> = {
  originals: summariesIn('originals'),
  classics: summariesIn('classics'),
};

/**
 * Build a pristine `Take` for a library take id. A fresh object every call:
 * whatever the transport or stores did to a previous copy can never leak
 * back into the catalog.
 */
export function getLibraryTake(takeId: string): Take | undefined {
  const def = LIBRARY_TRACKS.find((entry) => libraryTakeId(entry.trackId) === takeId);
  return def ? buildLibraryTake(def) : undefined;
}
