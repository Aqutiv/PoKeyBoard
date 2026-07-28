import { libraryTakeId } from '@/domain/libraryTakes';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { extractMusicXmlText } from '@/domain/mxlContainer';
import type { Take } from '@/domain/takeTypes';
import { CLASSIC_SCORES, type ClassicScoreEntry } from './classicsManifest';
import { CLASSIC_SCORE_NAMES } from './classicsNames';
import { LIBRARY_TIMESTAMP } from './trackBuilder';

/** Where the vendored pack is served from; versioned like the sample pack. */
export const SCORE_PACK_PATH = 'scores/classics-v1/';

const byTrackId = new Map<string, ClassicScoreEntry>(
  CLASSIC_SCORES.map((entry) => [entry.trackId, entry]),
);

/**
 * Parsed scores, kept for the session. The takes handed out are copies, so a
 * caller that mutates one cannot poison the next open.
 */
const parsed = new Map<string, Take>();

export function isClassicScoreId(trackId: string): boolean {
  return byTrackId.has(trackId);
}

/**
 * A score parsed into a library take: same guarantees the authored tracks
 * make. `musicXmlToTake` mints a fresh take id, wall-clock timestamps and a
 * random id per note, none of which may reach a library take — a reload has to
 * produce identical content, and nothing here may ever look like a user take.
 */
function toLibraryTake(entry: ClassicScoreEntry, take: Take): Take {
  const name = CLASSIC_SCORE_NAMES[entry.trackId];
  return {
    ...take,
    id: libraryTakeId(entry.trackId),
    title: name?.title ?? take.title,
    createdAt: LIBRARY_TIMESTAMP,
    updatedAt: LIBRARY_TIMESTAMP,
    notes: take.notes.map((note, index) => ({ ...note, id: `${entry.trackId}-n${index}` })),
  };
}

/**
 * Fetch and parse a vendored classic. Resolves undefined when the track is
 * unknown; throws when the score is there but cannot be fetched or read, so
 * the caller can tell "no such track" from "offline".
 */
export async function loadClassicTake(trackId: string): Promise<Take | undefined> {
  const entry = byTrackId.get(trackId);
  if (!entry) return undefined;

  const cached = parsed.get(trackId);
  // Structured-clone the cache hit for the same reason the catalog rebuilds:
  // whatever the transport did to a previous copy stays with that copy.
  if (cached) return structuredClone(cached);

  const response = await fetch(`${import.meta.env.BASE_URL}${SCORE_PACK_PATH}${entry.file}`);
  if (!response.ok) {
    throw new Error(`Score "${entry.file}" could not be fetched: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const take = toLibraryTake(entry, musicXmlToTake(extractMusicXmlText(bytes), entry.file));
  parsed.set(trackId, take);
  return structuredClone(take);
}
