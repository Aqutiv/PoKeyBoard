import { describe, expect, it } from 'vitest';
import {
  barLineNearMs,
  countInMsAt,
  createBeatTempoMap,
  createQuarterTempoMap,
  createTakeTempoMap,
  tempoChangesFrom,
  withTempoAt,
} from '@/domain/tempoMap';
import type { TimeSignature } from '@/domain/takeTypes';

const FOUR_FOUR: TimeSignature = { numerator: 4, denominator: 4 };
const SIX_EIGHT: TimeSignature = { numerator: 6, denominator: 8 };

describe('createBeatTempoMap', () => {
  it('maps beats to ms at a single tempo', () => {
    const map = createBeatTempoMap(120, FOUR_FOUR);
    expect(map.baseBpm).toBe(120);
    expect(map.msAtBeat(0)).toBe(0);
    expect(map.msAtBeat(4)).toBe(2000);
    expect(map.beatAtMs(2000)).toBe(4);
    expect(map.bpmAt(999_999)).toBe(120);
  });

  it('counts the time signature’s beat, not always a quarter', () => {
    const map = createBeatTempoMap(120, SIX_EIGHT);
    expect(map.msAtBeat(6)).toBe(1500); // six eighths at 120 per eighth
  });

  it('speeds up and slows down from the change onward', () => {
    // Four beats at 120 (2000 ms), then twice as fast.
    const map = createBeatTempoMap(120, FOUR_FOUR, [[4, 240]]);
    expect(map.msAtBeat(4)).toBe(2000);
    expect(map.msAtBeat(8)).toBe(3000);
    expect(map.bpmAt(1999)).toBe(120);
    expect(map.bpmAt(2000)).toBe(240);
    expect(map.beatAtMs(3000)).toBe(8);
  });

  it('ignores marks at or before the start, and unusable ones', () => {
    const map = createBeatTempoMap(120, FOUR_FOUR, [
      [0, 60],
      [-4, 200],
      [4, Number.NaN],
      [8, 0],
    ]);
    expect(map.segments).toHaveLength(1);
    expect(map.baseBpm).toBe(120);
  });

  it('takes the last of several marks at one position, in any order', () => {
    const map = createBeatTempoMap(120, FOUR_FOUR, [
      [8, 60],
      [4, 90],
      [4, 240],
    ]);
    expect(map.segments.map((s) => s.bpm)).toEqual([120, 240, 60]);
  });

  it('falls back to a usable tempo when the base is not one', () => {
    expect(createBeatTempoMap(0, FOUR_FOUR).baseBpm).toBe(120);
  });
});

describe('createTakeTempoMap', () => {
  const tempo = {
    bpm: 96,
    timeSignature: FOUR_FOUR,
    countInBars: 1 as const,
    changes: [{ atMs: 60_000, bpm: 104 }],
  };

  it('reads changes positioned in milliseconds', () => {
    const map = createTakeTempoMap(tempo);
    expect(map.beatAtMs(60_000)).toBe(96); // 24 bars at 96 bpm
    expect(map.bpmAt(60_000)).toBe(104);
    expect(Math.round(map.msAtBeat(100))).toBe(62_308);
  });

  it('round-trips beats and milliseconds across a change', () => {
    const map = createTakeTempoMap(tempo);
    for (const beat of [0, 12.5, 95.75, 96, 112, 127.75]) {
      expect(map.beatAtMs(map.msAtBeat(beat))).toBeCloseTo(beat, 6);
    }
  });

  it('reports the changes back as a take stores them', () => {
    expect(tempoChangesFrom(createTakeTempoMap(tempo))).toEqual([{ atMs: 60_000, bpm: 104 }]);
  });
});

describe('measureSpans', () => {
  it('fills the minimum measure count for an empty take', () => {
    const spans = createBeatTempoMap(120, FOUR_FOUR).measureSpans(0, 4);
    expect(spans).toHaveLength(4);
    expect(spans.map((span) => span.startMs)).toEqual([0, 2000, 4000, 6000]);
    expect(spans.every((span) => span.bpm === 120)).toBe(true);
  });

  it('shortens the measures that follow a faster tempo', () => {
    const spans = createBeatTempoMap(120, FOUR_FOUR, [[8, 240]]).measureSpans(4999, 1);
    expect(spans.map((span) => span.endMs - span.startMs)).toEqual([2000, 2000, 1000]);
    expect(spans.map((span) => span.bpm)).toEqual([120, 120, 240]);
    expect(spans[2]).toMatchObject({ index: 2, startMs: 4000, endMs: 5000 });
  });

  it('sizes a bar containing a mid-bar change from both tempi', () => {
    // Bar 2 runs two beats at 120 (1000 ms) then two at 240 (500 ms).
    const spans = createBeatTempoMap(120, FOUR_FOUR, [[6, 240]]).measureSpans(3000, 1);
    expect(spans[1]).toMatchObject({ startMs: 2000, endMs: 3500, bpm: 120 });
  });

  it('credits a change to the bar it lands on, even off the millisecond grid', () => {
    // 24 bars at 96 then 104 puts the next change on 69230.769… ms, which a
    // take stores rounded: the bar starting there must still read 96.
    const spans = createTakeTempoMap({
      bpm: 96,
      timeSignature: FOUR_FOUR,
      changes: [
        { atMs: 60_000, bpm: 104 },
        { atMs: 69_231, bpm: 96 },
      ],
    }).measureSpans(71_731, 1);
    expect(spans[24]).toMatchObject({ startMs: 60_000, bpm: 104 });
    expect(spans[27]).toMatchObject({ startMs: 66_923, bpm: 104 });
    expect(spans[28]).toMatchObject({ startMs: 69_231, endMs: 71_731, bpm: 96 });
  });

  it('adds the trailing measure a piece ending on a bar line needs', () => {
    const spans = createBeatTempoMap(120, FOUR_FOUR).measureSpans(4000, 1);
    expect(spans).toHaveLength(3);
  });
});

