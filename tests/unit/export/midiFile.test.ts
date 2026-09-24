import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import type { Take } from '@/domain/takeTypes';

afterEach(() => {
  vi.doUnmock('@/features/takes/takesService');
  vi.resetModules();
});

async function midiFor(take: Take | null) {
  vi.resetModules();
  vi.doMock('@/features/takes/takesService', () => ({
    snapshotTake: vi.fn(async () => take),
  }));
  const { takeMidiFile } = await import('@/features/export/midiFile');
  return takeMidiFile('any', { right: 'Right hand', left: 'Left hand' });
}

/** The bytes of the first meta event of `type` in the file, after its length. */
async function metaBytes(file: File, type: number): Promise<number[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (let i = 0; i + 2 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === type) {
      return [...bytes.subarray(i + 3, i + 3 + bytes[i + 2]!)];
    }
  }
  return [];
}

/** D minor, as its pitches say: D F A, the C♯ that leads home, and D again. */
function dMinor(overrides: Partial<Take> = {}): Take {
  const midis = [62, 65, 69, 74, 73, 74, 69, 65, 62, 57, 61, 62, 65, 69, 62];
  return createEmptyTake({
    title: 'Study in D minor',
    notes: midis.map((midi, i) => ({
      id: `n${i}`,
      midi,
      startMs: i * 400,
      durationMs: 380,
      velocity: 0.6,
    })),
    ...overrides,
  });
}

describe('a take as a MIDI file', () => {
  it('is named for the take and typed as MIDI', async () => {
    const file = await midiFor(dMinor());
    expect(file?.name).toBe('PoKeyBoard - Study in D minor.mid');
    expect(file?.type).toBe('audio/midi');
    expect(new TextDecoder().decode(new Uint8Array(await file!.arrayBuffer()).subarray(0, 4))).toBe(
      'MThd',
    );
  });

  it('declares the key its pitches read as, minor included', async () => {
    const file = await midiFor(dMinor());
    expect(await metaBytes(file!, 0x59)).toEqual([0xff, 1]); // one flat, minor
  });

  it('declares the key a score gave it over any reading', async () => {
    const declared = dMinor();
    declared.tempo = { ...declared.tempo, keySignature: 2 };
    expect((await metaBytes((await midiFor(declared))!, 0x59))[0]).toBe(2);
  });

  it('asks a sequencer for the electric piano a Wurlitzer take was played on', async () => {
    const file = await midiFor(dMinor({ samplePackVersion: 'wurlitzer-ep203w-v1' }));
    const bytes = new Uint8Array(await file!.arrayBuffer());
    // A program change, on the first tick of each hand's track.
    const programs = [...bytes.keys()].filter(
      (i) => bytes[i - 1] === 0 && (bytes[i] === 0xc0 || bytes[i] === 0xc1),
    );
    expect(programs.map((i) => bytes[i + 1])).toEqual([4, 4]);
  });

  it('has nothing to write for an empty or missing take', async () => {
    expect(await midiFor(createEmptyTake())).toBeNull();
    expect(await midiFor(null)).toBeNull();
  });
});
