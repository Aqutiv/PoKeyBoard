import { describe, expect, it } from 'vitest';
import type { TempoSettings } from '@/domain/takeTypes';
import {
  gradeOf,
  MAX_PASS_CELLS,
  passCells,
  resultCells,
  type Outcome,
} from '@/features/practice/resultCells';

/** 120 bpm in 4/4: a bar every two seconds. */
const STEADY: TempoSettings = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  countInBars: 1,
};

const good = (atMs: number): Outcome => ({ atMs, good: true });
const missed = (atMs: number): Outcome => ({ atMs, good: false });

describe('a run without a loop', () => {
  it('is told four bars at a time, from the bars of the take', () => {
    // Bars 1 and 2 at 120 bpm (two seconds each), then 60 bpm from bar 3 on:
    // bar 3 is 4000–8000, bar 4 8000–12000, bar 5 12000–16000, bar 6 to 20000.
    const tempo: TempoSettings = { ...STEADY, changes: [{ atMs: 4000, bpm: 60 }] };
    const cells = resultCells([good(1000), missed(9000), good(13000), good(19000)], {
      tempo,
      takeDurationMs: 19500,
      looping: false,
    });
    expect(cells).toEqual([
      {
        kind: 'bars',
        fromBar: 1,
        toBar: 4,
        startMs: 0,
        endMs: 12000,
        good: 1,
        total: 2,
        grade: 'weak',
      },
      // The take ends in bar 6, so the section stops there too.
      {
        kind: 'bars',
        fromBar: 5,
        toBar: 6,
        startMs: 12000,
        endMs: 20000,
        good: 2,
        total: 2,
        grade: 'good',
      },
    ]);
  });

  it('opens on the section a run started in, and leaves out those it never reached', () => {
    // Started in bar 6, played on into bar 9; the take is ten bars long.
    const cells = resultCells([good(10500), missed(12500), good(14000), good(16000)], {
      tempo: STEADY,
      takeDurationMs: 20000,
      looping: false,
    });
    expect(cells.map((cell) => cell.kind === 'bars' && [cell.fromBar, cell.toBar])).toEqual([
      [5, 8],
      [9, 10],
    ]);
    expect(cells[0]).toMatchObject({ startMs: 8000, endMs: 16000, good: 2, total: 3 });
    // A step right on a bar line is that bar's first.
    expect(cells[1]).toMatchObject({ startMs: 16000, endMs: 20000, good: 1, total: 1 });
  });

  it('skips a section with nothing asked in it', () => {
    const cells = resultCells([good(500), good(17000)], {
      tempo: STEADY,
      takeDurationMs: 24000,
      looping: false,
    });
    expect(cells.map((cell) => cell.kind === 'bars' && cell.fromBar)).toEqual([1, 9]);
  });

  it('ends a take that stops on a bar line with that bar', () => {
    const cells = resultCells([good(10500)], {
      tempo: STEADY,
      takeDurationMs: 12000,
      looping: false,
    });
    expect(cells[0]).toMatchObject({ fromBar: 5, toBar: 6, endMs: 12000 });
  });
});

describe('a run round a loop', () => {
  it('is told pass by pass, a single step going round once a pass', () => {
    const cells = resultCells([good(1000), missed(1000), good(1000)], {
      tempo: STEADY,
      takeDurationMs: 4000,
      looping: true,
    });
    expect(cells).toEqual([
      { kind: 'pass', pass: 1, good: 1, total: 1, grade: 'good' },
      { kind: 'pass', pass: 2, good: 0, total: 1, grade: 'weak' },
      { kind: 'pass', pass: 3, good: 1, total: 1, grade: 'good' },
    ]);
  });

  it('starts each pass at the top, even where a chord there is asked a little apart', () => {
    // The loop is 1000–3000 and a chord straddles its top, at 990 and 1010.
    // Run into from the start, the chord is asked at 990; every time round
    // after that, the loop starts at 1000 and asks for 1010 alone.
    const cells = resultCells(
      [good(0), good(990), missed(2000), good(1010), good(2000), good(1010), missed(2000)],
      { tempo: STEADY, takeDurationMs: 4000, looping: true },
    );
    expect(cells.map((cell) => cell.kind === 'pass' && [cell.pass, cell.good, cell.total])).toEqual(
      [
        [1, 2, 3],
        [2, 2, 2],
        [3, 1, 2],
      ],
    );
  });

  it('starts a pass at a straddling chord that is all the loop asks for', () => {
    // The same chord, but the only step in the loop 1000–2000: asked at 990 on
    // the way in, then at 1010, later than any step before it. A hold's next
    // step is always more than a chord on, so one this close is the next pass.
    const cells = resultCells([missed(990), good(1010), good(1010)], {
      tempo: STEADY,
      takeDurationMs: 4000,
      looping: true,
    });
    expect(cells.map((cell) => cell.kind === 'pass' && [cell.pass, cell.good, cell.total])).toEqual(
      [
        [1, 0, 1],
        [2, 1, 1],
        [3, 1, 1],
      ],
    );
  });

  it('keeps the latest passes, numbered as they were played', () => {
    const outcomes = Array.from({ length: 11 }, (_, index) =>
      index === 3 ? missed(500) : good(500),
    );
    const cells = resultCells(outcomes, { tempo: STEADY, takeDurationMs: 4000, looping: true });
    expect(cells).toHaveLength(MAX_PASS_CELLS);
    expect(cells.map((cell) => cell.kind === 'pass' && cell.pass)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(cells[0]).toMatchObject({ pass: 4, good: 0, grade: 'weak' });
  });

  it('can be handed passes a caller has told apart itself', () => {
    // Notes kept in time share their chord's moment, so one pass can hold
    // several outcomes at one millisecond.
    const cells = passCells([
      [good(1000), good(1000), missed(1500)],
      [good(1000), good(1000), good(1500)],
    ]);
    expect(cells.map((cell) => [cell.pass, cell.good, cell.total])).toEqual([
      [1, 2, 3],
      [2, 3, 3],
    ]);
  });
});

describe('grades', () => {
  it('are good from 90%, fair from 60%, and weak below', () => {
    expect(gradeOf(1, 1)).toBe('good');
    expect(gradeOf(9, 10)).toBe('good');
    expect(gradeOf(89, 100)).toBe('fair');
    expect(gradeOf(3, 5)).toBe('fair');
    expect(gradeOf(59, 100)).toBe('weak');
    expect(gradeOf(0, 2)).toBe('weak');
  });
});
