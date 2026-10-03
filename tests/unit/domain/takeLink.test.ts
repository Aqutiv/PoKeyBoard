import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { deflateSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeTakeDurationMs, createEmptyTake } from '@/domain/noteEvents';
import { decodeTakeLink, encodeTakeLink } from '@/domain/takeLink';
import { normalizeTake, type ParsedTake } from '@/domain/takeSchema';
import { MAX_NOTE_COUNT, type NoteEvent, type Take } from '@/domain/takeTypes';
import { libraryTakeId } from '@/domain/libraryTakes';
import { resolveLibraryTake } from '@/features/library/catalog';
import { SCORE_PACK_PATH } from '@/features/library/scoreLoader';
import { ShareLinkError } from '@/utils/errors';
import { newId } from '@/utils/ids';
import { xorshift32 } from '@/utils/random';

// ------------------------------------------------------------- helpers --

/** Split a payload as the address bar would carry it, and decode it. */
function roundTrip(take: Take): ParsedTake {
  const payload = encodeTakeLink(take);
  const dot = payload.indexOf('.');
  expect(payload.slice(0, dot)).toBe('1');
  return decodeTakeLink(1, payload.slice(dot + 1));
}

function withoutIds(notes: readonly NoteEvent[]): Partial<NoteEvent>[] {
  return notes.map((note) => {
    const rest: Partial<NoteEvent> = { ...note };
    delete rest.id;
    return rest;
  });
}

function expectLinkError(decode: () => unknown, kind: 'invalid' | 'newer'): ShareLinkError {
  let caught: unknown;
  try {
    decode();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ShareLinkError);
  expect((caught as ShareLinkError).kind).toBe(kind);
  expect((caught as ShareLinkError).messageKey).toBe(
    kind === 'newer' ? 'shareLinkNewer' : 'shareLinkInvalid',
  );
  return caught as ShareLinkError;
}

/** A performance as a player would leave one: chords, runs, held notes, pedalling. */
function recordedTake(noteCount: number, seed = 20261003): Take {
  const random = xorshift32(seed);
  const notes: NoteEvent[] = [];
  let at = 0;
  let pitch = 60;
  for (let index = 0; index < noteCount; index += 1) {
    // A third of the notes land with the one before, as a chord does.
    at += random() < 0.3 ? Math.floor(random() * 25) : 60 + Math.floor(random() * 400);
    pitch = Math.min(96, Math.max(36, pitch + Math.floor(random() * 9) - 4));
    notes.push({
      id: newId(),
      midi: pitch,
      startMs: at,
      durationMs: 60 + Math.floor(random() * 1100),
      velocity: 0.25 + random() * 0.7,
    });
  }
  const pedalEvents = [];
  for (let down = 500; down < at; down += 1500 + Math.floor(random() * 1500)) {
    pedalEvents.push({ atMs: down, down: true });
    pedalEvents.push({ atMs: down + 1200 + Math.floor(random() * 200), down: false });
  }
  return normalizeTake(createEmptyTake({ title: 'Long evening', notes, pedalEvents }));
}

