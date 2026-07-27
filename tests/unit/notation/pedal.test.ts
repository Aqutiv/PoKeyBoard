import { describe, expect, it } from 'vitest';
import type { NoteEvent, PedalEvent } from '@/domain/takeTypes';
import { layoutScore } from '@/features/notation/notationLayout';
import { layoutSheet } from '@/features/notation/sheetLayout';

const OPTS = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  quantization: '1/16' as const,
  minMeasures: 1,
};

function note(partial: Partial<NoteEvent>): NoteEvent {
  return { id: 'n', midi: 72, startMs: 0, durationMs: 500, velocity: 0.5, ...partial };
}

function pedals(events: PedalEvent[], notes = [note({ durationMs: 2000 })]) {
  return layoutScore(notes, { ...OPTS, pedals: events }).pedals;
}

describe('pedal spans', () => {
  it('draws a bracket between a press and its release', () => {
    expect(
      pedals([
        { atMs: 0, down: true },
        { atMs: 1000, down: false },
      ]),
    ).toEqual([{ fromMs: 0, toMs: 1000 }]);
  });

  it('reads a re-press without a release as one press continuing', () => {
    expect(
      pedals([
        { atMs: 0, down: true },
        { atMs: 400, down: true },
        { atMs: 1000, down: false },
      ]),
    ).toEqual([{ fromMs: 0, toMs: 1000 }]);
  });

  it('ignores a release with nothing held', () => {
    expect(pedals([{ atMs: 0, down: false }])).toEqual([]);
    expect(
      pedals([
        { atMs: 0, down: false },
        { atMs: 500, down: true },
        { atMs: 900, down: false },
      ]),
    ).toEqual([{ fromMs: 500, toMs: 900 }]);
  });

  it('runs a press left open to the end of the score', () => {
    const layout = layoutScore([note({ durationMs: 2000 })], {
      ...OPTS,
      pedals: [{ atMs: 500, down: true }],
    });
    expect(layout.pedals).toEqual([{ fromMs: 500, toMs: layout.totalMs }]);
  });

  it('splits a pedal change into two brackets', () => {
    // The importer writes a <pedal change> as a release and a press together,
    // which is exactly the notch an engraved bracket shows.
    expect(
      pedals([
        { atMs: 0, down: true },
        { atMs: 800, down: false },
        { atMs: 800, down: true },
        { atMs: 1600, down: false },
      ]),
    ).toEqual([
      { fromMs: 0, toMs: 800 },
      { fromMs: 800, toMs: 1600 },
    ]);
  });

  it('has nothing to draw for a take with no pedalling', () => {
    expect(pedals([])).toEqual([]);
  });
});

describe('pedal brackets on paper', () => {
  const SHEET_OPTS = {
    paper: 'a4' as const,
    timeSignature: OPTS.timeSignature,
    bpm: 120,
    title: 'T',
    subtitle: '',
    credit: 'C',
  };

  it('places a bracket under the system and leaves room for it', () => {
    const withPedal = layoutSheet(
      layoutScore([note({ durationMs: 2000 })], {
        ...OPTS,
        pedals: [
          { atMs: 0, down: true },
          { atMs: 1500, down: false },
        ],
      }),
      SHEET_OPTS,
    );
    const system = withPedal.pages[0]!.systems[0]!;
    expect(system.pedals).toHaveLength(1);
    const pedal = system.pedals[0]!;
    expect(pedal.xToPt).toBeGreaterThan(pedal.xFromPt);
    expect(pedal.continuesLeft).toBe(false);
    expect(pedal.continuesRight).toBe(false);
    // The row sits below the bass staff.
    expect(system.pedalRowPt).toBeGreaterThan(system.bassTopPt);
  });

  it('leaves the layout untouched when nothing is pedalled', () => {
    const plain = layoutSheet(layoutScore([note({ durationMs: 2000 })], OPTS), SHEET_OPTS);
    expect(plain.pages[0]!.systems[0]!.pedals).toEqual([]);
  });
});
