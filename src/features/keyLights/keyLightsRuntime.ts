import { subscribeFrame } from '@/app/frameClock';
import { audioEngine } from '@/audio/AudioEngine';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import { KeyLightsController } from './keyLightsController';
import { watchLightLinks } from './lightLinks';

function listen(target: EventTarget, type: string, listener: () => void): () => void {
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}

/** The app's one key-lights controller, reading the app's own state. Started by `useKeyLights`. */
export const keyLightsController = new KeyLightsController({
  now: () => performance.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  watchLinks: watchLightLinks,
  enabled: () => {
    const settings = useSettingsStore.getState();
    return settings.keyLights && settings.midiInput;
  },
  followsVelocity: () => useSettingsStore.getState().velocityShading,
  subscribeSettings: (listener) => useSettingsStore.subscribe(listener),
  transportState: () => transportController.getState(),
  playheadMs: () => transportController.getPlayheadMs(),
  notes: () => useTakeStore.getState().take.notes,
  subscribeTransport: (listener) => transportController.subscribeState(listener),
  subscribeInput: (listener) => audioEngine.subscribeInput(listener),
  subscribeFrames: (listener) => subscribeFrame(() => listener()),
  subscribeBackgroundTicks: (listener) => audioEngine.subscribeSchedulerTick(listener),
  hidden: () => document.visibilityState === 'hidden',
  backgroundPlayback: () => useSettingsStore.getState().backgroundPlayback,
  subscribeVisibility: (listener) => listen(document, 'visibilitychange', listener),
  subscribePageHide: (listener) => listen(window, 'pagehide', listener),
});
