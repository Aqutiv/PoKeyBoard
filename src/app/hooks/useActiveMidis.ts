import { useCallback, useSyncExternalStore } from 'react';
import { noteHand, type Hand } from '@/domain/hands';
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

const EMPTY: ReadonlyMap<number, Hand> = new Map();
let cache: ReadonlyMap<number, Hand> = EMPTY;

function mapsEqual(a: ReadonlyMap<number, Hand>, b: ReadonlyMap<number, Hand>): boolean {
  if (a.size !== b.size) return false;
  for (const [midi, hand] of a) if (b.get(midi) !== hand) return false;
  return true;
}

function computeSnapshot(): ReadonlyMap<number, Hand> {
  const state = transportController.getState();
  if (state === 'scrubbing') {
    const scrubActive = scrubController.getActiveHands();
    if (mapsEqual(scrubActive, cache)) return cache;
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
  const next = new Map<number, Hand>();
  for (const note of notes) {
    if (note.startMs > playheadMs) break;
    if (playheadMs >= note.startMs + note.durationMs) continue;
    // A unison across the hands is rare and momentary; the first one sounding
    // owns the key rather than the light flickering between two shades.
    if (!next.has(note.midi)) next.set(note.midi, noteHand(note));
  }
  if (mapsEqual(next, cache)) return cache;
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
 * Keys the keyboard should light beyond live input, each with the hand that
 * plays it: notes sounding under the playhead during playback, and
 * scrub-audition flashes while scrubbing.
 */
export function usePlaybackActiveHands(): ReadonlyMap<number, Hand> {
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
