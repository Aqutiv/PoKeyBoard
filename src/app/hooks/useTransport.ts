import { useCallback, useSyncExternalStore } from 'react';
import { subscribeFrame } from '@/app/frameClock';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';

const subscribe = (onStoreChange: () => void) => transportController.subscribeState(onStoreChange);

export function useTransportState(): TransportState {
  return useSyncExternalStore(subscribe, () => transportController.getState());
}

export function usePianoSwitching(): boolean {
  return useSyncExternalStore(subscribe, () => transportController.isPianoSwitching());
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

  return useSyncExternalStore(subscribePlayhead, getPlayheadSnapshot);
}
