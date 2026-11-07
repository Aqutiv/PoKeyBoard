import { useEffect, useSyncExternalStore } from 'react';
import type { KeyLightsStatus } from './keyLightsController';
import { keyLightsController } from './keyLightsRuntime';

/**
 * Lights a connected PartyKeys for the whole session, on every tab, the way
 * a MIDI keyboard plays on every tab. Mounted once, in the shell.
 */
export function useKeyLights(): void {
  useEffect(() => keyLightsController.start(), []);
}

const subscribe = (listener: () => void) => keyLightsController.subscribeStatus(listener);
const getStatus = () => keyLightsController.getStatus();

/** The keyboard being lit, and whether a USB one waits on SysEx: for the Key lights row. */
export function useKeyLightsStatus(): KeyLightsStatus {
  return useSyncExternalStore(subscribe, getStatus);
}
