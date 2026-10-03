import { describe, expect, it } from 'vitest';
import {
  buildImportedTake,
  fileTitle,
  importedTimeSignature,
  type ImportedNote,
  type ImportedScore,
} from '@/domain/importedTake';
import { parseTakeJson } from '@/domain/takeSchema';
import { createQuarterTempoMap } from '@/domain/tempoMap';
import { UNTITLED_TAKE_TITLE } from '@/domain/noteEvents';
import { MAX_TAKE_MS } from '@/domain/takeTypes';

class TestFailure extends Error {}
const fail = (issue: string): Error => new TestFailure(issue);

function note(overrides: Partial<ImportedNote> & Pick<ImportedNote, 'seq'>): ImportedNote {
  return { midi: 60, startMs: 0, endMs: 500, velocity: 0.5, ...overrides };
}

function score(overrides: Partial<ImportedScore> = {}): ImportedScore {
  return {
    notes: [note({ seq: 0 })],
    nextSeq: 1,
    pedals: [],
    tempoMap: createQuarterTempoMap([]),
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: null,
    keyMode: null,
    title: null,
    quantization: '1/16',
    ...overrides,
  };
}

describe('buildImportedTake', () => {
  it('rounds endpoints, not durations, so adjacent notes stay seamless', () => {
    const take = buildImportedTake(
      score({
        notes: [
          note({ seq: 0, startMs: 0, endMs: 333.4 }),
          note({ seq: 1, midi: 62, startMs: 333.4, endMs: 666.8 }),
        ],
        nextSeq: 2,
      }),
      undefined,
      fail,
    );
    expect(take.notes.map((n) => [n.startMs, n.durationMs])).toEqual([
      [0, 333],
      [333, 334],
    ]);
  });

  it('never leaves a note shorter than a millisecond', () => {
    const take = buildImportedTake(
      score({ notes: [note({ seq: 0, startMs: 10.2, endMs: 10.3 })] }),
      undefined,
      fail,
    );
    expect(take.notes[0]!.durationMs).toBe(1);
  });

  it('gives every note one stem and its place in reading order, padded', () => {
    const notes = Array.from({ length: 12 }, (_, seq) =>
      note({ seq, startMs: 0, endMs: 100, midi: 60 }),
    );
    const take = buildImportedTake(score({ notes, nextSeq: 12 }), undefined, fail);
    const stems = new Set(take.notes.map((n) => n.id.replace(/-\d+$/, '')));
    expect(stems.size).toBe(1);
    // Ties at one moment break by id, so reading order survives normalization.
    expect(take.notes.map((n) => n.id.slice(-3))).toEqual(
      notes.map((n) => `-${String(n.seq).padStart(2, '0')}`),
    );
  });

  it('carries the optional hints only when the source gave them', () => {
    const take = buildImportedTake(
      score({
        notes: [
          note({ seq: 0 }),
          note({ seq: 1, midi: 48, staff: 'bass', voice: 2, hidden: true }),
        ],
        nextSeq: 2,
      }),
      undefined,
      fail,
    );
    const plain = take.notes.find((n) => n.midi === 60)!;
    const hinted = take.notes.find((n) => n.midi === 48)!;
    expect(Object.keys(plain).sort()).toEqual(['durationMs', 'id', 'midi', 'startMs', 'velocity']);
    expect(hinted).toMatchObject({ staff: 'bass', voice: 2, hidden: true });
    expect('clef' in hinted).toBe(false);
  });

  it('refuses music longer than a take can hold, through the caller’s error', () => {
    expect(() =>
      buildImportedTake(
        score({ notes: [note({ seq: 0, startMs: MAX_TAKE_MS - 10, endMs: MAX_TAKE_MS + 10 })] }),
        undefined,
        fail,
      ),
    ).toThrow(TestFailure);
  });

  it('rounds pedal positions and drops those past the take limit', () => {
    const take = buildImportedTake(
      score({
        pedals: [
          { atMs: 0.4, down: true },
          { atMs: 499.6, down: false },
          { atMs: MAX_TAKE_MS + 1, down: true },
        ],
      }),
      undefined,
      fail,
    );
    expect(take.pedalEvents).toEqual([
      { atMs: 0, down: true },
      { atMs: 500, down: false },
    ]);
  });

  it('stores the map’s first tempo and its later changes at whole milliseconds', () => {
    const take = buildImportedTake(
      score({
        tempoMap: createQuarterTempoMap([
          { atQ: 0, bpm: 90 },
          { atQ: 4, bpm: 60 },
        ]),
      }),
      undefined,
      fail,
    );
    expect(take.tempo.bpm).toBe(90);
    expect(take.tempo.changes).toEqual([{ atMs: Math.round((4 * 60_000) / 90), bpm: 60 }]);
  });

  it('leaves tempo changes off a take that has none', () => {
    const take = buildImportedTake(score(), undefined, fail);
    expect(take.tempo.bpm).toBe(120);
    expect('changes' in take.tempo).toBe(false);
  });

  it('declares the key and mode only when the source named them', () => {
    const plain = buildImportedTake(score(), undefined, fail);
    expect('keySignature' in plain.tempo).toBe(false);
    expect('keyMode' in plain.tempo).toBe(false);
    const keyed = buildImportedTake(score({ keySignature: -3, keyMode: 'minor' }), undefined, fail);
    expect(keyed.tempo).toMatchObject({ keySignature: -3, keyMode: 'minor' });
  });

  it('titles the take from the source, then the file name, then the default', () => {
    expect(buildImportedTake(score({ title: '  Nocturne  ' }), 'x.mid', fail).title).toBe(
      'Nocturne',
    );
    expect(buildImportedTake(score(), 'Gymnopédie 1.mid', fail).title).toBe('Gymnopédie 1');
    expect(buildImportedTake(score(), undefined, fail).title).toBe(UNTITLED_TAKE_TITLE);
    expect(
      buildImportedTake(score({ title: 'x'.repeat(300) }), undefined, fail).title,
    ).toHaveLength(200);
  });

  it('keeps the grid it is handed', () => {
    expect(buildImportedTake(score({ quantization: '1/32' }), undefined, fail).display).toEqual({
      quantization: '1/32',
      zoom: 1,
      playheadMs: 0,
    });
  });

  it('builds a take that imports with no repairs', () => {
    const take = buildImportedTake(
      score({
        notes: [
          note({ seq: 0, startMs: 0, endMs: 333.4 }),
          note({ seq: 1, midi: 64, startMs: 333.4, endMs: 1000.2, staff: 'treble' }),
        ],
        nextSeq: 2,
        pedals: [{ atMs: 0, down: true }],
        tempoMap: createQuarterTempoMap([
          { atQ: 0, bpm: 72 },
          { atQ: 2, bpm: 80 },
        ]),
      }),
      'piece.mid',
      fail,
    );
    const { repairs } = parseTakeJson(JSON.parse(JSON.stringify(take)));
    expect(repairs).toEqual([]);
  });
});

