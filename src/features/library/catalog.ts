import { libraryTakeId } from '@/domain/libraryTakes';
import type { Take } from '@/domain/takeTypes';
import { buildLibraryTake, type LibraryTrackDef } from './trackBuilder';
import { A_BEAUTIFUL_DAY } from './tracks/aBeautifulDay';
import { BLUES_IN_C } from './tracks/bluesInC';
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
    descriptionKey: def.descriptionKey,
    bpm: def.bpm,
    durationMs: take.durationMs,
    noteCount: take.notes.length,
  };
});

/**
 * Build a pristine `Take` for a library take id. A fresh object every call:
 * whatever the transport or stores did to a previous copy can never leak
 * back into the catalog.
 */
export function getLibraryTake(takeId: string): Take | undefined {
  const def = LIBRARY_TRACKS.find((entry) => libraryTakeId(entry.trackId) === takeId);
  return def ? buildLibraryTake(def) : undefined;
}