describe('barLineNearMs', () => {
  const map = createBeatTempoMap(120, FOUR_FOUR); // 2 s bars

  it('snaps to the closest bar line either side', () => {
    expect(barLineNearMs(map, FOUR_FOUR, 0)).toBe(0);
    expect(barLineNearMs(map, FOUR_FOUR, 900)).toBe(0);
    expect(barLineNearMs(map, FOUR_FOUR, 1100)).toBe(2000);
    expect(barLineNearMs(map, FOUR_FOUR, 5400)).toBe(6000);
    expect(barLineNearMs(map, FOUR_FOUR, -50)).toBe(0);
  });

  it('follows the tempo map into shorter bars', () => {
    // Bar 2 onward runs at 240 bpm, so bars are 1 s long.
    const faster = createBeatTempoMap(120, FOUR_FOUR, [[4, 240]]);
    expect(barLineNearMs(faster, FOUR_FOUR, 2400)).toBe(2000);
    expect(barLineNearMs(faster, FOUR_FOUR, 2600)).toBe(3000);
  });
});

describe('countInMsAt', () => {
  const map = createTakeTempoMap({
    bpm: 120,
    timeSignature: FOUR_FOUR,
    changes: [{ atMs: 8000, bpm: 60 }],
  });

  it('counts in at the tempo in force where recording starts', () => {
    expect(countInMsAt(map, FOUR_FOUR, 1, 0)).toBe(2000);
    expect(countInMsAt(map, FOUR_FOUR, 2, 0)).toBe(4000);
    expect(countInMsAt(map, FOUR_FOUR, 1, 8000)).toBe(4000); // 60 bpm bar
    expect(countInMsAt(map, FOUR_FOUR, 0, 8000)).toBe(0);
  });
});

describe('withTempoAt', () => {
  const base = { bpm: 96, timeSignature: FOUR_FOUR, countInBars: 1 as const };

  it('edits the take tempo at the start', () => {
    expect(withTempoAt(base, 0, 120)).toMatchObject({ bpm: 120 });
    expect(withTempoAt(base, 0, 120).changes).toBeUndefined();
  });

  it('keeps existing changes when the start tempo is edited', () => {
    const mapped = { ...base, changes: [{ atMs: 60_000, bpm: 104 }] };
    const next = withTempoAt(mapped, 0, 120);
    expect(next.bpm).toBe(120);
    expect(next.changes).toEqual([{ atMs: 60_000, bpm: 104 }]);
  });

  it('writes a change later in the take', () => {
    const next = withTempoAt(base, 20_000, 120);
    expect(next.bpm).toBe(96);
    expect(next.changes).toEqual([{ atMs: 20_000, bpm: 120 }]);
  });

  it('replaces a change already at that position and keeps the order', () => {
    const mapped = { ...base, changes: [{ atMs: 40_000, bpm: 132 }] };
    const next = withTempoAt(withTempoAt(mapped, 20_000, 120), 40_000, 108);
    expect(next.changes).toEqual([
      { atMs: 20_000, bpm: 120 },
      { atMs: 40_000, bpm: 108 },
    ]);
  });

  it('removes the mark when the tempo matches what precedes it', () => {
    const mapped = { ...base, changes: [{ atMs: 20_000, bpm: 120 }] };
    expect(withTempoAt(mapped, 20_000, 96).changes).toBeUndefined();
    // Same, one change deep: 132 at 40 s reverting to the 120 before it.
    const two = {
      ...base,
      changes: [
        { atMs: 20_000, bpm: 120 },
        { atMs: 40_000, bpm: 132 },
      ],
    };
    expect(withTempoAt(two, 40_000, 120).changes).toEqual([{ atMs: 20_000, bpm: 120 }]);
  });

  it('rounds the position to a whole millisecond, as the schema requires', () => {
    expect(withTempoAt(base, 20_000.4, 120).changes).toEqual([{ atMs: 20_000, bpm: 120 }]);
  });
});

describe('createQuarterTempoMap', () => {
  it('lets the first mark govern everything before it', () => {
    const map = createQuarterTempoMap([
      { atQ: 8, bpm: 60 },
      { atQ: 0, bpm: 120 },
    ]);
    expect(map.baseBpm).toBe(120);
    expect(map.msAtBeat(8)).toBe(4000);
    expect(map.msAtBeat(9)).toBe(5000);
  });

  it('back-propagates a tempo first marked after the start', () => {
    const map = createQuarterTempoMap([{ atQ: 4, bpm: 60 }]);
    expect(map.baseBpm).toBe(60);
    expect(map.msAtBeat(4)).toBe(4000);
  });

  it('defaults to 120 when the score marks no tempo', () => {
    expect(createQuarterTempoMap([]).baseBpm).toBe(120);
  });
});
