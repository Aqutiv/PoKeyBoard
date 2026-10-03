import type { PracticeEvent, PracticeRun } from '@/features/transport/practiceEvents';
import type { PracticeState } from '@/state/usePracticeStore';
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
  subscribeTakeId,
  store,
}: PracticeSessionDeps): PracticeSession {
  /** The run under way and its events so far; null between runs. */
  let current: { run: PracticeRun; events: PracticeEvent[] } | null = null;

  const onEvent = (event: PracticeEvent): void => {
    if (event.type === 'run-start') {
      current = { run: event.run, events: [] };
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
    const { run, events } = current;
    current = null;
    if (run.style === 'wait') {
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
      current = null;
    },
  };
}
