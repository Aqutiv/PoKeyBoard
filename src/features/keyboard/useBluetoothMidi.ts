import { useEffect, useSyncExternalStore } from 'react';
import { useSettingsStore } from '@/state/useSettingsStore';
import {
  disconnectBluetoothMidi,
  getBluetoothMidiSnapshot,
  reconnectBluetoothMidi,
  subscribeBluetoothMidi,
} from './bluetoothMidi';

/** Whether a Bluetooth keyboard is playing right now; the MIDI calibration needs one. */
export function useBluetoothMidiConnected(): boolean {
  return useSyncExternalStore(
    subscribeBluetoothMidi,
    () => getBluetoothMidiSnapshot().kind === 'connected',
  );
}

/**
 * Keeps a Bluetooth keyboard with the MIDI setting, for the whole session.
 *
 * The keyboard chosen in Settings is remembered once it connects, and reached
 * for again, without the chooser, whenever MIDI is on: on load, and when MIDI
 * is turned back on. Turning MIDI off lets it go. Mounted once, in the shell,
 * beside `useMidiInput`, which plays what it sends.
 */
export function useBluetoothMidi(): void {
  const enabled = useSettingsStore((s) => s.midiInput);
  const rememberedId = useSettingsStore((s) => s.bluetoothMidiDevice?.id ?? null);

  // Subscribed here rather than rendered from: a connection changing state
  // has nothing to redraw in the shell.
  useEffect(
    () =>
      subscribeBluetoothMidi(() => {
        const snapshot = getBluetoothMidiSnapshot();
        if (snapshot.kind !== 'connected') return;
        const { bluetoothMidiDevice, setBluetoothMidiDevice } = useSettingsStore.getState();
        const { id, name } = snapshot.device;
        if (bluetoothMidiDevice?.id !== id || bluetoothMidiDevice.name !== name) {
          setBluetoothMidiDevice({ id, name });
        }
      }),
    [],
  );

  useEffect(() => {
    if (!enabled) {
      disconnectBluetoothMidi();
      return;
    }
    if (rememberedId) void reconnectBluetoothMidi(rememberedId);
  }, [enabled, rememberedId]);
}