/** A score take carrying every hint a note can, and every header field. */
function scoreTake(): Take {
  const v = (step: number) => step / 255; // velocities a link carries exactly
  const notes: NoteEvent[] = [
    { id: 'n01', midi: 67, startMs: 0, durationMs: 500, velocity: v(170), staff: 'treble' },
    {
      id: 'n02',
      midi: 43,
      startMs: 0,
      durationMs: 1000,
      velocity: v(140),
      staff: 'bass',
      voice: 1,
      finger: 5,
    },
    {
      id: 'n03',
      midi: 70,
      startMs: 500,
      durationMs: 167,
      velocity: v(150),
      staff: 'treble',
      voice: 0,
      tuplet: { actual: 3, normal: 2, unit: 8, group: 0 },
      spelling: { step: 'B', alter: -1 },
      finger: 3,
    },
    {
      id: 'n04',
      midi: 69,
      startMs: 667,
      durationMs: 167,
      velocity: v(1),
      staff: 'treble',
      voice: 0,
      tuplet: { actual: 3, normal: 2, unit: 8, group: 0 },
    },
    {
      id: 'n05',
      midi: 67,
      startMs: 833,
      durationMs: 167,
      velocity: v(255),
      staff: 'treble',
      voice: 15,
      tuplet: { actual: 5, normal: 4, unit: 128 },
      spelling: { step: 'F', alter: 2 },
      finger: 1,
    },
    {
      id: 'n06',
      midi: 76,
      startMs: 1000,
      durationMs: 250,
      velocity: 0,
      staff: 'bass',
      clef: 'treble',
      spelling: { step: 'E', alter: 0 },
    },
    {
      id: 'n07',
      midi: 38,
      startMs: 1000,
      durationMs: 250,
      velocity: v(90),
      staff: 'treble',
      clef: 'bass',
      tuplet: { actual: 6, normal: 4, unit: 16, group: 1234 },
      spelling: { step: 'E', alter: -2 },
    },
    { id: 'n08', midi: 77, startMs: 1100, durationMs: 50, velocity: v(100), hidden: true },
    {
      id: 'n09',
      midi: 79,
      startMs: 1150,
      durationMs: 50,
      velocity: v(100),
      hidden: true,
      finger: 4,
    },
    { id: 'n10', midi: 108, startMs: 2_000_000, durationMs: 120_000, velocity: v(64), voice: 2 },
    { id: 'n11', midi: 21, startMs: 2_000_000, durationMs: 1, velocity: v(2), finger: 2 },
  ];
  const take = createEmptyTake({
    id: 'sender-take-0001',
    title: 'Nocturne — “for Léa” 🎹',
    samplePackVersion: 'headroom-grand-v2',
    tempo: {
      bpm: 72.5,
      timeSignature: { numerator: 6, denominator: 8 },
      countInBars: 2,
      changes: [
        { atMs: 1000, bpm: 60 },
        { atMs: 1_500_000, bpm: 133.33333333333334 },
      ],
      keySignature: -3,
      keyMode: 'minor',
    },
    instrument: { id: 'grand-piano', masterVolume: 0.5, reverbMix: 0.42, reverbRoom: 'cathedral' },
    notes,
    pedalEvents: [
      { atMs: 0, down: true },
      { atMs: 990, down: false },
      { atMs: 1000, down: true },
      { atMs: 1000, down: false },
      { atMs: 2_100_000, down: true },
    ],
    display: { quantization: '1/32', zoom: 1.75, playheadMs: 900 },
  });
  return normalizeTake({
    ...take,
    futureSetting: { nested: [1, 'two', { three: true }] },
    anotherKey: 'kept',
  } as Take);
}

// Hand-made link bodies, for the ways a link can be damaged. ---------------

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  do {
    let byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest > 0) byte |= 0x80;
    out.push(byte);
  } while (rest > 0);
  return out;
}

function headerBytes(fields: Record<string, unknown> = {}): number[] {
  const json = strToU8(
    JSON.stringify({
      schemaVersion: 1,
      id: 'hand-made',
      title: 'Hand made',
      samplePackVersion: 'salamander-grand-v4',
      tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1 },
      instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
      display: { quantization: '1/16' },
      ...fields,
    }),
  );
  return [...varint(json.length), ...json];
}

/** One middle C, 400 ms, then no pedal: the smallest link that opens. */
const ONE_NOTE = [...varint(1), ...varint(0), ...varint(400), 60, 178, ...varint(0)];
const NO_PEDALS = varint(0);

