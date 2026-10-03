import { create } from 'zustand';
// Types only: the results are collected outside React, by the practice
// session, which is what reads the transport's events.
import type { TrainingHand } from '@/domain/trainingGate';
import type { WaitReport } from '@/features/practice/trainingReport';
import type { PracticeStyle, RunEndReason } from '@/features/transport/practiceEvents';

/** What every result says, whichever way the run was practised. */
interface PracticeResultBase {
  runId: number;
  /** The take the run played; a result for any other is put away. */
  takeId: string;
  hand: TrainingHand;
  /** The slowest the run went: the speed it started at, or one it was turned down to. */
  slowestSpeed: number;
  reason: RunEndReason;
}

/** How a "wait for me" run went. */
export interface WaitResult extends PracticeResultBase {
  style: 'wait';
  wait: WaitReport;
}

/** A finished run's result. Each style of practice brings a report of its own. */
export type PracticeResult = WaitResult;

/** The run under way. */
export interface LiveRun {
  runId: number;
  takeId: string;
  style: PracticeStyle;
}

interface PracticeState {
  /** The last run's result, until it is dismissed or the next run starts. */
  result: PracticeResult | null;
  /** The run under way, while there is one: its result comes when it ends. */
  live: LiveRun | null;
  /** The newest run started, so that a result for an older one is never shown. */
  latestRunId: number | null;
  /** Playing again puts the last result away: it is about the run before. */
  runStarted(runId: number, takeId: string, style: PracticeStyle): void;
  runEnded(runId: number): void;
  /** Ignored for any run but the newest started, which has overtaken it. */
  show(result: PracticeResult): void;
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
  runStarted: (runId, takeId, style) =>
    set({ live: { runId, takeId, style }, result: null, latestRunId: runId }),
  runEnded: (runId) => set((state) => (state.live?.runId === runId ? { live: null } : state)),
  show: (result) =>
    set((state) =>
      state.latestRunId === null || state.latestRunId === result.runId ? { result } : state,
    ),
  dismiss: () => set({ result: null }),
  keepOnlyTake: (takeId) =>
    set((state) => (state.result && state.result.takeId !== takeId ? { result: null } : state)),
}));
