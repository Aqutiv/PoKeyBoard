import type { NoteSpelling, NoteStep } from './takeTypes';

const NAME_WITH_ACCIDENTAL = /^([A-G])([#b])-?\d{1,2}$/;

/**
 * The spelling a note name states, if it states one. A name written with an
 * accidental is the author's choice — "Eb4" is an E flat, not just the key 63
 * — and the notation keeps it. A bare letter names only a key: "C4" may yet
 * be written B♯3, and the notation spells it from its context.
 *
 * Shared by everything authored as note names — Library tracks and Learn
 * phrases — so a chord written C–E♭–G in either is engraved that way rather
 * than guessed as C–D♯–G.
 */
export function writtenSpellingOf(name: string): NoteSpelling | undefined {
  const match = NAME_WITH_ACCIDENTAL.exec(name.trim());
  if (!match) return undefined;
  return { step: match[1] as NoteStep, alter: match[2] === '#' ? 1 : -1 };
}
