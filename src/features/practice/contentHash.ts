/**
 * A digest of the notes a practice run is measured on: what it asks for, and
 * when. Kept with each result, so a best is only ever set against the notes
 * it was played on, whatever else a new version of a track keeps the same.
 *
 * Free of imports, so the end-to-end tests can hash a Library track just as
 * the app does.
 */

/** A note as practice weighs it: when, which key, how long, which hand, and whether written. */
export interface ContentNote {
  startMs: number;
  midi: number;
  durationMs: number;
  hand: 'left' | 'right';
  /** Played but kept off the page, so never asked for (`NoteEvent.hidden`). */
  hidden: boolean;
}

/**
 * FNV-1a, 32 bits, over every note in a fixed order, by start, then key,
 * length, hand and hiddenness: the same notes come to the same digest however
 * they are listed, and a note moved, lengthened, retuned, given to the other
 * hand or hidden comes to another. Tempo and velocity are left out: neither
 * changes which keys are asked for, nor, the notes' milliseconds fixed, when.
 * Eight hex digits.
 */
export function contentHash(notes: readonly ContentNote[]): string {
  let hash = 0x811c9dc5;
  for (const note of [...notes].sort(compareNotes)) {
    const text = `${note.startMs},${note.midi},${note.durationMs},${note.hand},${note.hidden ? 1 : 0};`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function compareNotes(a: ContentNote, b: ContentNote): number {
  return (
    a.startMs - b.startMs ||
    a.midi - b.midi ||
    a.durationMs - b.durationMs ||
    a.hand.localeCompare(b.hand) ||
    Number(a.hidden) - Number(b.hidden)
  );
}
