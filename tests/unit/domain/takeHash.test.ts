import { describe, expect, it } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import {
  canonicalAudioContent,
  computeExportHash,
  sha256Hex,
  stableStringify,
} from '@/domain/takeHash';
import type { Take } from '@/domain/takeTypes';

function takeWithNotes(): Take {
  return createEmptyTake({
    notes: [
      { id: 'n1', midi: 60, startMs: 0, durationMs: 400, velocity: 0.7 },
      { id: 'n2', midi: 64, startMs: 500, durationMs: 400, velocity: 0.6 },
    ],
  });
}

const baseInput = {
  exporterVersion: 1,
  bitrateKbps: 128,
  includeMetronome: false,
  metronomeVolume: 0.6,
  loudness: 'normalized',
};

describe('stableStringify', () => {
  it('is independent of key insertion order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
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
  it('changes when the piano does, so a switch cannot serve a stale export', async () => {
    const salamander = await computeExportHash({ ...baseInput, take: takeWithNotes() });
    const headroom = await computeExportHash({
      ...baseInput,
      take: { ...takeWithNotes(), samplePackVersion: 'headroom-grand-v1' },
    });
    expect(headroom).not.toBe(salamander);
  });

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

  it('ignores a declared tuplet, which is engraving and not sound', async () => {
    // A cached MP3 must survive the notation learning something new about how a
    // note was written. The tuplet says how the beat divides, not what is heard.
    const base = takeWithNotes();
    const engraved: Take = {
      ...base,
      notes: base.notes.map((n) => ({ ...n, tuplet: { actual: 3, normal: 2, unit: 8, group: 1 } })),
    };
    expect(await computeExportHash({ ...baseInput, take: engraved })).toBe(
      await computeExportHash({ ...baseInput, take: base }),
    );
  });

  it('ignores whether a note is hidden, since it sounds the same either way', async () => {
    // A hidden note leaves the page, not the recording: a cached MP3 of a score
    // imported before hidden notes were read is still the same sound.
    const base = takeWithNotes();
    const hidden: Take = { ...base, notes: base.notes.map((n) => ({ ...n, hidden: true })) };
    expect(await computeExportHash({ ...baseInput, take: hidden })).toBe(
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

  it('changes with bitrate, metronome inclusion, reverb, loudness, and exporter version', async () => {
    const take = takeWithNotes();
    const base = await computeExportHash({ ...baseInput, take });
    expect(await computeExportHash({ ...baseInput, take, bitrateKbps: 192 })).not.toBe(base);
    expect(await computeExportHash({ ...baseInput, take, loudness: 'asPlayed' })).not.toBe(base);
    expect(await computeExportHash({ ...baseInput, take, includeMetronome: true })).not.toBe(base);
    expect(await computeExportHash({ ...baseInput, take, exporterVersion: 2 })).not.toBe(base);
    const wetter: Take = { ...take, instrument: { ...take.instrument, reverbMix: 0.5 } };
    expect(await computeExportHash({ ...baseInput, take: wetter })).not.toBe(base);
  });

  it('hears the room, and a take without one as Room', async () => {
    const take = takeWithNotes();
    const beforeRooms = { id: 'grand-piano', masterVolume: 0.85, reverbMix: 0.18 };
    const older: Take = { ...take, instrument: beforeRooms };
    const inRoom: Take = { ...take, instrument: { ...beforeRooms, reverbRoom: 'room' } };
    const inHall: Take = { ...take, instrument: { ...beforeRooms, reverbRoom: 'hall' } };

    expect(canonicalAudioContent(older).instrument).toEqual({
      id: 'grand-piano',
      reverbMix: 0.18,
      reverbRoom: 'room',
    });
    expect(canonicalAudioContent(inHall).instrument).toEqual({
      id: 'grand-piano',
      reverbMix: 0.18,
      reverbRoom: 'hall',
    });
    // Naming the room a take already played in changes nothing it renders…
    expect(await computeExportHash({ ...baseInput, take: older })).toBe(
      await computeExportHash({ ...baseInput, take: inRoom }),
    );
    // …and another room is another export.
    expect(await computeExportHash({ ...baseInput, take: inHall })).not.toBe(
      await computeExportHash({ ...baseInput, take: older }),
    );
  });

  it('ignores the volume slider, which the export renders without', async () => {
    const take = takeWithNotes();
    const quieter: Take = { ...take, instrument: { ...take.instrument, masterVolume: 0.3 } };
    expect(await computeExportHash({ ...baseInput, take: quieter })).toBe(
      await computeExportHash({ ...baseInput, take }),
    );
  });

  it('changes with click volume only when the metronome is included', async () => {
    const take = takeWithNotes();
    const withoutClicks = await computeExportHash({ ...baseInput, take });
    expect(await computeExportHash({ ...baseInput, take, metronomeVolume: 0.2 })).toBe(
      withoutClicks,
    );

    const withClicks = await computeExportHash({
      ...baseInput,
      take,
      includeMetronome: true,
    });
    expect(
      await computeExportHash({
        ...baseInput,
        take,
        includeMetronome: true,
        metronomeVolume: 0.2,
      }),
    ).not.toBe(withClicks);
  });

  it('is independent of note array order', async () => {
    const take = takeWithNotes();
    const reversed: Take = { ...take, notes: [...take.notes].reverse() };
    expect(await computeExportHash({ ...baseInput, take: reversed })).toBe(
      await computeExportHash({ ...baseInput, take }),
    );
  });
});
