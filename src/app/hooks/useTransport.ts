import { useCallback, useSyncExternalStore } from 'react';
import { subscribeFrame } from '@/app/frameClock';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';

const subscribe = (onStoreChange: () => void) => transportController.subscribeState(onStoreChange);

export function useTransportState(): TransportState {
  return useSyncExternalStore(subscribe, () => transportController.getState());
}

/** Playback is holding for the user to play the keys training has lit. */
export function useTrainingWaiting(): boolean {
  return useSyncExternalStore(subscribe, () => transportController.isWaitingForTraining());
}

export function useMetronomeOn(): boolean {
  return useSyncExternalStore(subscribe, () => transportController.isMetronomeOn());
}

/** The readout's resolution: tenths, so it changes ten times a second at most. */
const PLAYHEAD_TICK_MS = 100;

/** Quantized so the snapshot is stable between ticks (uSES contract). */
const getPlayheadSnapshot = () =>
  Math.round(transportController.getPlayheadMs() / PLAYHEAD_TICK_MS) * PLAYHEAD_TICK_MS;

/**
 * The playhead for text readouts and sliders, read on the frame clock and
 * quantized to a tenth of a second, so React renders only when the readout
 * would change. Smooth motion (the score playhead) reads the transport clock
 * in its own rAF loop instead of going through React state.
 */
export function usePlayheadMs(): number {
  return usePlayhead(identity);
}

const identity = (ms: number) => ms;

/**
 * What `select` makes of the playhead (as `usePlayheadMs` reads it), rendering
 * only when that changes: a control that needs only whether the playhead is at
 * the start, or the tempo it falls in, is not rendered ten times a second for
 * a value it does not show. `select` should be stable (useCallback) and return
 * a primitive.
 */
export function usePlayhead<T>(select: (playheadMs: number) => T): T {
  const state = useTransportState();
  const moving = state === 'playing' || state === 'recording' || state === 'countIn';

  const subscribePlayhead = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = transportController.subscribeState(onStoreChange);
      const stopFrames = moving ? subscribeFrame(onStoreChange) : null;
      return () => {
        unsubscribe();
        stopFrames?.();
      };
    },
    [moving],
  );

  return useSyncExternalStore(subscribePlayhead, () => select(getPlayheadSnapshot()));
}
