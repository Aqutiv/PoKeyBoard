import { useSyncExternalStore } from 'react';
import { transportController } from '@/features/transport/transportController';

/** Training's cues change only as the transport says so. */
const subscribeCues = (onStoreChange: () => void) =>
  transportController.subscribeState(onStoreChange);

const EMPTY_MIDIS: ReadonlySet<number> = new Set();
let wrongCache: ReadonlySet<number> = EMPTY_MIDIS;

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const midi of a) if (!b.has(midi)) return false;
  return true;
}

function wrongSnapshot(): ReadonlySet<number> {
  const next = transportController.getTrainingWrongMidis();
  if (setsEqual(next, wrongCache)) return wrongCache;
  wrongCache = next;
  return wrongCache;
}

/**
 * The keys a training wait is asking for. The gate's own set is handed back
 * unchanged, so the snapshot is stable for as long as the wait is.
 */
export function useTrainingTargets(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeCues, () => transportController.getTrainingTargets());
}

/**
 * Keys pressed at a wait point that were not the ones being asked for. The
 * transport speaks up as a flash starts and again as it runs out, so nothing
 * here has to watch the clock.
 */
export function useTrainingWrongMidis(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeCues, wrongSnapshot);
}
