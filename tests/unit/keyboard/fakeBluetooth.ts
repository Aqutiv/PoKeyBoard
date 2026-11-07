import { expect, vi } from 'vitest';
import { BLE_MIDI_IO, BLE_MIDI_SERVICE } from '@/features/keyboard/bleMidiCodec';

/**
 * A Bluetooth MIDI keyboard as Web Bluetooth shows one: a device, its GATT
 * server, and the one MIDI characteristic, notifications in and packets out.
 * jsdom has no Web Bluetooth at all, so `installBluetooth` puts this on
 * `navigator.bluetooth`.
 */
export class FakeCharacteristic extends EventTarget {
  value: DataView | null = null;
  readonly properties = { writeWithoutResponse: true };
  readonly writes: number[][] = [];
  readonly startNotifications = vi.fn(async () => this);
  readonly writeValueWithoutResponse = vi.fn(async (value: Uint8Array) => {
    this.writes.push([...value]);
  });
  readonly writeValueWithResponse = vi.fn(async (value: Uint8Array) => {
    this.writes.push([...value]);
  });

  notify(...bytes: number[]) {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

export class FakeDevice extends EventTarget {
  readonly id: string;
  readonly name: string | undefined;
  characteristic = new FakeCharacteristic();
  /** Set to make the next connects fail, as an out-of-range keyboard does. */
  failConnects = 0;
  readonly gatt = {
    connected: false,
    connect: vi.fn(async () => {
      if (this.failConnects > 0) {
        this.failConnects -= 1;
        throw new DOMException('Connection failed', 'NetworkError');
      }
      this.gatt.connected = true;
      return this.server;
    }),
    disconnect: vi.fn(() => this.drop()),
  };
  readonly server = {
    getPrimaryService: vi.fn(async (uuid: string) => {
      expect(uuid).toBe(BLE_MIDI_SERVICE);
      return {
        getCharacteristic: vi.fn(async (id: string) => {
          expect(id).toBe(BLE_MIDI_IO);
          return this.characteristic;
        }),
      };
    }),
  };

  constructor(id: string, name?: string) {
    super();
    this.id = id;
    this.name = name;
  }

  /** The link goes, as it does when the keyboard is switched off. */
  drop() {
    if (!this.gatt.connected) return;
    this.gatt.connected = false;
    this.dispatchEvent(new Event('gattserverdisconnected'));
  }
}

export interface FakeBluetooth {
  requestDevice: ReturnType<typeof vi.fn>;
  getAvailability: ReturnType<typeof vi.fn>;
  getDevices?: ReturnType<typeof vi.fn>;
}

/** Puts a Web Bluetooth that offers `device` (read on each call) on `navigator`. */
export function installBluetooth(device: () => FakeDevice): FakeBluetooth {
  const bluetooth: FakeBluetooth = {
    requestDevice: vi.fn(async () => device()),
    getAvailability: vi.fn(async () => true),
    getDevices: vi.fn(async () => [device()]),
  };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: bluetooth });
  return bluetooth;
}

export function uninstallBluetooth(): void {
  Reflect.deleteProperty(navigator, 'bluetooth');
}
