/**
 * The PartyKeys 36's key lights: the SysEx messages that set them, and the
 * reports the keyboard sends back.
 *
 * Ported from PianoBallDesktop (`src/PartyKeysProtocol.h`, `src/KeyLights.h`),
 * where every message was checked on this user's keyboard over USB and
 * Bluetooth (2026-11-06). Sources it cites: protocol.partykeys.org,
 * github.com/allen4z/PartykeysProtocol (LED_PROTOCOL.md), and the hardware
 * notes in github.com/aortegaCampanillas/MIDIChords.
 */

/** Physical keys 0–35, left to right, play C3–B5 with no octave or transpose shift. */
export const PARTYKEYS_KEYS = 36;
export const PARTYKEYS_LOWEST_NOTE = 48;

/**
 * Windows (WinMM through Windows MIDI Services) refused a 97-byte frame every
 * time, and frames over 103 bytes some or all of the time; a refused frame
 * broke that handle for good. Every length from 18 to 96 passed.
 */
export const MAX_FRAME_BYTES = 90;

const HEADER = [0xf0, 0x05, 0x30, 0x7f, 0x7f, 0x20, 0x00] as const;
const CMD_RGB = 0x15;
/** The header, the command, the group count and F7. */
const FRAME_OVERHEAD = HEADER.length + 3;
/** A group's colour (three 7-bit pairs) and its key count. */
const GROUP_HEAD = 7;

