import { describe, expect, it, vi } from 'vitest';
import { noteHand } from '@/domain/hands';
import { takeToMidi } from '@/domain/midiExport';
import { applySustainToNotes } from '@/features/transport/sustainPedal';
import { midiToTake } from '@/domain/midiImport';
import { createEmptyTake } from '@/domain/noteEvents';
import { parseTakeJson } from '@/domain/takeSchema';
import { MAX_NOTE_COUNT, MAX_TEMPO_CHANGES, type NoteEvent, type Take } from '@/domain/takeTypes';
import { MidiImportError } from '@/utils/errors';

// ---------------------------------------------------------------------------
// A small Standard MIDI File writer, so a test can say exactly which bytes a
// file holds — independent of the exporter, and of the reader under test.
// ---------------------------------------------------------------------------

type Ev = readonly [tick: number, ...bytes: number[]];

function vlq(value: number): number[] {
  const out = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) out.unshift((rest & 0x7f) | 0x80);
  return out;
}

function chunk(type: string, body: readonly number[]): number[] {
  const n = body.length;
  return [
    ...[...type].map((c) => c.charCodeAt(0)),
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
    ...body,
  ];
}

function track(events: readonly Ev[]): number[] {
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event[0] - b.event[0] || a.index - b.index);
  const body: number[] = [];
  let at = 0;
  for (const { event } of sorted) {
    const [tick, ...bytes] = event;
    body.push(...vlq(tick - at), ...bytes);
    at = tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return chunk('MTrk', body);
}

function smf(format: 0 | 1, division: number, tracks: readonly (readonly Ev[])[]): Uint8Array {
  const header = chunk('MThd', [
    0,
    format,
    0,
    tracks.length,
    (division >> 8) & 0xff,
    division & 0xff,
  ]);
  return Uint8Array.from([...header, ...tracks.flatMap((events) => track(events))]);
}

function tempo(tick: number, bpm: number): Ev {
  const us = Math.round(60_000_000 / bpm);
  return [tick, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
}

function meter(tick: number, numerator: number, denominator: number): Ev {
  return [tick, 0xff, 0x58, 0x04, numerator, Math.log2(denominator), 24, 8];
}

function key(tick: number, fifths: number, minor: boolean): Ev {
  return [tick, 0xff, 0x59, 0x02, fifths & 0xff, minor ? 1 : 0];
}

function name(tick: number, bytes: readonly number[]): Ev {
  return [tick, 0xff, 0x03, bytes.length, ...bytes];
}

/** A note as an on and an off on `channel`. */
function played(channel: number, midi: number, from: number, to: number, velocity = 100): Ev[] {
  return [
    [from, 0x90 | channel, midi, velocity],
    [to, 0x80 | channel, midi, 0],
  ];
}

function pedal(channel: number, tick: number, down: boolean): Ev {
  return [tick, 0xb0 | channel, 64, down ? 127 : 0];
}

function failure(run: () => unknown): MidiImportError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(MidiImportError);
  return caught as MidiImportError;
}

function repairsOf(take: Take) {
  return parseTakeJson(JSON.parse(JSON.stringify(take))).repairs;
}

/** A tiny deterministic random source, so a "performance" is the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// ---------------------------------------------------------------------------
// Round trips through the app's own exporter.
// ---------------------------------------------------------------------------

function note(midi: number, startMs: number, durationMs: number, extra: Partial<NoteEvent> = {}) {
  return { id: `n${midi}-${startMs}`, midi, startMs, durationMs, velocity: 0.5, ...extra };
}

/** A two-hand score: 3/4 at ♩=72, then ♩=90 from the third bar, in C minor. */
function scoreTake(): Take {
  const beat = 60_000 / 72;
  const at90 = 6 * beat; // the third bar
  const beat90 = 60_000 / 90;
  const notes: NoteEvent[] = [];
  for (let i = 0; i < 6; i += 1) {
    notes.push(note(72 + (i % 3), Math.round(i * beat), Math.round(beat)));
    if (i % 3 === 0) notes.push(note(48, Math.round(i * beat), Math.round(3 * beat), {}));
  }
  for (let i = 0; i < 6; i += 1) {
    notes.push(note(75, Math.round(at90 + i * beat90), Math.round(beat90 / 2)));
  }
  // Written on the treble staff below middle C, and on the bass staff above it:
  // the hands come back from the tracks, not from the split.
  notes.push(note(57, Math.round(at90), Math.round(beat90), { staff: 'treble' }));
  notes.push(note(64, Math.round(at90), Math.round(beat90), { staff: 'bass' }));
  return createEmptyTake({
    title: 'Nocturne in C minor',
    tempo: {
      bpm: 72,
      timeSignature: { numerator: 3, denominator: 4 },
      countInBars: 1,
      changes: [{ atMs: Math.round(at90), bpm: 90 }],
      keySignature: -3,
      keyMode: 'minor',
    },
    notes,
    pedalEvents: [
      { atMs: 0, down: true },
      { atMs: Math.round(3 * beat), down: false },
      { atMs: Math.round(3 * beat), down: true },
      { atMs: Math.round(at90), down: false },
    ],
  });
}

