import { useSyncExternalStore } from 'react';
import { audioEngine } from '@/audio/AudioEngine';
import type { EngineStatus, SampleLoadProgress } from '@/audio/audioTypes';

// Subscribe functions must be referentially stable across renders, and every
// getSnapshot must return a stable reference until an event fires — both are
// useSyncExternalStore contract requirements (violations cause render loops).

const subscribeStatus = (onStoreChange: () => void) => audioEngine.subscribeStatus(onStoreChange);
const getStatus = () => audioEngine.getStatus();

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(subscribeStatus, getStatus);
}

const subscribeProgress = (onStoreChange: () => void) =>
  audioEngine.subscribeLoadProgress(onStoreChange);
const getProgress = () => audioEngine.bank.getProgress();

export function useSampleLoadProgress(): SampleLoadProgress {
  return useSyncExternalStore(subscribeProgress, getProgress);
}

const subscribeActiveNotes = (onStoreChange: () => void) =>
  audioEngine.subscribeActiveNotes(onStoreChange);
const getActiveNotes = () => audioEngine.getActiveNotes();

export function useLiveActiveNotes(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeActiveNotes, getActiveNotes);
}
