import type { TempoSettings } from '@/domain/takeTypes';
import type { WaitReport } from '@/features/practice/trainingReport';
import type { PracticeRun } from '@/features/transport/practiceEvents';
import type { WaitResult } from '@/state/usePracticeStore';

/** 120 bpm in 4/4, as a new take starts: a bar every two seconds. */
export const TEMPO: TempoSettings = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  countInBars: 1,
};

/** A "wait for me" run through a take of eight bars at 120 bpm (a bar every two seconds). */
export function practiceRun(overrides: Partial<PracticeRun> = {}): PracticeRun {
  return {
    runId: 1,
    takeId: 'take',
    style: 'wait',
    hand: 'right',
    fromMs: 0,
    loop: null,
    speed: 1,
    anchorAudioTime: 10,
    countInMs: 0,
    durationMs: 16000,
    tempo: TEMPO,
    asked: [],
    noteCount: 16,
    takeDurationMs: 16000,
    ...overrides,
  };
}

/** Ten steps, eight of them right first time, all in the take's first four bars. */
export function waitReport(overrides: Partial<WaitReport> = {}): WaitReport {
  return {
    steps: 10,
    rightFirstTime: 8,
    withWrongKey: 1,
    wrongKeys: 2,
    letThrough: 1,
    slowHolds: 2,
    inFlow: 6,
    accuracy: 0.8,
    slowestSpeed: 1,
    cells: [
      {
        kind: 'bars',
        fromBar: 1,
        toBar: 4,
        startMs: 0,
        endMs: 8000,
        good: 8,
        total: 10,
        grade: 'fair',
      },
    ],
    ...overrides,
  };
}

export function waitResult(overrides: Partial<WaitResult> = {}): WaitResult {
  return {
    runId: 1,
    takeId: 'take',
    style: 'wait',
    hand: 'right',
    slowestSpeed: 1,
    reason: 'end',
    tempo: TEMPO,
    wait: waitReport(),
    ...overrides,
  };
}