function exported(take: Take): Uint8Array {
  return takeToMidi(take, {
    title: take.title,
    key:
      take.tempo.keySignature !== undefined
        ? { fifths: take.tempo.keySignature, minor: take.tempo.keyMode === 'minor' }
        : undefined,
    trackNames: { right: 'Right hand', left: 'Left hand' },
  });
}

function byStart(notes: readonly NoteEvent[]) {
  return [...notes].sort((a, b) => a.startMs - b.startMs || a.midi - b.midi);
}

describe('midiToTake: the app’s own export comes back', () => {
  const source = scoreTake();
  const take = midiToTake(exported(source), 'nocturne.mid');

  it('keeps every note to within a millisecond', () => {
    const want = byStart(source.notes);
    const got = byStart(take.notes);
    expect(got).toHaveLength(want.length);
    got.forEach((n, i) => {
      const w = want[i]!;
      expect(n.midi).toBe(w.midi);
      expect(Math.abs(n.startMs - w.startMs)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.durationMs - w.durationMs)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.velocity - w.velocity)).toBeLessThanOrEqual(1 / 127);
    });
  });

  it('gives every note back to the hand it was exported from', () => {
    const want = byStart(source.notes).map(noteHand);
    expect(byStart(take.notes).map(noteHand)).toEqual(want);
    expect(take.notes.find((n) => n.midi === 57)!.staff).toBe('treble');
    expect(take.notes.find((n) => n.midi === 64)!.staff).toBe('bass');
  });

  it('hears the pedal both hand tracks carry as one pedal', () => {
    expect(take.pedalEvents).toHaveLength(source.pedalEvents.length);
    take.pedalEvents.forEach((event, i) => {
      const want = source.pedalEvents[i]!;
      expect(event.down).toBe(want.down);
      expect(Math.abs(event.atMs - want.atMs)).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the tempo map', () => {
    expect(take.tempo.bpm).toBe(72);
    expect(take.tempo.changes).toHaveLength(1);
    expect(take.tempo.changes![0]!.bpm).toBe(90);
    expect(
      Math.abs(take.tempo.changes![0]!.atMs - source.tempo.changes![0]!.atMs),
    ).toBeLessThanOrEqual(1);
  });

  it('keeps the meter, the key and its mode, and the title', () => {
    expect(take.tempo.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(take.tempo.keySignature).toBe(-3);
    expect(take.tempo.keyMode).toBe('minor');
    expect(take.title).toBe('Nocturne in C minor');
  });

  it('reads as a written score on the grid it was written on', () => {
    expect(take.display.quantization).toBe('1/16');
  });

  it('imports without a single repair', () => {
    expect(repairsOf(take)).toEqual([]);
  });

  it('keeps a compound meter', () => {
    const sixEight = createEmptyTake({
      title: 'Barcarolle',
      tempo: { bpm: 60, timeSignature: { numerator: 6, denominator: 8 }, countInBars: 1 },
      notes: [0, 1, 2, 3, 4, 5].map((i) => note(67 + i, i * 500, 500)),
    });
    const back = midiToTake(exported(sixEight), 'b.mid');
    expect(back.tempo.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    expect(back.tempo.bpm).toBe(60);
  });

  it('keeps a triplet score on its grid', () => {
    const triplets = createEmptyTake({
      title: 'Triplets',
      notes: Array.from({ length: 24 }, (_, i) =>
        note(60 + (i % 12), Math.round((i * 500) / 3), Math.round(500 / 3)),
      ),
    });
    expect(midiToTake(exported(triplets), 't.mid').display.quantization).toBe('1/16');
  });

  it('chooses the grid a run of 32nds or 64ths needs', () => {
    const run = (stepMs: number) =>
      createEmptyTake({
        title: 'Run',
        notes: Array.from({ length: 32 }, (_, i) =>
          note(60 + (i % 12), Math.round(i * stepMs), Math.round(stepMs)),
        ),
      });
    // At ♩=120 a 32nd is 62.5 ms and a 64th 31.25 ms; the ms are rounded.
    expect(midiToTake(exported(run(62.5)), 'r.mid').display.quantization).toBe('1/32');
    expect(midiToTake(exported(run(31.25)), 'r.mid').display.quantization).toBe('1/64');
  });
});

// ---------------------------------------------------------------------------
// Files from elsewhere.
// ---------------------------------------------------------------------------

describe('midiToTake: notes', () => {
  it('times notes through the file’s tempo map', () => {
    const take = midiToTake(
      smf(0, 480, [
        [tempo(0, 60), ...played(0, 60, 0, 480), tempo(480, 120), ...played(0, 62, 480, 960)],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.midi, n.startMs, n.durationMs])).toEqual([
      [60, 0, 1000],
      [62, 1000, 500],
    ]);
  });

  it('reads velocity as a fraction of 127, and a note-on at 0 as a note-off', () => {
    const take = midiToTake(
      smf(0, 480, [
        [
          [0, 0x90, 60, 127],
          [480, 0x90, 60, 0],
          [480, 0x90, 64, 1],
          [960, 0x80, 64, 0],
        ],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.midi, n.velocity, n.durationMs])).toEqual([
      [60, 1, 500],
      [64, 1 / 127, 500],
    ]);
  });

  it('pairs a key struck twice before it is let go first in, first out', () => {
    const take = midiToTake(
      smf(0, 480, [
        [
          [0, 0x90, 60, 100],
          [240, 0x90, 60, 80],
          [480, 0x80, 60, 0],
          [960, 0x80, 60, 0],
        ],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([
      [0, 500],
      [250, 750],
    ]);
  });

  it('pairs a note-off written in another track with the strike it ends', () => {
    // Type 1: the strike in one track, its note-off in the next, one channel.
    const take = midiToTake(
      smf(1, 480, [[[0, 0x90, 60, 100]], [[480, 0x80, 60, 0], ...played(0, 64, 960, 1440)]]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.midi, n.startMs, n.durationMs])).toEqual([
      [60, 0, 500],
      [64, 1000, 500],
    ]);
  });

  it('lets a track end its own strikes first when two tracks share a channel', () => {
    // Both hands on channel 1, one key held by each, overlapping.
    const take = midiToTake(smf(1, 480, [played(0, 60, 0, 960), played(0, 60, 480, 720)]), 'x.mid');
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([
      [0, 1000],
      [500, 250],
    ]);
  });

  it('never ends another track’s strike on the very tick it is struck', () => {
    // A stray note-off in one track lands on the tick another track strikes the
    // key; which of the two came first means nothing, so the strike is kept.
    const take = midiToTake(smf(1, 480, [played(0, 60, 480, 960), [[480, 0x80, 60, 0]]]), 'x.mid');
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([[500, 500]]);
  });

  it('pairs 20,000 strikes of one key with their note-offs first in, first out', () => {
    // At 500 ticks a quarter and the default ♩=120, a tick is a millisecond.
    // Strike i comes at i ms, and every note-off after the last strike, 2 ms
    // apart: first in, first out, strike i ends at 20,000 + 2i ms and so lasts
    // 20,000 + i. Any other pairing gives other lengths.
    const count = 20_000;
    const events: Ev[] = [];
    for (let i = 0; i < count; i += 1) events.push([i, 0x90, 60, 1 + (i % 127)]);
    for (let i = 0; i < count; i += 1) events.push([count + 2 * i, 0x80, 60, 0]);
    const take = midiToTake(smf(0, 500, [events]), 'x.mid');
    expect(take.notes).toHaveLength(count);
    for (const i of [0, count / 2, count - 1]) {
      expect(take.notes[i]).toMatchObject({
        startMs: i,
        durationMs: count + i,
        velocity: (1 + (i % 127)) / 127,
      });
    }
  });

  it('ends every note a channel holds at an All Notes Off (CC123)', () => {
    // C4 struck and never let go, a CC123, then C4 struck and let go again:
    // without the controller, the one note-off would end the first strike.
    const take = midiToTake(
      smf(0, 480, [[[0, 0x90, 60, 100], [480, 0xb0, 123, 0], ...played(0, 60, 960, 1440)]]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([
      [0, 500],
      [1000, 500],
    ]);
  });

  it('ends every note a channel holds at an All Sound Off (CC120) too', () => {
    const take = midiToTake(
      smf(0, 480, [
        [[0, 0x92, 60, 100], [0, 0x92, 64, 100], [480, 0xb2, 120, 0], ...played(2, 60, 960, 1440)],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.midi, n.startMs, n.durationMs])).toEqual([
      [60, 0, 500],
      [64, 0, 500],
      [60, 1000, 500],
    ]);
  });

  it('ends a key struck again after it was let go, and nothing already ended', () => {
    // C4 struck and let go, struck again, then the channel's All Notes Off.
    const take = midiToTake(
      smf(0, 480, [[...played(0, 60, 0, 240), [288, 0x90, 60, 100], [480, 0xb0, 123, 0]]]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([
      [0, 250],
      [300, 200],
    ]);
  });

  it('looks only at the keys a channel holds when it is silenced', () => {
    // A dense stream of All Notes Off with one note held elsewhere. Each must
    // cost a look at what its channel holds, not a sweep of all 128 keys.
    const panics = 5000;
    const events: Ev[] = [[0, 0x90, 60, 100]];
    for (let i = 1; i <= panics; i += 1) events.push([i, 0xb1, 123, 0]);
    events.push([panics + 1, 0x80, 60, 0]);
    const bytes = smf(0, 480, [events]);
    const lookups = vi.spyOn(Map.prototype, 'get');
    try {
      const take = midiToTake(bytes, 'x.mid');
      expect(take.notes).toHaveLength(1);
      expect(lookups.mock.calls.length).toBeLessThan(panics * 4);
    } finally {
      lookups.mockRestore();
    }
  });

  it('leaves the notes of other channels alone', () => {
    const otherChannel = midiToTake(
      smf(0, 480, [
        [
          [0, 0x90, 60, 100],
          [480, 0xb1, 123, 0],
          [960, 0x80, 60, 0],
        ],
      ]),
      'x.mid',
    );
    expect(otherChannel.notes.map((n) => n.durationMs)).toEqual([1000]);
  });

  it('ends the channel’s notes in every track, as MIDI addresses channels', () => {
    const take = midiToTake(
      smf(1, 480, [
        [
          [0, 0x90, 60, 100],
          [960, 0x80, 60, 0],
        ],
        [[480, 0xb0, 123, 0]],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => n.durationMs)).toEqual([500]);
  });

  it('ends a note its own track struck just before, on the same tick', () => {
    // Within a track the file's order holds: struck, then silenced, at 480.
    const take = midiToTake(
      smf(0, 480, [
        [
          [480, 0x90, 60, 100],
          [480, 0xb0, 123, 0],
          [960, 0x80, 60, 0],
        ],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([[500, 1]]);
  });

  it('pairs notes the same around messages it has no use for', () => {
    // Pitch bend, pressure and a program change between a note's ends.
    const take = midiToTake(
      smf(0, 480, [
        [
          [0, 0x90, 60, 100],
          [120, 0xe0, 0, 64],
          [240, 0xd0, 40],
          [360, 0xc0, 5],
          [480, 0x80, 60, 0],
        ],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([[0, 500]]);
  });

  it('never silences another track’s note struck on the same tick', () => {
    // Each hand's track opens with an All Notes Off on the shared channel, on
    // the tick its first note is struck: a reset, not an end to the other's.
    const take = midiToTake(
      smf(1, 480, [
        [[0, 0xb0, 123, 0], ...played(0, 72, 0, 480)],
        [[0, 0xb0, 123, 0], ...played(0, 48, 0, 480)],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.midi, n.durationMs])).toEqual([
      [48, 500],
      [72, 500],
    ]);
  });

  it('ends a note that is never let go where its track ends', () => {
    const take = midiToTake(smf(0, 480, [[[0, 0x90, 60, 100], ...played(0, 64, 0, 960)]]), 'x.mid');
    expect(take.notes.find((n) => n.midi === 60)!.durationMs).toBe(1000);
  });

  it('leaves the drums out, and refuses a file of nothing else', () => {
    const take = midiToTake(
      smf(0, 480, [[...played(9, 36, 0, 120), ...played(0, 60, 0, 480)]]),
      'x.mid',
    );
    expect(take.notes.map((n) => n.midi)).toEqual([60]);
    const error = failure(() => midiToTake(smf(0, 480, [played(9, 36, 0, 120)]), 'd.mid'));
    expect(error.kind).toBe('invalid');
    expect(error.issues[0]).toMatch(/drum/i);
  });

  it('refuses a file with no notes', () => {
    const error = failure(() => midiToTake(smf(1, 480, [[tempo(0, 100)], []]), 'e.mid'));
    expect(error.issues[0]).toMatch(/no playable notes/i);
  });

  it('refuses more notes than a take can hold', () => {
    const events: Ev[] = [];
    for (let i = 0; i <= MAX_NOTE_COUNT; i += 1) events.push(...played(0, 60, i, i + 1));
    const error = failure(() => midiToTake(smf(0, 480, [events]), 'big.mid'));
    expect(error.issues[0]).toContain(String(MAX_NOTE_COUNT));
  });

  it('passes the reader’s refusal on', () => {
    const bytes = smf(0, 480, [played(0, 60, 0, 480)]);
    bytes[9] = 2; // type 2
    expect(failure(() => midiToTake(bytes, 'p.mid')).kind).toBe('unsupported');
  });
});

describe('midiToTake: hands', () => {
  it('splits a type 0 file’s two channels by their pitch', () => {
    // Channel 1 plays above channel 2 here, so it is the right hand even
    // though the app's own export would have put the right hand on channel 1.
    const take = midiToTake(
      smf(0, 480, [
        [...played(0, 43, 0, 480), ...played(1, 76, 0, 480), ...played(0, 62, 480, 960)],
      ]),
      'x.mid',
    );
    expect(take.notes.find((n) => n.midi === 76)!.staff).toBe('treble');
    expect(take.notes.find((n) => n.midi === 43)!.staff).toBe('bass');
    expect(take.notes.find((n) => n.midi === 62)!.staff).toBe('bass');
  });

  it('splits two tracks by their pitch too', () => {
    const take = midiToTake(
      smf(1, 480, [[tempo(0, 100)], played(3, 40, 0, 480), played(5, 70, 0, 480)]),
      'x.mid',
    );
    expect(take.notes.find((n) => n.midi === 70)!.staff).toBe('treble');
    expect(take.notes.find((n) => n.midi === 40)!.staff).toBe('bass');
  });

  it('leaves a single part to the middle-C split', () => {
    const take = midiToTake(
      smf(0, 480, [[...played(0, 48, 0, 480), ...played(0, 72, 0, 480)]]),
      'x.mid',
    );
    expect(take.notes.every((n) => n.staff === undefined)).toBe(true);
  });

  it('leaves three parts to the middle-C split', () => {
    const take = midiToTake(
      smf(1, 480, [played(0, 72, 0, 480), played(1, 60, 0, 480), played(2, 48, 0, 480)]),
      'x.mid',
    );
    expect(take.notes.every((n) => n.staff === undefined)).toBe(true);
  });
});

describe('midiToTake: pedal', () => {
  it('reads 64 and above as down', () => {
    const take = midiToTake(
      smf(0, 480, [
        [
          [0, 0xb0, 64, 64],
          [240, 0xb0, 64, 63],
          [480, 0xb0, 64, 100],
          [600, 0xb0, 64, 0],
          ...played(0, 60, 0, 960),
        ],
      ]),
      'x.mid',
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 250, down: false },
      { atMs: 500, down: true },
      { atMs: 625, down: false },
    ]);
  });

  it('holds the pedal while any channel holds it', () => {
    const take = midiToTake(
      smf(0, 480, [
        [
          pedal(0, 0, true),
          pedal(1, 240, true),
          pedal(0, 480, false),
          pedal(1, 720, false),
          pedal(1, 720, false),
          ...played(0, 60, 0, 960),
        ],
      ]),
      'x.mid',
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 750, down: false },
    ]);
  });

  it('lifts the pedal inside a millisecond only if it was ever all the way up', () => {
    // Both hands hold; within one millisecond, on ticks of their own, one
    // re-pedals and then the other. One channel is down throughout, so the
    // pedal never lifts — where the same changes on one tick would be the
    // export's change of pedal.
    const ms = 9600 / 500; // ticks a millisecond at 9600 to the quarter, ♩=120
    const at = 1000 * ms;
    const staggered = midiToTake(
      smf(0, 9600, [
        [
          pedal(0, 0, true),
          pedal(1, 0, true),
          pedal(0, at + 1, false),
          pedal(0, at + 2, true),
          pedal(1, at + 3, false),
          pedal(1, at + 4, true),
          ...played(0, 60, 0, 2 * at),
        ],
      ]),
      'x.mid',
    );
    expect(staggered.pedalEvents).toEqual([{ atMs: 0, down: true }]);
  });

  it('settles pedal changes that round to one millisecond in the file’s order', () => {
    // At 960 to the quarter and ♩=120 a tick is 0.52 ms: a press at tick 1 and
    // a release at tick 2 both land on 1 ms. Down then up nets nothing, where
    // sorted as one moment's up and down it would leave the pedal down.
    const pressed = midiToTake(
      smf(0, 960, [[pedal(0, 1, true), pedal(0, 2, false), ...played(0, 60, 0, 1920)]]),
      'x.mid',
    );
    expect(pressed.pedalEvents).toEqual([]);
    // And a change of pedal inside one millisecond is still a change.
    const changed = midiToTake(
      smf(0, 960, [
        [pedal(0, 0, true), pedal(0, 1921, false), pedal(0, 1922, true), ...played(0, 60, 0, 3840)],
      ]),
      'x.mid',
    );
    expect(changed.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 1001, down: false },
      { atMs: 1001, down: true },
    ]);
  });

  it('stops a note All Sound Off cuts while its key and the pedal are held', () => {
    // C4 still held under the pedal at CC120: it must sound no further than
    // the controller, not ring on under the pedal pressed again after it.
    const take = midiToTake(
      smf(0, 480, [
        [pedal(0, 0, true), [0, 0x90, 60, 100], [480, 0xb0, 120, 0], [960, 0x80, 60, 0]],
      ]),
      'x.mid',
    );
    const [sounded] = applySustainToNotes(take.notes, take.pedalEvents);
    expect(sounded!.startMs + sounded!.durationMs).toBe(500);
  });

  it('stops a note let go on the tick of an All Sound Off under the pedal', () => {
    // Let go by its note-off just before the controller, on the same tick: the
    // pedal held it, so the controller silences it, and the press after the
    // break must not hold it on.
    const take = midiToTake(
      smf(0, 480, [[pedal(0, 0, true), ...played(0, 60, 0, 480), [480, 0xb0, 120, 0]]]),
      'x.mid',
    );
    const [sounded] = applySustainToNotes(take.notes, take.pedalEvents);
    expect(sounded!.startMs + sounded!.durationMs).toBe(500);
  });

  it('leaves out a note All Sound Off silences as it is struck under the pedal', () => {
    // Struck and silenced on one tick, with the pedal held: it never sounds,
    // and kept as the shortest note a take holds it would let go after the
    // pedal went down again, and ring on.
    const take = midiToTake(
      smf(0, 480, [
        [pedal(0, 0, true), [480, 0x90, 60, 100], [480, 0xb0, 120, 0], ...played(0, 64, 960, 1440)],
      ]),
      'x.mid',
    );
    expect(take.notes.map((n) => [n.midi, n.startMs])).toEqual([[64, 1000]]);
  });

  it('leaves a note whole when the pedal, broken, is let up within the millisecond', () => {
    // At 9600 to the quarter a tick is 0.05 ms: CC120 breaks the held pedal at
    // 1000 ms and a release a tick later lets it up, so nothing presses it
    // again at 1000 ms and the note let go there keeps its length.
    const ms = 9600 / 500;
    const at = 1000 * ms;
    const take = midiToTake(
      smf(0, 9600, [
        [pedal(0, 0, true), ...played(0, 60, 0, at), [at, 0xb0, 120, 0], pedal(0, at + 1, false)],
      ]),
      'x.mid',
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 1000, down: false },
    ]);
    expect(take.notes.map((n) => n.durationMs)).toEqual([1000]);
  });

  it('leaves a note whole when an All Sound Off on its tick finds no pedal', () => {
    const take = midiToTake(
      smf(0, 480, [[...played(0, 60, 0, 480), [480, 0xb0, 120, 0]]]),
      'x.mid',
    );
    expect(take.notes.map((n) => n.durationMs)).toEqual([500]);
  });

  it('breaks a held pedal for an instant at an All Sound Off (CC120)', () => {
    // The pedal goes down and stays down; CC120 silences what it was holding,
    // and the pedal holds again from there.
    const held = midiToTake(
      smf(0, 480, [[pedal(0, 0, true), ...played(0, 60, 0, 240), [480, 0xb0, 120, 0]]]),
      'x.mid',
    );
    expect(held.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
      { atMs: 500, down: true },
    ]);
    // With the pedal up, there is nothing to break.
    const up = midiToTake(smf(0, 480, [[...played(0, 60, 0, 240), [480, 0xb0, 120, 0]]]), 'x.mid');
    expect(up.pedalEvents).toEqual([]);
  });

  it('keeps the pedal changes a take can hold, and lets it up where they stop', () => {
    // One note under more pedal changes than a take holds, a tick apart.
    const changes: Ev[] = [];
    for (let i = 0; i < MAX_NOTE_COUNT + 2; i += 1) changes.push(pedal(0, i, i % 2 === 0));
    const take = midiToTake(smf(0, 480, [[...changes, ...played(0, 60, 0, 480)]]), 'x.mid');
    expect(take.pedalEvents.length).toBeLessThanOrEqual(MAX_NOTE_COUNT);
    expect(take.pedalEvents.at(-1)?.down).toBe(false);
    expect(() => parseTakeJson(take)).not.toThrow();
  });

  it('lets the pedal up at a Reset All Controllers (CC121)', () => {
    const take = midiToTake(
      smf(0, 480, [[pedal(0, 0, true), [480, 0xb0, 121, 0], ...played(0, 60, 0, 960)]]),
      'x.mid',
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
    ]);
  });

  /** The pedal events of a one-note file whose pedal does what `changes` say. */
  function pedalOf(changes: readonly Ev[]) {
    return midiToTake(smf(0, 480, [[...changes, ...played(0, 60, 0, 1920)]]), 'x.mid').pedalEvents;
  }

  it('reads a channel’s changes at one tick in the order the file gives them', () => {
    // Held, then a redundant press and a release on the same tick: the
    // release is the last word, so the pedal ends up.
    expect(pedalOf([pedal(0, 0, true), pedal(0, 480, true), pedal(0, 480, false)])).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
    ]);
  });

  it('keeps a change of pedal: up and down again at one tick', () => {
    expect(pedalOf([pedal(0, 0, true), pedal(0, 480, false), pedal(0, 480, true)])).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
      { atMs: 500, down: true },
    ]);
  });

  it('hears nothing while one channel holds the pedal and another changes it', () => {
    expect(
      pedalOf([pedal(0, 0, true), pedal(1, 0, true), pedal(1, 480, false), pedal(1, 480, true)]),
    ).toEqual([{ atMs: 0, down: true }]);
  });

  it('hears a change of pedal when one channel lets go as another presses', () => {
    // In one track the file's order holds: a release, then a press, lifts it;
    // a press, then a release, never does.
    expect(pedalOf([pedal(0, 0, true), pedal(0, 480, false), pedal(1, 480, true)])).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
      { atMs: 500, down: true },
    ]);
    expect(pedalOf([pedal(0, 0, true), pedal(1, 480, true), pedal(0, 480, false)])).toEqual([
      { atMs: 0, down: true },
    ]);
    // Across tracks the order of one tick's events means nothing: either way,
    // a change of pedal.
    for (const tracks of [
      [[pedal(0, 0, true), pedal(0, 480, false)], [pedal(1, 480, true)]],
      [[pedal(1, 480, true)], [pedal(0, 0, true), pedal(0, 480, false)]],
    ]) {
      const take = midiToTake(smf(1, 480, [...tracks, played(2, 60, 0, 1920)]), 'x.mid');
      expect(take.pedalEvents).toEqual([
        { atMs: 0, down: true },
        { atMs: 500, down: false },
        { atMs: 500, down: true },
      ]);
    }
  });

  it('lets the pedal up when one track releases a channel another presses again', () => {
    // A channel held; on one tick one track presses it again (redundantly)
    // and another track lets it go. However the two fall, the pedal comes up.
    const take = midiToTake(
      smf(1, 480, [
        [pedal(0, 0, true), pedal(0, 480, true)],
        [pedal(0, 480, false)],
        played(1, 60, 0, 960),
      ]),
      'x.mid',
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
    ]);
  });

  it('never lifts the pedal one track’s channels hold in turn on one tick', () => {
    // A type 0 file: both channels held; on one tick channel 1 changes pedal,
    // then channel 2 does. One of them is down at every point of the file.
    expect(
      pedalOf([
        pedal(0, 0, true),
        pedal(1, 0, true),
        pedal(0, 480, false),
        pedal(0, 480, true),
        pedal(1, 480, false),
        pedal(1, 480, true),
      ]),
    ).toEqual([{ atMs: 0, down: true }]);
  });
});

