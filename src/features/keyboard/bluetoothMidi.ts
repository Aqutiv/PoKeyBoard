import {
  BLE_MIDI_IO,
  BLE_MIDI_MIN_PACKET,
  BLE_MIDI_SERVICE,
  BleMidiParser,
  bleMidiSysExPackets,
} from './bleMidiCodec';

/**
 * A Bluetooth LE MIDI keyboard, reached through Web Bluetooth.
 *
 * Web MIDI never lists a Bluetooth keyboard on Windows (WinMM has no BLE-MIDI
 * driver), so the app talks to the standard BLE-MIDI service itself: the
 * keyboard's notifications become `midimessage` events on a port that
 * `MidiInput` binds exactly as it binds a Web MIDI input, and SysEx written to
 * the port goes back out as BLE-MIDI packets.
 *
 * Like `midiAccess`, nothing here runs at import time. The device chooser
 * only ever opens from a click in Settings; a keyboard chosen before comes
 * back without one, where the browser can list the devices it has granted.
 */

/** The keyboard a later visit reconnects to. */
export interface BluetoothMidiDeviceInfo {
  id: string;
  name: string;
}

export type BluetoothMidiErrorReason = 'noAdapter' | 'blocked' | 'failed';

export type BluetoothMidiSnapshot =
  | { kind: 'unsupported' }
  | { kind: 'idle' }
  | { kind: 'choosing' }
  | { kind: 'connecting'; device: BluetoothMidiDeviceInfo }
  | { kind: 'connected'; device: BluetoothMidiDeviceInfo }
  | { kind: 'reconnecting'; device: BluetoothMidiDeviceInfo }
  | { kind: 'error'; reason: BluetoothMidiErrorReason; device: BluetoothMidiDeviceInfo | null };

/**
 * A connected Bluetooth keyboard as a MIDI port: it dispatches `midimessage`
 * events carrying whole messages (running status expanded, SysEx reassembled),
 * the shape `MidiInput` reads from a Web MIDI input.
 */
export class BluetoothMidiPort extends EventTarget {
  readonly id: string;
  readonly name: string;
  private readonly writer: (message: Uint8Array) => Promise<void>;

  constructor(id: string, name: string, writer: (message: Uint8Array) => Promise<void>) {
    super();
    this.id = id;
    this.name = name;
    this.writer = writer;
  }

  /**
   * Sends one SysEx message, framed as BLE-MIDI packets and written in turn
   * with every other send. Rejects once the connection it belongs to is gone.
   */
  send(message: Uint8Array): Promise<void> {
    return this.writer(message);
  }
}

type PortsListener = (ports: readonly BluetoothMidiPort[]) => void;

/** A Bluetooth keyboard's name, or a stand-in for one that has none. */
const UNNAMED = 'Bluetooth MIDI';

/** After a drop: 2 s, then doubling to at most 30 s (PianoBallDesktop's backoff). */
export function retryDelayMs(failures: number): number {
  return Math.min(30_000, 2_000 << Math.min(Math.max(failures, 0), 4));
}

interface Session {
  characteristic: BluetoothRemoteGATTCharacteristic;
  port: BluetoothMidiPort;
}

const UNSUPPORTED: BluetoothMidiSnapshot = { kind: 'unsupported' };
const IDLE: BluetoothMidiSnapshot = { kind: 'idle' };

let snapshot: BluetoothMidiSnapshot = IDLE;
const listeners = new Set<() => void>();
const portsListeners = new Set<PortsListener>();

let device: BluetoothDevice | null = null;
let session: Session | null = null;
const parser = new BleMidiParser();
/** Whether the app wants the keyboard connected: false after a Disconnect. */
let wanted = false;
/** Bumped by every attempt and by Disconnect, so a stale attempt stands down. */
let generation = 0;
let connecting = false;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function isBluetoothMidiSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'bluetooth' in navigator &&
    typeof navigator.bluetooth?.requestDevice === 'function'
  );
}

function infoOf(target: BluetoothDevice): BluetoothMidiDeviceInfo {
  return { id: target.id, name: target.name?.trim() || UNNAMED };
}

