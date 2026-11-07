import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLE_MIDI_SERVICE } from '@/features/keyboard/bleMidiCodec';
import {
  __resetBluetoothMidiForTests,
  connectBluetoothMidi,
  disconnectBluetoothMidi,
  getBluetoothMidiSnapshot,
  reconnectBluetoothMidi,
  retryDelayMs,
  subscribeBluetoothPorts,
  type BluetoothMidiPort,
} from '@/features/keyboard/bluetoothMidi';
import { __resetForTests as resetMidiAccess } from '@/features/keyboard/midiAccess';
import { MidiInput } from '@/features/keyboard/midiInput';
import {
  FakeCharacteristic,
  FakeDevice,
  installBluetooth,
  uninstallBluetooth,
  type FakeBluetooth,
} from './fakeBluetooth';

let device: FakeDevice;
let bluetooth: FakeBluetooth;

function installBluetoothFake() {
  bluetooth = installBluetooth(() => device);
}
function latestPorts() {
  let ports: readonly BluetoothMidiPort[] = [];
  const stop = subscribeBluetoothPorts((next) => {
    ports = next;
  });
  return {
    get ports() {
      return ports;
    },
    stop,
  };
}

beforeEach(() => {
  __resetBluetoothMidiForTests();
  resetMidiAccess();
  device = new FakeDevice('dev-1', 'PartyKeys');
  installBluetoothFake();
});

afterEach(() => {
  vi.useRealTimers();
  __resetBluetoothMidiForTests();
  resetMidiAccess();
  uninstallBluetooth();
});

