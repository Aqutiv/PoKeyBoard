import { describe, expect, it } from 'vitest';
import { reduceWaitRun } from '@/features/practice/trainingReport';
import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';

const RUN_ID = 7;

/** A "wait for me" run through a take of four bars at 120 bpm (a bar every two seconds). */
const RUN: PracticeRun = {
  runId: RUN_ID,
  takeId: 'take',
  style: 'wait',
  hand: 'right',
  fromMs: 0,
  loop: null,
  speed: 1,
  anchorAudioTime: 10,
  countInMs: 0,
  durationMs: 8000,
  tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, countInBars: 1 },
  asked: [],
  noteCount: 8,
  takeDurationMs: 8000,
};

const step = (atMs: number): PracticeEvent => ({
  runId: RUN_ID,
  type: 'step',
  atMs,
  midis: [60],
});
const hold = (atMs: number, dueAudioTime = 10 + atMs / 1000): PracticeEvent => ({
  runId: RUN_ID,
  type: 'hold',
  atMs,
  midis: [60],
  dueAudioTime,
});
const key = (wanted: boolean, audioTime = 0): PracticeEvent => ({
  runId: RUN_ID,
  type: 'hold-key',
  midi: wanted ? 60 : 61,
  wanted,
  audioTime,
});
const cleared = (audioTime: number, skipped = false): PracticeEvent => ({
  runId: RUN_ID,
  type: 'hold-cleared',
  skipped,
  audioTime,
});
const speed = (value: number): PracticeEvent => ({
  runId: RUN_ID,
  type: 'speed',
  speed: value,
  audioTime: null,
});
const end: PracticeEvent = { runId: RUN_ID, type: 'run-end', reason: 'end', audioTime: null };

describe('a "wait for me" run', () => {
  it('counts a clean hold right first time, and neither one after a wrong key nor one let through', () => {
    const report = reduceWaitRun(RUN, [
      hold(0, 10),
      key(true, 10.4),
      cleared(10.4),
      hold(1000, 11),
      key(false, 11.2),
      key(true, 11.5),
      cleared(11.5),
      hold(2000, 12),
      cleared(12.6, true),
      end,
    ]);
    expect(report).toMatchObject({
      steps: 3,
      rightFirstTime: 1,
      withWrongKey: 1,
      wrongKeys: 1,
      letThrough: 1,
      slowHolds: 0,
      inFlow: 0,
    });
    expect(report.accuracy).toBeCloseTo(1 / 3);
  });

  it('counts a step played before the music reached it as right first time, in flow', () => {
    const report = reduceWaitRun(RUN, [step(0), step(500), hold(1000, 11), cleared(11.2), end]);
    expect(report).toMatchObject({ steps: 3, rightFirstTime: 3, inFlow: 2, accuracy: 1 });
  });

  it('calls a hold slow only past two seconds, and never one let through', () => {
    const report = reduceWaitRun(RUN, [
      // Exactly two seconds is not slow; a millisecond more is.
      hold(0, 10),
      cleared(12),
      hold(1000, 13),
      cleared(15.001),
      // Read off a running clock, two seconds later is rarely a round number.
      hold(2000, 20.3),
      cleared(22.3),
      // Let through after a long wait: the player chose to move on.
      hold(3000, 30),
      cleared(36, true),
      end,
    ]);
    expect(report.slowHolds).toBe(1);
    // Slow is still right first time.
    expect(report.rightFirstTime).toBe(3);
  });

  it('counts every wrong press at a hold, and the hold once', () => {
    const report = reduceWaitRun(RUN, [
      hold(0, 10),
      key(false),
      key(false),
      key(true),
      key(false),
      cleared(10.9),
      hold(1000, 11),
      cleared(11.1),
      end,
    ]);
    expect(report).toMatchObject({ steps: 2, withWrongKey: 1, wrongKeys: 3, rightFirstTime: 1 });
  });

  it('keeps the slowest speed the run went at', () => {
    const slowed = { ...RUN, speed: 0.8 };
    expect(reduceWaitRun(slowed, [step(0), speed(0.6), step(500), speed(0.9), end])).toMatchObject({
      slowestSpeed: 0.6,
    });
    expect(reduceWaitRun(slowed, [step(0), step(500), end]).slowestSpeed).toBe(0.8);
  });

  it('leaves out a hold still open when the run ends', () => {
    const report = reduceWaitRun(RUN, [step(0), hold(1000, 11), key(false), end]);
    expect(report).toMatchObject({ steps: 1, rightFirstTime: 1, withWrongKey: 0, wrongKeys: 0 });
    expect(report.cells).toEqual([
      expect.objectContaining({ kind: 'bars', fromBar: 1, toBar: 4, good: 1, total: 1 }),
    ]);
  });

  it('tells its steps in the take’s sections, or round its loop in passes', () => {
    const through = reduceWaitRun(RUN, [step(0), hold(2500, 12.5), key(false), cleared(13), end]);
    expect(through.cells).toEqual([
      {
        kind: 'bars',
        fromBar: 1,
        toBar: 4,
        startMs: 0,
        endMs: 8000,
        good: 1,
        total: 2,
        grade: 'weak',
      },
    ]);

    const looping = { ...RUN, loop: { startMs: 0, endMs: 2000 } };
    const round = reduceWaitRun(looping, [step(0), step(1000), step(0), hold(1000, 13), end]);
    expect(round.cells.map((cell) => cell.kind === 'pass' && [cell.pass, cell.total])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('reads only its own run’s events', () => {
    const stale: PracticeEvent = { runId: RUN_ID - 1, type: 'step', atMs: 0, midis: [60] };
    expect(reduceWaitRun(RUN, [stale, step(500), end]).steps).toBe(1);
  });
});
