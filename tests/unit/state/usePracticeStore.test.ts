import { beforeEach, describe, expect, it } from 'vitest';
import { usePracticeStore } from '@/state/usePracticeStore';
import { keepTimeResult, TEMPO, waitResult } from '../practice/practiceFixtures';

const store = () => usePracticeStore.getState();

beforeEach(() => {
  usePracticeStore.setState({ result: null, live: null, latestRunId: null });
});

describe('the practice results store', () => {
  it('starts with no run and nothing to show', () => {
    expect(store().live).toBeNull();
    expect(store().result).toBeNull();
  });

  it('holds a run while it lasts, and its result after', () => {
    store().runStarted(1, 'take', 'wait');
    expect(store().live).toEqual({ runId: 1, takeId: 'take', style: 'wait' });

    const result = waitResult({ runId: 1 });
    store().show(result);
    store().runEnded(1);
    expect(store().live).toBeNull();
    expect(store().result).toBe(result);
  });

  it('holds where a Keep-time run’s presses land while it lasts, and its result after', () => {
    store().runStarted(3, 'take', 'playAlong', 7180);
    expect(store().live).toEqual({
      runId: 3,
      takeId: 'take',
      style: 'playAlong',
      pressOriginMs: 7180,
    });

    const result = keepTimeResult({ runId: 3 });
    store().show(result);
    store().runEnded(3);
    expect(store().live).toBeNull();
    expect(store().result).toBe(result);
  });

  it('puts a result away when the next run starts', () => {
    store().runStarted(1, 'take', 'wait');
    store().show(waitResult({ runId: 1 }));
    store().runEnded(1);

    store().runStarted(2, 'take', 'wait');
    expect(store().result).toBeNull();
    expect(store().live?.runId).toBe(2);
  });

  it('ends only the run that ended', () => {
    store().runStarted(2, 'take', 'wait');
    store().runEnded(1);
    expect(store().live?.runId).toBe(2);
  });

  it('drops a result that arrives after a newer run started', () => {
    store().runStarted(1, 'take', 'wait');
    store().runStarted(2, 'take', 'wait');
    store().show(waitResult({ runId: 1 }));
    expect(store().result).toBeNull();

    // Even once the newer run is over; its own result still shows.
    store().runEnded(2);
    store().show(waitResult({ runId: 1 }));
    expect(store().result).toBeNull();
    store().show(waitResult({ runId: 2 }));
    expect(store().result?.runId).toBe(2);
  });

  it('puts a result away when dismissed', () => {
    store().show(waitResult());
    expect(store().result).not.toBeNull();
    store().dismiss();
    expect(store().result).toBeNull();
  });

  it('keeps a result only while its take is the one open', () => {
    const result = waitResult({ takeId: 'take' });
    store().show(result);
    store().keepOnlyTake({ id: 'take', tempo: TEMPO });
    expect(store().result).toBe(result);

    store().keepOnlyTake({ id: 'another', tempo: TEMPO });
    expect(store().result).toBeNull();
  });

  it('keeps a result only while its take keeps the bars it was scored on', () => {
    store().show(waitResult({ takeId: 'take' }));
    // The same values in a tempo built afresh, and a count-in, keep the bars.
    store().keepOnlyTake({ id: 'take', tempo: { ...TEMPO, countInBars: 0, changes: [] } });
    expect(store().result).not.toBeNull();

    store().keepOnlyTake({ id: 'take', tempo: { ...TEMPO, bpm: 90 } });
    expect(store().result).toBeNull();
  });

  it('puts a Keep-time result away when its bars move, as any result', () => {
    store().show(keepTimeResult({ takeId: 'take' }));
    store().keepOnlyTake({ id: 'take', tempo: { ...TEMPO, countInBars: 2 } });
    expect(store().result).not.toBeNull();

    store().keepOnlyTake({ id: 'take', tempo: { ...TEMPO, bpm: 90 } });
    expect(store().result).toBeNull();
  });
});
