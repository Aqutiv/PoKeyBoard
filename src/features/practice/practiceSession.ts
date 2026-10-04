import { audioEngine } from '@/audio/AudioEngine';
import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import { usePracticeStore, type PracticeState } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { startPlayAlongRun, type PlayAlongDeps, type PlayAlongRun } from './playAlongSession';
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
  store: Pick<PracticeState, 'runStarted' | 'runEnded' | 'show' | 'keepOnlyTake'>;
  /** What a Keep-time run listens to and flashes as it plays; see `startPlayAlongRun`. */
  playAlong: PlayAlongDeps;
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
 */
export function createPracticeSession({
  subscribePractice,
  subscribeTakeId,
  store,
  playAlong,
}: PracticeSessionDeps): PracticeSession {
  /**
   * The run under way: its events so far, or, keeping time, what is listening
   * to it. Null between runs.
   */
  let current: { run: PracticeRun; events: PracticeEvent[]; along: PlayAlongRun | null } | null =
    null;
  /** Keep-time runs still listening: the one under way, and any waiting on late notes. */
  const listening = new Set<PlayAlongRun>();

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
    if (along) {
      // At once, or once its last notes have had time to be played late. The
      // store drops it then if another run has started meanwhile.
      along.end(event, (keepTime) => {
        listening.delete(along);
        if (keepTime.notes < MIN_RESULT_STEPS) return;
        store.show({
          runId: run.runId,
          takeId: run.takeId,
          style: 'playAlong',
          hand: run.hand,
          slowestSpeed: keepTime.slowestSpeed,
          reason: event.reason,
          keepTime,
        });
      });
    } else {
      const wait = reduceWaitRun(run, events);
      if (wait.steps >= MIN_RESULT_STEPS) {
        store.show({
          runId: run.runId,
          takeId: run.takeId,
          style: 'wait',
          hand: run.hand,
          slowestSpeed: wait.slowestSpeed,
          reason: event.reason,
          wait,
        });
      }
    }
    store.runEnded(run.runId);
  };

  const unsubscribePractice = subscribePractice(onEvent);
  // A result is about the take it was played on, so opening another puts it away.
  const unsubscribeTakeId = subscribeTakeId((takeId) => store.keepOnlyTake(takeId));
  return {
    dispose() {
      unsubscribePractice();
      unsubscribeTakeId();
      for (const along of listening) along.cancel();
      listening.clear();
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
    });
  },
};
