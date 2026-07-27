import type { NoteClef, NoteStaff } from '@/domain/takeTypes';
import {
  accidentalFor,
  keyAlterations,
  letterPitchClass,
  spellingsFor,
  type AccidentalKind,
} from './keySignature';

/**
 * MIDI → grand-staff geometry. Positions are diatonic steps from each staff's
 * bottom line (treble: E4, bass: G2); one step is half a staff space. Middle C
 * sits at step -2 on the treble staff (first ledger line below).
 *
 * How a pitch is spelled comes from the key: an E flat in a flat key is an E
 * flat, not a D sharp, and it sits on E's line. With no key given the context
 * is C major, which spells every black key as a sharp — what this did before
 * keys existed at all.
 */
export type StaffKind = NoteStaff;
export type ClefKind = NoteClef;

/** The clef a staff carries unless the score says otherwise. */
export function defaultClefFor(staff: StaffKind): ClefKind {
  return staff;
}

const TREBLE_BOTTOM_LINE = 4 * 7 + 2; // E4 as absolute diatonic index
const BASS_BOTTOM_LINE = 2 * 7 + 4; // G2

/** Notes at or above middle C display on the treble staff. */
export const TREBLE_SPLIT_MIDI = 60;

/**
 * The letter and octave a position names, with the clef taken back out —
 * `octave * 7 + letter`, the index `step` was measured from.
 *
 * A step alone only means something under a clef: step 0 is E4 under a G clef
 * and G2 under an F clef. Anything that has to know whether two notes are the
 * *same note* rather than the same line has to ask this instead.
 */
export function absoluteDiatonic(step: number, clef: ClefKind): number {
  return step + (clef === 'treble' ? TREBLE_BOTTOM_LINE : BASS_BOTTOM_LINE);
}

export interface StaffPosition {
  staff: StaffKind;
  /** The clef this position was read under. */
  clef: ClefKind;
  /** Diatonic steps above the staff's bottom line (may be negative). */
  step: number;
  /**
   * The accidental to print, or null when the key signature already says it.
   * A measure can still override this: see `layoutScore`, where an accidental
   * printed earlier in the bar holds until the bar line.
   */
  accidental: AccidentalKind | null;
  /** How this pitch is altered from its letter: −1 flat, 0 natural, +1 sharp. */
  alter: number;
}

/**
 * `staffHint` is the staff an imported score wrote the note on, and always
 * wins: a left hand reaching above middle C stays on the bass staff, which is
 * how the source engraved it. Without a hint (recorded takes, sources with one
 * staff) the split falls back to middle C.
 *
 * `clefHint` is how that staff is read where the note falls — the two are
 * independent, so a bass staff under a G clef puts a high left hand on the
 * staff instead of a ladder of ledger lines. It defaults to the staff's own
 * clef, which is what every recorded take uses.
 */
export function midiToStaffPosition(
  midi: number,
  staffHint?: StaffKind,
  clefHint?: ClefKind,
  fifths = 0,
): StaffPosition {
  const pitchClass = ((midi % 12) + 12) % 12;
  const spelling = spellingsFor(fifths)[pitchClass] as { letter: number; alter: number };

  // A letter can belong to the octave next door: B sharp sounds as the C above
  // it but is written on B's line, and C flat the other way about.
  const raw = letterPitchClass(spelling.letter) + spelling.alter;
  const octave = Math.floor(midi / 12) - 1 + (raw < 0 ? 1 : raw > 11 ? -1 : 0);
  const absolute = octave * 7 + spelling.letter;

  const staff: StaffKind = staffHint ?? (midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
  const clef: ClefKind = clefHint ?? defaultClefFor(staff);
  const reference = clef === 'treble' ? TREBLE_BOTTOM_LINE : BASS_BOTTOM_LINE;
  // Nothing is printed for a note the key signature has already accounted for.
  const inKey = (keyAlterations(fifths)[spelling.letter] as number) === spelling.alter;
  return {
    staff,
    clef,
    step: absolute - reference,
    accidental: inKey ? null : accidentalFor(spelling.alter),
    alter: spelling.alter,
  };
}

/**
 * Ledger-line steps needed for a note at `step` (each is an even step at or
 * beyond the staff: below → -2, -4, …; above → 10, 12, …).
 */
export function ledgerLineSteps(step: number): number[] {
  const lines: number[] = [];
  if (step <= -2) {
    for (let s = -2; s >= step; s -= 2) lines.push(s);
  } else if (step >= 10) {
    for (let s = 10; s <= step; s += 2) lines.push(s);
  }
  return lines;
}

/** Stem points down for notes on/above the middle line (step 4). */
export function stemGoesDown(step: number): boolean {
  return step >= 4;
}
