import { useCallback, useSyncExternalStore } from 'react';
import { subscribeFrame } from '@/app/frameClock';
import { transportController } from '@/features/transport/transportController';
import { useTrainingWaiting } from './useTransport';

/**
 * Subscribe to the transport, and to every frame while `framed` — for a cue
 * that changes with time rather than on an event.
 */
function useCueSubscribe(framed: boolean): (onStoreChange: () => void) => () => void {
  return useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = transportController.subscribeState(onStoreChange);
      const stopFrames = framed ? subscribeFrame(onStoreChange) : null;
      return () => {
        unsubscribe();
        stopFrames?.();
      };
    },
    [framed],
  );
}

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
  return useSyncExternalStore(useCueSubscribe(false), () =>
    transportController.getTrainingTargets(),
  );
}

/**
 * Keys pressed at a wait point that were not the ones being asked for. Read on
 * the frame clock while a wait holds, because a flash expires on a timer
 * rather than on an event.
 */
export function useTrainingWrongMidis(): ReadonlySet<number> {
  return useSyncExternalStore(useCueSubscribe(useTrainingWaiting()), wrongSnapshot);
}
