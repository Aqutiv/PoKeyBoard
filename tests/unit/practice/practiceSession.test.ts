import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPracticeSession } from '@/features/practice/practiceSession';
import type { PracticeEvent, PracticeRun, RunEndReason } from '@/features/transport/practiceEvents';
import { usePracticeStore } from '@/state/usePracticeStore';
import { practiceRun } from './practiceFixtures';

/** A stand-in for a subscription: what was subscribed, and a way to send to it. */
function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (listener: (value: T) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    send: (value: T) => {
      for (const listener of listeners) listener(value);
    },
    get size() {
      return listeners.size;
    },
  };
}

const practice = channel<PracticeEvent>();
const takeIds = channel<string>();
let session: { dispose(): void } | null = null;

const start = (run: PracticeRun) => practice.send({ runId: run.runId, type: 'run-start', run });
const step = (runId: number, atMs: number) =>
  practice.send({ runId, type: 'step', atMs, midis: [60] });
const end = (runId: number, reason: RunEndReason = 'end') =>
  practice.send({ runId, type: 'run-end', reason, audioTime: null });

/** A "wait for me" run that plays `steps` steps and ends. */
function playRun(runId: number, steps: number, overrides: Partial<PracticeRun> = {}): void {
  start(practiceRun({ runId, ...overrides }));
  for (let index = 0; index < steps; index += 1) step(runId, index * 500);
  end(runId);
}

const store = () => usePracticeStore.getState();

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
  session = createPracticeSession({
    subscribePractice: practice.subscribe,
    subscribeTakeId: takeIds.subscribe,
    store: usePracticeStore.getState(),
  });
});

afterEach(() => {
  session?.dispose();
  session = null;
});

describe('the practice session', () => {
  it('shows how a "wait for me" run went once it ends', () => {
    start(practiceRun({ runId: 3, takeId: 'scale', hand: 'left', speed: 0.6 }));
    expect(store().live).toEqual({ runId: 3, takeId: 'scale', style: 'wait' });
    step(3, 0);
    step(3, 500);
    expect(store().result).toBeNull();

    end(3, 'pause');
    expect(store().live).toBeNull();
    expect(store().result).toMatchObject({
      runId: 3,
      takeId: 'scale',
      style: 'wait',
      hand: 'left',
      slowestSpeed: 0.6,
      reason: 'pause',
      wait: { steps: 2, rightFirstTime: 2 },
    });
  });

  it('has nothing to show for a run of one step', () => {
    start(practiceRun({ runId: 1 }));
    expect(store().live?.runId).toBe(1);
    step(1, 0);
    end(1);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
  });

  it('puts the card away when the next run starts', () => {
    playRun(1, 2);
    expect(store().result).not.toBeNull();

    start(practiceRun({ runId: 2 }));
    expect(store().result).toBeNull();
  });

  it('puts the card away when another take is opened', () => {
    playRun(1, 2, { takeId: 'scale' });
    takeIds.send('scale');
    expect(store().result).not.toBeNull();

    takeIds.send('etude');
    expect(store().result).toBeNull();
  });

  it('ignores events from a run no longer under way', () => {
    start(practiceRun({ runId: 1 }));
    start(practiceRun({ runId: 2 }));
    // The first run's last words, arriving late.
    step(1, 0);
    step(1, 500);
    end(1);
    expect(store().result).toBeNull();
    expect(store().live?.runId).toBe(2);

    step(2, 0);
    end(2);
    // One step of its own: the first run's two were not counted toward it.
    expect(store().result).toBeNull();
  });

  it('has no card of its own for a run played along', () => {
    playRun(1, 2);
    expect(store().result).not.toBeNull();

    start(practiceRun({ runId: 2, style: 'playAlong' }));
    // Playing again puts the last card away, however the run is practised.
    expect(store().live).toEqual({ runId: 2, takeId: 'take', style: 'playAlong' });
    expect(store().result).toBeNull();
    for (let index = 0; index < 4; index += 1) step(2, index * 500);
    end(2);
    expect(store().result).toBeNull();
    expect(store().live).toBeNull();
  });

  it('stops listening once disposed', () => {
    expect(practice.size).toBe(1);
    expect(takeIds.size).toBe(1);
    session?.dispose();
    session = null;
    expect(practice.size).toBe(0);
    expect(takeIds.size).toBe(0);
    playRun(1, 2);
    expect(store().result).toBeNull();
  });
});
