import { lowerBoundByStart as lowerBound } from '@/domain/noteEvents';
import type { NoteEvent } from '@/domain/takeTypes';

/** First index whose startMs is > t. */
function upperBound(notes: readonly NoteEvent[], t: number): number {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((notes[mid] as NoteEvent).startMs <= t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Note onsets crossed by the playhead moving previousTimeMs → nextTimeMs
 * over notes sorted by startMs (binary-searched — no full scans per pointer
 * move).
 *
 * Boundary semantics prevent duplicate boundary events:
 * - Forward uses (prev, next]: landing exactly on an onset plays it; the
 *   onset you started on (just played) does not repeat.
 * - Backward uses (next, prev): both ends open, so jittering back onto an
 *   onset you just played forward stays silent until you actually pass it.
 *
 * Chords (equal startMs) always travel together, in movement order:
 * ascending for forward drags, descending for backward drags. Copies of one
 * key at one onset are the exception: they keep the order they came in either
 * way, since struck together the last is the one heard, and with notes in
 * strike order (`sortStrikes`) that has to be the louder whichever way the
 * playhead crossed them.
 */
export function getCrossedNoteOnsets(
  previousTimeMs: number,
  nextTimeMs: number,
  sortedNotes: readonly NoteEvent[],
): NoteEvent[] {
  if (previousTimeMs === nextTimeMs || sortedNotes.length === 0) return [];
  if (nextTimeMs > previousTimeMs) {
    const start = upperBound(sortedNotes, previousTimeMs);
    const end = upperBound(sortedNotes, nextTimeMs);
    return sortedNotes.slice(start, end);
  }
  const start = upperBound(sortedNotes, nextTimeMs);
  const end = lowerBound(sortedNotes, previousTimeMs);
  const passed = sortedNotes.slice(start, end);
  const crossed: NoteEvent[] = [];
  // Back to front, a run at a time: the copies of one key at one onset.
  for (let last = passed.length - 1; last >= 0;) {
    const { startMs, midi } = passed[last] as NoteEvent;
    let first = last;
    while (first > 0) {
      const before = passed[first - 1] as NoteEvent;
      if (before.startMs !== startMs || before.midi !== midi) break;
      first -= 1;
    }
    crossed.push(...passed.slice(first, last + 1));
    last = first - 1;
  }
  return crossed;
}
