import { describe, expect, it } from 'vitest';
import {
  MAX_SMF_EVENTS,
  readSmf,
  type SmfChannelEvent,
  type SmfMetaEvent,
} from '@/domain/smfReader';
import { MidiImportError } from '@/utils/errors';

/** A MIDI variable-length number, most significant group first. */
function vlq(value: number): number[] {
  const out = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) out.unshift((rest & 0x7f) | 0x80);
  return out;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, body: readonly number[], declaredLength = body.length): number[] {
  return [...[...type].map((c) => c.charCodeAt(0)), ...u32(declaredLength), ...body];
}

function header(format: number, tracks: number, division: number): number[] {
  return chunk('MThd', [0, format, tracks >> 8, tracks & 0xff, division >> 8, division & 0xff]);
}

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00];

function file(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function expectFailure(
  bytes: Uint8Array,
  kind: 'invalid' | 'unsupported',
  maxEvents?: number,
): MidiImportError {
  let caught: unknown;
  try {
    readSmf(bytes, maxEvents);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MidiImportError);
  expect((caught as MidiImportError).kind).toBe(kind);
  return caught as MidiImportError;
}

function channelEvents(events: readonly (SmfChannelEvent | SmfMetaEvent)[]): SmfChannelEvent[] {
  return events.filter((event): event is SmfChannelEvent => event.type === 'channel');
}

describe('readSmf: header', () => {
  it('reads a type 1 file track by track, with absolute ticks', () => {
    const smf = readSmf(
      file(
        header(1, 2, 480),
        chunk('MTrk', [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, ...END_OF_TRACK]),
        chunk('MTrk', [
          0x00,
          0x90,
          60,
          100,
          ...vlq(480),
          0x80,
          60,
          64,
          ...vlq(240),
          0x90,
          62,
          90,
          ...vlq(240),
          0x80,
          62,
          0,
          ...END_OF_TRACK,
        ]),
      ),
    );
    expect(smf.format).toBe(1);
    expect(smf.ticksPerQuarter).toBe(480);
    expect(smf.tracks).toHaveLength(2);
    expect(smf.tracks[0]!.events).toEqual([
      { type: 'meta', tick: 0, metaType: 0x51, data: Uint8Array.from([0x07, 0xa1, 0x20]) },
    ]);
    expect(channelEvents(smf.tracks[1]!.events)).toEqual([
      { type: 'channel', tick: 0, command: 0x90, channel: 0, data1: 60, data2: 100 },
      { type: 'channel', tick: 480, command: 0x80, channel: 0, data1: 60, data2: 64 },
      { type: 'channel', tick: 720, command: 0x90, channel: 0, data1: 62, data2: 90 },
      { type: 'channel', tick: 960, command: 0x80, channel: 0, data1: 62, data2: 0 },
    ]);
    expect(smf.tracks[1]!.endTick).toBe(960);
  });

  it('reads a type 0 file', () => {
    const smf = readSmf(
      file(
        header(0, 1, 96),
        chunk('MTrk', [0x00, 0x93, 64, 80, 0x60, 0x83, 64, 0, ...END_OF_TRACK]),
      ),
    );
    expect(smf.format).toBe(0);
    expect(channelEvents(smf.tracks[0]!.events).map((e) => [e.tick, e.channel])).toEqual([
      [0, 3],
      [96, 3],
    ]);
  });

  it('accepts a header longer than the six bytes it defines', () => {
    const smf = readSmf(
      file(
        chunk('MThd', [0, 0, 0, 1, 0x01, 0xe0, 0xaa, 0xbb]),
        chunk('MTrk', [0x00, 0x90, 60, 100, 0x10, 0x80, 60, 0, ...END_OF_TRACK]),
      ),
    );
    expect(smf.ticksPerQuarter).toBe(480);
    expect(channelEvents(smf.tracks[0]!.events)).toHaveLength(2);
  });

  it('refuses a file that is not MIDI', () => {
    expectFailure(new TextEncoder().encode('<?xml version="1.0"?><score-partwise/>'), 'invalid');
    expectFailure(new Uint8Array(0), 'invalid');
    expectFailure(file(chunk('MThd', [0, 1, 0])), 'invalid');
  });

  it('refuses type 2 and SMPTE timing as unsupported, not as damaged', () => {
    const track = chunk('MTrk', [0x00, 0x90, 60, 100, 0x10, 0x80, 60, 0, ...END_OF_TRACK]);
    expect(expectFailure(file(header(2, 1, 480), track), 'unsupported').issues[0]).toMatch(
      /type 2/,
    );
    // -25 frames a second, 40 ticks a frame.
    expect(expectFailure(file(header(1, 1, 0xe728), track), 'unsupported').issues[0]).toMatch(
      /SMPTE/,
    );
  });

  it('refuses a zero division and a file with no tracks', () => {
    const track = chunk('MTrk', END_OF_TRACK);
    expectFailure(file(header(1, 1, 0), track), 'invalid');
    expectFailure(file(header(1, 0, 480)), 'invalid');
  });
});

describe('readSmf: chunks', () => {
  it('skips chunks it does not know', () => {
    const smf = readSmf(
      file(
        header(1, 2, 480),
        chunk('XFIH', [1, 2, 3, 4, 5]),
        chunk('MTrk', END_OF_TRACK),
        chunk('MTrk', [0x00, 0x90, 60, 1, 0x01, 0x80, 60, 0, ...END_OF_TRACK]),
      ),
    );
    expect(smf.tracks).toHaveLength(2);
    expect(channelEvents(smf.tracks[1]!.events)).toHaveLength(2);
  });

  it('tolerates a last track whose declared length runs past the end of the file', () => {
    const body = [0x00, 0x90, 60, 100, 0x10, 0x80, 60, 0, ...END_OF_TRACK];
    const smf = readSmf(file(header(0, 1, 480), chunk('MTrk', body, body.length + 200)));
    expect(channelEvents(smf.tracks[0]!.events)).toHaveLength(2);
  });

  it('stops a track at its End of Track, whatever follows inside the chunk', () => {
    const smf = readSmf(
      file(header(0, 1, 480), chunk('MTrk', [...END_OF_TRACK, 0x00, 0x90, 60, 100])),
    );
    expect(smf.tracks[0]!.events).toEqual([]);
  });

  it('ignores a few stray bytes after the last chunk', () => {
    const smf = readSmf(file(header(0, 1, 480), chunk('MTrk', END_OF_TRACK), [0, 0, 0]));
    expect(smf.tracks).toHaveLength(1);
  });
});

describe('readSmf: events', () => {
  it('reads delta times of up to four bytes, and no more', () => {
    const smf = readSmf(
      file(
        header(0, 1, 480),
        chunk('MTrk', [...vlq(0x0fffffff), 0x90, 60, 100, 0x00, 0x80, 60, 0, ...END_OF_TRACK]),
      ),
    );
    expect(channelEvents(smf.tracks[0]!.events)[0]!.tick).toBe(0x0fffffff);
    expectFailure(
      file(header(0, 1, 480), chunk('MTrk', [0x81, 0x80, 0x80, 0x80, 0x00, 0x90, 60, 100])),
      'invalid',
    );
  });

  it('follows running status across channel messages', () => {
    const smf = readSmf(
      file(
        header(0, 1, 480),
        chunk('MTrk', [
          0x00,
          0x91,
          60,
          100,
          0x00,
          64,
          100,
          0x60,
          60,
          0,
          0x00,
          64,
          0,
          ...END_OF_TRACK,
        ]),
      ),
    );
    expect(channelEvents(smf.tracks[0]!.events).map((e) => [e.tick, e.data1, e.data2])).toEqual([
      [0, 60, 100],
      [0, 64, 100],
      [96, 60, 0],
      [96, 64, 0],
    ]);
  });

  it('reads one data byte for program change and channel pressure', () => {
    const smf = readSmf(
      file(
        header(0, 1, 480),
        chunk('MTrk', [0x00, 0xc0, 5, 0x00, 0xd0, 40, 0x00, 0x90, 60, 100, ...END_OF_TRACK]),
      ),
    );
    expect(channelEvents(smf.tracks[0]!.events).map((e) => [e.command, e.data1])).toEqual([
      [0xc0, 5],
      [0xd0, 40],
      [0x90, 60],
    ]);
  });

  it('skips system exclusive messages by their length', () => {
    const smf = readSmf(
      file(
        header(0, 1, 480),
        chunk('MTrk', [
          0x00,
          0xf0,
          0x05,
          0x7e,
          0x7f,
          0x09,
          0x01,
          0xf7,
          0x00,
          0xf7,
          0x02,
          0xf3,
          0x01,
          0x00,
          0x90,
          60,
          100,
          ...END_OF_TRACK,
        ]),
      ),
    );
    expect(smf.tracks[0]!.events).toEqual([
      { type: 'channel', tick: 0, command: 0x90, channel: 0, data1: 60, data2: 100 },
    ]);
  });

  it('keeps running status across a meta event or a system exclusive', () => {
    // The standard says these end running status, but some writers carry on
    // using it after one; a file that follows the standard always has a status
    // byte there, so keeping the last channel status costs it nothing.
    const body = [
      [0x00, 0x90, 60, 100],
      [0x00, 0xff, 0x01, 0x01, 0x41], // a text event
      [0x00, 62, 100], // a note-on, by running status
      [0x00, 0xf0, 0x01, 0xf7], // a system exclusive
      [0x60, 60, 0], // a note-on at velocity 0, by running status
      END_OF_TRACK,
    ].flat();
    const smf = readSmf(file(header(0, 1, 480), chunk('MTrk', body)));
    expect(smf.tracks[0]!.events).toEqual([
      { type: 'channel', tick: 0, command: 0x90, channel: 0, data1: 60, data2: 100 },
      { type: 'meta', tick: 0, metaType: 0x01, data: Uint8Array.from([0x41]) },
      { type: 'channel', tick: 0, command: 0x90, channel: 0, data1: 62, data2: 100 },
      { type: 'channel', tick: 96, command: 0x90, channel: 0, data1: 60, data2: 0 },
    ]);
  });

  it('refuses a data byte with no status before it', () => {
    expectFailure(
      file(header(0, 1, 480), chunk('MTrk', [0x00, 60, 100, ...END_OF_TRACK])),
      'invalid',
    );
    // A meta event is no channel status to borrow.
    expectFailure(
      file(
        header(0, 1, 480),
        chunk('MTrk', [0x00, 0xff, 0x01, 0x01, 0x41, 0x00, 60, 100, ...END_OF_TRACK]),
      ),
      'invalid',
    );
    // Nor is the last track's: each track starts with none.
    expectFailure(
      file(
        header(1, 2, 480),
        chunk('MTrk', [0x00, 0x90, 60, 100, ...END_OF_TRACK]),
        chunk('MTrk', [0x00, 62, 100, ...END_OF_TRACK]),
      ),
      'invalid',
    );
  });

  it('refuses a status byte where a data byte belongs', () => {
    expectFailure(
      file(header(0, 1, 480), chunk('MTrk', [0x00, 0x90, 60, 0x90, ...END_OF_TRACK])),
      'invalid',
    );
  });

  it('refuses system messages that have no place in a file', () => {
    expectFailure(file(header(0, 1, 480), chunk('MTrk', [0x00, 0xf8, ...END_OF_TRACK])), 'invalid');
  });

  it('refuses a track cut off in the middle of an event', () => {
    for (const body of [
      [0x00, 0x90, 60],
      [0x00, 0xff, 0x03, 0x05, 0x41],
      [0x00, 0xf0, 0x10, 0x01],
      [0x81],
    ]) {
      expectFailure(file(header(0, 1, 480), chunk('MTrk', body)), 'invalid');
    }
    // Cut inside the declared length of a track that is not the last.
    expectFailure(
      file(header(1, 2, 480), chunk('MTrk', [0x00, 0x90], 2), chunk('MTrk', END_OF_TRACK)),
      'invalid',
    );
  });

  it('accepts a track that simply runs out without an End of Track', () => {
    const smf = readSmf(
      file(header(0, 1, 480), chunk('MTrk', [0x00, 0x90, 60, 100, 0x10, 0x80, 60, 0])),
    );
    expect(channelEvents(smf.tracks[0]!.events)).toHaveLength(2);
    expect(smf.tracks[0]!.endTick).toBe(16);
  });
});

describe('readSmf: limits', () => {
  /** A track of `count` note events by running status, then its End of Track. */
  function notes(count: number): number[] {
    const body = [0x00, 0x90, 60, 100];
    for (let i = 1; i < count; i += 1) body.push(0x00, 60, i % 2 === 0 ? 100 : 0);
    return [...body, ...END_OF_TRACK];
  }

  it('holds a file to a million events', () => {
    expect(MAX_SMF_EVENTS).toBe(1_000_000);
  });

  it('reads a file of as many events as it may hold, and refuses one more', () => {
    // Three notes and the End of Track: four events.
    const bytes = file(header(0, 1, 480), chunk('MTrk', notes(3)));
    expect(channelEvents(readSmf(bytes, 4).tracks[0]!.events)).toHaveLength(3);
    const error = expectFailure(bytes, 'invalid', 3);
    expect(error.issues).toEqual(['The file holds more than 3 events.']);
  });

  it('counts across every track', () => {
    const bytes = file(header(1, 2, 480), chunk('MTrk', notes(2)), chunk('MTrk', notes(2)));
    expect(readSmf(bytes, 6).tracks).toHaveLength(2);
    expectFailure(bytes, 'invalid', 5);
  });

  it('counts meta events and system exclusives too', () => {
    const body = [
      [0x00, 0xf0, 0x01, 0xf7],
      [0x00, 0xf7, 0x01, 0x00],
      [0x00, 0xff, 0x01, 0x01, 0x41],
      END_OF_TRACK,
    ].flat();
    const bytes = file(header(0, 1, 480), chunk('MTrk', body));
    expect(readSmf(bytes, 4).tracks[0]!.events).toHaveLength(1);
    expectFailure(bytes, 'invalid', 3);
  });

  it('counts a track that is empty, so a flood of them is refused too', () => {
    const empty = Array.from({ length: 5 }, () => chunk('MTrk', []));
    const bytes = file(header(1, 5, 480), ...empty);
    expect(readSmf(bytes, 5).tracks).toHaveLength(5);
    expectFailure(bytes, 'invalid', 4);
  });

  it('names the limit as people write numbers', () => {
    const bytes = file(header(0, 1, 480), chunk('MTrk', notes(1500)));
    expect(expectFailure(bytes, 'invalid', 1500).issues).toEqual([
      'The file holds more than 1,500 events.',
    ]);
  });
});
