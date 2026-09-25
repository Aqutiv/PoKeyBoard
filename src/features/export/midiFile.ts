import { instrumentForPackVersion } from '@/audio/instruments';
import type { Hand } from '@/domain/hands';
import { takeToMidi } from '@/domain/midiExport';
import { libraryTrackSummary } from '@/features/library/catalog';
import { detectFifths, detectMode } from '@/features/notation/keyDetection';
import { normalizeFifths } from '@/features/notation/keySignature';
import { snapshotTake } from '@/features/takes/takesService';
import { takeMidiFileName } from '@/utils/filenames';

/**
 * A take as a `.mid` file, from its freshest copy and without disturbing
 * playback. It declares the key the notation writes — the score's own, or the
 * one its pitches read as — so an editor opening it spells its accidentals the
 * same way, minor where the score says so and otherwise major or minor as the
 * pitches read; and it names the General MIDI program nearest the piano it was
 * played on. Null for an empty or missing take, which has nothing to write.
 */
export async function takeMidiFile(
  takeId: string,
  trackNames: Readonly<Record<Hand, string>>,
): Promise<File | null> {
  const take = await snapshotTake(takeId);
  if (!take || take.notes.length === 0) return null;
  const fifths =
    take.tempo.keySignature !== undefined
      ? normalizeFifths(take.tempo.keySignature)
      : detectFifths(take.notes);
  // A score that calls its key minor meant it, and a short piece has too few
  // notes to read that from. "Major" is often just what the exporting program
  // wrote: several of the vendored scores in minor keys carry it. So a minor
  // is taken at its word, and a major, like no mode at all, is left to the
  // pitches.
  const mode = take.tempo.keyMode === 'minor' ? 'minor' : detectMode(take.notes, fifths);
  const bytes = takeToMidi(take, {
    title: take.title,
    key: { fifths, minor: mode === 'minor' },
    program: instrumentForPackVersion(take.samplePackVersion).midiProgram,
    trackNames,
  });
  const fileName = takeMidiFileName(take.title, {
    composer: libraryTrackSummary(take.id)?.composer,
  });
  return new File([bytes], fileName, { type: 'audio/midi' });
}
