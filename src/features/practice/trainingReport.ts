import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import { resultCells, type Outcome, type ResultCell } from './resultCells';

/**
 * How a "wait for me" run went. A step is a note or chord the chosen hand was
 * asked for: played before the music reached it, or at a hold the music made
 * for it.
 */
export interface WaitReport {
  /** Steps the run asked for and got: every one played in time, every hold cleared. */
  steps: number;
  /** Steps with no wrong key on the way, and not let through. */
  rightFirstTime: number;
  /** Holds where at least one key pressed was not asked for. */
  withWrongKey: number;
  /** Every key pressed at a hold that was not asked for. */
  wrongKeys: number;
  /** Holds Play let through rather than the player. */
  letThrough: number;
  /** Holds the player cleared more than `SLOW_HOLD_MS` after the note was due. */
  slowHolds: number;
  /** Steps played before the music reached them, so it never stopped for them. */
  inFlow: number;
  /** `rightFirstTime` of `steps`, from 0 to 1; 0 when nothing was asked. */
  accuracy: number;
  /** The slowest the run went: the speed it started at, or one it was turned down to. */
  slowestSpeed: number;
  cells: ResultCell[];
}

/** How long a hold may wait for the player before it counts as slow. */
export const SLOW_HOLD_MS = 2000;

/** The hold the run is waiting at, as far as it has gone. */
interface OpenHold {
  atMs: number;
  dueAudioTime: number;
  wrongKeys: number;
}

/**
 * Read a "wait for me" run's events into its report. Only steps the run got
 * count: a hold still open when the run ended — paused there, or stopped —
 * was never answered, so it is neither right nor wrong.
 */
export function reduceWaitRun(run: PracticeRun, events: readonly PracticeEvent[]): WaitReport {
  const outcomes: Outcome[] = [];
  let withWrongKey = 0;
  let wrongKeys = 0;
  let letThrough = 0;
  let slowHolds = 0;
  let inFlow = 0;
  let slowestSpeed = run.speed;
  let open: OpenHold | null = null;

  for (const event of events) {
    if (event.runId !== run.runId) continue;
    if (event.type === 'run-end') break;
    switch (event.type) {
      case 'step':
        inFlow += 1;
        outcomes.push({ atMs: event.atMs, good: true });
        break;
      case 'hold':
        open = { atMs: event.atMs, dueAudioTime: event.dueAudioTime, wrongKeys: 0 };
        break;
      case 'hold-key':
        if (open && !event.wanted) open.wrongKeys += 1;
        break;
      case 'hold-cleared': {
        if (!open) break;
        wrongKeys += open.wrongKeys;
        if (open.wrongKeys > 0) withWrongKey += 1;
        if (event.skipped) letThrough += 1;
        // Measured to the millisecond: two readings of a running clock are
        // rarely a round number apart, even when the wait was.
        else if (Math.round((event.audioTime - open.dueAudioTime) * 1000) > SLOW_HOLD_MS) {
          slowHolds += 1;
        }
        outcomes.push({ atMs: open.atMs, good: open.wrongKeys === 0 && !event.skipped });
        open = null;
        break;
      }
      case 'speed':
        slowestSpeed = Math.min(slowestSpeed, event.speed);
        break;
    }
  }

  const steps = outcomes.length;
  const rightFirstTime = outcomes.filter((outcome) => outcome.good).length;
  return {
    steps,
    rightFirstTime,
    withWrongKey,
    wrongKeys,
    letThrough,
    slowHolds,
    inFlow,
    accuracy: steps > 0 ? rightFirstTime / steps : 0,
    slowestSpeed,
    cells: resultCells(outcomes, {
      tempo: run.tempo,
      takeDurationMs: run.takeDurationMs,
      looping: run.loop !== null,
    }),
  };
}
