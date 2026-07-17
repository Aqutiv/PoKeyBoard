import { useCallback, useSyncExternalStore } from 'react';
import { transportController } from '@/features/transport/transportController';
import type { TransportState } from '@/features/transport/transportMachine';

const subscribe = (onStoreChange: () => void) => transportController.subscribeState(onStoreChange);

export function useTransportState(): TransportState {
  return useSyncExternalStore(subscribe, () => transportController.getState());
}

export function useMetronomeOn(): boolean {
  return useSyncExternalStore(subscribe, () => transportController.isMetronomeOn());
}

const PLAYHEAD_TICK_MS = 100;

/** Quantized so the snapshot is stable between ticks (uSES contract). */
const getPlayheadSnapshot = () =>
  Math.round(transportController.getPlayheadMs() / PLAYHEAD_TICK_MS) * PLAYHEAD_TICK_MS;

/**
 * Low-frequency playhead sampling (~10 Hz) for text readouts and sliders.
 * Smooth 60fps motion (the score playhead) reads the transport clock in its
 * own rAF loop instead of going through React state.
 */
export function usePlayheadMs(): number {
  const state = useTransportState();
  const moving = state === 'playing' || state === 'recording' || state === 'countIn';

  const subscribePlayhead = useCallback(
    (onStoreChange: () => void) => {
      const unsubscribe = transportController.subscribeState(onStoreChange);
      const timer = moving ? setInterval(onStoreChange, PLAYHEAD_TICK_MS) : null;
      return () => {
        unsubscribe();
        if (timer !== null) clearInterval(timer);
      };
    },
    [moving],
  );

  return useSyncExternalStore(subscribePlayhead, getPlayheadSnapshot);
}
