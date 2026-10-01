import { isHiddenNote, writtenNotes } from '@/domain/noteEvents';
import type { NoteEvent, NoteSpelling, PedalEvent, TempoSettings } from '@/domain/takeTypes';
import { detectFifths, detectMode } from './keyDetection';
import { normalizeFifths, type Spelling } from './keySignature';
import { pedalSpans } from './notationLayout';
import { spellInKey, spellNotes } from './pitchSpelling';

const LETTERS = 'CDEFGAB';

/** A source's own spelling of a note, as `spellNotes` gives one. */
function fromHint(hint: NoteSpelling): Spelling {
  return { letter: LETTERS.indexOf(hint.step), alter: hint.alter };
}

/**
 * How the score spells each of a take's notes, by id. It reads them as the
 * staff does — the written notes, in the key the take says or the one read
 * from them, in the mode read from them, chords and pedals and all — so a
 * name shown anywhere else agrees with the page. A hidden note, which the
 * score never draws, takes its source's own spelling, or its key's.
 */
export function scoreSpellings(
  notes: readonly NoteEvent[],
  tempo: Pick<TempoSettings, 'keySignature'>,
  pedals: readonly PedalEvent[],
): Map<string, Spelling> {
  const written = writtenNotes(notes);
  const fifths =
    tempo.keySignature !== undefined ? normalizeFifths(tempo.keySignature) : detectFifths(written);
  const key = { fifths, mode: detectMode(written, fifths) };
  const spellings = spellNotes(written, key, pedalSpans(pedals, Number.POSITIVE_INFINITY));
  const byId = new Map<string, Spelling>();
  written.forEach((note, index) => byId.set(note.id, spellings[index] as Spelling));
  for (const note of notes) {
    if (!isHiddenNote(note)) continue;
    byId.set(note.id, note.spelling ? fromHint(note.spelling) : spellInKey(note.midi, key));
  }
  return byId;
}

/** A spelling as a name: the letter, then ♯ or ♭ for each step up or down. No octave. */
export function spellingName({ letter, alter }: Spelling): string {
  const accidental = alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter);
  return `${LETTERS[letter] ?? ''}${accidental}`;
}
