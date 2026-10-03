import { MidiImportError } from '@/utils/errors';

/**
 * A Standard MIDI File read as bytes, and nothing more: its header, and each
 * track's events with their ticks counted from the start. What the events mean
 * — which are notes, which hand plays them, how fast a tick is — is
 * `midiImport.ts`'s business.
 *
 * A file comes from anywhere, so every read is checked against the end of the
 * bytes it belongs to. A file cut off in the middle of something, or holding
 * bytes MIDI has no meaning for, is refused as damaged (`invalid`). Two forms
 * that are sound but are not read here are refused as `unsupported`, so the
 * message can say how to save them again: type 2, whose tracks are separate
 * patterns rather than parts of one piece, and SMPTE timing, which counts
 * frames of film rather than beats and so has no bars to put on a page.
 */

export interface SmfChannelEvent {
  type: 'channel';
  tick: number;
  /** The status byte's upper half: 0x80 note-off, 0x90 note-on, 0xb0 controller… */
  command: number;
  /** 0–15; General MIDI's drums are channel 9 here (10 to a musician). */
  channel: number;
  data1: number;
  /** 0 for the messages that carry a single data byte. */
  data2: number;
}

export interface SmfMetaEvent {
  type: 'meta';
  tick: number;
  /** The byte after 0xff: 0x03 a track name, 0x51 a tempo, 0x58 a meter… */
  metaType: number;
  data: Uint8Array;
}

export type SmfEvent = SmfChannelEvent | SmfMetaEvent;

export interface SmfTrack {
  /** In file order, which is also tick order. System exclusive is left out. */
  events: SmfEvent[];
  /** Where the track ends: its End of Track, or its last event without one. */
  endTick: number;
}

export interface SmfFile {
  format: 0 | 1;
  ticksPerQuarter: number;
  tracks: SmfTrack[];
}

/** A variable-length number holds at most 28 bits, in at most four bytes. */
const MAX_VARIABLE_LENGTH_BYTES = 4;

const META = 0xff;
const META_END_OF_TRACK = 0x2f;
const SYSEX = 0xf0;
const SYSEX_ESCAPE = 0xf7;

function invalid(issue: string): MidiImportError {
  return new MidiImportError([issue], 'invalid');
}

function tagAt(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] as number,
    bytes[at + 1] as number,
    bytes[at + 2] as number,
    bytes[at + 3] as number,
  );
}

function u32At(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] as number) << 24) |
      ((bytes[at + 1] as number) << 16) |
      ((bytes[at + 2] as number) << 8) |
      (bytes[at + 3] as number)) >>>
    0
  );
}

function u16At(bytes: Uint8Array, at: number): number {
  return ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
}

/** One track chunk's events, read from `start` up to (not including) `end`. */
function readTrack(bytes: Uint8Array, start: number, end: number, index: number): SmfTrack {
  const cutOff = (): MidiImportError =>
    invalid(`Track ${index + 1} ends in the middle of an event.`);
  let at = start;
  const byte = (): number => {
    if (at >= end) throw cutOff();
    return bytes[at++] as number;
  };
  const dataByte = (): number => {
    const value = byte();
    if (value >= 0x80) {
      throw invalid(`Track ${index + 1} has a status byte where a data byte belongs.`);
    }
    return value;
  };
  const variableLength = (): number => {
    let value = 0;
    for (let count = 0; count < MAX_VARIABLE_LENGTH_BYTES; count += 1) {
      const next = byte();
      value = value * 128 + (next & 0x7f);
      if ((next & 0x80) === 0) return value;
    }
    throw invalid(`Track ${index + 1} has a number longer than MIDI allows.`);
  };

  const events: SmfEvent[] = [];
  let tick = 0;
  // The last channel message's status, which later messages may leave out.
  let runningStatus: number | null = null;
  while (at < end) {
    tick += variableLength();
    let status = byte();

    if (status === META) {
      const metaType = dataByte();
      const length = variableLength();
      if (length > end - at) throw cutOff();
      // Meta events and system exclusive end running status: a data byte
      // after one has no status to borrow.
      runningStatus = null;
      if (metaType === META_END_OF_TRACK) return { events, endTick: tick };
      events.push({ type: 'meta', tick, metaType, data: bytes.slice(at, at + length) });
      at += length;
      continue;
    }
    if (status === SYSEX || status === SYSEX_ESCAPE) {
      // A message for one make of synthesiser; skipped whole by its length.
      const length = variableLength();
      if (length > end - at) throw cutOff();
      at += length;
      runningStatus = null;
      continue;
    }
    if (status >= 0xf0) {
      // Clock, song position and the rest are for a live cable, not a file.
      throw invalid(`Track ${index + 1} holds a system message a file cannot carry.`);
    }

    let data1: number;
    if (status < 0x80) {
      if (runningStatus === null) {
        throw invalid(`Track ${index + 1} has a data byte with no status before it.`);
      }
      data1 = status;
      status = runningStatus;
    } else {
      runningStatus = status;
      data1 = dataByte();
    }
    const command = status & 0xf0;
    // Program change and channel pressure carry one data byte; the rest two.
    const data2 = command === 0xc0 || command === 0xd0 ? 0 : dataByte();
    events.push({ type: 'channel', tick, command, channel: status & 0x0f, data1, data2 });
  }
  // A track that simply runs out, with no End of Track, has still said all it
  // had to; one cut off part-way through an event was refused above.
  return { events, endTick: tick };
}

/** Whether bytes start the way every Standard MIDI File does, with `MThd`. */
export function hasMidiHeader(bytes: Uint8Array): boolean {
  return bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
}

/** Read a Standard MIDI File's bytes. Throws `MidiImportError`. */
export function readSmf(bytes: Uint8Array): SmfFile {
  if (bytes.length < 14 || !hasMidiHeader(bytes)) {
    throw invalid('The file does not start with a MIDI header.');
  }
  const headerLength = u32At(bytes, 4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) {
    throw invalid('The MIDI header is damaged.');
  }
  const format = u16At(bytes, 8);
  const division = u16At(bytes, 12);
  if (format === 2) {
    throw new MidiImportError(
      ['The file is MIDI type 2, whose tracks are separate patterns.'],
      'unsupported',
    );
  }
  if (format !== 0 && format !== 1) {
    throw invalid(`The file declares MIDI type ${format}, which does not exist.`);
  }
  if ((division & 0x8000) !== 0) {
    throw new MidiImportError(
      ['The file is timed in SMPTE frames rather than beats.'],
      'unsupported',
    );
  }
  if (division === 0) throw invalid('The file declares zero ticks per beat.');

  // The header's track count is not trusted: the chunks themselves say how
  // many tracks there are, and anything that is not a track is skipped.
  const tracks: SmfTrack[] = [];
  let at = 8 + headerLength;
  while (at + 8 <= bytes.length) {
    const type = tagAt(bytes, at);
    const length = u32At(bytes, at + 4);
    const start = at + 8;
    const declaredEnd = start + length;
    if (type === 'MTrk') {
      // Some programs write a last track's length wrong; its events still end
      // with the file, and are read up to there.
      tracks.push(readTrack(bytes, start, Math.min(declaredEnd, bytes.length), tracks.length));
    }
    at = declaredEnd;
  }
  if (tracks.length === 0) throw invalid('The file has no tracks.');
  return { format: format === 0 ? 0 : 1, ticksPerQuarter: division, tracks };
}