function publish(next: BluetoothMidiSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function currentPorts(): BluetoothMidiPort[] {
  return session ? [session.port] : [];
}

function publishPorts(): void {
  const ports = currentPorts();
  for (const listener of portsListeners) listener(ports);
}

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

/** Ends the session, if any: its port leaves, and `MidiInput` lets its notes go. */
function endSession(): void {
  if (!session) return;
  session.characteristic.removeEventListener('characteristicvaluechanged', onValue);
  session = null;
  parser.reset();
  publishPorts();
}

function onValue(event: Event): void {
  const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
  const port = session?.port;
  if (!view || !port) return;
  const bytes = new Uint8Array(
    view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
  );
  const { messages, sysex } = parser.parse(bytes);
  for (const message of messages) {
    port.dispatchEvent(new MessageEvent('midimessage', { data: message.data }));
  }
  for (const message of sysex) {
    port.dispatchEvent(new MessageEvent('midimessage', { data: message }));
  }
}

function onDisconnected(): void {
  // A failing attempt can drop the link on its way down; the attempt itself
  // decides what follows.
  if (connecting) return;
  const target = device;
  endSession();
  if (!wanted || !target) {
    if (snapshot.kind !== 'idle') publish(IDLE);
    return;
  }
  publish({ kind: 'reconnecting', device: infoOf(target) });
  scheduleRetry();
}

function scheduleRetry(): void {
  clearRetry();
  const delay = retryDelayMs(failures);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (wanted && device && !session) void attempt(device, 'reconnecting');
  }, delay);
}