describe('midiToTake: tempo', () => {
  it('starts at 120 when the file names no tempo', () => {
    const take = midiToTake(smf(0, 480, [played(0, 60, 0, 480)]), 'x.mid');
    expect(take.tempo.bpm).toBe(120);
    expect(take.notes[0]!.durationMs).toBe(500);
  });

  it('folds a very slow tempo up by octaves, keeping the bar where it was', () => {
    const take = midiToTake(
      smf(0, 480, [
        [tempo(0, 10), meter(0, 4, 4), ...played(0, 60, 0, 480), ...played(0, 62, 480, 960)],
      ]),
      'x.mid',
    );
    // The milliseconds are the file's own: a quarter at ♩=10 lasts 6 s.
    expect(take.notes.map((n) => n.startMs)).toEqual([0, 6000]);
    expect(take.tempo.bpm).toBe(20);
    // A file quarter is now a half note, so a bar of four of them is 4/2.
    expect(take.tempo.timeSignature).toEqual({ numerator: 4, denominator: 2 });
  });

  it('folds a very fast tempo down, a grid finer', () => {
    const sixteenths: Ev[] = [];
    for (let i = 0; i < 16; i += 1) sixteenths.push(...played(0, 60 + i, i * 120, i * 120 + 120));
    const take = midiToTake(smf(0, 480, [[tempo(0, 400), meter(0, 3, 4), ...sixteenths]]), 'x.mid');
    expect(take.notes[1]!.startMs).toBe(38); // 37.5 ms, the file's own
    expect(take.tempo.bpm).toBe(200);
    expect(take.tempo.timeSignature).toEqual({ numerator: 3, denominator: 8 });
    // Sixteenths of the file are 32nds of the take.
    expect(take.display.quantization).toBe('1/32');
  });

  it('folds every tempo by the same octaves while one factor fits them all', () => {
    const take = midiToTake(
      smf(0, 480, [[tempo(0, 300), tempo(1920, 150), ...played(0, 60, 0, 3840)]]),
      'x.mid',
    );
    expect(take.tempo.bpm).toBe(150);
    expect(take.tempo.changes!.map((c) => c.bpm)).toEqual([75]);
  });

  it('folds each tempo on its own when no one factor fits', () => {
    const take = midiToTake(
      smf(0, 480, [[tempo(0, 15), tempo(480, 400), ...played(0, 60, 0, 960)]]),
      'x.mid',
    );
    expect(take.tempo.bpm).toBe(30);
    expect(take.tempo.changes).toEqual([{ atMs: 4000, bpm: 200 }]);
    expect(take.notes[0]!.durationMs).toBe(4150);
  });

  it('takes a file of 200,000 tempo changes, keeping as many as a take holds', () => {
    // Far more values than a function call can take as arguments, so nothing
    // on the way may spread them into one (Math.min(...) threw a RangeError).
    const events: Ev[] = [];
    for (let i = 0; i < 200_000; i += 1) events.push(tempo(i * 10, i % 2 === 0 ? 100 : 120));
    const take = midiToTake(smf(0, 480, [[...events, ...played(0, 60, 0, 480)]]), 'x.mid');
    expect(take.notes).toHaveLength(1);
    expect(take.tempo.bpm).toBe(100);
    expect(take.tempo.changes).toHaveLength(MAX_TEMPO_CHANGES);
  });

  it('drops changes that land on one millisecond or repeat the tempo', () => {
    const take = midiToTake(
      smf(0, 9600, [
        [
          tempo(0, 120),
          tempo(9600, 100), // 500 ms
          tempo(9602, 90), // 500.1 ms: the same millisecond, and the later wins
          tempo(19200, 90), // no change
          tempo(28800, 90),
          ...played(0, 60, 0, 38400),
        ],
      ]),
      'x.mid',
    );
    expect(take.tempo.changes).toEqual([{ atMs: 500, bpm: 90 }]);
    expect(repairsOf(take)).toEqual([]);
  });

  it('reads a stored tempo as the one with the fewest decimals that rounds to it', () => {
    const tempoBytes = (us: number): Ev => [
      0,
      0xff,
      0x51,
      0x03,
      (us >> 16) & 0xff,
      (us >> 8) & 0xff,
      us & 0xff,
    ];
    // 476 128 µs a quarter is ♩=126.01653…; ♩=126.0165 is the first that rounds back.
    const take = midiToTake(
      smf(0, 480, [[tempoBytes(476_128), ...played(0, 60, 0, 480)]]),
      'x.mid',
    );
    expect(take.tempo.bpm).toBe(126.0165);
    // So slow that four decimals cannot say it: kept exactly, then folded up three octaves.
    const slow = midiToTake(
      smf(0, 480, [[tempoBytes(0xffffff), ...played(0, 60, 0, 480)]]),
      'x.mid',
    );
    expect(slow.tempo.bpm).toBeCloseTo((8 * 60_000_000) / 0xffffff, 9);
    expect(slow.notes[0]!.durationMs).toBe(Math.round(0xffffff / 1000));
  });
});

