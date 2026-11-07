import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetBluetoothMidiForTests,
  getBluetoothMidiSnapshot,
} from '@/features/keyboard/bluetoothMidi';
import { useBluetoothMidi } from '@/features/keyboard/useBluetoothMidi';
import { BluetoothMidiRow } from '@/features/settings/BluetoothMidiRow';
import { en } from '@/i18n/en';
import { I18nContext } from '@/i18n/i18nContext';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';
import {
  FakeDevice,
  installBluetooth,
  uninstallBluetooth,
  type FakeBluetooth,
} from '../keyboard/fakeBluetooth';

let device: FakeDevice;
let bluetooth: FakeBluetooth;

/** The row, with the shell's hook beside it as the app runs it. */
function Harness() {
  useBluetoothMidi();
  return <BluetoothMidiRow />;
}

function renderRow() {
  render(
    <I18nContext.Provider value={{ language: 'en', locale: 'en-US', m: en }}>
      <Harness />
    </I18nContext.Provider>,
  );
}

function button(name: string) {
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  __resetBluetoothMidiForTests();
  useSettingsStore.setState({ ...SETTINGS_DEFAULTS, midiInput: true });
  device = new FakeDevice('dev-1', 'PartyKeys');
  bluetooth = installBluetooth(() => device);
});

afterEach(() => {
  cleanup();
  __resetBluetoothMidiForTests();
  uninstallBluetooth();
});

describe('BluetoothMidiRow', () => {
  it('connects a keyboard picked in the chooser, and remembers it', async () => {
    renderRow();
    expect(screen.getByText(en.settings.bluetoothMidiIdle)).toBeInTheDocument();

    fireEvent.click(button(en.settings.bluetoothMidiConnect));

    expect(
      await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' })),
    ).toBeInTheDocument();
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().bluetoothMidiDevice).toEqual({
      id: 'dev-1',
      name: 'PartyKeys',
    });
  });

  it('disconnects and forgets the keyboard', async () => {
    renderRow();
    fireEvent.click(button(en.settings.bluetoothMidiConnect));
    await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' }));

    fireEvent.click(button(en.settings.bluetoothMidiDisconnect));

    expect(screen.getByText(en.settings.bluetoothMidiIdle)).toBeInTheDocument();
    expect(device.gatt.disconnect).toHaveBeenCalled();
    expect(useSettingsStore.getState().bluetoothMidiDevice).toBeNull();
  });

  it('reconnects a remembered keyboard on load, without the chooser', async () => {
    useSettingsStore.setState({ bluetoothMidiDevice: { id: 'dev-1', name: 'PartyKeys' } });
    renderRow();
    expect(
      await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' })),
    ).toBeInTheDocument();
    expect(bluetooth.requestDevice).not.toHaveBeenCalled();
  });

  it('offers to reconnect where the browser cannot list granted keyboards', async () => {
    delete bluetooth.getDevices;
    useSettingsStore.setState({ bluetoothMidiDevice: { id: 'dev-1', name: 'PartyKeys' } });
    renderRow();
    expect(
      screen.getByText(en.settings.bluetoothMidiLast({ name: 'PartyKeys' })),
    ).toBeInTheDocument();

    fireEvent.click(button(en.settings.bluetoothMidiReconnect({ name: 'PartyKeys' })));

    expect(
      await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' })),
    ).toBeInTheDocument();
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
  });

  it('reports a failed connection and tries again on request', async () => {
    device.failConnects = 1;
    renderRow();
    fireEvent.click(button(en.settings.bluetoothMidiConnect));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      en.settings.bluetoothMidiFailed({ name: 'PartyKeys' }),
    );

    fireEvent.click(button(en.settings.bluetoothMidiRetry));
    expect(
      await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' })),
    ).toBeInTheDocument();
    // The retry goes back to the keyboard already chosen.
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
  });

  it('lets the keyboard go while MIDI is off, and reaches for it again when it is back on', async () => {
    renderRow();
    fireEvent.click(button(en.settings.bluetoothMidiConnect));
    await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' }));

    act(() => useSettingsStore.getState().setMidiInput(false));
    expect(getBluetoothMidiSnapshot().kind).toBe('idle');
    expect(useSettingsStore.getState().bluetoothMidiDevice).not.toBeNull();

    act(() => useSettingsStore.getState().setMidiInput(true));
    expect(
      await screen.findByText(en.settings.bluetoothMidiConnected({ name: 'PartyKeys' })),
    ).toBeInTheDocument();
  });

  it('explains what to use where the browser has no Web Bluetooth', () => {
    uninstallBluetooth();
    renderRow();
    expect(button(en.settings.bluetoothMidiConnect)).toBeDisabled();
    expect(screen.getByText(en.settings.bluetoothMidiUnsupported)).toBeInTheDocument();
  });
});
