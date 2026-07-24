import { describe, expect, it, vi } from 'vitest';
import {
  constantClickGrid,
  gridForTake,
  MetronomeEngine,
  scheduleClicksForRange,
  takeClickGrid,
  type ClickGrid,
} from '@/audio/MetronomeEngine';
import { createTakeTempoMap } from '@/domain/tempoMap';
import type { TempoSettings } from '@/domain/takeTypes';

const FOUR_FOUR = { numerator: 4, denominator: 4 } as const;

/** 96 bpm, then the Forward, Gently marks: 104 at bar 25, 96 at 29. */
const MAPPED_TEMPO: TempoSettings = {
  bpm: 96,
  timeSignature: FOUR_FOUR,
  countInBars: 1,
  changes: [
    { atMs: 60_000, bpm: 104 },
    { atMs: 69_231, bpm: 96 },
  ],
};

/**
 * The bare minimum of the Web Audio surface `scheduleClick` touches, recording
 * what would have been heard.
 */
function stubContext(currentTime = 0) {
  const clicks: Array<{ when: number; freq: number }> = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const context = {
    currentTime,
    destination: { name: 'destination' },
    createGain: () => ({ gain: param(), connect: vi.fn() }),
    createOscillator: () => {
      const osc = {
        frequency: { value: 0 },
        connect: vi.fn(),
        start: (when: number) => clicks.push({ when, freq: osc.frequency.value }),
        stop: vi.fn(),
      };
      return osc;
    },
  };
  return { context, clicks };
}

describe('constantClickGrid', () => {
  const grid = constantClickGrid(10, 500, 4);

  it('spaces clicks by one beat and accents each bar', () => {
    expect([0, 1, 4, 8].map((i) => grid.audioTimeAt(i))).toEqual([10, 10.5, 12, 14]);
    expect([0, 1, 2, 3, 4].map((i) => grid.isAccent(i))).toEqual([true, false, false, false, true]);
    expect(grid.numerator).toBe(4);
  });

  it('inverts audio time back to a click index', () => {
    expect(grid.indexAt(12)).toBe(4);
    expect(grid.indexAt(9.5)).toBe(-1); // before the first click
  });
});

describe('takeClickGrid', () => {
  // A clock anchored so take-ms 0 is audio time 100.
  const audioTimeForTakeMs = (ms: number) => 100 + ms / 1000;
  const takeMsForAudioTime = (t: number) => (t - 100) * 1000;
  const grid: ClickGrid = takeClickGrid(
    createTakeTempoMap(MAPPED_TEMPO),
    FOUR_FOUR.numerator,
    audioTimeForTakeMs,
    takeMsForAudioTime,
  );

  it('clicks where the tempo map puts each beat', () => {
    expect(grid.audioTimeAt(0)).toBe(100);
    expect(grid.audioTimeAt(4)).toBeCloseTo(102.5, 6); // bar 2 at 96 bpm
    // Bar 25 starts at 60 s; its beats are 104 bpm, so shorter.
    expect(grid.audioTimeAt(96)).toBeCloseTo(160, 6);
    expect(grid.audioTimeAt(97) - grid.audioTimeAt(96)).toBeCloseTo(60 / 104, 6);
    // Bar 29 returns to 96 bpm. The take stores the change at a whole
    // millisecond, so the beat either side of it is off by ~0.02 ms.
    expect(grid.audioTimeAt(112)).toBeCloseTo(100 + 69.2307692, 5);
    expect(grid.audioTimeAt(113) - grid.audioTimeAt(112)).toBeCloseTo(0.625, 3);
  });

  it('accents bar lines all the way through the tempo changes', () => {
    for (const bar of [0, 24, 28, 30]) {
      expect(grid.isAccent(bar * 4)).toBe(true);
      expect(grid.isAccent(bar * 4 + 1)).toBe(false);
    }
  });

  it('inverts audio time back to a beat', () => {
    expect(grid.indexAt(grid.audioTimeAt(96))).toBeCloseTo(96, 6);
    expect(grid.indexAt(grid.audioTimeAt(113))).toBeCloseTo(113, 6);
  });

  it('is built from a take and a clock by gridForTake', () => {
    const clock = { audioTimeForTakeMs, takeMsForAudioTime };
    const built = gridForTake(MAPPED_TEMPO, clock);
    expect(built.audioTimeAt(96)).toBeCloseTo(grid.audioTimeAt(96), 6);
    expect(built.numerator).toBe(4);
  });
});

describe('MetronomeEngine', () => {
  it('schedules the clicks inside the lookahead window, accents included', () => {
    const { context, clicks } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    engine.start(constantClickGrid(0, 30, 4)); // 30 ms beats: five fit the 120 ms window
    expect(engine.isRunning).toBe(true);
    expect(clicks).toHaveLength(5);
    expect(clicks.map((click) => click.when)).toEqual([0, 0.03, 0.06, 0.09, 0.12]);
    // Accents are the higher pitch, every fourth click.
    const accents = clicks.map((click) => click.freq === clicks[0]!.freq);
    expect(accents.slice(0, 5)).toEqual([true, false, false, false, true]);
    engine.stop();
    expect(engine.isRunning).toBe(false);
  });

  it('starts at the first click that has not passed', () => {
    const { context, clicks } = stubContext(10);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    // A grid whose beat 0 was ten seconds ago: nothing before now is replayed.
    engine.start(constantClickGrid(0, 500, 4));
    expect(clicks.every((click) => click.when >= 10)).toBe(true);
    expect(clicks[0]!.when).toBeCloseTo(10, 6);
    engine.stop();
  });

  it('reports the beat within the bar for the beat dots', () => {
    const { context } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    expect(engine.beatInBarAt(0)).toBe(-1); // silent
    engine.start(constantClickGrid(0, 500, 4));
    expect(engine.beatInBarAt(0)).toBe(0);
    expect(engine.beatInBarAt(1.2)).toBe(2);
    expect(engine.beatInBarAt(2.0)).toBe(0);
    engine.stop();
  });

  it('swaps grids without stopping the click', () => {
    const { context } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    engine.start(constantClickGrid(0, 500, 4));
    engine.setGrid(constantClickGrid(0, 250, 4));
    expect(engine.isRunning).toBe(true);
    expect(engine.beatInBarAt(1)).toBe(0); // 4 quarter-second beats in
    engine.stop();
  });
});

describe('scheduleClicksForRange', () => {
  it('follows the tempo map through an exported click track', () => {
    const { context, clicks } = stubContext(0);
    scheduleClicksForRange(
      context as unknown as BaseAudioContext,
      context.destination as unknown as AudioNode,
      MAPPED_TEMPO,
      0.6,
      0,
      62_000,
    );
    // 96 bpm to 60 s = 96 beats, then 104 bpm beats of 576.9 ms.
    expect(clicks[0]!.when).toBe(0);
    expect(clicks[96]!.when).toBeCloseTo(60, 6);
    expect(clicks[97]!.when - clicks[96]!.when).toBeCloseTo(60 / 104, 6);
    expect(clicks.at(-1)!.when).toBeLessThanOrEqual(62);
  });

  it('starts at the first beat inside the range', () => {
    const { context, clicks } = stubContext(0);
    scheduleClicksForRange(
      context as unknown as BaseAudioContext,
      context.destination as unknown as AudioNode,
      { bpm: 120, timeSignature: FOUR_FOUR },
      0.6,
      1200,
      3000,
    );
    // Beats land every 500 ms; the first at or after 1200 ms is 1500 ms.
    expect(clicks[0]!.when).toBeCloseTo(0.3, 6);
  });
});
