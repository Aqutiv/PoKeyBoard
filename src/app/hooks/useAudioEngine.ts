import { useSyncExternalStore } from 'react';
import { audioEngine, type InstrumentSwitchState } from '@/audio/AudioEngine';
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
const getCoreReady = () => audioEngine.bank.isCoreReady();

export function useSampleLoadProgress(): SampleLoadProgress {
  return useSyncExternalStore(subscribeProgress, getProgress);
}

const subscribeSwitch = (onStoreChange: () => void) => audioEngine.subscribeSwitch(onStoreChange);
const getSwitchState = () => audioEngine.getSwitchState();

/** Where a change of piano stands: the one decoding, and the last that failed. */
export function usePianoSwitchState(): InstrumentSwitchState {
  return useSyncExternalStore(subscribeSwitch, getSwitchState);
}

/** A new piano is decoding while the previous one plays on. */
export function usePianoSwitching(): boolean {
  return usePianoSwitchState().pending !== null;
}

/** The piano playing can play — all Play and Resume need, even mid-switch. */
export function usePianoPlayable(): boolean {
  return useSyncExternalStore(subscribeProgress, getCoreReady);
}

/** The piano chosen is the one playing, and ready; recording waits for this. */
export function usePianoReady(): boolean {
  const switching = usePianoSwitching();
  const coreReady = usePianoPlayable();
  return !switching && coreReady;
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
