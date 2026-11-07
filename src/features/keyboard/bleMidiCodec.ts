/**
 * Bluetooth LE MIDI 1.0 packets: what a keyboard's notifications carry, and
 * how a host writes SysEx back to it.
 *
 * A packet opens with a header byte (0x80 | the timestamp's high six bits),
 * and each message in it follows a timestamp byte (0x80 | its low seven
 * bits). Running status carries across messages and across packets, real-time
 * bytes may appear anywhere, even inside SysEx, and a SysEx may run on into
 * the next packet as bare data. Ported from PianoBallDesktop's `BleMidi.h`,
 * where it reads a PartyKeys over raw GATT.
 */

/** The BLE-MIDI service and its one characteristic (notify + write). */
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_IO = '7772e5db-3868-4112-a1a9-f2669d106bf3';

/**
 * The smallest ATT MTU (23) less its 3-byte header. Web Bluetooth never says
 * what MTU a link negotiated, so every write fits the one every link carries.
 */
export const BLE_MIDI_MIN_PACKET = 20;

/** Longer SysEx is consumed but not kept: nothing the app reads is that long. */
export const MAX_SYSEX_BYTES = 64;

export interface BleMidiMessage {
  /** One whole channel message, running status expanded: status, data1[, data2]. */
  data: Uint8Array;
  /** The packet's 13-bit millisecond timestamp. */
  timestamp: number;
}

export interface BleMidiPacket {
  messages: BleMidiMessage[];
  /** SysEx messages completed in this packet, whole from F0 to F7. */
  sysex: Uint8Array[];
  /** False when the packet was malformed or cut short; what came before the fault is kept. */
  ok: boolean;
}

export class BleMidiParser {
  private running = 0;
  private inSysex = false;
  private gathered: number[] = [];

  /** A new connection: nothing carries over from the last one. */
  reset(): void {
    this.running = 0;
    this.inSysex = false;
    this.gathered = [];
  }

  parse(bytes: Uint8Array): BleMidiPacket {
    const messages: BleMidiMessage[] = [];
    const sysex: Uint8Array[] = [];
    const fail = (): BleMidiPacket => ({ messages, sysex, ok: false });
    const size = bytes.length;
    if (size < 2 || ((bytes[0] as number) & 0xc0) !== 0x80) return fail();

    let high = (bytes[0] as number) & 0x3f;
    let lastLow = -1;
    let stamp = 0;
    let i = 1;
    let ok = true;
    const at = (index: number) => bytes[index] as number;
    const timestamp = (value: number) => {
      const low = value & 0x7f;
      // A low byte that goes backwards has wrapped past the high bits.
      if (lastLow >= 0 && low < lastLow) high = (high + 1) & 0x3f;
      lastLow = low;
      stamp = (high << 7) | low;
    };
    const keep = (value: number) => {
      if (this.gathered.length < MAX_SYSEX_BYTES + 1) this.gathered.push(value);
    };

    // A SysEx begun in an earlier packet continues with bare data bytes.
    if (this.inSysex) while (i < size && at(i) < 0x80) keep(at(i++));

    while (i < size) {
      const value = at(i);
      if (value < 0x80) {
        // Data where a timestamp belongs, or more SysEx after a real-time byte.
        i += 1;
        if (this.inSysex) keep(value);
        else ok = false;
        continue;
      }
      timestamp(value);
      i += 1;
      // A timestamp with no message after it.
      if (i >= size) return fail();
      const status = at(i);
      if (status >= 0x80) {
        i += 1;
        if (status >= 0xf8) {
          // Real-time keeps running status: data bytes after one continue the
          // interrupted stream of channel messages.
          if (this.inSysex || !this.running || i >= size || at(i) >= 0x80) continue;
        } else if (status === 0xf0) {
          this.inSysex = true;
          this.running = 0;
          this.gathered = [0xf0];
          while (i < size && at(i) < 0x80) keep(at(i++));
          continue;
        } else if (status === 0xf7) {
          if (this.inSysex && this.gathered.length < MAX_SYSEX_BYTES) {
            this.gathered.push(0xf7);
            sysex.push(Uint8Array.from(this.gathered));
          }
          this.inSysex = false;
          this.gathered = [];
          continue;
        } else {
          this.inSysex = false;
          this.gathered = [];
          if (status >= 0xf0) {
            // System Common is consumed with its data and, in BLE-MIDI (unlike
            // wired MIDI), keeps running status too. SysEx alone cancels it.
            const skip = status === 0xf2 ? 2 : status === 0xf1 || status === 0xf3 ? 1 : 0;
            for (let k = 0; k < skip && i < size && at(i) < 0x80; k += 1) i += 1;
            if (!this.running || i >= size || at(i) >= 0x80) continue;
          } else {
            this.running = status;
          }
        }
      } else if (this.inSysex) {
        i += 1;
        continue;
      } else if (!this.running) {
        ok = false;
        while (i < size && at(i) < 0x80) i += 1;
        continue;
      }
      // One message, then any more in running status sharing its timestamp.
      const need = (this.running & 0xe0) === 0xc0 ? 1 : 2;
      do {
        if (i + need > size) return fail();
        for (let k = 0; k < need; k += 1) if (at(i + k) >= 0x80) return fail();
        const data =
          need === 1
            ? Uint8Array.of(this.running, at(i))
            : Uint8Array.of(this.running, at(i), at(i + 1));
        messages.push({ data, timestamp: stamp });
        i += need;
      } while (i < size && at(i) < 0x80);
    }
    return { messages, sysex, ok };
  }
}

/**
 * One SysEx message (F0 … F7) as BLE-MIDI packets of at most `maxPacket`
 * bytes. The first opens with the header, a timestamp and F0; a continuation
 * carries the header and bare data; the last closes with a timestamp and F7.
 * `timestampMs` is sent as its low 13 bits. Anything but SysEx frames to
 * nothing.
 */
export function bleMidiSysExPackets(
  message: Uint8Array,
  maxPacket: number = BLE_MIDI_MIN_PACKET,
  timestampMs = 0,
): Uint8Array[] {
  if (message.length < 2 || message[0] !== 0xf0 || message[message.length - 1] !== 0xf7) {
    return [];
  }
  const limit = Math.max(maxPacket, 5);
  const ms = Math.max(0, Math.floor(timestampMs)) & 0x1fff;
  const header = 0x80 | ((ms >> 7) & 0x3f);
  const stamp = 0x80 | (ms & 0x7f);
  const packets: Uint8Array[] = [];
  let packet = [header, stamp, 0xf0];
  for (let i = 1; i + 1 < message.length; i += 1) {
    const value = message[i] as number;
    if (value >= 0x80) return []; // not a SysEx body
    if (packet.length + 1 > limit) {
      packets.push(Uint8Array.from(packet));
      packet = [header];
    }
    packet.push(value);
  }
  if (packet.length + 2 > limit) {
    packets.push(Uint8Array.from(packet));
    packet = [header];
  }
  packet.push(stamp, 0xf7);
  packets.push(Uint8Array.from(packet));
  return packets;
}
