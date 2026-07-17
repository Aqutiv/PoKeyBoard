import { useCallback, useSyncExternalStore } from 'react';
import { scrubController } from '@/features/notation/scrubController';
import { transportController } from '@/features/transport/transportController';
import { useTakeStore } from '@/state/useTakeStore';
import { useTransportState } from './useTransport';

const EMPTY: ReadonlySet<number> = new Set();
let cache: ReadonlySet<number> = EMPTY;

function setsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function computeSnapshot(): ReadonlySet<number> {
  const state = transportController.getState();
  if (state === 'scrubbing') {
    const scrubActive = scrubController.getActiveMidis();
    if (setsEqual(scrubActive, cache)) return cache;
    cache = scrubActive;
    return cache;
  }
  if (state !== 'playing') {
    if (cache !== EMPTY && cache.size > 0) cache = EMPTY;
    return cache;
  }
  const playheadMs = transportController.getPlayheadMs();
  const notes = useTakeStore.getState().take.notes; // sorted by startMs
  const next = new Set<number>();
  for (const note of notes) {
    if (note.startMs > playheadMs) break;
    if (playheadMs < note.startMs + note.durationMs) next.add(note.midi);
  }
  if (setsEqual(next, cache)) return cache;
  cache = next;
  return cache;
}

/**
 * Keys the keyboard should light beyond live input: notes sounding under
 * the playhead during playback, and scrub-audition flashes while scrubbing.
 */
export function usePlaybackActiveMidis(): ReadonlySet<number> {
  const state = useTransportState();
  const polling = state === 'playing' || state === 'scrubbing';

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = transportController.subscribeState(onStoreChange);
      const timer = polling ? setInterval(onStoreChange, 90) : null;
      return () => {
        unsubscribe();
        if (timer !== null) clearInterval(timer);
      };
    },
    [polling],
  );

  return useSyncExternalStore(subscribe, computeSnapshot);
}
