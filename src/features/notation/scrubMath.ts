import { lowerBoundByStart as lowerBound } from '@/domain/noteEvents';
import type { NoteEvent, PlaybackLoop } from '@/domain/takeTypes';
import { foldIntoLoop, loopPassAt } from '@/features/transport/transportClock';

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

/**
 * Note onsets crossed moving `fromVirtualMs` → `toVirtualMs` on a run that
 * goes round `loop`, as playback's does: past the loop's end, virtual time
 * folds back to its top (`foldIntoLoop`). Each pass crosses the loop's own
 * notes, from its top, which plays, up to its end, which does not; the onsets
 * come in movement order, as `getCrossedNoteOnsets` gives them.
 *
 * Only the last `limit` of them, nearest where the movement lands: a long one
 * round a short loop crosses its notes many times over, and the passes whose
 * notes would be dropped are never walked.
 */
export function getCrossedNoteOnsetsRound(
  loop: PlaybackLoop,
  fromVirtualMs: number,
  toVirtualMs: number,
  sortedNotes: readonly NoteEvent[],
  limit = Number.POSITIVE_INFINITY,
): NoteEvent[] {
  const lastOf = (notes: NoteEvent[]) =>
    notes.length > limit ? notes.slice(notes.length - limit) : notes;
  const fromPass = loopPassAt(loop, fromVirtualMs);
  const toPass = loopPassAt(loop, toVirtualMs);
  const from = foldIntoLoop(loop, fromVirtualMs);
  const to = foldIntoLoop(loop, toVirtualMs);
  if (fromPass === toPass) return lastOf(getCrossedNoteOnsets(from, to, sortedNotes));
  // Half a millisecond inside each edge: onsets fall on whole milliseconds,
  // so a pass crosses the note on the loop's top and never one on its end.
  const top = loop.startMs - 0.5;
  const end = loop.endMs - 0.5;
  const forward = toPass > fromPass;
  // Out to the edge of the pass it starts in, round whole passes, and on to
  // where it lands; gathered from the landing back, as far as the limit.
  const leaving = getCrossedNoteOnsets(from, forward ? end : top, sortedNotes);
  const whole = getCrossedNoteOnsets(forward ? top : end, forward ? end : top, sortedNotes);
  const landing = getCrossedNoteOnsets(forward ? top : end, to, sortedNotes);
  const parts = [landing];
  let count = landing.length;
  const wholePasses = Math.abs(toPass - fromPass) - 1;
  for (let pass = 0; pass < wholePasses && count < limit && whole.length > 0; pass += 1) {
    parts.push(whole);
    count += whole.length;
  }
  if (count < limit) parts.push(leaving);
  return lastOf(parts.reverse().flat());
}
