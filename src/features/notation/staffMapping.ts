import type { NoteClef, NoteStaff } from '@/domain/takeTypes';

/**
 * MIDI → grand-staff geometry in C-major display context (explicit sharps).
 * Positions are diatonic steps from each staff's bottom line (treble: E4,
 * bass: G2); one step is half a staff space. Middle C sits at step -2 on the
 * treble staff (first ledger line below).
 */
export type StaffKind = NoteStaff;
export type ClefKind = NoteClef;

/** The clef a staff carries unless the score says otherwise. */
export function defaultClefFor(staff: StaffKind): ClefKind {
  return staff;
}

const DIATONIC_STEP: Record<number, number> = {
  0: 0, // C
  2: 1, // D
  4: 2, // E
  5: 3, // F
  7: 4, // G
  9: 5, // A
  11: 6, // B
};

const TREBLE_BOTTOM_LINE = 4 * 7 + 2; // E4 as absolute diatonic index
const BASS_BOTTOM_LINE = 2 * 7 + 4; // G2

/** Notes at or above middle C display on the treble staff. */
export const TREBLE_SPLIT_MIDI = 60;

export interface StaffPosition {
  staff: StaffKind;
  /** The clef this position was read under. */
  clef: ClefKind;
  /** Diatonic steps above the staff's bottom line (may be negative). */
  step: number;
  /** '#' when the pitch is a black key (C-major spelling), else null. */
  accidental: '#' | null;
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
): StaffPosition {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const natural = DIATONIC_STEP[pitchClass];
  const isSharp = natural === undefined;
  // Sharps take the letter below (C# uses C's line/space).
  const letterStep = isSharp ? (DIATONIC_STEP[pitchClass - 1] as number) : natural;
  const absolute = octave * 7 + letterStep;
  const staff: StaffKind = staffHint ?? (midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
  const clef: ClefKind = clefHint ?? defaultClefFor(staff);
  const reference = clef === 'treble' ? TREBLE_BOTTOM_LINE : BASS_BOTTOM_LINE;
  return { staff, clef, step: absolute - reference, accidental: isSharp ? '#' : null };
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
