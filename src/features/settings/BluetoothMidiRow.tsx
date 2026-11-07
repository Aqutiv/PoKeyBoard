import { useSyncExternalStore, type ReactNode } from 'react';
import {
  connectBluetoothMidi,
  disconnectBluetoothMidi,
  getBluetoothMidiSnapshot,
  reconnectBluetoothMidi,
  subscribeBluetoothMidi,
  type BluetoothMidiSnapshot,
} from '@/features/keyboard/bluetoothMidi';
import { useMessages } from '@/i18n/i18nContext';
import { useSettingsStore } from '@/state/useSettingsStore';

/**
 * Brings a known keyboard back, quietly if the browser can, and through the
 * chooser if it cannot. A click, so the chooser is allowed to open.
 */
async function reconnectOrChoose(id: string): Promise<void> {
  if (await reconnectBluetoothMidi(id, false)) return;
  await connectBluetoothMidi();
}

/**
 * The Bluetooth keyboard row, under the MIDI toggle: connect one through the
 * browser's chooser, see it connect and reconnect, and let it go. Disconnect
 * also forgets it, so the app stops reaching for it on later visits.
 */
export function BluetoothMidiRow() {
  const m = useMessages();
  const snapshot = useSyncExternalStore(subscribeBluetoothMidi, getBluetoothMidiSnapshot);
  const remembered = useSettingsStore((s) => s.bluetoothMidiDevice);
  const setRemembered = useSettingsStore((s) => s.setBluetoothMidiDevice);

  const forget = () => {
    disconnectBluetoothMidi();
    setRemembered(null);
  };

  const action = actionFor(snapshot, remembered?.id ?? null);
  let button: ReactNode = null;
  switch (action.kind) {
    case 'connect':
      button = (
        <button
          type="button"
          className="btn btn--small"
          disabled={action.disabled}
          onClick={() => void connectBluetoothMidi()}
        >
          {m.settings.bluetoothMidiConnect}
        </button>
      );
      break;
    case 'reconnect':
      button = (
        <>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => void reconnectOrChoose(action.id)}
          >
            {action.retry
              ? m.settings.bluetoothMidiRetry
              : m.settings.bluetoothMidiReconnect({ name: remembered?.name ?? action.name })}
          </button>
          <button type="button" className="btn btn--small" onClick={forget}>
            {m.settings.bluetoothMidiDisconnect}
          </button>
        </>
      );
      break;
    case 'disconnect':
      button = (
        <button type="button" className="btn btn--small" onClick={forget}>
          {m.settings.bluetoothMidiDisconnect}
        </button>
      );
      break;
  }

  return (
    <>
      <div className="setting-row">
        <span>{m.settings.bluetoothMidi}</span>
        <span className="setting-row__actions">{button}</span>
      </div>
      <BluetoothMidiStatus snapshot={snapshot} rememberedName={remembered?.name ?? null} />
      {snapshot.kind === 'unsupported' ? null : (
        <p className="settings__hint">{m.settings.bluetoothMidiHint}</p>
      )}
    </>
  );
}

type RowAction =
  | { kind: 'connect'; disabled: boolean }
  | { kind: 'reconnect'; id: string; name: string; retry: boolean }
  | { kind: 'disconnect' };

function actionFor(snapshot: BluetoothMidiSnapshot, rememberedId: string | null): RowAction {
  switch (snapshot.kind) {
    case 'unsupported':
      return { kind: 'connect', disabled: true };
    case 'choosing':
      return { kind: 'connect', disabled: true };
    case 'connecting':
    case 'connected':
    case 'reconnecting':
      return { kind: 'disconnect' };
    case 'error':
      return snapshot.device
        ? { kind: 'reconnect', id: snapshot.device.id, name: snapshot.device.name, retry: true }
        : { kind: 'connect', disabled: false };
    case 'idle':
      return rememberedId
        ? { kind: 'reconnect', id: rememberedId, name: '', retry: false }
        : { kind: 'connect', disabled: false };
  }
}

function BluetoothMidiStatus({
  snapshot,
  rememberedName,
}: {
  snapshot: BluetoothMidiSnapshot;
  rememberedName: string | null;
}) {
  const m = useMessages();
  switch (snapshot.kind) {
    case 'unsupported':
      return <p className="settings__hint">{m.settings.bluetoothMidiUnsupported}</p>;
    case 'idle':
      return (
        <p className="settings__hint" role="status">
          {rememberedName
            ? m.settings.bluetoothMidiLast({ name: rememberedName })
            : m.settings.bluetoothMidiIdle}
        </p>
      );
    case 'choosing':
      return (
        <p className="settings__hint" role="status">
          {m.settings.bluetoothMidiChoosing}
        </p>
      );
    case 'connecting':
      return (
        <p className="settings__hint" role="status">
          {m.settings.bluetoothMidiConnecting({ name: snapshot.device.name })}
        </p>
      );
    case 'connected':
      return (
        <p className="settings__hint settings__ok" role="status">
          {m.settings.bluetoothMidiConnected({ name: snapshot.device.name })}
        </p>
      );
    case 'reconnecting':
      return (
        <p className="settings__hint" role="status">
          {m.settings.bluetoothMidiReconnecting({ name: snapshot.device.name })}
        </p>
      );
    case 'error': {
      const message =
        snapshot.reason === 'noAdapter'
          ? m.settings.bluetoothMidiNoAdapter
          : snapshot.reason === 'blocked'
            ? m.settings.bluetoothMidiBlocked
            : snapshot.device
              ? m.settings.bluetoothMidiFailed({ name: snapshot.device.name })
              : m.settings.bluetoothMidiFailedAny;
      return (
        <p role="alert" className="settings__error">
          {message}
        </p>
      );
    }
  }
}
