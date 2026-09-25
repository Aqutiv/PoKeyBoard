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
 * same way, major or minor as the score said, or as the pitches read where it
 * never did; and it names the General MIDI program nearest the piano it was
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
  // A reading can only guess at what the score said, and a short piece is too
  // little to read at all: it would come out major whatever it was.
  const mode = take.tempo.keyMode ?? detectMode(take.notes, fifths);
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
