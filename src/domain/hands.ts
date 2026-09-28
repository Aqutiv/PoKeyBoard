import { TREBLE_SPLIT_MIDI } from '@/features/notation/staffMapping';
import type { NoteEvent } from './takeTypes';

/** Which hand a note belongs to, as far as the notation can tell. */
export type Hand = 'left' | 'right';

/**
 * How the take lights one key: in the shade of the hand that plays it, as deep
 * as the note it is heard at was struck.
 */
export interface KeyCue {
  readonly hand: Hand;
  /** 0–1, as `NoteEvent.velocity`. */
  readonly velocity: number;
}

/**
 * The hand a note is played with. Imported scores say which staff they wrote a
 * note on, and that is the answer; recorded takes say nothing, so the same
 * middle-C split the grand staff falls back to decides it — the notation and
 * the keyboard then agree about which hand a note belongs to.
 */
export function noteHand(note: Pick<NoteEvent, 'midi' | 'staff'>): Hand {
  const staff = note.staff ?? (note.midi >= TREBLE_SPLIT_MIDI ? 'treble' : 'bass');
  return staff === 'bass' ? 'left' : 'right';
}
