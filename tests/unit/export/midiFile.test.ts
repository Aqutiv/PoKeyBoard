import { afterEach, describe, expect, it, vi } from 'vitest';
import { musicXmlToTake } from '@/domain/musicXmlImport';
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

  it('declares a key the score calls minor, however few notes there are to read', async () => {
    // Four notes are too few to read a mode from, which reads as major; the
    // score says A minor.
    const arpeggio = [
      ['A', 4],
      ['C', 5],
      ['E', 5],
      ['A', 5],
    ] as const;
    const aMinor = musicXmlToTake(
      '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1">' +
        '<part-list><score-part id="P1"><part-name>P1</part-name></score-part></part-list>' +
        '<part id="P1"><measure number="1"><attributes><divisions>1</divisions>' +
        '<key><fifths>0</fifths><mode>minor</mode></key>' +
        '<time><beats>4</beats><beat-type>4</beat-type></time></attributes>' +
        arpeggio
          .map(
            ([step, octave]) =>
              `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
              '<duration>1</duration></note>',
          )
          .join('') +
        '</measure></part></score-partwise>',
    );
    expect(await metaBytes((await midiFor(aMinor))!, 0x59)).toEqual([0, 1]); // no sharps, minor
  });

  it('reads the mode from the pitches when a score calls its key major', async () => {
    // "Major" is often just what the exporting program wrote: the D minor
    // study, declared as F major, is still in D minor.
    const declared = dMinor();
    declared.tempo = { ...declared.tempo, keySignature: -1, keyMode: 'major' };
    expect(await metaBytes((await midiFor(declared))!, 0x59)).toEqual([0xff, 1]); // one flat, minor
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
