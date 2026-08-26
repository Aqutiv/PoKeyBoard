import { noteHand, type Hand } from './hands';
import { lowerBoundByStart } from './noteEvents';
import type { NoteEvent } from './takeTypes';

/** Which hand training waits on. `both` waits on whatever comes next. */
export type TrainingHand = Hand | 'both';

/**
 * How far past an onset another note still counts as part of the same chord.
 * A chord played by a human never lands on one millisecond, so the gate has to
 * gather a window rather than an instant — the same reason Learn's exercise
 * specs carry an `onsetWindowMs` instead of demanding true simultaneity.
 */
export const CHORD_WINDOW_MS = 50;

/** A point playback stops at until the user has played `midis`. */
export interface TrainingGate {
  atMs: number;
  midis: ReadonlySet<number>;
  /**
   * The exact notes that make up `midis`. Once the user has played them the
   * take's own copies are skipped, so a resumed pass does not echo what they
   * just sounded live.
   */
  noteIds: ReadonlySet<string>;
}

function matches(note: NoteEvent, hand: TrainingHand): boolean {
  return hand === 'both' || noteHand(note) === hand;
}

/**
 * The next place training playback should stop, or null if the hand has
 * nothing left to play. `fromMs` is inclusive: a note starting exactly there
 * gates, which is what a seek onto a chord should do. Callers resuming from a
 * gate pass a time past the chord they just cleared.
 *
 * `notes` must be sorted by startMs.
 */
export function nextTrainingGate(
  notes: readonly NoteEvent[],
  fromMs: number,
  hand: TrainingHand,
): TrainingGate | null {
  let index = lowerBoundByStart(notes, fromMs);
  while (index < notes.length && !matches(notes[index] as NoteEvent, hand)) index += 1;
  if (index >= notes.length) return null;

  const atMs = (notes[index] as NoteEvent).startMs;
  const midis = new Set<number>();
  const noteIds = new Set<string>();
  for (let i = index; i < notes.length; i += 1) {
    const note = notes[i] as NoteEvent;
    if (note.startMs > atMs + CHORD_WINDOW_MS) break;
    if (!matches(note, hand)) continue;
    midis.add(note.midi);
    noteIds.add(note.id);
  }
  return { atMs, midis, noteIds };
}
