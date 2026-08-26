import { spellingsFor } from '@/features/notation/keySignature';

/** Which name a black key is shown under. White keys read the same either way. */
export type NoteSpelling = 'sharp' | 'flat';

/**
 * Keys whose spelling tables give every black key the wanted accidental while
 * leaving all seven white keys bare: C major, and D♭ major — whose own scale
 * *is* the five black keys, so all five are diatonic there rather than coming
 * from the fallback rules.
 *
 * The usable windows are `[0, 5]` for sharps and `[-5, -1]` for flats. Past
 * either end the table starts spelling white keys as B♯/E♯ or C♭/F♭, which
 * would quietly rename a lesson's keys — hence the pinned test.
 */
const FIFTHS_FOR: Record<NoteSpelling, number> = { sharp: 0, flat: -5 };

const LETTERS = 'CDEFGAB';
/** Indexed by `alter + 1`; the spelling table never emits a double accidental. */
const SIGNS = ['♭', '', '♯'];

/**
 * A note's name without its octave: "C", "D♯", "E♭".
 *
 * Takes a midi number or a bare pitch class — both call sites already hold one
 * or the other. Learn-owned rather than added to the notation module, because
 * "show this as a sharp" is a teaching choice, and a chapter author should
 * never have to know that −5 means D♭ major.
 */
export function noteLabel(midiOrPitchClass: number, spelling: NoteSpelling = 'sharp'): string {
  const pitchClass = ((midiOrPitchClass % 12) + 12) % 12;
  const spelled = spellingsFor(FIFTHS_FOR[spelling])[pitchClass];
  if (!spelled) return '';
  return (LETTERS[spelled.letter] ?? '') + (SIGNS[spelled.alter + 1] ?? '');
}
