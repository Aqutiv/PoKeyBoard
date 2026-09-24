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
 * one its pitches read as, major or minor as they read — so an editor opening
 * it spells its accidentals the same way; and it names the General MIDI
 * program nearest the piano it was played on. Null for an empty or missing
 * take, which has nothing to write.
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
  const bytes = takeToMidi(take, {
    title: take.title,
    key: { fifths, minor: detectMode(take.notes, fifths) === 'minor' },
    program: instrumentForPackVersion(take.samplePackVersion).midiProgram,
    trackNames,
  });
  const fileName = takeMidiFileName(take.title, {
    composer: libraryTrackSummary(take.id)?.composer,
  });
  return new File([bytes], fileName, { type: 'audio/midi' });
}
