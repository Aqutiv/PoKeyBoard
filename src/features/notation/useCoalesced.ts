import { useEffect, useRef, useState } from 'react';
import type { NoteEvent } from '@/domain/takeTypes';

/** How often, at most, the score is laid out again while a recording grows. */
export const RECORDING_RELAYOUT_MS = 250;

/**
 * `value`, but while `coalesce` holds, updated at most once every `intervalMs`
 * — or, if showing the last update took longer than that, at least that long
 * after it was shown: the first change after a quiet spell straight away (on
 * the next task), and a burst of changes as one. Otherwise `value` as it is,
 * with no delay at all.
 *
 * The score lays the whole take out again whenever its notes change. While
 * recording they change with every key let go, and on a slow machine a long
 * take's layout costs more than the time between notes; coalesced, a fast run
 * costs a few layouts a second instead of one a note, and never more than half
 * the main thread, however slow each layout is.
 */
export function useCoalesced<T>(
  value: T,
  coalesce: boolean,
  intervalMs = RECORDING_RELAYOUT_MS,
): T {
  const [shown, setShown] = useState(value);
  /** When the last update was asked for, and when it was on screen. */
  const timing = useRef({ askedAt: Number.NEGATIVE_INFINITY, shownAt: Number.NEGATIVE_INFINITY });
  // Not coalescing: keep up at once, during this very render.
  if (!coalesce && shown !== value) setShown(value);

  // Committed: the work of showing it is done.
  useEffect(() => {
    timing.current.shownAt = performance.now();
  }, [shown]);

  useEffect(() => {
    if (!coalesce || Object.is(shown, value)) return;
    const { askedAt, shownAt } = timing.current;
    const cost = Math.max(0, shownAt - askedAt);
    const wait = Math.max(0, shownAt + Math.max(intervalMs, cost) - performance.now());
    const timer = setTimeout(() => {
      timing.current.askedAt = performance.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, coalesce, intervalMs]);

  return coalesce ? shown : value;
}

const NONE: readonly NoteEvent[] = [];
/** Each laid-out snapshot's note ids, built once however many notes follow it. */
const idsOf = new WeakMap<readonly NoteEvent[], ReadonlySet<string>>();

/**
 * The notes of `all` that `laidOut` does not have yet — a recording's newest,
 * between two coalesced layouts — in `all`'s order. Empty (and always the same
 * empty array) when there are none.
 */
export function notesMissingFrom(
  all: readonly NoteEvent[],
  laidOut: readonly NoteEvent[],
): readonly NoteEvent[] {
  if (all === laidOut) return NONE;
  let ids = idsOf.get(laidOut);
  if (!ids) {
    ids = new Set(laidOut.map((note) => note.id));
    idsOf.set(laidOut, ids);
  }
  const missing = all.filter((note) => !ids.has(note.id));
  return missing.length > 0 ? missing : NONE;
}
