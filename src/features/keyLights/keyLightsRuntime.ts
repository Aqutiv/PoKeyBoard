import { subscribeFrame } from '@/app/frameClock';
import { audioEngine } from '@/audio/AudioEngine';
import type { Hand } from '@/domain/hands';
import { getScreenCues, subscribeScreenCues } from '@/features/keyboard/screenCues';
import { practiceHandFor } from '@/features/transport/modes';
import { transportController } from '@/features/transport/transportController';
import { useSettingsStore } from '@/state/useSettingsStore';
import { useTakeStore } from '@/state/useTakeStore';
import type { KeyLightScene } from './keyLightModel';
import { KeyLightsController } from './keyLightsController';
import { watchLightLinks } from './lightLinks';
import { comingNotes, holdTargetHands } from './practiceLights';

const NOT_COMING: ReadonlyMap<number, Hand> = new Map();

/**
 * Beyond the take: the keys a hold waits for, in their hands (read from the
 * transport itself, so they light on any tab), the keys a lesson asks for or
 * pictures and the wrong ones (as the screen marks them), and, while a hand
 * is practised, its next notes.
 */
function practiceScene(): Pick<KeyLightScene, 'targets' | 'wrong' | 'coming' | 'faint'> {
  const screen = getScreenCues();
  const notes = useTakeStore.getState().take.notes;
  const state = transportController.getState();
  const playheadMs = transportController.getPlayheadMs();
  const held = transportController.getTrainingTargets();

  const targets = new Map<number, Hand | null>();
  for (const midi of screen.pictured) targets.set(midi, null);
  for (const midi of screen.targets) targets.set(midi, null);
  for (const [midi, hand] of holdTargetHands(notes, held, playheadMs)) targets.set(midi, hand);

  // Practice plays (Keep time counts in while playing, too) or holds. A
  // recording's count-in is `countIn`, and asks nothing of a practised hand.
  const hand = practiceHandFor(useSettingsStore.getState().playbackMode);
  const practising = hand !== null && (state === 'playing' || held.size > 0);
  const coming = practising
    ? comingNotes(
        notes,
        playheadMs,
        hand,
        transportController.getSpeed(),
        transportController.getLoop(),
        held.size > 0,
      )
    : NOT_COMING;
  return { targets, wrong: screen.wrong, coming, faint: screen.picturedSecond };
}

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
  extras: practiceScene,
  subscribeExtras: subscribeScreenCues,
});