function dataOf(body: readonly number[] | Uint8Array): string {
  return Buffer.from(deflateSync(Uint8Array.from(body), { level: 9 })).toString('base64url');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------- tests --

describe('a take link', () => {
  it('carries a recording: exact milliseconds, velocities to 1/510, pedals', () => {
    const take = recordedTake(400);
    const { take: back, repairs } = roundTrip(take);

    expect(repairs).toEqual([]);
    expect(back.notes).toHaveLength(take.notes.length);
    back.notes.forEach((note, index) => {
      const sent = take.notes[index] as NoteEvent;
      expect([note.midi, note.startMs, note.durationMs]).toEqual([
        sent.midi,
        sent.startMs,
        sent.durationMs,
      ]);
      expect(Math.abs(note.velocity - sent.velocity)).toBeLessThanOrEqual(1 / 510 + 1e-12);
    });
    expect(back.pedalEvents).toEqual(take.pedalEvents);
    expect(back.durationMs).toBe(take.durationMs);
  });

  it('keeps a whisper audible and a silent note silent', () => {
    const take = createEmptyTake({
      notes: [
        { id: 'a', midi: 60, startMs: 0, durationMs: 100, velocity: 0.0004 },
        { id: 'b', midi: 62, startMs: 100, durationMs: 100, velocity: 0 },
        { id: 'c', midi: 64, startMs: 200, durationMs: 100, velocity: 1 },
      ],
    });
    const velocities = roundTrip(take).take.notes.map((note) => note.velocity);
    expect(velocities).toEqual([1 / 255, 0, 1]);
  });

  it('carries a score: every hint, the tempo map, the key, the room, unknown keys', () => {
    const take = scoreTake();
    const { take: back, repairs } = roundTrip(take);

    expect(repairs).toEqual([]);
    expect(withoutIds(back.notes)).toEqual(withoutIds(take.notes));
    expect(back.pedalEvents).toEqual(take.pedalEvents);
    expect(back.tempo).toEqual(take.tempo);
    expect(back.instrument).toEqual(take.instrument);
    expect(back.title).toBe(take.title);
    expect(back.samplePackVersion).toBe(take.samplePackVersion);
    expect(back.display.quantization).toBe('1/32');
    const loose = back as Take & { futureSetting?: unknown; anotherKey?: unknown };
    expect(loose.futureSetting).toEqual({ nested: [1, 'two', { three: true }] });
    expect(loose.anotherKey).toBe('kept');
  });

  it('keeps the sender’s take id, so a link opened twice can replace its copy', () => {
    expect(roundTrip(scoreTake()).take.id).toBe('sender-take-0001');
  });

  it('starts the timestamps, the view and the practice state afresh', () => {
    const take = {
      ...scoreTake(),
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-02-01T00:00:00.000Z',
      durationMs: 5,
      display: {
        quantization: '1/8' as const,
        zoom: 2.5,
        playheadMs: 1500,
        speed: 0.5,
        loop: { startMs: 100, endMs: 900 },
      },
    };
    const before = Date.now();
    const { take: back } = roundTrip(take);
    const after = Date.now();

    for (const stamp of [back.createdAt, back.updatedAt]) {
      expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(stamp)).toBeLessThanOrEqual(after);
    }
    expect(back.durationMs).toBe(computeTakeDurationMs(take.notes));
    expect(back.display).toEqual({ quantization: '1/8', zoom: 1, playheadMs: 0 });
  });

  it('gives fresh note ids that keep the order of notes struck together', () => {
    // Two copies of one key at one moment: the score's order is the order its
    // voices are drawn and struck in, and a link must not shuffle it.
    const take = normalizeTake(
      createEmptyTake({
        notes: [
          { id: 'b-second', midi: 60, startMs: 0, durationMs: 400, velocity: 0.9, voice: 0 },
          { id: 'a-first', midi: 60, startMs: 0, durationMs: 800, velocity: 0.2, voice: 1 },
          { id: 'c-third', midi: 60, startMs: 0, durationMs: 200, velocity: 0.5, voice: 2 },
        ],
      }),
    );
    const { take: back, repairs } = roundTrip(take);

    expect(repairs).toEqual([]);
    expect(back.notes.map((note) => note.voice)).toEqual([1, 0, 2]);
    expect(back.notes.map((note) => note.durationMs)).toEqual([800, 400, 200]);
    const ids = back.notes.map((note) => note.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}-\d{5}$/);
    expect(ids.map((id) => id.slice(-5))).toEqual(['00000', '00001', '00002']);
  });

  it('is the same link for the same take, whatever order its keys were set in', () => {
    const take = scoreTake();
    const reordered = Object.fromEntries(Object.entries(take).reverse()) as unknown as Take;
    reordered.tempo = Object.fromEntries(
      Object.entries(take.tempo).reverse(),
    ) as unknown as Take['tempo'];

    const link = encodeTakeLink(take);
    expect(encodeTakeLink(structuredClone(take))).toBe(link);
    expect(encodeTakeLink(reordered)).toBe(link);
    expect(encodeTakeLink(JSON.parse(JSON.stringify(take)) as Take)).toBe(link);
  });

  it('rounds a stray fractional millisecond rather than garbling the stream', () => {
    const take = createEmptyTake({
      notes: [{ id: 'a', midi: 60, startMs: 10.4, durationMs: 99.6, velocity: 0.5 }],
      pedalEvents: [{ atMs: 5.5, down: true }],
    });
    const { take: back } = roundTrip(take);
    expect(back.notes[0]).toMatchObject({ startMs: 10, durationMs: 100 });
    expect(back.pedalEvents).toEqual([{ atMs: 6, down: true }]);
  });

  it('uses only the characters a URL carries untouched', () => {
    expect(encodeTakeLink(scoreTake())).toMatch(/^1\.[A-Za-z0-9_-]+$/);
  });
});