/** One light's drive, each channel 0–255. */
export interface Rgb8 {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export const DARK: Rgb8 = { r: 0, g: 0, b: 0 };

export function sameRgb(a: Rgb8, b: Rgb8): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

export interface KeyColour {
  /** The physical key, 0–35. */
  readonly key: number;
  readonly colour: Rgb8;
}

function command(...body: number[]): Uint8Array {
  return Uint8Array.from([...HEADER, ...body, 0xf7]);
}

/** Mode 01: the keyboard shows the host's colours. Sent after every connect. */
export function enterLedMode(): Uint8Array {
  return command(0x0f, 0x01);
}

/** Mode 00 gives the lights back to the keyboard's own behaviour. */
export function builtInMode(): Uint8Array {
  return command(0x0f, 0x00);
}

/**
 * CMD 0x15: per-key RGB, in groups of one colour, each `[R G B as 7-bit
 * high/low pairs][count][keys…]`. Keys sharing a colour share a group, and
 * frames split so none passes `maxBytes`; a group too long for one frame
 * carries on in the next. Keys off the keyboard are never sent.
 */
export function rgbFrames(
  keys: readonly KeyColour[],
  maxBytes: number = MAX_FRAME_BYTES,
): Uint8Array[] {
  const groups: { colour: Rgb8; keys: number[] }[] = [];
  for (const { key, colour } of keys) {
    if (!Number.isInteger(key) || key < 0 || key >= PARTYKEYS_KEYS) continue;
    let group = groups.find((candidate) => sameRgb(candidate.colour, colour));
    if (!group) {
      group = { colour, keys: [] };
      groups.push(group);
    }
    if (!group.keys.includes(key)) group.keys.push(key);
  }

  const limit = Math.max(maxBytes, FRAME_OVERHEAD + GROUP_HEAD + 1);
  const frames: Uint8Array[] = [];
  let body: number[] = [];
  let count = 0;
  const flush = () => {
    if (count === 0) return;
    frames.push(Uint8Array.from([...HEADER, CMD_RGB, count, ...body, 0xf7]));
    body = [];
    count = 0;
  };
  for (const group of groups) {
    for (let first = 0; first < group.keys.length;) {
      if (FRAME_OVERHEAD + body.length + GROUP_HEAD + 1 > limit) flush();
      const room = limit - FRAME_OVERHEAD - body.length - GROUP_HEAD;
      const take = Math.min(room, group.keys.length - first);
      for (const value of [group.colour.r, group.colour.g, group.colour.b]) {
        const level = Math.min(255, Math.max(0, Math.round(value)));
        body.push(level >> 7, level & 0x7f);
      }
      body.push(take, ...group.keys.slice(first, first + take));
      count += 1;
      first += take;
    }
  }
  flush();
  return frames;
}

/**
 * Every key dark, through CMD 0x15: one 36-key group, 53 bytes. The vendor's
 * 0x71 all-off is never used; one bridge saw it crash the firmware.
 */
export function allDark(): Uint8Array[] {
  return rgbFrames(Array.from({ length: PARTYKEYS_KEYS }, (_, key) => ({ key, colour: DARK })));
}

/**
 * The keyboard's own OCT± and transpose. The notes it sends are
 * `48 + key + 12·octave + transpose`; it returns to 0/0 on reconnect, and
 * cannot be asked where it is.
 */
export interface KeyboardShift {
  readonly octave: number;
  readonly transpose: number;
}

export const NO_SHIFT: KeyboardShift = { octave: 0, transpose: 0 };

const signed7 = (value: number) => (value & 0x40 ? (value & 0x7f) - 128 : value & 0x7f);

/**
 * `F0 05 30 20 00 <ch> 3F 18 <octave> <transpose> F7`, both signed 7-bit, as a
 * PartyKeys sent them on macOS. On Windows this keyboard sent none, over USB
 * or Bluetooth, so `shiftForNote` reads the shift from the notes instead.
 */
export function parseShiftReport(data: Uint8Array): KeyboardShift | null {
  if (
    data.length !== 11 ||
    data[0] !== 0xf0 ||
    data[1] !== 0x05 ||
    data[2] !== 0x30 ||
    data[3] !== 0x20 ||
    data[4] !== 0x00 ||
    data[6] !== 0x3f ||
    data[7] !== 0x18 ||
    data[10] !== 0xf7
  ) {
    return null;
  }
  return { octave: signed7(data[8] as number), transpose: signed7(data[9] as number) };
}

/**
 * `F0 05 30 10 00 <ch> 3F 16 F7`, sent once for every use of the
 * Multi-Function Button. Alone the button lights the black keys as shortcut
 * hints, and its colour shortcuts change the keyboard's own palette: either
 * way, the keyboard has just taken its lights over.
 */
export function isButtonReport(data: Uint8Array): boolean {
  return (
    data.length === 9 &&
    data[0] === 0xf0 &&
    data[1] === 0x05 &&
    data[2] === 0x30 &&
    data[3] === 0x10 &&
    data[4] === 0x00 &&
    data[6] === 0x3f &&
    data[7] === 0x16 &&
    data[8] === 0xf7
  );
}

/** A PartyKeys by its port or device name: "PartyKeys", "2- PARTYKEYS MIDI", … */
export function isPartyKeys(name: string | null | undefined): boolean {
  return (name ?? '').toLowerCase().includes('partykeys');
}

const OCTAVE_LIMIT = 4;

/** The note key `key` sends at `shift`. */
export function noteOfKey(key: number, shift: KeyboardShift): number {
  return PARTYKEYS_LOWEST_NOTE + key + 12 * shift.octave + shift.transpose;
}

/** The key that plays `note` at `shift`, or -1 when none of the 36 does. */
export function keyOfNote(note: number, shift: KeyboardShift): number {
  const key = note - PARTYKEYS_LOWEST_NOTE - 12 * shift.octave - shift.transpose;
  return key >= 0 && key < PARTYKEYS_KEYS ? key : -1;
}

/**
 * The shift a note the keyboard sent shows it must be at. The keyboard never
 * reports OCT±, so a note outside the span the known shift gives (an octave
 * pressed while the app was not listening, or never told) moves it: to the
 * nearest octave that puts that note on one of its keys. Transpose is kept.
 */
export function shiftForNote(raw: number, shift: KeyboardShift): KeyboardShift {
  const key = raw - PARTYKEYS_LOWEST_NOTE - 12 * shift.octave - shift.transpose;
  if (key >= 0 && key < PARTYKEYS_KEYS) return shift;
  const octave =
    key < 0
      ? shift.octave - Math.floor((-key + 11) / 12)
      : shift.octave + Math.floor((key - PARTYKEYS_KEYS) / 12) + 1;
  return {
    octave: Math.min(OCTAVE_LIMIT, Math.max(-OCTAVE_LIMIT, octave)),
    transpose: shift.transpose,
  };
}
