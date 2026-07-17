import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import {
  normalizeTake,
  parseTakeJson,
  parseTakeJsonString,
  repairRawTake,
} from '@/domain/takeSchema';
import { ImportValidationError } from '@/utils/errors';

function specExampleTake(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'b2ce1f0e-45c1-4b3a-8a4e-3b1936b25c01',
    title: 'My Take',
    createdAt: '2026-07-17T10:00:00.000Z',
    updatedAt: '2026-07-17T10:05:00.000Z',
    durationMs: 12345,
    samplePackVersion: 'grand-piano-v1',
    tempo: {
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      countInBars: 1,
    },
    instrument: { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 },
    notes: [
      { id: 'n-1', midi: 60, startMs: 0, durationMs: 420, velocity: 0.78 },
      { id: 'n-2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.6 },
    ],
    pedalEvents: [
      { atMs: 1000, down: true },
      { atMs: 1800, down: false },
    ],
    display: { quantization: '1/16', zoom: 1, playheadMs: 0 },
  };
}

describe('parseTakeJson', () => {
  it('accepts the spec example take', () => {
    const { take, repairs } = parseTakeJson(specExampleTake());
    expect(repairs).toEqual([]);
    expect(take.title).toBe('My Take');
    expect(take.notes).toHaveLength(2);
    expect(take.durationMs).toBe(900); // recomputed from notes, not trusted
  });

  it('rejects invalid MIDI values', () => {
    const raw = specExampleTake();
    (raw.notes as Record<string, unknown>[])[0]!.midi = 128;
    expect(() => parseTakeJson(raw)).toThrow(ImportValidationError);
  });

  it('rejects NaN and infinite numbers', () => {
    const raw = specExampleTake();
    (raw.notes as Record<string, unknown>[])[0]!.velocity = Number.NaN;
    expect(() => parseTakeJson(raw)).toThrow(ImportValidationError);

    const raw2 = specExampleTake();
    (raw2.notes as Record<string, unknown>[])[0]!.startMs = Number.POSITIVE_INFINITY;
    expect(() => parseTakeJson(raw2)).toThrow(ImportValidationError);
  });

  it('rejects negative times and out-of-range velocities', () => {
    const raw = specExampleTake();
    (raw.notes as Record<string, unknown>[])[0]!.startMs = -10;
    expect(() => parseTakeJson(raw)).toThrow(ImportValidationError);

    const raw2 = specExampleTake();
    (raw2.notes as Record<string, unknown>[])[0]!.velocity = 1.5;
    expect(() => parseTakeJson(raw2)).toThrow(ImportValidationError);
  });

  it('reports useful issue paths', () => {
    const raw = specExampleTake();
    (raw.notes as Record<string, unknown>[])[1]!.midi = 'sixty';
    try {
      parseTakeJson(raw);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportValidationError);
      const issues = (error as ImportValidationError).issues;
      expect(issues.some((issue) => issue.includes('notes.1.midi'))).toBe(true);
    }
  });

  it('repairs fractional milliseconds by rounding', () => {
    const raw = specExampleTake();
    (raw.notes as Record<string, unknown>[])[0]!.startMs = 10.4;
    const { take, repairs } = parseTakeJson(raw);
    expect(take.notes[0]!.startMs).toBe(10);
    expect(repairs.length).toBeGreaterThan(0);
  });

  it('repairs missing pedalEvents, display, and title', () => {
    const raw = specExampleTake();
    delete raw.pedalEvents;
    delete raw.display;
    raw.title = '';
    const { take } = parseTakeJson(raw);
    expect(take.pedalEvents).toEqual([]);
    expect(take.display.quantization).toBe('1/16');
    expect(take.title).toBe('Untitled take');
  });

  it('clamps velocity float drift but rejects real violations', () => {
    const raw = specExampleTake();
    (raw.notes as Record<string, unknown>[])[0]!.velocity = 1.0000000001;
    const { take } = parseTakeJson(raw);
    expect(take.notes[0]!.velocity).toBe(1);
  });

  it('preserves unknown forward-compatible top-level keys', () => {
    const raw = specExampleTake();
    raw.futureFeature = { setting: 42 };
    const { take } = parseTakeJson(raw);
    expect((take as unknown as Record<string, unknown>).futureFeature).toEqual({ setting: 42 });
  });

  it('sorts notes deterministically', () => {
    const raw = specExampleTake();
    raw.notes = [
      { id: 'z', midi: 64, startMs: 500, durationMs: 100, velocity: 0.5 },
      { id: 'a', midi: 60, startMs: 500, durationMs: 100, velocity: 0.5 },
      { id: 'm', midi: 72, startMs: 0, durationMs: 100, velocity: 0.5 },
    ];
    const { take } = parseTakeJson(raw);
    expect(take.notes.map((n) => n.id)).toEqual(['m', 'a', 'z']);
  });

  it('rejects non-object roots', () => {
    expect(() => parseTakeJson(null)).toThrow(ImportValidationError);
    expect(() => parseTakeJson([1, 2])).toThrow(ImportValidationError);
    expect(() => parseTakeJson('take')).toThrow(ImportValidationError);
  });
});

describe('parseTakeJsonString', () => {
  it('rejects malformed JSON with a friendly issue', () => {
    expect(() => parseTakeJsonString('{not json')).toThrow(ImportValidationError);
  });

  it('parses a stringified valid take', () => {
    const { take } = parseTakeJsonString(JSON.stringify(specExampleTake()));
    expect(take.notes).toHaveLength(2);
  });
});

describe('repairRawTake', () => {
  it('leaves genuinely invalid values for the schema to reject', () => {
    const { data } = repairRawTake({
      notes: [{ midi: 200, startMs: 5, durationMs: 5, velocity: 2 }],
    });
    const note = (data.notes as Record<string, unknown>[])[0]!;
    expect(note.midi).toBe(200);
    expect(note.velocity).toBe(2);
  });

  it('bumps zero durations to one millisecond', () => {
    const { data } = repairRawTake({
      notes: [{ id: 'n', midi: 60, startMs: 0, durationMs: 0, velocity: 0.5 }],
    });
    expect((data.notes as Record<string, unknown>[])[0]!.durationMs).toBe(1);
  });
});

describe('normalizeTake', () => {
  it('recomputes duration and clamps the playhead', () => {
    const take = createEmptyTake({
      notes: [{ id: 'n', midi: 60, startMs: 100, durationMs: 400, velocity: 0.5 }],
      display: { quantization: 'off', zoom: 1, playheadMs: 99_999 },
    });
    const normalized = normalizeTake(take);
    expect(normalized.durationMs).toBe(500);
    expect(normalized.display.playheadMs).toBe(500);
  });
});
