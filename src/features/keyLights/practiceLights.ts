import { noteHand, type Hand } from '@/domain/hands';
import type { NoteEvent } from '@/domain/takeTypes';
import { asksFor, CHORD_WINDOW_MS, type TrainingHand } from '@/domain/trainingGate';

/**
 * How far ahead, in real time, the practised hand's next notes light dimly:
 * far enough to see the next chord coming and move to it, near enough that a
 * long rest does not leave a note glowing seconds before it is due.
 */
export const COMING_WINDOW_MS = 2000;

/** First index whose note starts after `ms`, over notes sorted by start. */
function firstStartingAfter(notes: readonly NoteEvent[], ms: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((notes[mid] as NoteEvent).startMs <= ms) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The hand of each key a hold waits for: the note on that key starting at the
 * hold, where the playhead stands. A key with no such note (none should be)
 * takes no hand.
 */
export function holdTargetHands(
  notes: readonly NoteEvent[],
  targets: ReadonlySet<number>,
  playheadMs: number,
): Map<number, Hand | null> {
  const hands = new Map<number, Hand | null>();
  if (targets.size === 0) return hands;
  // A hold's chord spans CHORD_WINDOW_MS from its first note; the playhead
  // can sit a rounding hair either side of it.
  const from = firstStartingAfter(notes, playheadMs - CHORD_WINDOW_MS - 1);
  for (let i = from; i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    if (note.startMs > playheadMs + CHORD_WINDOW_MS + 1) break;
    if (targets.has(note.midi) && !hands.has(note.midi)) hands.set(note.midi, noteHand(note));
  }
  for (const midi of targets) if (!hands.has(midi)) hands.set(midi, null);
  return hands;
}

/**
 * The practised hand's next notes: the first chord it is asked to play after
 * the one at the playhead (which sounds, or is held for, already), in its
 * hand, if it starts within `COMING_WINDOW_MS` of real time at `speed`.
 */
export function comingNotes(
  notes: readonly NoteEvent[],
  playheadMs: number,
  hand: TrainingHand,
  speed: number,
): Map<number, Hand> {
  const coming = new Map<number, Hand>();
  const horizon = playheadMs + COMING_WINDOW_MS * Math.max(speed, 0.01);
  let groupStart: number | null = null;
  for (let i = firstStartingAfter(notes, playheadMs + CHORD_WINDOW_MS); i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    if (groupStart === null) {
      if (note.startMs > horizon) break;
      if (!asksFor(note, hand)) continue;
      groupStart = note.startMs;
    } else if (note.startMs > groupStart + CHORD_WINDOW_MS) {
      break;
    }
    if (asksFor(note, hand) && !coming.has(note.midi)) coming.set(note.midi, noteHand(note));
  }
  return coming;
}
