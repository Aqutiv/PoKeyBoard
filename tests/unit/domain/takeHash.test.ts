import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { computeExportHash, sha256Hex, stableStringify } from '@/domain/takeHash';
import type { Take } from '@/domain/takeTypes';

function takeWithNotes(): Take {
  return createEmptyTake({
    notes: [
      { id: 'n1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
      { id: 'n2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.6 },
    ],
  });
}

const baseInput = { exporterVersion: 1, bitrateKbps: 128, includeMetronome: false };

describe('stableStringify', () => {
  it('is independent of key insertion order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('preserves array order', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe('sha256Hex', () => {
  it('produces the known digest for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('computeExportHash', () => {
  it('is stable for identical audible content', async () => {
    const a = await computeExportHash({ ...baseInput, take: takeWithNotes() });
    const b = await computeExportHash({ ...baseInput, take: takeWithNotes() });
    expect(a).toBe(b);
  });

  it('ignores title, timestamps, display state, and note ids', async () => {
    const base = takeWithNotes();
    const renamed: Take = {
      ...base,
      title: 'Different name',
      updatedAt: '2030-01-01T00:00:00.000Z',
      display: { quantization: 'off', zoom: 2, playheadMs: 123 },
      notes: base.notes.map((n, i) => ({ ...n, id: `other-${i}` })),
    };
    expect(await computeExportHash({ ...baseInput, take: renamed })).toBe(
      await computeExportHash({ ...baseInput, take: base }),
    );
  });

  it('changes when a note changes', async () => {
    const base = takeWithNotes();
    const edited: Take = {
      ...base,
      notes: base.notes.map((n, i) => (i === 0 ? { ...n, midi: 61 } : n)),
    };
    expect(await computeExportHash({ ...baseInput, take: edited })).not.toBe(
      await computeExportHash({ ...baseInput, take: base }),
    );
  });

  it('changes with bitrate, metronome inclusion, reverb, and exporter version', async () => {
    const take = takeWithNotes();
    const base = await computeExportHash({ ...baseInput, take });
    expect(await computeExportHash({ ...baseInput, take, bitrateKbps: 192 })).not.toBe(base);
    expect(await computeExportHash({ ...baseInput, take, includeMetronome: true })).not.toBe(base);
    expect(await computeExportHash({ ...baseInput, take, exporterVersion: 2 })).not.toBe(base);
    const wetter: Take = { ...take, instrument: { ...take.instrument, reverbMix: 0.5 } };
    expect(await computeExportHash({ ...baseInput, take: wetter })).not.toBe(base);
  });

  it('is independent of note array order', async () => {
    const take = takeWithNotes();
    const reversed: Take = { ...take, notes: [...take.notes].reverse() };
    expect(await computeExportHash({ ...baseInput, take: reversed })).toBe(
      await computeExportHash({ ...baseInput, take }),
    );
  });
});
