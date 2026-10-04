import { audioEngine } from '@/audio/AudioEngine';
import { recordPracticeScore } from '@/data/practiceResultsRepository';
import { libraryTrackSummary } from '@/features/library/catalog';
import type { PracticeEvent, PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import {
  usePracticeStore,
  type PracticeResult,
  type PracticeState,
} from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { startPlayAlongRun, type PlayAlongDeps, type PlayAlongRun } from './playAlongSession';
import {
  isCompleteRun,
  practiceModeKey,
  trackFingerprint,
  type PracticeModeKey,
  type PracticeScore,
  type ResultRecord,
} from './practiceRecords';
import { reduceWaitRun } from './trainingReport';

/**
 * Fewest steps a run needs for its result to be shown. One note right or
 * wrong is plain from the keys already; a card for it would only be in the way.
 */
export const MIN_RESULT_STEPS = 2;

export interface PracticeSessionDeps {
  /** The transport's practice runs, as they happen. */
  subscribePractice(listener: (event: PracticeEvent) => void): () => void;
  /** Hears the open take change to another. */
  subscribeTakeId(listener: (takeId: string) => void): () => void;
  store: Pick<PracticeState, 'runStarted' | 'runEnded' | 'show' | 'keepOnlyTake' | 'attachRecord'>;
  /** What a Keep-time run listens to and flashes as it plays; see `startPlayAlongRun`. */
  playAlong: PlayAlongDeps;
  /** Where a run through the whole of a Library track is kept; see `PracticeRecordDeps`. */
  records: PracticeRecordDeps;
}

/** What keeping a run's result among its track's results needs; injected, for the tests. */
export interface PracticeRecordDeps {
  /** The take open now: its id, and how many notes and milliseconds it has. */
  openTake(): { id: string; noteCount: number; durationMs: number };
  /** A Library track's catalog entry, by its take id, or none for a take of the user's. */
  trackSummary(takeId: string): { noteCount: number; durationMs: number } | undefined;
  /** Keep a score among its track's results, and say what its best and last are now. */
  keep(takeId: string, mode: PracticeModeKey, score: PracticeScore): Promise<ResultRecord>;
}

export interface PracticeSession {
  dispose(): void;
}

/**
 * Collects each practice run's events and, when the run ends, its result.
 * Outside React, so a run is read exactly once — a card mounting twice, as
 * StrictMode mounts it, or not at all, on another route, changes nothing.
 *
 * A "wait for me" run is read from its events. A Keep-time run is read from
 * the keys the player pressed as it played, which it listens to from its
 * start to its end (`startPlayAlongRun`), and from a little past the end of
 * one played to its end, for its last notes played late.
 *
 * A run through the whole of a Library track is kept among the track's
 * results too, on the device, in the background: the card shows how it went
 * at once, and the track's best and last a moment after, once they are known.
 */
export function createPracticeSession({
  subscribePractice,
  subscribeTakeId,
  store,
  playAlong,
  records,
}: PracticeSessionDeps): PracticeSession {
  /**
   * The run under way: its events so far, or, keeping time, what is listening
   * to it. Null between runs.
   */
  let current: { run: PracticeRun; events: PracticeEvent[]; along: PlayAlongRun | null } | null =
    null;
  /** Keep-time runs still listening: the one under way, and any waiting on late notes. */
  const listening = new Set<PlayAlongRun>();
  /** Once disposed, a result kept late has nowhere to go. */
  let disposed = false;

  /**
   * The fingerprint a run's result is kept under, or null for a run that is
   * not one to keep. Only a run through the whole of a Library track counts
   * (`isCompleteRun`), on the notes the catalog has for it, with that track
   * still open, as it was, when the run ended. A run on notes the catalog does
   * not describe means a classics manifest out of date with its scores, which
   * is worth a warning; any other run is simply not one to keep.
   */
  const fingerprintToKeep = (run: PracticeRun, reason: RunEndReason): string | null => {
    if (!isCompleteRun(run, reason)) return null;
    const summary = records.trackSummary(run.takeId);
    if (!summary) return null;
    if (run.noteCount !== summary.noteCount || run.takeDurationMs !== summary.durationMs) {
      console.warn(
        `Practice results for ${run.takeId} are not kept: the take has ${run.noteCount} notes ` +
          `over ${run.takeDurationMs} ms, the catalog ${summary.noteCount} over ` +
          `${summary.durationMs} ms. Is the classics manifest out of date?`,
      );
      return null;
    }
    const open = records.openTake();
    const unchanged =
      open.id === run.takeId &&
      open.noteCount === run.noteCount &&
      open.durationMs === run.takeDurationMs;
    return unchanged ? trackFingerprint(summary) : null;
  };

  /**
   * Keep `result` among its track's results, then add the track's best and
   * last to it, if it is still the result shown. In the background: a write
   * that fails costs the record, never the card.
   */
  const keep = (result: PracticeResult, fingerprint: string, at: string): void => {
    const mode = practiceModeKey(result.style, result.hand);
    records.keep(result.takeId, mode, scoreOf(result, fingerprint, at)).then(
      (record) => {
        if (!disposed) store.attachRecord(result.runId, record);
      },
      (error: unknown) => console.error('Keeping a practice result failed:', error),
    );
  };

  const onEvent = (event: PracticeEvent): void => {
    if (event.type === 'run-start') {
      // A run's end always comes before the next one starts; one that never
      // came has nothing more to say.
      if (current?.along) {
        current.along.cancel();
        listening.delete(current.along);
      }
      const { run } = event;
      const along = run.style === 'playAlong' ? startPlayAlongRun(run, playAlong) : null;
      if (along) listening.add(along);
      current = { run, events: [], along };
      store.runStarted(event.runId, run.takeId, run.style, along?.pressOriginMs);
      return;
    }
    // A run already over, or one that started before anyone was listening,
    // has nothing to add to the run under way.
    if (!current || event.runId !== current.run.runId) return;
    if (event.type !== 'run-end') {
      if (current.along) current.along.hear(event);
      else current.events.push(event);
      return;
    }
    const { run, events, along } = current;
    current = null;
    // Whether the run is one to keep is settled as it ends: by the time a
    // Keep-time run's late notes are in, another take may be open.
    const fingerprint = fingerprintToKeep(run, event.reason);
    const endedAt = new Date().toISOString();
    if (along) {
      // At once, or once its last notes have had time to be played late. The
      // store drops it then if another run has started meanwhile, but a run
      // through the track is kept all the same.
      along.end(event, (keepTime) => {
        listening.delete(along);
        if (keepTime.notes < MIN_RESULT_STEPS) return;
        const result: PracticeResult = {
          runId: run.runId,
          takeId: run.takeId,
          style: 'playAlong',
          hand: run.hand,
          slowestSpeed: keepTime.slowestSpeed,
          reason: event.reason,
          keepTime,
        };
        store.show(result);
        if (fingerprint !== null) keep(result, fingerprint, endedAt);
      });
    } else {
      const wait = reduceWaitRun(run, events);
      if (wait.steps >= MIN_RESULT_STEPS) {
        const result: PracticeResult = {
          runId: run.runId,
          takeId: run.takeId,
          style: 'wait',
          hand: run.hand,
          slowestSpeed: wait.slowestSpeed,
          reason: event.reason,
          wait,
        };
        store.show(result);
        if (fingerprint !== null) keep(result, fingerprint, endedAt);
      }
    }
    store.runEnded(run.runId);
  };

  const unsubscribePractice = subscribePractice(onEvent);
  // A result is about the take it was played on, so opening another puts it away.
  const unsubscribeTakeId = subscribeTakeId((takeId) => store.keepOnlyTake(takeId));
  return {
    dispose() {
      disposed = true;
      unsubscribePractice();
      unsubscribeTakeId();
      for (const along of listening) along.cancel();
      listening.clear();
      current = null;
    },
  };
}

/**
 * A result as its track's results keep it: the share right first time and
 * the steps, waiting for the player; keeping time, the notes played and the
 * share on time, of the notes judged.
 */
function scoreOf(result: PracticeResult, fingerprint: string, at: string): PracticeScore {
  if (result.style === 'wait') {
    const { wait } = result;
    return {
      at,
      accuracy: wait.accuracy,
      speed: result.slowestSpeed,
      notes: wait.steps,
      fingerprint,
    };
  }
  const { keepTime } = result;
  return {
    at,
    accuracy: keepTime.accuracy,
    onTime: keepTime.onTimeShare,
    speed: result.slowestSpeed,
    notes: keepTime.notes,
    fingerprint,
  };
}

let started: PracticeSession | null = null;

/**
 * The app's practice session: the transport's runs, read into the results
 * store, for the take open. Started once, with the other services, and kept
 * for the life of the page; StrictMode runs the providers' effect twice, so a
 * second start changes nothing.
 *
 * The transport tells its listeners from inside its own commands, so this one
 * only takes note: it writes the store, and never calls the transport back.
 * The keys are another matter: a wrong one played along is flashed from the
 * press, which no transport command is in the middle of. A result kept among
 * its track's results is written to the device later still.
 */
export const practiceSession = {
  init(): void {
    started ??= createPracticeSession({
      subscribePractice: (listener) => transportController.subscribePractice(listener),
      // A rename or an edit keeps the take; only another take puts a result away.
      subscribeTakeId: (listener) =>
        useTakeStore.subscribe((state, previous) => {
          if (state.take.id !== previous.take.id) listener(state.take.id);
        }),
      store: usePracticeStore.getState(),
      playAlong: {
        subscribeInput: (listener) => audioEngine.subscribeInput(listener),
        outputLatencyMs: () => audioEngine.getOutputLatencyMs(),
        audioTime: () => audioEngine.currentTime,
        now: () => performance.now(),
        flashWrongKey: (midi) => transportController.flashWrongKey(midi),
      },
      records: {
        openTake: () => {
          const { take } = useTakeStore.getState();
          return { id: take.id, noteCount: take.notes.length, durationMs: take.durationMs };
        },
        trackSummary: (takeId) => libraryTrackSummary(takeId),
        keep: (takeId, mode, score) => recordPracticeScore(takeId, mode, score),
      },
    });
  },
};
