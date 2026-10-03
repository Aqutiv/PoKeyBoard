import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTake } from '@/domain/noteEvents';
import { practiceSession } from '@/features/practice/practiceSession';
import type { PracticeEvent } from '@/features/transport/practiceEvents';
import { usePracticeStore } from '@/state/usePracticeStore';
import { useTakeStore } from '@/state/useTakeStore';
import { practiceRun } from './practiceFixtures';

/** The transport's practice listeners, as the session subscribes them. */
const h = vi.hoisted(() => ({ listeners: new Set<(event: PracticeEvent) => void>() }));

vi.mock('@/features/transport/transportController', () => ({
  transportController: {
    subscribePractice: (listener: (event: PracticeEvent) => void) => {
      h.listeners.add(listener);
      return () => h.listeners.delete(listener);
    },
  },
}));

function send(event: PracticeEvent): void {
  for (const listener of [...h.listeners]) listener(event);
}

/** A "wait for me" run on the take open, of two steps played in flow. */
function playRun(runId: number): void {
  const run = practiceRun({ runId, takeId: useTakeStore.getState().take.id });
  send({ runId, type: 'run-start', run });
  send({ runId, type: 'step', atMs: 0, midis: [60] });
  send({ runId, type: 'step', atMs: 500, midis: [64] });
  send({ runId, type: 'run-end', reason: 'end', audioTime: null });
}

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
  useTakeStore.getState().setTake(createEmptyTake());
});

describe('the app’s practice session', () => {
  it('collects the transport’s runs once, however often it is started', () => {
    // StrictMode runs the providers' effect twice.
    practiceSession.init();
    practiceSession.init();
    expect(h.listeners.size).toBe(1);

    playRun(1);
    expect(usePracticeStore.getState().result).toMatchObject({
      runId: 1,
      wait: { steps: 2, rightFirstTime: 2 },
    });
  });

  it('keeps a result through edits to its take, and puts it away when another opens', () => {
    practiceSession.init();
    playRun(2);
    useTakeStore.getState().setTitle('Scales');
    expect(usePracticeStore.getState().result?.runId).toBe(2);

    useTakeStore.getState().setTake(createEmptyTake());
    expect(usePracticeStore.getState().result).toBeNull();
  });
});
