import { audioEngine } from '@/audio/AudioEngine';
import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import { usePracticeStore, type OpenTake, type PracticeState } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { startPlayAlongRun, type PlayAlongDeps, type PlayAlongRun } from './playAlongSession';
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
  store: Pick<PracticeState, 'runStarted' | 'runEnded' | 'show' | 'keepOnlyTake' | 'dismiss'>;
  /** What a Keep-time run listens to and flashes as it plays; see `startPlayAlongRun`. */
  playAlong: PlayAlongDeps;
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
 */
export function createPracticeSession({
  subscribePractice,
  subscribeTake,
  store,
  playAlong,
}: PracticeSessionDeps): PracticeSession {
  /** The run under way; null between runs. */
  let current: Reading | null = null;
  /** Keep-time runs that have ended, listening on for their last notes played late. */
  const finishing = new Set<Reading>();

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
    if (along) {
      // At once, or once its last notes have had time to be played late. The
      // store drops it then if another run has started meanwhile.
      finishing.add(reading);
      along.end(event, (keepTime) => {
        finishing.delete(reading);
        if (reading.spoiled || keepTime.notes < MIN_RESULT_STEPS) return;
        store.show({
          runId: run.runId,
          takeId: run.takeId,
          style: 'playAlong',
          hand: run.hand,
          slowestSpeed: keepTime.slowestSpeed,
          reason: event.reason,
          tempo: run.tempo,
          keepTime,
        });
      });
    } else if (!reading.spoiled) {
      const wait = reduceWaitRun(run, events);
      if (wait.steps >= MIN_RESULT_STEPS) {
        store.show({
          runId: run.runId,
          takeId: run.takeId,
          style: 'wait',
          hand: run.hand,
          slowestSpeed: wait.slowestSpeed,
          reason: event.reason,
          tempo: run.tempo,
          wait,
        });
      }
    }
    store.runEnded(run.runId);
  };

  const unsubscribePractice = subscribePractice(onEvent);
  // A result is about the take it was played on, as it was: opening another
  // take puts it away, and so does a tempo that moves its bars. A recording
  // pass, a clear or an undo writes the take new notes, and counts made of the
  // old ones no longer describe it. The same edits made while a run is under
  // way, a tempo at a hold or an Undo pass, spoil the result it would have.
  const unsubscribeTake = subscribeTake((take, previous) => {
    store.keepOnlyTake(take);
    if (take.notes !== previous.notes) store.dismiss();
    if (
      current &&
      (take.id !== current.run.takeId ||
        take.notes !== previous.notes ||
        !sameBarGrid(current.run.tempo, take.tempo))
    ) {
      current.spoiled = true;
    }
  });
  return {
    dispose() {
      unsubscribePractice();
      unsubscribeTake();
      current?.along?.cancel();
      for (const reading of finishing) reading.along?.cancel();
      finishing.clear();
      current = null;
    },
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
 * press, which no transport command is in the middle of.
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
    });
  },
};