describe('importedTimeSignature', () => {
  it('keeps a meter a take can hold', () => {
    expect(importedTimeSignature({ numerator: 6, denominator: 8 })).toEqual({
      numerator: 6,
      denominator: 8,
    });
    expect(importedTimeSignature({ numerator: 16, denominator: 16 })).toEqual({
      numerator: 16,
      denominator: 16,
    });
  });

  it('falls back to 4/4 for none, or for one it cannot hold', () => {
    const common = { numerator: 4, denominator: 4 };
    expect(importedTimeSignature(null)).toEqual(common);
    expect(importedTimeSignature({ numerator: 0, denominator: 4 })).toEqual(common);
    expect(importedTimeSignature({ numerator: 17, denominator: 4 })).toEqual(common);
    expect(importedTimeSignature({ numerator: 2.5, denominator: 4 })).toEqual(common);
    expect(importedTimeSignature({ numerator: 3, denominator: 32 })).toEqual(common);
  });
});

describe('fileTitle', () => {
  it('drops the extension and trims', () => {
    expect(fileTitle(' Waltz.mid ')).toBe('Waltz');
    expect(fileTitle('a.b.musicxml')).toBe('a.b');
  });

  it('is null for no name, or one that is all extension', () => {
    expect(fileTitle(undefined)).toBeNull();
    expect(fileTitle('.mid')).toBeNull();
  });
});