// Budgets, a little over what each link measures today (2026-10: 34,657 and
// 16,977 characters), so a change to the format that costs length shows here.
describe('link size', () => {
  // Every gap, length and velocity a fresh random draw: the worst a recording
  // can be for deflate. A real one repeats itself more and comes out shorter;
  // either way a long one passes the dialog's soft 32,000-character warning.
  it('fits a 5,000-note recording in under 36,000 characters', () => {
    expect(encodeTakeLink(recordedTake(5_000)).length).toBeLessThan(36_000);
  });

  it('fits the vendored Chopin Ballade No. 1 in under 18,500 characters', async () => {
    const packDir = path.resolve(process.cwd(), 'public', SCORE_PACK_PATH);
    vi.stubGlobal('fetch', async (input: string) => {
      const file = decodeURIComponent(path.basename(new URL(input, 'http://localhost/').pathname));
      return new Response(new Uint8Array(await readFile(path.join(packDir, file))));
    });
    const ballade = await resolveLibraryTake(
      libraryTakeId('score-chopin-ballade-no-1-in-g-minor-op-23'),
    );
    expect(ballade?.notes.length).toBe(5162);

    const payload = encodeTakeLink(ballade as Take);
    expect(payload.length).toBeLessThan(18_500);
    const { take: back, repairs } = decodeTakeLink(1, payload.slice(2));
    expect(repairs).toEqual([]);
    expect(back.notes).toHaveLength(5162);
    // Parsing an eleven-minute score is most of this; a busy machine needs longer.
  }, 30_000);
});

