import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import { transportController } from '@/features/transport/transportController';
import { usePracticeStore, type OpenTake, type PracticeState } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
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
}

export interface PracticeSession {
  dispose(): void;
}

/**
 * Collects each practice run's events and, when the run ends, its result.
 * Outside React, so a run is read exactly once — a card mounting twice, as
 * StrictMode mounts it, or not at all, on another route, changes nothing.
 *
 * Only "wait for me" runs are read for now. A run played along still puts
 * the last card away while it plays, since the card is about the run before.
 */
export function createPracticeSession({
  subscribePractice,
  subscribeTake,
  store,
}: PracticeSessionDeps): PracticeSession {
  /**
   * The run under way and its events so far; null between runs. `spoiled`
   * once the take changed under it in a way its result could not describe.
   */
  let current: { run: PracticeRun; events: PracticeEvent[]; spoiled: boolean } | null = null;

  const onEvent = (event: PracticeEvent): void => {
    if (event.type === 'run-start') {
      current = { run: event.run, events: [], spoiled: false };
      store.runStarted(event.runId, event.run.takeId, event.run.style);
      return;
    }
    // A run already over, or one that started before anyone was listening,
    // has nothing to add to the run under way.
    if (!current || event.runId !== current.run.runId) return;
    if (event.type !== 'run-end') {
      if (current.run.style === 'wait') current.events.push(event);
      return;
    }
    const { run, events, spoiled } = current;
    current = null;
    if (run.style === 'wait' && !spoiled) {
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
    });
  },
};
