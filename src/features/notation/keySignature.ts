import { MAX_FIFTHS } from '@/domain/takeTypes';
import type { ClefKind } from './staffMapping';

/**
 * How a key signature spells the twelve pitch classes.
 *
 * A take stores pitches as MIDI numbers, which say which key was pressed and
 * nothing about how it is written: 63 is E flat in one piece and D sharp in
 * another. The key is what settles it, so spelling lives here and everything
 * downstream — staff position, accidental, key signature — is read from it.
 */

export type AccidentalKind = '#' | 'b' | 'natural';

/** Coerce anything (a corrupt setting, a wild `<fifths>`) into a real key. */
export function normalizeFifths(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-MAX_FIFTHS, Math.min(MAX_FIFTHS, Math.round(value)));
}

/** Pitch class of each natural letter, C first. */
const LETTER_PITCH_CLASS = [0, 2, 4, 5, 7, 9, 11];

/** Letters the sharps take, in the order a key signature writes them. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
/** And the flats, which is the same order backwards. */
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

/**
 * Where each accidental of a key signature sits, in steps above the staff's
 * bottom line, in the order it is written. Read under the clef rather than
 * from the staff: a bass staff carrying a G clef takes the treble positions.
 */
const SIGNATURE_STEPS: Record<ClefKind, { sharps: number[]; flats: number[] }> = {
  // Treble: bottom line E4 = 0.
  treble: { sharps: [8, 5, 9, 6, 3, 7, 4], flats: [4, 7, 3, 6, 2, 5, 1] },
  // Bass: bottom line G2 = 0.
  bass: { sharps: [6, 3, 7, 4, 1, 5, 2], flats: [2, 5, 1, 4, 0, 3, -1] },
};

/** How the key signature alters each letter, C first (−1 flat, +1 sharp). */
export function keyAlterations(fifths: number): number[] {
  const alterations = [0, 0, 0, 0, 0, 0, 0];
  const count = Math.min(Math.abs(fifths), MAX_FIFTHS);
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  const step = fifths >= 0 ? 1 : -1;
  for (let i = 0; i < count; i += 1) alterations[order[i] as number] = step;
  return alterations;
}

/** The accidentals of a key signature, in writing order, as staff steps. */
export function signatureSteps(fifths: number, clef: ClefKind): number[] {
  const count = Math.min(Math.abs(fifths), MAX_FIFTHS);
  const steps = SIGNATURE_STEPS[clef];
  return (fifths >= 0 ? steps.sharps : steps.flats).slice(0, count);
}

/** Which glyph a key signature is written with. */
export function signatureAccidental(fifths: number): AccidentalKind {
  return fifths >= 0 ? '#' : 'b';
}

/** How a single pitch class is written in some key. */
export interface Spelling {
  /** 0 = C … 6 = B. */
  letter: number;
  /** −1 flat, 0 natural, +1 sharp — relative to the letter, not to the key. */
  alter: number;
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * The letter and alteration each pitch class takes in a key.
 *
 * Built in order of how obvious the answer is. The key's own seven letters
 * come first and are written bare. Then the naturals that cancel them: in E
 * flat major a played E is E natural, never F flat. What is left is the
 * chromatic remainder, which leans the way the key does — sharps in a sharp
 * key, flats in a flat key — and falls back to leaning the other way rather
 * than reaching for a double accidental.
 */
function buildSpellings(fifths: number): Spelling[] {
  const alterations = keyAlterations(fifths);
  const table: (Spelling | undefined)[] = new Array<Spelling | undefined>(12);
  const claim = (letter: number, alter: number): void => {
    if (Math.abs(alter) > 1) return;
    const pitchClass = mod12((LETTER_PITCH_CLASS[letter] as number) + alter);
    table[pitchClass] ??= { letter, alter };
  };

  for (let letter = 0; letter < 7; letter += 1) claim(letter, alterations[letter] as number);
  for (let letter = 0; letter < 7; letter += 1) {
    if (alterations[letter] !== 0) claim(letter, 0);
  }
  const lean = fifths < 0 ? -1 : 1;
  for (let letter = 0; letter < 7; letter += 1) {
    claim(letter, (alterations[letter] as number) + lean);
  }
  for (let letter = 0; letter < 7; letter += 1) {
    claim(letter, (alterations[letter] as number) - lean);
  }
  return table as Spelling[];
}

const cache = new Map<number, Spelling[]>();

/** Spellings for a key, by pitch class. Cached; there are only fifteen keys. */
export function spellingsFor(fifths: number): Spelling[] {
  const key = normalizeFifths(fifths);
  let found = cache.get(key);
  if (!found) {
    found = buildSpellings(key);
    cache.set(key, found);
  }
  return found;
}

/** The sign an alteration is written with. */
export function accidentalFor(alter: number): AccidentalKind {
  return alter > 0 ? '#' : alter < 0 ? 'b' : 'natural';
}

/** Steps above the letter's own natural pitch class, for the octave a letter falls in. */
export function letterPitchClass(letter: number): number {
  return LETTER_PITCH_CLASS[letter] as number;
}

/** Every key, from seven flats to seven sharps — the order a chooser offers them. */
export const ALL_FIFTHS: readonly number[] = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];

const MAJOR_TONIC_BY_FIFTHS: Record<number, string> = {
  '-7': 'C♭',
  '-6': 'G♭',
  '-5': 'D♭',
  '-4': 'A♭',
  '-3': 'E♭',
  '-2': 'B♭',
  '-1': 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F♯',
  7: 'C♯',
};

const MINOR_TONIC_BY_FIFTHS: Record<number, string> = {
  '-7': 'A♭',
  '-6': 'E♭',
  '-5': 'B♭',
  '-4': 'F',
  '-3': 'C',
  '-2': 'G',
  '-1': 'D',
  0: 'A',
  1: 'E',
  2: 'B',
  3: 'F♯',
  4: 'C♯',
  5: 'G♯',
  6: 'D♯',
  7: 'A♯',
};

/**
 * The two keys a signature can mean, spelled with real accidental signs.
 *
 * Both are named because a signature does not say which: four sharps is E
 * major and C sharp minor alike, and a player looking for the piece they are
 * exporting should find it under either. Note names are letters everywhere the
 * app is translated, so only the words beside them need localizing.
 */
export function majorTonicName(fifths: number): string {
  return MAJOR_TONIC_BY_FIFTHS[normalizeFifths(fifths)] as string;
}

export function minorTonicName(fifths: number): string {
  return MINOR_TONIC_BY_FIFTHS[normalizeFifths(fifths)] as string;
}
