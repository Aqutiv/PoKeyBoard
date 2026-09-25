import { describe, expect, it, vi } from 'vitest';
import {
  constantClickGrid,
  gridForTake,
  loopClickGrid,
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
 * every click scheduled. One stopped at or before its start is never heard.
 */
function stubContext(currentTime = 0) {
  const clicks: Array<{ when: number; freq: number; stopAt: number }> = [];
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
      const click = { when: 0, freq: 0, stopAt: Number.POSITIVE_INFINITY };
      const osc = {
        frequency: { value: 0 },
        connect: vi.fn(),
        start: (when: number) => {
          click.when = when;
          click.freq = osc.frequency.value;
          clicks.push(click);
        },
        stop: (when: number) => {
          click.stopAt = when;
        },
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
    const clock = {
      audioTimeForVirtualMs: audioTimeForTakeMs,
      virtualMsForAudioTime: takeMsForAudioTime,
      loop: null,
    };
    const built = gridForTake(MAPPED_TEMPO, clock);
    expect(built.audioTimeAt(96)).toBeCloseTo(grid.audioTimeAt(96), 6);
    expect(built.numerator).toBe(4);
  });
});

describe('loopClickGrid', () => {
  // 120 bpm in 4/4: a beat is 500 ms. The loop is bar 2 (2000–4000 ms), and
  // the run is anchored so virtual time 0 is audio time 100.
  const map = createTakeTempoMap({ bpm: 120, timeSignature: FOUR_FOUR });
  const loop = { startMs: 2000, endMs: 4000 };
  const timeline = {
    audioTimeForVirtualMs: (ms: number) => 100 + ms / 1000,
    virtualMsForAudioTime: (t: number) => (t - 100) * 1000,
    loop,
  };
  const grid = loopClickGrid(map, 4, timeline, loop);

  it('clicks up to the loop’s end, then round the loop again and again', () => {
    // Beats 0–7 (to 4000 ms), then bar 2's four beats, pass after pass.
    expect([6, 7, 8, 9, 12].map((i) => grid.audioTimeAt(i))).toEqual([103, 103.5, 104, 104.5, 106]);
  });

  it('accents the bar line each time round', () => {
    expect([4, 8, 9, 12, 13].map((i) => grid.isAccent(i))).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
  });

  it('inverts audio time back to a click, in whichever pass it falls', () => {
    expect(grid.indexAt(104.5)).toBeCloseTo(9, 6);
    expect(grid.indexAt(106.25)).toBeCloseTo(12.5, 6);
  });

  it('counts a mark rounded to the millisecond as the beat it was put on', () => {
    // 104 bpm: beat 1 falls at 576.923 ms and a mark there is stored as 577.
    // The loop is four beats from it, and must click beats 1 to 4 each time.
    const slow = createTakeTempoMap({ bpm: 104, timeSignature: FOUR_FOUR });
    const rounded = { startMs: 577, endMs: Math.round(slow.msAtBeat(5)) };
    const at = { ...timeline, loop: rounded };
    const looped = loopClickGrid(slow, 4, at, rounded);
    const length = rounded.endMs - rounded.startMs;
    // Click 5 is the first after the seam: beat 1 again, one loop later.
    expect(looped.audioTimeAt(5)).toBeCloseTo(100 + (slow.msAtBeat(1) + length) / 1000, 6);
    // Beat 4 is bar two's downbeat, inside the loop: accented every time round.
    expect(looped.isAccent(8)).toBe(true);
  });

  it('is what gridForTake builds for a clock that loops', () => {
    const built = gridForTake({ bpm: 120, timeSignature: FOUR_FOUR }, timeline);
    expect(built.audioTimeAt(12)).toBeCloseTo(106, 6);
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

  it('lights the beat each click stands for, round a loop that is not whole bars', () => {
    const { context } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    // 120 bpm in 4/4, looping bar 2's first three beats (2000–3500 ms), with
    // virtual time 0 at audio time 0.
    const loop = { startMs: 2000, endMs: 3500 };
    const timeline = {
      audioTimeForVirtualMs: (ms: number) => ms / 1000,
      virtualMsForAudioTime: (t: number) => t * 1000,
      loop,
    };
    const map = createTakeTempoMap({ bpm: 120, timeSignature: FOUR_FOUR });
    engine.start(loopClickGrid(map, 4, timeline, loop));
    // Halfway through each beat from the last before the seam: bar 2's third
    // beat, then its first three again and again, never its fourth.
    const at = [3.25, 3.75, 4.25, 4.75, 5.25, 5.75, 6.25, 6.75];
    expect(at.map((t) => engine.beatInBarAt(t))).toEqual([2, 0, 1, 2, 0, 1, 2, 0]);
    engine.stop();
  });

  it('never sounds a click twice when the grid is swapped', () => {
    const { context, clicks } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    engine.start(constantClickGrid(0, 30, 4)); // clicks to 120 ms already scheduled
    engine.setGrid(constantClickGrid(0, 30, 4));
    engine.topUpSchedule();
    const times = clicks.map((click) => click.when);
    expect(new Set(times).size).toBe(times.length);
    engine.stop();
  });

  it('calls off the clicks still to come when it starts again', () => {
    const { context, clicks } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    engine.start(constantClickGrid(0, 62.5, 4)); // clicks at 0 and 62.5 ms queued
    context.currentTime = 0.03125;
    // Started over on a grid a little later, as a loop edit restarts playback.
    engine.start(constantClickGrid(0.09375, 62.5, 4));
    const heard = clicks.filter((click) => click.stopAt > click.when);
    expect(heard.map((click) => click.when)).toEqual([0, 0.09375]);
    engine.stop();
  });

  it('calls off the clicks still to come when it stops, but not one sounding', () => {
    const { context, clicks } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    engine.start(constantClickGrid(0, 62.5, 4));
    context.currentTime = 0.0625;
    engine.topUpSchedule(); // the click at 125 ms is queued too
    engine.stop(); // on the click at 62.5 ms itself
    const heard = clicks.filter((click) => click.stopAt > click.when);
    expect(heard.map((click) => click.when)).toEqual([0, 0.0625]);
  });

  it('lets the clicks already queued sound when it finishes, as a count-in does', () => {
    const { context, clicks } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    engine.start(constantClickGrid(0, 62.5, 4)); // clicks at 0 and 62.5 ms queued
    context.currentTime = 0.03125;
    engine.finish();
    engine.topUpSchedule();
    expect(engine.isRunning).toBe(false);
    const heard = clicks.filter((click) => click.stopAt > click.when);
    expect(heard.map((click) => click.when)).toEqual([0, 0.0625]);
  });

  it('calls off the clicks queued at the old speed when the speed changes', () => {
    const { context, clicks } = stubContext(0);
    const engine = new MetronomeEngine();
    engine.attach(context as unknown as AudioContext);
    const tempo = { bpm: 120, timeSignature: FOUR_FOUR };
    /** A run at `rate` that plays take time `fromMs` at audio time `fromAudio`. */
    const run = (rate: number, fromAudio: number, fromMs: number) => ({
      audioTimeForVirtualMs: (ms: number) => fromAudio + (ms - fromMs) / 1000 / rate,
      virtualMsForAudioTime: (t: number) => fromMs + (t - fromAudio) * 1000 * rate,
      loop: null,
    });
    engine.start(gridForTake(tempo, run(1, 0, 0)));
    context.currentTime = 0.45;
    engine.topUpSchedule(); // beat 1, at 0.5 s, is queued
    // Quarter speed from here: beat 1 is 50 ms of the take away, 200 ms of audio.
    engine.retime(gridForTake(tempo, run(0.25, 0.45, 450)));
    for (let t = 0.45; t < 2.7; t += 0.025) {
      context.currentTime = t;
      engine.topUpSchedule();
    }
    const heard = clicks.filter((click) => click.stopAt > click.when);
    expect(heard.map((click) => click.when)).toEqual([
      0,
      expect.closeTo(0.65, 6),
      expect.closeTo(2.65, 6),
    ]);
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
