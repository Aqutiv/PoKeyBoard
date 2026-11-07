import type { KeyCue } from '@/domain/hands';
import type { NoteEvent } from '@/domain/takeTypes';
import { scrubController } from '@/features/notation/scrubController';
import type { TransportState } from '@/features/transport/transportMachine';
import type { SoundingNotes } from './soundingNotes';

export const NO_KEYS: ReadonlyMap<number, KeyCue> = new Map();

/** The transport states whose playhead the key bed lights: moving, or dragged. */
export function cuesMove(state: TransportState): boolean {
  return state === 'playing' || state === 'recording' || state === 'scrubbing';
}

/**
 * The keys a take lights at `ms`, each in the hand that plays it, as hard as
 * it is heard: the notes sounding under the playhead or, while the score is
 * dragged, the keys the drag auditions. The on-screen keys and a light-up
 * keyboard's both read it here, so the two always show the same.
 */
export function takeCuesAt(
  sounding: SoundingNotes,
  state: TransportState,
  notes: readonly NoteEvent[],
  ms: number,
): ReadonlyMap<number, KeyCue> {
  if (state === 'scrubbing') return scrubController.getActiveKeys();
  sounding.setNotes(notes);
  return sounding.keysAt(ms);
}
