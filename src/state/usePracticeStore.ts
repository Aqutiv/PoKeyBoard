import { create } from 'zustand';
// Types only: the results are collected outside React, by the practice
// session, which is what reads the transport's events.
import type { TrainingHand } from '@/domain/trainingGate';
import type { KeepTimeReport } from '@/features/practice/playAlongSession';
import type { ResultRecord } from '@/features/practice/practiceRecords';
import type { WaitReport } from '@/features/practice/trainingReport';
import type { PracticeStyle } from '@/features/transport/modes';
import type { RunEndReason } from '@/features/transport/practiceEvents';

/** What every result says, whichever way the run was practised. */
interface PracticeResultBase {
  runId: number;
  /** The take the run played; a result for any other is put away. */
  takeId: string;
  hand: TrainingHand;
  /** The slowest the run went: the speed it started at, or one it was turned down to. */
  slowestSpeed: number;
  reason: RunEndReason;
  /**
   * For a run through the whole of a Library track, the track's best and last
   * in the way it was practised, the run's own the last: added a moment after
   * the result itself, once the run is kept among them on the device.
   */
  record?: ResultRecord;
}

/** How a "wait for me" run went. */
export interface WaitResult extends PracticeResultBase {
  style: 'wait';
  wait: WaitReport;
}

/** How a Keep-time run went. */
export interface KeepTimeResult extends PracticeResultBase {
  style: 'playAlong';
  keepTime: KeepTimeReport;
}

/** A finished run's result. Each style of practice brings a report of its own. */
export type PracticeResult = WaitResult | KeepTimeResult;

/** The run under way. */
export interface LiveRun {
  runId: number;
  takeId: string;
  style: PracticeStyle;
  /**
   * For a Keep-time run, the moment on the page's clock a press lands exactly
   * on the run's start (`PlayAlongRun.pressOriginMs`). The card publishes it
   * for the end-to-end tests, which play in time from it.
   */
  pressOriginMs?: number;
}

export interface PracticeState {
  /** The last run's result, until it is dismissed or the next run starts. */
  result: PracticeResult | null;
  /** The run under way, while there is one: its result comes when it ends. */
  live: LiveRun | null;
  /** The newest run started, so that a result for an older one is never shown. */
  latestRunId: number | null;
  /** Playing again puts the last result away: it is about the run before. */
  runStarted(runId: number, takeId: string, style: PracticeStyle, pressOriginMs?: number): void;
  runEnded(runId: number): void;
  /** Ignored for any run but the newest started, which has overtaken it. */
  show(result: PracticeResult): void;
  /** Add the track's best and last to run `runId`'s result, while it is the one shown. */
  attachRecord(runId: number, record: ResultRecord): void;
  dismiss(): void;
  /** Put away a result for any take but this one, the take now open. */
  keepOnlyTake(takeId: string): void;
}

/**
 * The results of practice runs, for the card under the transport. The
 * practice session fills it from the transport's events, outside React, so a
 * run is read once however often the card mounts.
 */
export const usePracticeStore = create<PracticeState>()((set) => ({
  result: null,
  live: null,
  latestRunId: null,
  runStarted: (runId, takeId, style, pressOriginMs) =>
    set({
      live:
        pressOriginMs === undefined
          ? { runId, takeId, style }
          : { runId, takeId, style, pressOriginMs },
      result: null,
      latestRunId: runId,
    }),
  runEnded: (runId) => set((state) => (state.live?.runId === runId ? { live: null } : state)),
  show: (result) =>
    set((state) =>
      state.latestRunId === null || state.latestRunId === result.runId ? { result } : state,
    ),
  attachRecord: (runId, record) =>
    set((state) =>
      state.result?.runId === runId ? { result: { ...state.result, record } } : state,
    ),
  dismiss: () => set({ result: null }),
  keepOnlyTake: (takeId) =>
    set((state) => (state.result && state.result.takeId !== takeId ? { result: null } : state)),
}));
