import { subscribeBluetoothPorts, type BluetoothMidiPort } from '@/features/keyboard/bluetoothMidi';
import {
  getSysexState,
  subscribe as subscribeMidiAccess,
  subscribeOutputs,
  subscribePorts,
} from '@/features/keyboard/midiAccess';
import { isPartyKeys } from './partyKeysProtocol';

/**
 * At least this long between two light messages: the vendor's pacing for
 * wireless lights, kept over USB too, where it costs nothing noticeable.
 */
export const FRAME_SPACING_MS = 8;

/** Where a PartyKeys' light messages go, and where its own messages come from. */
export interface LightLink {
  /** Stable for as long as the connection lasts. */
  readonly id: string;
  readonly name: string;
  readonly transport: 'bluetooth' | 'usb';
  /** The keyboard's own port: its notes and SysEx arrive as `midimessage` events. */
  readonly input: EventTarget;
  /** One SysEx frame, sent in turn with every other; rejects if it could not go. */
  send(frame: Uint8Array): Promise<void>;
}

/**
 * Sends one frame at a time, each at least `spacingMs` after the last
 * finished. A failed send rejects its own promise and leaves the queue
 * running.
 */
export function pacedSender(
  write: (frame: Uint8Array) => void | Promise<void>,
  spacingMs = FRAME_SPACING_MS,
  now: () => number = () => performance.now(),
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): (frame: Uint8Array) => Promise<void> {
  let queue: Promise<void> = Promise.resolve();
  let last = Number.NEGATIVE_INFINITY;
  return (frame) => {
    const run = queue.then(async () => {
      const since = now() - last;
      if (since < spacingMs) await wait(spacingMs - since);
      try {
        await write(frame);
      } finally {
        last = now();
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
}

/**
 * The output that lights a PartyKeys input: the PartyKeys output of the same
 * name, else the only PartyKeys output there is. Two of one name and none
 * matching is a guess not taken.
 */
export function pairOutput(
  input: { readonly name?: string | null },
  outputs: readonly MIDIOutput[],
): MIDIOutput | null {
  const partyKeys = outputs.filter((output) => isPartyKeys(output.name));
  const named = partyKeys.find((output) => output.name === input.name);
  if (named) return named;
  return partyKeys.length === 1 ? (partyKeys[0] as MIDIOutput) : null;
}

const bluetoothLinks = new WeakMap<BluetoothMidiPort, LightLink>();
const usbLinks = new WeakMap<MIDIInput, { output: MIDIOutput; link: LightLink }>();

function bluetoothLink(port: BluetoothMidiPort): LightLink {
  let link = bluetoothLinks.get(port);
  if (!link) {
    link = {
      id: port.id,
      name: port.name,
      transport: 'bluetooth',
      input: port,
      send: pacedSender((frame) => port.send(frame)),
    };
    bluetoothLinks.set(port, link);
  }
  return link;
}

function usbLink(input: MIDIInput, output: MIDIOutput): LightLink {
  const known = usbLinks.get(input);
  if (known && known.output === output) return known.link;
  const link: LightLink = {
    id: `usb:${input.id}`,
    name: input.name ?? output.name ?? 'PartyKeys',
    transport: 'usb',
    input,
    // `send` throws once the port is gone, or for SysEx without SysEx access.
    send: pacedSender((frame) => output.send(frame)),
  };
  usbLinks.set(input, { output, link });
  return link;
}

export interface LightLinksSnapshot {
  /** Keyboards that can be lit now, Bluetooth first. */
  readonly links: readonly LightLink[];
  /**
   * A PartyKeys on USB that could be lit once SysEx is allowed: what the Key
   * lights row offers to ask for.
   */
  readonly usbAwaitingSysex: boolean;
}

/**
 * Every PartyKeys the app can light, delivered now and whenever a keyboard
 * connects or goes, or SysEx is granted: a Bluetooth one by its port, a USB
 * one by its input and the output paired with it.
 */
export function watchLightLinks(listener: (snapshot: LightLinksSnapshot) => void): () => void {
  let bluetoothPorts: readonly BluetoothMidiPort[] = [];
  let inputs: readonly MIDIInput[] = [];
  let outputs: readonly MIDIOutput[] = [];
  let last: LightLinksSnapshot | null = null;

  const publish = () => {
    const links: LightLink[] = bluetoothPorts
      .filter((port) => isPartyKeys(port.name))
      .map(bluetoothLink);
    let usbAwaitingSysex = false;
    for (const input of inputs) {
      if (!isPartyKeys(input.name)) continue;
      const output = pairOutput(input, outputs);
      if (!output) continue;
      if (getSysexState() === 'granted') links.push(usbLink(input, output));
      else usbAwaitingSysex = true;
    }
    const same =
      last &&
      last.usbAwaitingSysex === usbAwaitingSysex &&
      last.links.length === links.length &&
      last.links.every((link, index) => link === links[index]);
    if (same) return;
    last = { links, usbAwaitingSysex };
    listener(last);
  };

  const stops = [
    subscribeBluetoothPorts((ports) => {
      bluetoothPorts = ports;
      publish();
    }),
    subscribePorts((next) => {
      inputs = next;
      publish();
    }),
    subscribeOutputs((next) => {
      outputs = next;
      publish();
    }),
    // SysEx granted (or refused) changes what a USB keyboard can do.
    subscribeMidiAccess(publish),
  ];
  publish();
  return () => {
    for (const stop of stops) stop();
  };
}
