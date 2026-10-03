import { useEffect, useRef, useState } from 'react';
import type { NoteEvent } from '@/domain/takeTypes';

/** How often, at most, the score is laid out again while a recording grows. */
export const RECORDING_RELAYOUT_MS = 250;
/** The longest one update is taken to cost, however long it seemed to. */
const MAX_COST_MS = 2_000;

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
  /**
   * When the last coalesced update was asked for (null once it is on screen),
   * when it was on screen, and so what showing one costs. An update passed
   * straight through (a take opened or cleared) leaves no interval to wait out:
   * the next coalesced one shows at once.
   */
  const timing = useRef({
    askedAt: null as number | null,
    shownAt: Number.NEGATIVE_INFINITY,
    cost: 0,
  });
  // Not coalescing: keep up at once, during this very render.
  if (!coalesce && shown !== value) setShown(value);

  // Committed: the work of showing it is done. Only an update this hook asked
  // for is timed; one passed straight through says nothing about how long a
  // coalesced one takes.
  useEffect(() => {
    const now = performance.now();
    const { askedAt } = timing.current;
    timing.current.askedAt = null;
    if (askedAt === null) {
      timing.current.shownAt = Number.NEGATIVE_INFINITY;
      timing.current.cost = 0;
    } else {
      timing.current.shownAt = now;
      timing.current.cost = Math.min(MAX_COST_MS, now - askedAt);
    }
  }, [shown]);

  useEffect(() => {
    if (!coalesce || Object.is(shown, value)) return;
    const { shownAt, cost } = timing.current;
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
