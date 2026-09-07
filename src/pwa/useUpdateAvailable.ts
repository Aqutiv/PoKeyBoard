import { useSyncExternalStore } from 'react';
import { updateManager } from './updateManager';

const subscribe = (notify: () => void) => updateManager.subscribe(notify);
const snapshot = () => updateManager.updateAvailable;

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}