describe('midiToTake: the grid', () => {
  it('reads a jittered performance on the recording grid', () => {
    const random = seeded(7);
    const events: Ev[] = [];
    for (let i = 0; i < 200; i += 1) {
      const start = i * 240 + Math.round((random() - 0.5) * 60);
      events.push(
        ...played(0, 60 + (i % 24), Math.max(0, start), start + 100 + Math.round(random() * 200)),
      );
    }
    expect(midiToTake(smf(0, 960, [events]), 'p.mid').display.quantization).toBe('1/16');
  });

  it('reads a written run of 32nds on a 1/32 grid', () => {
    const events: Ev[] = [];
    for (let i = 0; i < 32; i += 1) events.push(...played(0, 60 + (i % 12), i * 60, i * 60 + 30));
    expect(midiToTake(smf(0, 480, [events]), 'r.mid').display.quantization).toBe('1/32');
  });

  it('puts a few 64ths among irregular tuplets down to chance', () => {
    // A long score in 16ths with a run of 32nds, as many a piano piece is; and
    // 40 onsets of irregular tuplets (on no written position), two of which
    // happen to land a tick from a 64th — as a run of 39 in the time of 32
    // will, now and then.
    const quarter = 960;
    const onsets: number[] = [];
    for (let k = 0; k < 400; k += 1) onsets.push(k * (quarter / 4));
    for (let k = 0; k < 20; k += 1) onsets.push(quarter / 8 + k * (quarter / 4));
    const irregular = Array.from({ length: 40 }, (_, k) => 50 + (100 + k) * (quarter / 4));
    const chance = [200, 201].map((k) => quarter / 16 + k * (quarter / 4) + 1);
    const file = (ticks: readonly number[]) =>
      smf(0, quarter, [ticks.flatMap((tick, i) => played(0, 60 + (i % 12), tick, tick + 30))]);

    expect(
      midiToTake(file([...onsets, ...irregular, ...chance]), 'c.mid').display.quantization,
    ).toBe('1/32');
    // With nothing irregular to explain them, the same two 64ths are written ones.
    expect(midiToTake(file([...onsets, ...chance]), 'c.mid').display.quantization).toBe('1/64');
  });

  it('ignores how long the notes are held', () => {
    // Staccato 64ths on 16th onsets: only where notes start says what grid
    // the music is written on.
    const events: Ev[] = [];
    for (let i = 0; i < 16; i += 1) events.push(...played(0, 60, i * 120, i * 120 + 30));
    expect(midiToTake(smf(0, 480, [events]), 's.mid').display.quantization).toBe('1/16');
  });
});