describe('bluetoothMidi', () => {
  it('reads as unsupported where the browser has no Web Bluetooth', () => {
    Reflect.deleteProperty(navigator, 'bluetooth');
    expect(getBluetoothMidiSnapshot()).toEqual({ kind: 'unsupported' });
  });

  it('lists BLE-MIDI keyboards in the chooser and connects the one picked', async () => {
    const watch = latestPorts();
    await connectBluetoothMidi();

    expect(bluetooth.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [BLE_MIDI_SERVICE] }, { namePrefix: 'PartyKeys' }],
      optionalServices: [BLE_MIDI_SERVICE],
    });
    expect(device.characteristic.startNotifications).toHaveBeenCalled();
    expect(getBluetoothMidiSnapshot()).toEqual({
      kind: 'connected',
      device: { id: 'dev-1', name: 'PartyKeys' },
    });
    expect(watch.ports.map((port) => [port.id, port.name])).toEqual([
      ['bluetooth:dev-1', 'PartyKeys'],
    ]);
    watch.stop();
  });

  it('reads the MIDI characteristic once before notifications start, as BLE-MIDI asks', async () => {
    await connectBluetoothMidi();
    expect(device.characteristic.calls).toEqual(['read', 'notify']);
  });

  it('still connects a keyboard that does not allow the initial read', async () => {
    device.characteristic.refuseRead = true;
    await connectBluetoothMidi();
    expect(getBluetoothMidiSnapshot().kind).toBe('connected');
  });

  it('turns notifications into whole MIDI messages on the port', async () => {
    const watch = latestPorts();
    await connectBluetoothMidi();
    const port = watch.ports[0] as BluetoothMidiPort;
    const received: number[][] = [];
    port.addEventListener('midimessage', (event) => {
      received.push([...((event as MessageEvent).data as Uint8Array)]);
    });

    // A note-on, then a second in running status, then a PartyKeys SysEx.
    device.characteristic.notify(0x80, 0x81, 0x90, 60, 100, 64, 90);
    device.characteristic.notify(
      0x80,
      0x81,
      0xf0,
      0x05,
      0x30,
      0x10,
      0x00,
      0x00,
      0x3f,
      0x16,
      0x82,
      0xf7,
    );

    expect(received).toEqual([
      [0x90, 60, 100],
      [0x90, 64, 90],
      [0xf0, 0x05, 0x30, 0x10, 0x00, 0x00, 0x3f, 0x16, 0xf7],
    ]);
    watch.stop();
  });

  it('plays through MidiInput like any MIDI keyboard, and lets go of held notes when it drops', async () => {
    vi.useFakeTimers();
    const callbacks = {
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      setSustain: vi.fn(),
      shiftRange: vi.fn(),
      setVolume: vi.fn(),
    };
    const detach = new MidiInput().attach(callbacks);
    await connectBluetoothMidi();

    device.characteristic.notify(0x80, 0x81, 0x90, 62, 127);
    expect(callbacks.noteOn).toHaveBeenCalledWith(62, expect.any(Number));

    device.drop();
    expect(callbacks.noteOff).toHaveBeenCalledWith(62);
    expect(getBluetoothMidiSnapshot().kind).toBe('reconnecting');

    // It comes back on its own, and plays again.
    device.characteristic = new FakeCharacteristic();
    await vi.advanceTimersByTimeAsync(retryDelayMs(0));
    expect(getBluetoothMidiSnapshot().kind).toBe('connected');
    device.characteristic.notify(0x80, 0x81, 0x90, 64, 100);
    expect(callbacks.noteOn).toHaveBeenLastCalledWith(64, expect.any(Number));
    detach();
  });

  it('backs off between reconnection attempts', async () => {
    vi.useFakeTimers();
    await connectBluetoothMidi();
    device.failConnects = 2;
    device.drop();

    await vi.advanceTimersByTimeAsync(retryDelayMs(0));
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
    expect(getBluetoothMidiSnapshot().kind).toBe('reconnecting');

    // The second wait is longer than the first.
    await vi.advanceTimersByTimeAsync(retryDelayMs(0));
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(retryDelayMs(1) - retryDelayMs(0));
    expect(device.gatt.connect).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(retryDelayMs(2));
    expect(device.gatt.connect).toHaveBeenCalledTimes(4);
    expect(getBluetoothMidiSnapshot().kind).toBe('connected');
  });

  it('waits 2 s, then doubles, to at most 30 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('stops trying once disconnected', async () => {
    vi.useFakeTimers();
    const watch = latestPorts();
    await connectBluetoothMidi();
    disconnectBluetoothMidi();

    expect(device.gatt.disconnect).toHaveBeenCalled();
    expect(watch.ports).toEqual([]);
    expect(getBluetoothMidiSnapshot()).toEqual({ kind: 'idle' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
    watch.stop();
  });

  it('goes back quietly when the chooser is closed', async () => {
    bluetooth.requestDevice.mockRejectedValueOnce(
      new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError'),
    );
    await connectBluetoothMidi();
    expect(getBluetoothMidiSnapshot()).toEqual({ kind: 'idle' });
  });

  it('says so when there is no Bluetooth to use', async () => {
    // Chrome's answer for a missing or switched-off adapter, as for a closed chooser.
    bluetooth.requestDevice.mockRejectedValueOnce(
      new DOMException('Bluetooth adapter not available.', 'NotFoundError'),
    );
    bluetooth.getAvailability.mockResolvedValueOnce(false);
    await connectBluetoothMidi();
    expect(getBluetoothMidiSnapshot()).toEqual({
      kind: 'error',
      reason: 'noAdapter',
      device: null,
    });
  });

  it('opens the chooser even when the browser says there is no Bluetooth', async () => {
    // getAvailability can be wrong; the chooser is the one that knows.
    bluetooth.getAvailability.mockResolvedValue(false);
    await connectBluetoothMidi();
    expect(bluetooth.requestDevice).toHaveBeenCalledTimes(1);
    expect(getBluetoothMidiSnapshot().kind).toBe('connected');
  });

  it('reports a first connection that fails, and does not keep trying', async () => {
    vi.useFakeTimers();
    device.failConnects = 1;
    await connectBluetoothMidi();
    expect(getBluetoothMidiSnapshot()).toEqual({
      kind: 'error',
      reason: 'failed',
      device: { id: 'dev-1', name: 'PartyKeys' },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
  });

  it('reconnects a granted keyboard without the chooser', async () => {
    await expect(reconnectBluetoothMidi('dev-1')).resolves.toBe(true);
    await vi.waitFor(() => expect(getBluetoothMidiSnapshot().kind).toBe('connected'));
    expect(bluetooth.requestDevice).not.toHaveBeenCalled();
  });

  it('stays disconnected when MIDI goes off while the browser is still listing keyboards', async () => {
    let list: (devices: FakeDevice[]) => void = () => undefined;
    bluetooth.getDevices = vi.fn(
      () =>
        new Promise<FakeDevice[]>((resolve) => {
          list = resolve;
        }),
    );
    const reconnecting = reconnectBluetoothMidi('dev-1');
    disconnectBluetoothMidi();
    list([device]);

    await expect(reconnecting).resolves.toBe(true);
    expect(device.gatt.connect).not.toHaveBeenCalled();
    expect(getBluetoothMidiSnapshot()).toEqual({ kind: 'idle' });
  });

  it('needs the chooser where the browser cannot list granted keyboards', async () => {
    delete bluetooth.getDevices;
    await expect(reconnectBluetoothMidi('dev-1')).resolves.toBe(false);
    expect(device.gatt.connect).not.toHaveBeenCalled();
  });

  it('needs the chooser for a keyboard the browser no longer lists', async () => {
    await expect(reconnectBluetoothMidi('someone-else')).resolves.toBe(false);
  });

  it('names a keyboard that advertises no name', async () => {
    device = new FakeDevice('dev-2');
    await connectBluetoothMidi();
    expect(getBluetoothMidiSnapshot()).toMatchObject({ device: { name: 'Bluetooth MIDI' } });
  });

  it('writes SysEx as BLE-MIDI packets, in order, and refuses once disconnected', async () => {
    const watch = latestPorts();
    await connectBluetoothMidi();
    const port = watch.ports[0] as BluetoothMidiPort;
    const mode = Uint8Array.of(0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00, 0x0f, 0x01, 0xf7);
    const long = Uint8Array.from([0xf0, ...Array.from({ length: 40 }, (_, i) => i), 0xf7]);

    await Promise.all([port.send(mode), port.send(long)]);

    const writes = device.characteristic.writes;
    expect(writes).toHaveLength(4); // one packet, then three
    expect(writes[0]?.slice(2, -2)).toEqual([...mode.slice(0, -1)]);
    expect(writes.every((packet) => packet.length <= 20)).toBe(true);

    disconnectBluetoothMidi();
    await expect(port.send(mode)).rejects.toThrow();
    watch.stop();
  });

  it('writes with a response where the keyboard offers no other write', async () => {
    const watch = latestPorts();
    device.characteristic = Object.assign(new FakeCharacteristic(), {
      properties: { writeWithoutResponse: false },
    });
    await connectBluetoothMidi();
    await watch.ports[0]?.send(Uint8Array.of(0xf0, 0x01, 0xf7));
    expect(device.characteristic.writeValueWithResponse).toHaveBeenCalledTimes(1);
    expect(device.characteristic.writeValueWithoutResponse).not.toHaveBeenCalled();
    watch.stop();
  });
});
