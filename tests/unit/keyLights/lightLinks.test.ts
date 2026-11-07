import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetBluetoothMidiForTests,
  connectBluetoothMidi,
} from '@/features/keyboard/bluetoothMidi';
import {
  __resetForTests as resetMidiAccess,
  ensureAccess,
  ensureSysexAccess,
  getSysexState,
} from '@/features/keyboard/midiAccess';
import {
  pacedSender,
  pairOutput,
  watchLightLinks,
  type LightLinksSnapshot,
} from '@/features/keyLights/lightLinks';
import { FakeDevice, installBluetooth, uninstallBluetooth } from '../keyboard/fakeBluetooth';

class FakePort extends EventTarget {
  readonly id: string;
  readonly name: string;
  readonly sent: number[][] = [];

  constructor(id: string, name: string) {
    super();
    this.id = id;
    this.name = name;
  }

  send(data: Uint8Array) {
    this.sent.push([...data]);
  }
}

function access(inputs: FakePort[], outputs: FakePort[]) {
  return Object.assign(new EventTarget(), {
    inputs: new Map(inputs.map((port) => [port.id, port])),
    outputs: new Map(outputs.map((port) => [port.id, port])),
  });
}

describe('pacedSender', () => {
  it('sends one frame at a time, at least the spacing apart', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const send = pacedSender(
      () => {
        times.push(Date.now());
      },
      8,
      () => Date.now(),
    );
    const done = Promise.all([
      send(Uint8Array.of(1)),
      send(Uint8Array.of(2)),
      send(Uint8Array.of(3)),
    ]);
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(times).toHaveLength(3);
    expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(8);
    expect((times[2] as number) - (times[1] as number)).toBeGreaterThanOrEqual(8);
    vi.useRealTimers();
  });

  it('rejects a failed send and carries on with the next', async () => {
    let calls = 0;
    const send = pacedSender(() => {
      calls += 1;
      if (calls === 1) throw new Error('refused');
    }, 0);
    await expect(send(Uint8Array.of(1))).rejects.toThrow('refused');
    await expect(send(Uint8Array.of(2))).resolves.toBeUndefined();
  });
});

describe('pairOutput', () => {
  const out = (id: string, name: string) => new FakePort(id, name) as unknown as MIDIOutput;

  it('lights an input through the PartyKeys output of its own name', () => {
    const synth = out('0', 'Microsoft GS Wavetable Synth');
    const partyKeys = out('1', 'PartyKeys');
    expect(pairOutput({ name: 'PartyKeys' }, [synth, partyKeys])).toBe(partyKeys);
  });

  it('takes the only PartyKeys output when the names differ', () => {
    const partyKeys = out('1', '2- PartyKeys MIDI');
    expect(pairOutput({ name: 'PartyKeys' }, [partyKeys])).toBe(partyKeys);
  });

  it('guesses neither of two that do not match, and lights nothing else', () => {
    expect(
      pairOutput({ name: 'PartyKeys' }, [out('1', 'PartyKeys A'), out('2', 'PartyKeys B')]),
    ).toBeNull();
    expect(pairOutput({ name: 'PartyKeys' }, [out('3', 'Keystation 49')])).toBeNull();
  });
});

describe('watchLightLinks', () => {
  let snapshots: LightLinksSnapshot[];
  let stop: () => void;
  const latest = () => snapshots[snapshots.length - 1] as LightLinksSnapshot;

  beforeEach(() => {
    resetMidiAccess();
    __resetBluetoothMidiForTests();
    snapshots = [];
  });

  afterEach(() => {
    stop?.();
    resetMidiAccess();
    __resetBluetoothMidiForTests();
    uninstallBluetooth();
  });

  it('offers a USB PartyKeys only once SysEx is granted, and then lights it through its output', async () => {
    const input = new FakePort('in-1', 'PartyKeys');
    const output = new FakePort('out-1', 'PartyKeys');
    const request = vi.fn(async () => access([input], [output]));
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: request });
    stop = watchLightLinks((snapshot) => snapshots.push(snapshot));

    await ensureAccess();
    expect(latest()).toEqual({ links: [], awaitingSysex: 'PartyKeys' });

    await expect(ensureSysexAccess()).resolves.toBe(true);
    expect(request).toHaveBeenLastCalledWith({ sysex: true });
    expect(getSysexState()).toBe('granted');
    const [link] = latest().links;
    expect(link).toMatchObject({ transport: 'usb', name: 'PartyKeys', input });
    await link?.send(Uint8Array.of(0xf0, 0x01, 0xf7));
    expect(output.sent).toEqual([[0xf0, 0x01, 0xf7]]);
  });

  it('leaves plain MIDI as it was when SysEx is refused', async () => {
    const input = new FakePort('in-1', 'PartyKeys');
    const request = vi.fn(async (options?: MIDIOptions) => {
      if (options?.sysex) throw new DOMException('no', 'NotAllowedError');
      return access([input], [new FakePort('out-1', 'PartyKeys')]);
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: request });
    stop = watchLightLinks((snapshot) => snapshots.push(snapshot));
    await ensureAccess();

    await expect(ensureSysexAccess()).resolves.toBe(false);
    expect(getSysexState()).toBe('denied');
    expect(latest()).toEqual({ links: [], awaitingSysex: 'PartyKeys' });
  });

  it('lights a Bluetooth PartyKeys through its own port, ahead of USB, but no other Bluetooth keyboard', async () => {
    let device = new FakeDevice('dev-1', 'PartyKeys');
    installBluetooth(() => device);
    stop = watchLightLinks((snapshot) => snapshots.push(snapshot));
    await connectBluetoothMidi();
    expect(latest().links.map((link) => [link.transport, link.name])).toEqual([
      ['bluetooth', 'PartyKeys'],
    ]);

    __resetBluetoothMidiForTests();
    stop();
    snapshots = [];
    device = new FakeDevice('dev-2', 'Some BLE Piano');
    installBluetooth(() => device);
    stop = watchLightLinks((snapshot) => snapshots.push(snapshot));
    await connectBluetoothMidi();
    expect(latest().links).toEqual([]);
  });
});
