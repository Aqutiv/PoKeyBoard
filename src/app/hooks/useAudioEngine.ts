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
const getProgress = () => audioEngine.getLoadProgress();

export function useSampleLoadProgress(): SampleLoadProgress {
  return useSyncExternalStore(subscribeProgress, getProgress);
}

const subscribeActiveNotes = (onStoreChange: () => void) =>
  audioEngine.subscribeActiveNotes(onStoreChange);
const getActiveNotes = () => audioEngine.getActiveNotes();

export function useLiveActiveNotes(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeActiveNotes, getActiveNotes);
}

const subscribeSustain = (onStoreChange: () => void) => audioEngine.subscribeSustain(onStoreChange);
const getSustainDown = () => audioEngine.isSustainDown();

/** The pedal as the engine has it, so a panic reset cannot leave the UI lying. */
export function useSustainDown(): boolean {
  return useSyncExternalStore(subscribeSustain, getSustainDown);
}
