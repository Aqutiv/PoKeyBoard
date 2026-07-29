import { useCallback, useSyncExternalStore } from 'react';
import type { PedalEvent } from '@/domain/takeTypes';
import { scrubController } from '@/features/notation/scrubController';
import {
  isPedalDownIn,
  sustainIntervals,
  type SustainInterval,
} from '@/features/transport/sustainPedal';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';
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
  // Playback lights notes under the playhead; recording does the same so an
  // overdub pass shows its backing on the keyboard (matching the score).
  if (state !== 'playing' && state !== 'recording') {
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

const POLL_MS = 90;

/** Same cadence for every playhead-driven keyboard cue; see `computeSnapshot`. */
function usePlayheadCueSubscribe(polling: boolean): (onStoreChange: () => void) => () => void {
  return useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = transportController.subscribeState(onStoreChange);
      const timer = polling ? setInterval(onStoreChange, POLL_MS) : null;
      return () => {
        unsubscribe();
        if (timer !== null) clearInterval(timer);
      };
    },
    [polling],
  );
}

function isCuePolling(state: TransportState): boolean {
  return state === 'playing' || state === 'scrubbing' || state === 'recording';
}

/**
 * Keys the keyboard should light beyond live input: notes sounding under
 * the playhead during playback, and scrub-audition flashes while scrubbing.
 */
export function usePlaybackActiveMidis(): ReadonlySet<number> {
  const subscribe = usePlayheadCueSubscribe(isCuePolling(useTransportState()));
  return useSyncExternalStore(subscribe, computeSnapshot);
}

let pedalSource: readonly PedalEvent[] | null = null;
let pedalIntervals: readonly SustainInterval[] = [];

/**
 * The take's pedal intervals, derived once per `pedalEvents` array. The
 * snapshot below runs ~11 times a second, and a take may carry tens of
 * thousands of pedal events — far too much sorting to redo per tick. Takes are
 * immutable in the store, so array identity is a sound cache key.
 */
function intervalsFor(pedals: readonly PedalEvent[]): readonly SustainInterval[] {
  if (pedals !== pedalSource) {
    pedalSource = pedals;
    pedalIntervals = sustainIntervals(pedals);
  }
  return pedalIntervals;
}

function pedalSnapshot(): boolean {
  const state = transportController.getState();
  // The take's own pedal marks, shown while the playhead moves — the same
  // states the note lights follow, so an overdub pass and a scrub show them.
  if (!isCuePolling(state)) return false;
  const pedals = useTakeStore.getState().take.pedalEvents;
  if (pedals.length === 0) return false;
  return isPedalDownIn(intervalsFor(pedals), transportController.getPlayheadMs());
}

/**
 * Whether the take's sustain pedal is down under the playhead, so the pedal
 * cue can light alongside the keys. A plain boolean, so no snapshot caching
 * is needed for the `useSyncExternalStore` contract.
 */
export function usePlaybackPedalDown(): boolean {
  const subscribe = usePlayheadCueSubscribe(isCuePolling(useTransportState()));
  return useSyncExternalStore(subscribe, pedalSnapshot);
}
