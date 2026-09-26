import { describe, expect, it } from 'vitest';
import { MIDI_TICKS_PER_QUARTER, takeToMidi } from '@/domain/midiExport';
import { createEmptyTake } from '@/domain/noteEvents';
import type { NoteEvent, Take } from '@/domain/takeTypes';

interface ParsedEvent {
  tick: number;
  bytes: number[];
}

/** Read a file back the way a sequencer would: header, then each track's events. */
function parseMidi(file: Uint8Array) {
  let at = 0;
  const u32 = () => {
    const value = (file[at]! << 24) | (file[at + 1]! << 16) | (file[at + 2]! << 8) | file[at + 3]!;
    at += 4;
    return value >>> 0;
  };
  const u16 = () => {
    const value = (file[at]! << 8) | file[at + 1]!;
    at += 2;
    return value;
  };
  const tag = () => {
    const value = String.fromCharCode(...file.subarray(at, at + 4));
    at += 4;
    return value;
  };
  const varLen = () => {
    let value = 0;
    for (;;) {
      const byte = file[at++]!;
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
  };
  expect(tag()).toBe('MThd');
  expect(u32()).toBe(6);
  const format = u16();
  const trackCount = u16();
  const division = u16();
  const tracks: ParsedEvent[][] = [];
  for (let t = 0; t < trackCount; t += 1) {
    expect(tag()).toBe('MTrk');
    const end = u32() + at;
    const events: ParsedEvent[] = [];
    let tick = 0;
    while (at < end) {
      tick += varLen();
      const status = file[at]!;
      const from = at;
      if (status === 0xff) {
        at += 2;
        const length = varLen();
        at += length;
      } else if ((status & 0xf0) === 0xc0) {
        at += 2;
      } else {
        at += 3;
      }
      events.push({ tick, bytes: [...file.subarray(from, at)] });
    }
    tracks.push(events);
  }
  expect(at).toBe(file.length);
  return { format, division, tracks };
}

/** Notes a track sounds, paired on and off. */
function notesOf(events: ParsedEvent[]) {
  const open = new Map<number, ParsedEvent>();
  const out: { midi: number; channel: number; velocity: number; start: number; end: number }[] = [];
  for (const event of events) {
    const [status, midi, velocity] = event.bytes as [number, number, number];
    if ((status & 0xf0) === 0x90) {
      expect(open.has(midi)).toBe(false);
      open.set(midi, event);
    } else if ((status & 0xf0) === 0x80) {
      const on = open.get(midi)!;
      open.delete(midi);
      out.push({
        midi,
        channel: status & 0x0f,
        velocity: on.bytes[2]!,
        start: on.tick,
        end: event.tick,
      });
      void velocity;
    }
  }
  expect(open.size).toBe(0);
  return out;
}

function metaOf(events: ParsedEvent[], type: number): ParsedEvent[] {
  return events.filter((event) => event.bytes[0] === 0xff && event.bytes[1] === type);
}

function note(midi: number, startMs: number, durationMs: number, extra: Partial<NoteEvent> = {}) {
  return { id: `${midi}-${startMs}`, midi, startMs, durationMs, velocity: 0.5, ...extra };
}

function take(overrides: Partial<Take> = {}): Take {
  return createEmptyTake({ title: 'Test', ...overrides });
}

const Q = MIDI_TICKS_PER_QUARTER;

describe('MIDI export', () => {
  it('writes a format 1 file: tempo track, then right hand, then left', () => {
    const file = takeToMidi(
      take({ notes: [note(72, 0, 500), note(48, 500, 500, { staff: 'bass' })] }),
      { title: 'Für Elise', trackNames: { right: 'Right hand', left: 'Left hand' } },
    );
    const { format, division, tracks } = parseMidi(file);
    expect([format, division, tracks.length]).toEqual([1, Q, 3]);
    const name = (events: ParsedEvent[]) =>
      new TextDecoder().decode(Uint8Array.from(metaOf(events, 0x03)[0]!.bytes.slice(3)));
    expect(tracks.map(name)).toEqual(['Für Elise', 'Right hand', 'Left hand']);
    // A quarter at 120 bpm is 500 ms; velocity 0.5 of 127.
    expect(notesOf(tracks[1]!)).toEqual([{ midi: 72, channel: 0, velocity: 64, start: 0, end: Q }]);
    expect(notesOf(tracks[2]!)).toEqual([
      { midi: 48, channel: 1, velocity: 64, start: Q, end: 2 * Q },
    ]);
    for (const events of tracks) expect(events.at(-1)!.bytes).toEqual([0xff, 0x2f, 0x00]);
  });

  it('splits the hands the way the notation does, at middle C', () => {
    const { tracks } = parseMidi(
      takeToMidi(take({ notes: [note(60, 0, 500), note(59, 0, 500)] }), { title: 't' }),
    );
    expect(notesOf(tracks[1]!).map((n) => n.midi)).toEqual([60]);
    expect(notesOf(tracks[2]!).map((n) => n.midi)).toEqual([59]);
  });

  it('keeps bar lines where the tempo map puts them', () => {
    // 120 bpm for four beats (2 s), then 60: a note at 3 s is on beat five.
    const changing = take({
      tempo: {
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        countInBars: 0,
        changes: [{ atMs: 2000, bpm: 60 }],
      },
      notes: [note(72, 3000, 1000)],
    });
    const { tracks } = parseMidi(takeToMidi(changing, { title: 't' }));
    expect(notesOf(tracks[1]!)).toMatchObject([{ start: 5 * Q, end: 6 * Q }]);
    expect(metaOf(tracks[0]!, 0x51)).toEqual([
      { tick: 0, bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20] }, // 500 000 µs
      { tick: 4 * Q, bytes: [0xff, 0x51, 0x03, 0x0f, 0x42, 0x40] }, // 1 000 000 µs
    ]);
  });

  it('ends the tempo track after a tempo change that comes once the music has stopped', () => {
    // One quarter, then 60 bpm from the third bar: a reader may stop at End of
    // Track, so the change has to come before it.
    const late = take({
      tempo: {
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        countInBars: 0,
        changes: [{ atMs: 4000, bpm: 60 }],
      },
      notes: [note(72, 0, 500)],
    });
    const conductor = parseMidi(takeToMidi(late, { title: 't' })).tracks[0]!;
    expect(metaOf(conductor, 0x51).at(-1)).toEqual({
      tick: 8 * Q,
      bytes: [0xff, 0x51, 0x03, 0x0f, 0x42, 0x40],
    });
    expect(conductor.at(-1)).toEqual({ tick: 8 * Q, bytes: [0xff, 0x2f, 0x00] });
  });

  it('declares a compound meter and counts its eighths as half quarters', () => {
    const sixEight = take({
      tempo: { bpm: 120, timeSignature: { numerator: 6, denominator: 8 }, countInBars: 0 },
      notes: [note(72, 750, 250)],
    });
    const { tracks } = parseMidi(takeToMidi(sixEight, { title: 't' }));
    expect(metaOf(tracks[0]!, 0x58)[0]!.bytes).toEqual([0xff, 0x58, 0x04, 6, 3, 36, 8]);
    expect(notesOf(tracks[1]!)).toMatchObject([{ start: 1.5 * Q, end: 2 * Q }]);
  });

  it('declares the key, flats as a negative count', () => {
    const { tracks } = parseMidi(
      takeToMidi(take({ notes: [note(72, 0, 500)] }), {
        title: 't',
        key: { fifths: -3, minor: true },
      }),
    );
    expect(metaOf(tracks[0]!, 0x59)[0]!.bytes).toEqual([0xff, 0x59, 0x02, 0xfd, 1]);
  });

  it('sends the pedal to both hands, once per change', () => {
    const pedalled = take({
      notes: [note(72, 0, 500), note(48, 0, 500)],
      pedalEvents: [
        { atMs: 0, down: true },
        { atMs: 250, down: true },
        { atMs: 1000, down: false },
      ],
    });
    const { tracks } = parseMidi(takeToMidi(pedalled, { title: 't' }));
    for (const [index, channel] of [
      [1, 0],
      [2, 1],
    ] as const) {
      const controls = tracks[index]!.filter((event) => (event.bytes[0]! & 0xf0) === 0xb0);
      expect(controls).toEqual([
        { tick: 0, bytes: [0xb0 | channel, 64, 127] },
        { tick: 2 * Q, bytes: [0xb0 | channel, 64, 0] },
      ]);
    }
  });

  it('plays a key struck again while held as a re-strike held to the longer end', () => {
    // A half note with an eighth on the same key inside it.
    const { tracks } = parseMidi(
      takeToMidi(take({ notes: [note(72, 0, 2000), note(72, 500, 250)] }), { title: 't' }),
    );
    expect(notesOf(tracks[1]!)).toMatchObject([
      { start: 0, end: Q },
      { start: Q, end: 4 * Q },
    ]);
  });

  it('plays a key two voices share at once as one note, the harder and longer', () => {
    const shared = take({
      notes: [
        { ...note(72, 0, 500), id: 'a', velocity: 0.3 },
        { ...note(72, 0, 1000), id: 'b', velocity: 0.8 },
      ],
    });
    const { tracks } = parseMidi(takeToMidi(shared, { title: 't' }));
    expect(notesOf(tracks[1]!)).toEqual([
      { midi: 72, channel: 0, velocity: 102, start: 0, end: 2 * Q },
    ]);
  });

  it('leaves out a note written but not played, even where it shares a key', () => {
    const written = take({
      notes: [
        // A trill's written note, silent, over the first note that plays it…
        { ...note(72, 0, 2000), id: 'a', velocity: 0 },
        { ...note(72, 0, 250), id: 'b', velocity: 0.8 },
        // …and one standing alone.
        { ...note(74, 1000, 500), id: 'c', velocity: 0 },
      ],
    });
    const { tracks } = parseMidi(takeToMidi(written, { title: 't' }));
    expect(notesOf(tracks[1]!)).toEqual([
      { midi: 72, channel: 0, velocity: 102, start: 0, end: Q / 2 },
    ]);
  });

  it('lets a key go before striking it again on the same tick', () => {
    const { tracks } = parseMidi(
      takeToMidi(take({ notes: [note(72, 0, 500), note(72, 500, 500)] }), { title: 't' }),
    );
    const onOff = tracks[1]!.filter((event) => event.tick === Q && event.bytes[1] === 72);
    expect(onOff.map((event) => event.bytes[0]! & 0xf0)).toEqual([0x80, 0x90]);
  });

  it('names the program the piano stands for', () => {
    const { tracks } = parseMidi(
      takeToMidi(take({ notes: [note(72, 0, 500)] }), { title: 't', program: 4 }),
    );
    expect(tracks[1]!.find((event) => (event.bytes[0]! & 0xf0) === 0xc0)!.bytes).toEqual([0xc0, 4]);
  });
});
