import { audioEngine } from '@/audio/AudioEngine';
import { prunePracticeRecords, recordPracticeScore } from '@/data/practiceResultsRepository';
import { libraryTrackSummary } from '@/features/library/catalog';
import type { PracticeEvent, PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import {
  usePracticeStore,
  type OpenTake,
  type PracticeResult,
  type PracticeState,
} from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { startPlayAlongRun, type PlayAlongDeps, type PlayAlongRun } from './playAlongSession';
import {
  isCompleteRun,
  practiceModeKey,
  takeContent,
  trackFingerprint,
  type PracticeModeKey,
  type PracticeScore,
  type ResultRecord,
} from './practiceRecords';
import { sameBarGrid } from './resultCells';
import { reduceWaitRun } from './trainingReport';

/**
 * Fewest steps a run needs for its result to be shown. One note right or
 * wrong is plain from the keys already; a card for it would only be in the way.
 */
export const MIN_RESULT_STEPS = 2;

export interface PracticeSessionDeps {
  /** The transport's practice runs, as they happen. */
  subscribePractice(listener: (event: PracticeEvent) => void): () => void;
  /** Hears the open take change: another take, a new tempo, or new notes. */
  subscribeTake(listener: (take: OpenTake, previous: OpenTake) => void): () => void;
  store: Pick<
    PracticeState,
    'runStarted' | 'runEnded' | 'show' | 'keepOnlyTake' | 'dismiss' | 'attachRecord'
  >;
  /** What a Keep-time run listens to and flashes as it plays; see `startPlayAlongRun`. */
  playAlong: PlayAlongDeps;
  /** Where a run through the whole of a Library track is kept; see `PracticeRecordDeps`. */
  records: PracticeRecordDeps;
}

/** What keeping a run's result among its track's results needs; injected, for the tests. */
export interface PracticeRecordDeps {
  /**
   * The take open now: its id, how many notes and milliseconds it has, and
   * its notes as `takeContent` digests them.
   */
  openTake(): { id: string; noteCount: number; durationMs: number; content: string };
  /** A Library track's catalog entry, by its take id, or none for a take of the user's. */
  trackSummary(takeId: string): { noteCount: number; durationMs: number } | undefined;
  /** Keep a score among its track's results, and say what its best and last are now. */
  keep(takeId: string, mode: PracticeModeKey, score: PracticeScore): Promise<ResultRecord>;
  /** Put away a track's results of notes other than `content`'s: `prunePracticeRecords`. */
  prune(takeId: string, content: string): Promise<boolean>;
}

/** The track a result is kept for, as it was: the catalog's count and length, and its notes. */
interface KeptTrack {
  fingerprint: string;
  content: string;
}

export interface PracticeSession {
  dispose(): void;
}

/** A run being read into its result. */
interface Reading {
  run: PracticeRun;
  /** A "wait for me" run's events so far. */
  events: PracticeEvent[];
  /** What is listening to a Keep-time run's keys; null for a run that waits. */
  along: PlayAlongRun | null;
  /** The take changed under the run in a way its result could not describe. */
  spoiled: boolean;
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
 * at once, and how it stands against the track's best a moment after, once
 * that is known. A run with no result to show, spoiled or too short, is kept
 * no more than it is shown.
 */
export function createPracticeSession({
  subscribePractice,
  subscribeTake,
  store,
  playAlong,
  records,
}: PracticeSessionDeps): PracticeSession {
  /** The run under way; null between runs. */
  let current: Reading | null = null;
  /** Keep-time runs that have ended, listening on for their last notes played late. */
  const finishing = new Set<Reading>();
  /** Once disposed, a result kept late has nowhere to go. */
  let disposed = false;

  /**
   * The track a run's result is kept for, or null for a run that is not one to
   * keep. Only a run through the whole of a Library track counts
   * (`isCompleteRun`), on the notes the catalog has for it, with that track
   * still open, as it was, when the run ended: its notes, read off the take
   * then, say which version of the track it was. A run on notes the catalog
   * does not describe means a classics manifest out of date with its scores,
   * which is worth a warning; any other run is simply not one to keep.
   */
  const trackToKeep = (run: PracticeRun, reason: RunEndReason): KeptTrack | null => {
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
    return unchanged ? { fingerprint: trackFingerprint(summary), content: open.content } : null;
  };

  /**
   * Keep `result` among its track's results, then add the track's best and
   * last to it, if it is still the result shown. In the background: a write
   * that fails costs the record, never the card.
   */
  const keep = (result: PracticeResult, track: KeptTrack, at: string): void => {
    const mode = practiceModeKey(result.style, result.hand);
    records.keep(result.takeId, mode, scoreOf(result, track, at)).then(
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
      current?.along?.cancel();
      const { run } = event;
      const along = run.style === 'playAlong' ? startPlayAlongRun(run, playAlong) : null;
      current = { run, events: [], along, spoiled: false };
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
    const reading = current;
    const { run, events, along } = reading;
    current = null;
    // Whether the run is one to keep is settled as it ends: by the time a
    // Keep-time run's late notes are in, another take may be open.
    const track = reading.spoiled ? null : trackToKeep(run, event.reason);
    const endedAt = new Date().toISOString();
    if (along) {
      // At once, or once its last notes have had time to be played late. The
      // store drops it then if another run has started meanwhile, but a run
      // through the track is kept all the same, unless the take changed under
      // it meanwhile.
      finishing.add(reading);
      along.end(event, (keepTime) => {
        finishing.delete(reading);
        if (reading.spoiled || keepTime.notes < MIN_RESULT_STEPS) return;
        const result: PracticeResult = {
          runId: run.runId,
          takeId: run.takeId,
          style: 'playAlong',
          hand: run.hand,
          slowestSpeed: keepTime.slowestSpeed,
          reason: event.reason,
          tempo: run.tempo,
          keepTime,
        };
        store.show(result);
        if (track !== null) keep(result, track, endedAt);
      });
    } else if (!reading.spoiled) {
      const wait = reduceWaitRun(run, events);
      if (wait.steps >= MIN_RESULT_STEPS) {
        const result: PracticeResult = {
          runId: run.runId,
          takeId: run.takeId,
          style: 'wait',
          hand: run.hand,
          slowestSpeed: wait.slowestSpeed,
          reason: event.reason,
          tempo: run.tempo,
          wait,
        };
        store.show(result);
        if (track !== null) keep(result, track, endedAt);
      }
    }
    store.runEnded(run.runId);
  };

  const unsubscribePractice = subscribePractice(onEvent);
  // A result is about the take it was played on, as it was: opening another
  // take puts it away, and so does a tempo that moves its bars. A recording
  // pass, a clear or an undo writes the take new notes, and counts made of the
  // old ones no longer describe it. The same edits made while a run is under
  // way, a tempo at a hold or an Undo pass, spoil the result it would have, as
  // they do a Keep-time run's still waiting on its last notes: it has no result
  // yet for the store to put away.
  const unsubscribeTake = subscribeTake((take, previous) => {
    store.keepOnlyTake(take);
    if (take.notes !== previous.notes) store.dismiss();
    // A Library track just opened puts away its results of notes it no longer
    // has, so the Library's chip, which cannot see a track's notes without
    // fetching its score, never shows them again. Only once it is open, its
    // notes all there: a score still loading has nothing to compare yet.
    if (take.id !== previous.id && records.trackSummary(take.id)) {
      records
        .prune(take.id, takeContent(take.notes))
        .catch((error: unknown) =>
          console.error('Putting away a track’s practice results failed:', error),
        );
    }
    for (const reading of current ? [current, ...finishing] : finishing) {
      if (
        take.id !== reading.run.takeId ||
        take.notes !== previous.notes ||
        !sameBarGrid(reading.run.tempo, take.tempo)
      ) {
        reading.spoiled = true;
      }
    }
  });
  return {
    dispose() {
      disposed = true;
      unsubscribePractice();
      unsubscribeTake();
      current?.along?.cancel();
      for (const reading of finishing) reading.along?.cancel();
      finishing.clear();
      current = null;
    },
  };
}

/**
 * A result as its track's results keep it: the share right first time and
 * the steps, waiting for the player; keeping time, the notes played and the
 * share on time, of the notes judged.
 */
function scoreOf(result: PracticeResult, track: KeptTrack, at: string): PracticeScore {
  if (result.style === 'wait') {
    const { wait } = result;
    return {
      at,
      accuracy: wait.accuracy,
      speed: result.slowestSpeed,
      notes: wait.steps,
      ...track,
    };
  }
  const { keepTime } = result;
  return {
    at,
    accuracy: keepTime.accuracy,
    onTime: keepTime.onTimeShare,
    speed: result.slowestSpeed,
    notes: keepTime.notes,
    ...track,
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
      // Another take, a new tempo, or new notes. A rename, a level or the
      // playhead leaves all three as they were, and is never heard.
      subscribeTake: (listener) =>
        useTakeStore.subscribe(({ take }, { take: before }) => {
          if (take.id !== before.id || take.tempo !== before.tempo || take.notes !== before.notes) {
            listener(take, before);
          }
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
          return {
            id: take.id,
            noteCount: take.notes.length,
            durationMs: take.durationMs,
            content: takeContent(take.notes),
          };
        },
        trackSummary: (takeId) => libraryTrackSummary(takeId),
        keep: (takeId, mode, score) => recordPracticeScore(takeId, mode, score),
        prune: (takeId, content) => prunePracticeRecords(takeId, content),
      },
    });
  },
};