describe('midiToTake: what the file says about itself', () => {
  it('takes its title from the first track’s name, in UTF-8', () => {
    const utf8 = [...new TextEncoder().encode('Gymnopédie No. 1')];
    const take = midiToTake(
      smf(1, 480, [[name(0, utf8)], [name(0, [0x50]), ...played(0, 60, 0, 480)]]),
      'x.mid',
    );
    expect(take.title).toBe('Gymnopédie No. 1');
  });

  it('falls back to Windows-1252 for a name that is not UTF-8', () => {
    const take = midiToTake(
      smf(0, 480, [
        [
          name(0, [0x47, 0x79, 0x6d, 0x6e, 0x6f, 0x70, 0xe9, 0x64, 0x69, 0x65]),
          ...played(0, 60, 0, 480),
        ],
      ]),
      'x.mid',
    );
    expect(take.title).toBe('Gymnopédie');
  });

  it('falls back to the file name', () => {
    expect(midiToTake(smf(0, 480, [played(0, 60, 0, 480)]), 'Prelude in C.mid').title).toBe(
      'Prelude in C',
    );
  });

  it('takes the first meter and the first key, but not a bare C major', () => {
    const take = midiToTake(
      smf(0, 480, [
        [meter(0, 6, 8), key(0, 0, false), meter(1920, 2, 4), ...played(0, 60, 0, 480)],
      ]),
      'x.mid',
    );
    expect(take.tempo.timeSignature).toEqual({ numerator: 6, denominator: 8 });
    expect('keySignature' in take.tempo).toBe(false);
    expect('keyMode' in take.tempo).toBe(false);

    const aMinor = midiToTake(smf(0, 480, [[key(0, 0, true), ...played(0, 60, 0, 480)]]), 'x.mid');
    expect(aMinor.tempo).toMatchObject({ keySignature: 0, keyMode: 'minor' });
    const eFlat = midiToTake(smf(0, 480, [[key(0, -3, false), ...played(0, 60, 0, 480)]]), 'x.mid');
    expect(eFlat.tempo).toMatchObject({ keySignature: -3, keyMode: 'major' });
  });

  it('leaves spelling, voices and tuplets to the notation', () => {
    const take = midiToTake(smf(0, 480, [played(0, 61, 0, 480)]), 'x.mid');
    expect(Object.keys(take.notes[0]!).sort()).toEqual([
      'durationMs',
      'id',
      'midi',
      'startMs',
      'velocity',
    ]);
  });
});
