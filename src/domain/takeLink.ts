import { deflateSync, Inflate } from 'fflate';
import { ImportValidationError, ShareLinkError } from '@/utils/errors';
import { newId } from '@/utils/ids';
import { compareNoteEvents, comparePedalEvents } from './noteEvents';
import { parseTakeJson, type ParsedTake } from './takeSchema';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_NOTE_COUNT,
  type NoteEvent,
  type NoteSpelling,
  type NoteStep,
  type PedalEvent,
  type Take,
} from './takeTypes';

/**
 * A take carried whole inside a link: the data of `#/s/1.<data>`. TAKE_FORMAT.md
 * ("Share links") lays out the bytes; in short, a JSON header with everything
 * but the notes and pedals, then the notes a column at a time — every start,
 * then every duration, and so on — then the pedals, the lot deflated and
 * written in base64url. Columns put like with like, which is what deflate
 * feeds on: Chopin's First Ballade, 5,162 notes, fits in about 17,000
 * characters, and a 5,000-note recording in 28,000 to 35,000.
 *
 * Nothing here is random, so one take always makes one link. Decoding trusts
 * nothing: every read is bounded, the inflated size is capped, and what comes
 * out goes through the same `parseTakeJson` as any imported file.
 */

/** The link format this build writes, and the newest it reads: the `1.` a link starts with. */
export const TAKE_LINK_VERSION = 1;
/** The most base64url a link may carry. A longer one is refused unread. */
export const MAX_TAKE_LINK_CHARS = 4_000_000;
/** The most a link may inflate to, far past any real take: a deflate bomb stops here. */
export const MAX_TAKE_LINK_BYTES = 8 * 1024 * 1024;
/** The most the JSON header may take up. */
export const MAX_TAKE_LINK_HEADER_BYTES = 65_536;

// A note's flags, bit by bit in the order the format lists them. A qualifier
// (bass, for staff and clef) means something only beside its own flag.
const HAS_STAFF = 1 << 0;
const STAFF_BASS = 1 << 1;
const HAS_VOICE = 1 << 2;
const HAS_CLEF = 1 << 3;
const CLEF_BASS = 1 << 4;
const HAS_TUPLET = 1 << 5;
const HAS_SPELLING = 1 << 6;
const HAS_FINGER = 1 << 7;
const HIDDEN = 1 << 8;
const KNOWN_FLAGS = (1 << 9) - 1;

const STEPS: readonly NoteStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** A spelling as one byte: `step × 5 + alter + 2`, so C double flat is 0 and B double sharp 34. */
const MAX_SPELLING_CODE = STEPS.length * 5 - 1;

/**
 * What a link leaves out: the notes and pedals (carried as columns), when the
 * take was made and changed (the copy it opens as is new), its length (worked
 * out from the notes), and the view and practice state — zoom, playhead,
 * speed, loop. Of the display, only the grid travels: it is how the score is
 * written.
 */
const LEFT_OUT = new Set([
  'notes',
  'pedalEvents',
  'createdAt',
  'updatedAt',
  'durationMs',
  'display',
]);

/** Varints stay below this: five bytes hold it, and it is still exact in a double. */
const VARINT_LIMIT = 2 ** 31;
/**
 * How much deflated data each push hands the inflater. Deflate expands at most
 * about 1,032 to 1, so no single push can make more than ~2 MB before the size
 * is checked again.
 */
const INFLATE_SLICE_BYTES = 2048;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_VALUES = (() => {
  const values = new Int8Array(128).fill(-1);
  for (let index = 0; index < BASE64URL.length; index += 1) {
    values[BASE64URL.charCodeAt(index)] = index;
  }
  return values;
})();

/** Refuse the link as damaged, saying why for the logs. */
function fail(reason: string): never {
  throw new ShareLinkError('invalid', [reason]);
}

// ------------------------------------------------------------- encoding --

class ByteWriter {
  private buffer = new Uint8Array(4096);
  private length = 0;

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  byte(value: number): void {
    this.reserve(1);
    this.buffer[this.length] = value;
    this.length += 1;
  }