describe('a damaged link', () => {
  it('opens when made by hand as the format says', () => {
    const { take } = decodeTakeLink(1, dataOf([...headerBytes(), ...ONE_NOTE, ...NO_PEDALS]));
    expect(take.title).toBe('Hand made');
    expect(withoutIds(take.notes)).toEqual([
      { midi: 60, startMs: 0, durationMs: 400, velocity: 178 / 255 },
    ]);
  });

  it('is refused when its characters are not base64url', () => {
    const good = dataOf([...headerBytes(), ...ONE_NOTE, ...NO_PEDALS]);
    for (const data of [
      '',
      'A',
      `${good}=`,
      `${good.slice(0, 8)}*${good.slice(9)}`,
      // Standard base64's two characters, which a URL would have to escape.
      `${good.slice(0, 8)}+${good.slice(9)}`,
      `${good.slice(0, 8)}/${good.slice(9)}`,
    ]) {
      expectLinkError(() => decodeTakeLink(1, data), 'invalid');
    }
  });

  it('is refused when cut short, in the stream or in what it holds', () => {
    const body = [...headerBytes(), ...ONE_NOTE, ...NO_PEDALS];
    const data = dataOf(body);
    expectLinkError(() => decodeTakeLink(1, data.slice(0, -3)), 'invalid');
    expectLinkError(() => decodeTakeLink(1, data.slice(0, data.length >> 1)), 'invalid');
    expectLinkError(() => decodeTakeLink(1, dataOf(body.slice(0, -1))), 'invalid');
    expectLinkError(() => decodeTakeLink(1, dataOf(body.slice(0, -4))), 'invalid');
  });

  it('is refused with bytes left over after the pedals', () => {
    expectLinkError(
      () => decodeTakeLink(1, dataOf([...headerBytes(), ...ONE_NOTE, ...NO_PEDALS, 0])),
      'invalid',
    );
  });

  it('is refused when a number runs past five bytes or 2^31', () => {
    const header = headerBytes();
    // Six bytes for one number.
    expectLinkError(
      () => decodeTakeLink(1, dataOf([...header, 0x81, 0x80, 0x80, 0x80, 0x80, 0x00])),
      'invalid',
    );
    // Five bytes, but 2^35 − 1.
    expectLinkError(
      () => decodeTakeLink(1, dataOf([...header, 0xff, 0xff, 0xff, 0xff, 0x7f])),
      'invalid',
    );
    // A duration of exactly 2^31.
    expectLinkError(
      () =>
        decodeTakeLink(
          1,
          dataOf([...header, ...varint(1), 0, ...varint(2 ** 31), 60, 178, 0, ...NO_PEDALS]),
        ),
      'invalid',
    );
  });

  it('is refused when it counts more notes or pedals than a take may hold', () => {
    const header = headerBytes();
    expectLinkError(
      () => decodeTakeLink(1, dataOf([...header, ...varint(MAX_NOTE_COUNT + 1)])),
      'invalid',
    );
    expectLinkError(
      () => decodeTakeLink(1, dataOf([...header, ...ONE_NOTE, ...varint(MAX_NOTE_COUNT + 1)])),
      'invalid',
    );
  });

  it('is refused when its header claims more than 64 KB', () => {
    expectLinkError(() => decodeTakeLink(1, dataOf(varint(65_537))), 'invalid');
  });

  it('is refused when its header is not a JSON object', () => {
    for (const text of ['{not json', '[1,2]', 'null', '"title"']) {
      const json = strToU8(text);
      expectLinkError(
        () =>
          decodeTakeLink(1, dataOf([...varint(json.length), ...json, ...ONE_NOTE, ...NO_PEDALS])),
        'invalid',
      );
    }
  });

  it('is refused when a note sets a flag no hint uses, or a spelling no letter has', () => {
    const header = headerBytes();
    expectLinkError(
      () =>
        decodeTakeLink(
          1,
          dataOf([...header, ...varint(1), 0, ...varint(400), 60, 178, ...varint(512), 0]),
        ),
      'invalid',
    );
    // hasSpelling (64), then the code past B double sharp.
    expectLinkError(
      () =>
        decodeTakeLink(1, dataOf([...header, ...varint(1), 0, ...varint(400), 60, 178, 64, 35, 0])),
      'invalid',
    );
  });

  it('is refused when what it holds is not a valid take', () => {
    expectLinkError(
      () =>
        decodeTakeLink(
          1,
          dataOf([...headerBytes(), ...varint(1), 0, ...varint(400), 200, 178, 0, ...NO_PEDALS]),
        ),
      'invalid',
    );
  });

  it('is refused unread past 4,000,000 characters', () => {
    expectLinkError(() => decodeTakeLink(1, 'A'.repeat(4_000_004)), 'invalid');
  });

  it('refuses a deflate bomb before it fills memory', () => {
    // 20 MB of zeros squeezes into a link of about 27,000 characters.
    const bomb = Buffer.from(deflateSync(new Uint8Array(20 * 1024 * 1024), { level: 9 })).toString(
      'base64url',
    );
    expect(bomb.length).toBeLessThan(40_000);
    // Stopped by the 8 MB cap, not by whatever reading the zeros would find.
    expect(expectLinkError(() => decodeTakeLink(1, bomb), 'invalid').issues).toEqual([
      'The link unpacks to more than 8 MB.',
    ]);
  });
});

describe('a link from a newer PoKeyBoard', () => {
  it('says so for a newer link format, whatever its data', () => {
    expectLinkError(() => decodeTakeLink(2, 'anything'), 'newer');
    expectLinkError(() => decodeTakeLink(2, ''), 'newer');
  });

  it('says so for a take of a newer schema in a link this version reads', () => {
    expectLinkError(
      () =>
        decodeTakeLink(
          1,
          dataOf([...headerBytes({ schemaVersion: 2 }), ...ONE_NOTE, ...NO_PEDALS]),
        ),
      'newer',
    );
  });

  it('calls a link with no version damaged, not newer', () => {
    expectLinkError(
      () => decodeTakeLink(0, dataOf([...headerBytes(), ...ONE_NOTE, ...NO_PEDALS])),
      'invalid',
    );
  });
});
