import { useSyncExternalStore } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import type { EngineStatus, SampleLoadProgress } from '@/audio/audioTypes';

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(
    (onStoreChange) => audioEngine.subscribeStatus(onStoreChange),
    () => audioEngine.getStatus(),
  );
}

export function useSampleLoadProgress(): SampleLoadProgress {
  return useSyncExternalStore(
    (onStoreChange) => audioEngine.subscribeLoadProgress(onStoreChange),
    () => audioEngine.bank.getProgress(),
  );
}

let cachedActiveNotes: ReadonlySet<number> = new Set();

export function useLiveActiveNotes(): ReadonlySet<number> {
  return useSyncExternalStore(
    (onStoreChange) =>
      audioEngine.subscribeActiveNotes((midis) => {
        cachedActiveNotes = midis;
        onStoreChange();
      }),
    () => cachedActiveNotes,
  );
}