  /** Seven bits a byte, low first; the top bit says another byte follows. */
  varint(value: number): void {
    let rest = value;
    while (rest >= 0x80) {
      this.byte((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.byte(rest);
  }

  bytes(values: Uint8Array): void {
    this.reserve(values.length);
    this.buffer.set(values, this.length);
    this.length += values.length;
  }

  result(): Uint8Array {
    return this.buffer.subarray(0, this.length);
  }
}

/** A whole number in `[0, max]`. A take's numbers already are; this only guards the stream. */
function whole(value: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : 0;
}

/** 1/255 steps, so 0 stays silent and the softest note any take holds stays audible. */
function velocityByte(velocity: number): number {
  return velocity > 0 ? Math.max(1, whole(velocity * 255, 255)) : 0;
}

function spellingCode(spelling: NoteSpelling): number {
  return STEPS.indexOf(spelling.step) * 5 + spelling.alter + 2;
}

/** Whether the format can carry this spelling; a take's own always are. */
function carriesSpelling(spelling: NoteSpelling | undefined): spelling is NoteSpelling {
  if (spelling === undefined) return false;
  const code = spellingCode(spelling);
  return Number.isInteger(code) && code >= 0 && code <= MAX_SPELLING_CODE;
}

function flagsOf(note: NoteEvent): number {
  let flags = 0;
  if (note.staff !== undefined) flags |= HAS_STAFF | (note.staff === 'bass' ? STAFF_BASS : 0);
  if (note.voice !== undefined) flags |= HAS_VOICE;
  if (note.clef !== undefined) flags |= HAS_CLEF | (note.clef === 'bass' ? CLEF_BASS : 0);
  if (note.tuplet !== undefined) flags |= HAS_TUPLET;
  if (carriesSpelling(note.spelling)) flags |= HAS_SPELLING;
  if (note.finger !== undefined) flags |= HAS_FINGER;
  if (note.hidden === true) flags |= HIDDEN;
  return flags;
}

/**
 * A copy of the take's fields as JSON with every object's keys in order, so
 * one take writes one header however its objects were built.
 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const record = inner as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

function headerOf(take: Take): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(take)) {
    if (!LEFT_OUT.has(key)) header[key] = value;
  }
  header.display = { quantization: take.display.quantization };
  return header;
}

function toBase64Url(bytes: Uint8Array): string {
  const chars = new Uint8Array(Math.ceil((bytes.length * 4) / 3));
  let out = 0;
  let bits = 0;
  let pending = 0;
  for (const byte of bytes) {
    pending = (pending << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      chars[out] = BASE64URL.charCodeAt((pending >> bits) & 63);
      out += 1;
    }
    pending &= (1 << bits) - 1;
  }
  if (bits > 0) {
    chars[out] = BASE64URL.charCodeAt((pending << (6 - bits)) & 63);
    out += 1;
  }
  return new TextDecoder().decode(chars.subarray(0, out));
}

/**
 * The payload of a take's link — what follows `#/s/`: the format version, a
 * dot, then the take. Timing is carried in whole milliseconds, which every
 * take already keeps; a stray fraction is rounded rather than written as
 * something else. Throws when the take cannot fit the format at all (a header
 * past 64 KB, more notes than a take may hold), which no take this app made
 * comes near.
 */
export function encodeTakeLink(take: Take): string {
  const notes = take.notes
    .map((note) => ({
      ...note,
      startMs: whole(note.startMs, VARINT_LIMIT - 1),
      durationMs: whole(note.durationMs, VARINT_LIMIT - 1),
    }))
    .sort(compareNoteEvents);
  const pedals = take.pedalEvents
    .map((pedal): PedalEvent => ({
      atMs: whole(pedal.atMs, VARINT_LIMIT / 2 - 1),
      down: pedal.down,
    }))
    .sort(comparePedalEvents);
  const header = new TextEncoder().encode(canonicalJson(headerOf(take)));
  if (header.length > MAX_TAKE_LINK_HEADER_BYTES) {
    throw new RangeError(`A take link's header is ${header.length} bytes; the most is 65,536.`);
  }
  if (notes.length > MAX_NOTE_COUNT || pedals.length > MAX_NOTE_COUNT) {
    throw new RangeError('The take holds more notes or pedal events than a link may carry.');
  }

  const out = new ByteWriter();
  out.varint(header.length);
  out.bytes(header);

  // Sorted, so every step from one start to the next is forward.
  out.varint(notes.length);
  let previous = 0;
  for (const note of notes) {
    out.varint(note.startMs - previous);
    previous = note.startMs;
  }
  for (const note of notes) out.varint(note.durationMs);
  for (const note of notes) out.byte(whole(note.midi, 127));
  for (const note of notes) out.byte(velocityByte(note.velocity));
  for (const note of notes) out.varint(flagsOf(note));
  for (const note of notes) if (note.voice !== undefined) out.byte(whole(note.voice, 255));
  const tuplets = notes.flatMap((note) => (note.tuplet === undefined ? [] : [note.tuplet]));
  for (const tuplet of tuplets) out.byte(whole(tuplet.actual, 255));
  for (const tuplet of tuplets) out.byte(whole(tuplet.normal, 255));
  for (const tuplet of tuplets) out.byte(whole(Math.log2(tuplet.unit), 255));
  for (const tuplet of tuplets) {
    out.varint(tuplet.group === undefined ? 0 : whole(tuplet.group, VARINT_LIMIT - 2) + 1);
  }
  for (const note of notes)
    if (carriesSpelling(note.spelling)) out.byte(spellingCode(note.spelling));
  for (const note of notes) if (note.finger !== undefined) out.byte(whole(note.finger, 255));

  out.varint(pedals.length);
  previous = 0;
  for (const pedal of pedals) {
    out.varint((pedal.atMs - previous) * 2 + (pedal.down ? 1 : 0));
    previous = pedal.atMs;
  }

  return `${TAKE_LINK_VERSION}.${toBase64Url(deflateSync(out.result(), { level: 9 }))}`;
}

// ------------------------------------------------------------- decoding --

class ByteReader {
  private readonly data: Uint8Array;
  private position = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get atEnd(): boolean {
    return this.position === this.data.length;
  }

  byte(): number {
    if (this.position >= this.data.length) fail('The link ends too soon.');
    const value = this.data[this.position] as number;
    this.position += 1;
    return value;
  }

  varint(): number {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** (7 * index);
      if ((byte & 0x80) === 0) {
        if (value >= VARINT_LIMIT) fail('A number in the link is too large.');
        return value;
      }
    }
    fail('A number in the link runs past five bytes.');
  }

  bytes(count: number): Uint8Array {
    if (this.position + count > this.data.length) fail('The link ends too soon.');
    const slice = this.data.subarray(this.position, this.position + count);
    this.position += count;
    return slice;
  }

  /** A count, refused before anything is made for it when it passes `max`. */
  count(max: number, what: string): number {
    const count = this.varint();
    if (count > max) fail(`The link counts ${count} ${what}; a take holds at most ${max}.`);
    return count;
  }
}

function fromBase64Url(text: string): Uint8Array {
  // A lone character past a multiple of four is six bits: not even one byte.
  if (text.length % 4 === 1) fail('The link’s data is cut off mid-character.');
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let out = 0;
  let bits = 0;
  let pending = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const value = code < 128 ? (BASE64URL_VALUES[code] as number) : -1;
    if (value < 0) fail('The link holds a character base64url does not use.');
    pending = (pending << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = pending >> bits;
      out += 1;
      pending &= (1 << bits) - 1;
    }
  }
  // An encoder leaves the spare bits of the last character clear.
  if (pending !== 0) fail('The link’s last character is not one an encoder writes.');
  return bytes;
}

/** Inflate a slice at a time, giving up the moment the output passes the cap. */
function inflateCapped(compressed: Uint8Array): Uint8Array {
  if (compressed.length === 0) fail('The link carries no data.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    chunks.push(chunk);
  });
  try {
    for (let offset = 0; offset < compressed.length; offset += INFLATE_SLICE_BYTES) {
      const end = Math.min(compressed.length, offset + INFLATE_SLICE_BYTES);
      inflater.push(compressed.subarray(offset, end), end === compressed.length);
      if (total > MAX_TAKE_LINK_BYTES) fail('The link unpacks to more than 8 MB.');
    }
  } catch (error) {
    if (error instanceof ShareLinkError) throw error;
    fail(`The link could not be unpacked (${error instanceof Error ? error.message : 'unknown'}).`);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function parseHeader(bytes: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('The link’s header is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail('The link’s header is not an object.');
  }
  return parsed as Record<string, unknown>;
}

/** Each note's index among those whose flags have `flag`, in order. */
function indicesWith(flags: readonly number[], flag: number): number[] {
  const indices: number[] = [];
  flags.forEach((value, index) => {
    if ((value & flag) !== 0) indices.push(index);
  });
  return indices;
}

/** The take a link's bytes hold, as raw data for `parseTakeJson` to judge. */
function readTake(bytes: Uint8Array): Record<string, unknown> {
  const reader = new ByteReader(bytes);
  const headerLength = reader.varint();
  if (headerLength > MAX_TAKE_LINK_HEADER_BYTES) fail('The link’s header is too long.');
  const header = parseHeader(reader.bytes(headerLength));

  const count = reader.count(MAX_NOTE_COUNT, 'notes');
  const starts = new Array<number>(count);
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    at += reader.varint();
    starts[index] = at;
  }
  const durations = Array.from({ length: count }, () => reader.varint());
  const midis = Array.from({ length: count }, () => reader.byte());
  const velocities = Array.from({ length: count }, () => reader.byte());
  const flags = Array.from({ length: count }, () => {
    const value = reader.varint();
    if ((value & ~KNOWN_FLAGS) !== 0) fail('A note in the link sets a flag no hint uses.');
    return value;
  });

  // Fresh ids, one prefix for the take and each note's place after it: the
  // notes sort back into exactly the order they were written in, and the
  // import has nothing to repair.
  const prefix = newId();
  const width = String(MAX_NOTE_COUNT - 1).length;
  const notes: NoteEvent[] = starts.map((startMs, index) => {
    const value = flags[index] as number;
    const note: NoteEvent = {
      id: `${prefix}-${String(index).padStart(width, '0')}`,
      midi: midis[index] as number,
      startMs,
      durationMs: durations[index] as number,
      velocity: (velocities[index] as number) / 255,
    };
    if ((value & HAS_STAFF) !== 0) note.staff = (value & STAFF_BASS) !== 0 ? 'bass' : 'treble';
    if ((value & HAS_CLEF) !== 0) note.clef = (value & CLEF_BASS) !== 0 ? 'bass' : 'treble';
    if ((value & HIDDEN) !== 0) note.hidden = true;
    return note;
  });

  for (const index of indicesWith(flags, HAS_VOICE))
    (notes[index] as NoteEvent).voice = reader.byte();
  const tuplets = indicesWith(flags, HAS_TUPLET);
  const actuals = tuplets.map(() => reader.byte());
  const normals = tuplets.map(() => reader.byte());
  const units = tuplets.map(() => reader.byte());
  const groups = tuplets.map(() => reader.varint());
  tuplets.forEach((noteIndex, index) => {
    const unitLog2 = units[index] as number;
    // A unit past a 128th is no note value; 2^31 is past them all, for the schema to refuse.
    const unit = unitLog2 > 30 ? VARINT_LIMIT : 2 ** unitLog2;
    const group = (groups[index] as number) - 1;
    (notes[noteIndex] as NoteEvent).tuplet = {
      actual: actuals[index] as number,
      normal: normals[index] as number,
      unit,
      ...(group >= 0 ? { group } : {}),
    };
  });
  for (const index of indicesWith(flags, HAS_SPELLING)) {
    const code = reader.byte();
    if (code > MAX_SPELLING_CODE) fail('A note in the link is spelled with no letter there is.');
    (notes[index] as NoteEvent).spelling = {
      step: STEPS[Math.floor(code / 5)] as NoteStep,
      alter: (code % 5) - 2,
    };
  }
  for (const index of indicesWith(flags, HAS_FINGER)) {
    (notes[index] as NoteEvent).finger = reader.byte() as NoteEvent['finger'];
  }

  const pedalCount = reader.count(MAX_NOTE_COUNT, 'pedal events');
  const pedalEvents: PedalEvent[] = [];
  at = 0;
  for (let index = 0; index < pedalCount; index += 1) {
    const step = reader.varint();
    at += Math.floor(step / 2);
    pedalEvents.push({ atMs: at, down: step % 2 === 1 });
  }
  if (!reader.atEnd) fail('The link has bytes left over after its pedal events.');

  const display = header.display;
  const quantization =
    typeof display === 'object' && display !== null
      ? (display as { quantization?: unknown }).quantization
      : undefined;
  const now = new Date().toISOString();
  return {
    ...header,
    createdAt: now,
    updatedAt: now,
    durationMs: 0, // worked out again from the notes
    display: { quantization, zoom: 1, playheadMs: 0 },
    notes,
    pedalEvents,
  };
}

/**
 * The take a link carries, from its format `version` and its `data` (both as
 * `parseHashLink` reads them), through the same import pipeline as a file.
 * Throws `ShareLinkError`: `newer` for a link a newer PoKeyBoard made — a later
 * format, or a take of a later schema — and `invalid` for anything else.
 */
export function decodeTakeLink(version: number, data: string): ParsedTake {
  if (version > TAKE_LINK_VERSION) {
    throw new ShareLinkError('newer', [
      `Link format ${version}; this app reads up to ${TAKE_LINK_VERSION}.`,
    ]);
  }
  if (version !== TAKE_LINK_VERSION) fail('The link has no format version this app knows.');
  if (data.length > MAX_TAKE_LINK_CHARS) fail('The link is longer than any take needs.');

  const raw = readTake(inflateCapped(fromBase64Url(data)));
  const schemaVersion = raw.schemaVersion;
  if (
    typeof schemaVersion === 'number' &&
    Number.isInteger(schemaVersion) &&
    schemaVersion > CURRENT_SCHEMA_VERSION
  ) {
    throw new ShareLinkError('newer', [`Take schema ${schemaVersion}.`]);
  }
  try {
    return parseTakeJson(raw);
  } catch (error) {
    if (error instanceof ImportValidationError) throw new ShareLinkError('invalid', error.issues);
    throw error;
  }
}