function writerFor(characteristic: BluetoothRemoteGATTCharacteristic) {
  const withoutResponse = characteristic.properties.writeWithoutResponse;
  let queue: Promise<void> = Promise.resolve();
  return (message: Uint8Array): Promise<void> => {
    const run = queue.then(async () => {
      const packets = bleMidiSysExPackets(message, BLE_MIDI_MIN_PACKET, performance.now());
      if (packets.length === 0)
        throw new TypeError('Only SysEx is written to a Bluetooth keyboard');
      for (const packet of packets) {
        if (session?.characteristic !== characteristic) {
          throw new DOMException('The keyboard is no longer connected', 'NetworkError');
        }
        // A fresh buffer per packet: Web Bluetooth wants a plain ArrayBuffer view.
        const value = new Uint8Array(packet);
        if (withoutResponse) await characteristic.writeValueWithoutResponse(value);
        else await characteristic.writeValueWithResponse(value);
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

/**
 * One go at opening the keyboard's MIDI characteristic. A first attempt that
 * fails reports the error; a reconnection that fails tries again later.
 */
async function attempt(
  target: BluetoothDevice,
  mode: 'connecting' | 'reconnecting',
): Promise<void> {
  clearRetry();
  const token = ++generation;
  const info = infoOf(target);
  connecting = true;
  publish({ kind: mode, device: info });
  // Which step failed is what tells a keyboard out of reach (connect) from
  // one whose GATT discovery the platform cannot complete (service).
  let step = 'connect';
  try {
    const gatt = target.gatt;
    if (!gatt) throw new DOMException('No GATT server', 'NotSupportedError');
    const server = await gatt.connect();
    step = 'service';
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    step = 'characteristic';
    const characteristic = await service.getCharacteristic(BLE_MIDI_IO);
    // BLE-MIDI 1.0, section 5: the central reads the characteristic once
    // (the keyboard answers with nothing), and some keyboards hold their
    // notes until it does. A keyboard that refuses the read still plays.
    try {
      await characteristic.readValue();
    } catch {
      // Not every keyboard allows it; the PartyKeys works without.
    }
    step = 'notifications';
    characteristic.addEventListener('characteristicvaluechanged', onValue);
    await characteristic.startNotifications();
    if (token !== generation || !wanted) {
      characteristic.removeEventListener('characteristicvaluechanged', onValue);
      // Let go of a link opened after Disconnect; a newer attempt owns its own.
      if (!wanted) gatt.disconnect();
      return;
    }
    endSession();
    parser.reset();
    session = {
      characteristic,
      port: new BluetoothMidiPort(`bluetooth:${target.id}`, info.name, writerFor(characteristic)),
    };
    failures = 0;
    connecting = false;
    publish({ kind: 'connected', device: info });
    publishPorts();
  } catch (error) {
    if (token !== generation) return;
    connecting = false;
    // Once per run of failures: a keyboard left switched off retries for as
    // long as MIDI is on, and need not fill the console while it does.
    if (failures === 0) console.warn(`Bluetooth MIDI ${step} failed:`, error);
    failures += 1;
    if (mode === 'reconnecting' && wanted) {
      publish({ kind: 'reconnecting', device: info });
      scheduleRetry();
    } else {
      wanted = false;
      publish({ kind: 'error', reason: 'failed', device: info });
    }
  } finally {
    if (token === generation) connecting = false;
  }
}

function adopt(target: BluetoothDevice): void {
  if (device === target) return;
  device?.removeEventListener('gattserverdisconnected', onDisconnected);
  device = target;
  target.addEventListener('gattserverdisconnected', onDisconnected);
}

/** Whether the browser says there is no Bluetooth to use; a failed question is no answer. */
async function adapterMissing(): Promise<boolean> {
  try {
    return (await navigator.bluetooth.getAvailability()) === false;
  } catch {
    return false;
  }
}

async function errorReason(error: unknown): Promise<BluetoothMidiErrorReason | 'cancelled'> {
  const name = error instanceof DOMException ? error.name : '';
  // Chrome rejects with NotFoundError both for a chooser closed with nothing
  // picked and for a missing or switched-off adapter. Availability tells the
  // two apart. It is only asked afterwards: its answer can be wrong, and a
  // wrong "no" must never keep the chooser from opening.
  if (name === 'NotFoundError') return (await adapterMissing()) ? 'noAdapter' : 'cancelled';
  if (name === 'AbortError') return 'cancelled';
  // Blocked by a permissions policy or the browser's own setting.
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'blocked';
  return 'failed';
}

/**
 * Opens the browser's device chooser, listing BLE-MIDI keyboards, and
 * connects the one picked. Call from a click: the chooser needs one.
 */
export async function connectBluetoothMidi(): Promise<void> {
  if (!isBluetoothMidiSupported()) {
    publish(UNSUPPORTED);
    return;
  }
  const previous = snapshot;
  publish({ kind: 'choosing' });
  let chosen: BluetoothDevice;
  try {
    // Straight to the chooser: nothing may be awaited first, or the click
    // that opens it can be used up.
    chosen = await navigator.bluetooth.requestDevice({
      // Keyboards advertise the MIDI service; a PartyKeys is also found by
      // name, in case its advertisement leaves the service out.
      filters: [{ services: [BLE_MIDI_SERVICE] }, { namePrefix: 'PartyKeys' }],
      optionalServices: [BLE_MIDI_SERVICE],
    });
  } catch (error) {
    const reason = await errorReason(error);
    if (reason === 'cancelled') publish(previous.kind === 'choosing' ? IDLE : previous);
    else publish({ kind: 'error', reason, device: null });
    return;
  }
  if (session && device !== chosen) disconnectBluetoothMidi();
  if (session && device === chosen) {
    publish({ kind: 'connected', device: infoOf(chosen) });
    return;
  }
  adopt(chosen);
  wanted = true;
  failures = 0;
  await attempt(chosen, 'connecting');
}

/**
 * Brings back a keyboard chosen before, without the chooser: the one this
 * page already holds, or one the browser lists as granted. Resolves false
 * when there is no such device here, and the chooser is the only way back.
 *
 * `persistent` keeps trying, quietly, until the keyboard is in reach: the
 * way back on load and after a drop. Without it, one attempt reports its
 * failure, as a Retry click should.
 */
export async function reconnectBluetoothMidi(id: string, persistent = true): Promise<boolean> {
  if (!isBluetoothMidiSupported()) return false;
  if (device?.id === id && (session || connecting || retryTimer !== null)) return true;
  let target = device?.id === id ? device : null;
  if (!target && typeof navigator.bluetooth.getDevices === 'function') {
    // Every Disconnect and every attempt moves the generation on: one that
    // happens while the browser lists its devices wins over the listing.
    const asked = generation;
    try {
      const granted = await navigator.bluetooth.getDevices();
      target = granted.find((candidate) => candidate.id === id) ?? null;
    } catch {
      target = null;
    }
    if (generation !== asked) return true;
  }
  if (!target) return false;
  // Another keyboard chosen meanwhile wins over a late listing.
  if (device && device !== target && (session || connecting)) return true;
  adopt(target);
  wanted = true;
  failures = 0;
  void attempt(target, persistent ? 'reconnecting' : 'connecting');
  return true;
}

/** Lets the keyboard go and stops trying to reach it. */
export function disconnectBluetoothMidi(): void {
  wanted = false;
  generation += 1;
  connecting = false;
  clearRetry();
  endSession();
  device?.gatt?.disconnect();
  if (snapshot.kind !== 'unsupported' && snapshot.kind !== 'idle') publish(IDLE);
}

export function subscribeBluetoothMidi(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBluetoothMidiSnapshot(): BluetoothMidiSnapshot {
  if (snapshot === IDLE && !isBluetoothMidiSupported()) return UNSUPPORTED;
  return snapshot;
}

/** The connected keyboard's port, delivered now and on every connect and drop. */
export function subscribeBluetoothPorts(listener: PortsListener): () => void {
  portsListeners.add(listener);
  listener(currentPorts());
  return () => portsListeners.delete(listener);
}

/** Test-only: the module-level connection outlives a single test. */
export function __resetBluetoothMidiForTests(): void {
  clearRetry();
  device?.removeEventListener('gattserverdisconnected', onDisconnected);
  session?.characteristic.removeEventListener('characteristicvaluechanged', onValue);
  device = null;
  session = null;
  parser.reset();
  wanted = false;
  generation += 1;
  connecting = false;
  failures = 0;
  snapshot = IDLE;
  listeners.clear();
  portsListeners.clear();
}
