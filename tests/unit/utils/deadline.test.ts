import { afterEach, describe, expect, it, vi } from 'vitest';
import { settledWithin, untilAborted } from '@/utils/deadline';

afterEach(() => {
  vi.useRealTimers();
});

const never = <T>() => new Promise<T>(() => undefined);

describe('untilAborted', () => {
  it('passes a settled promise straight through', async () => {
    const controller = new AbortController();
    await expect(untilAborted(Promise.resolve('code'), controller.signal)).resolves.toBe('code');
    await expect(
      untilAborted(Promise.reject(new Error('offline')), controller.signal),
    ).rejects.toThrow('offline');
  });

  it('gives up on one that hangs once the signal aborts', async () => {
    const controller = new AbortController();
    const waiting = untilAborted(never<string>(), controller.signal);
    controller.abort(new Error('deadline'));
    await expect(waiting).rejects.toThrow('deadline');
  });

  it('gives up at once if the signal has aborted already', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));
    await expect(untilAborted(never<string>(), controller.signal)).rejects.toThrow('deadline');
  });
});

describe('settledWithin', () => {
  it('hands over a value that arrives in time', async () => {
    await expect(settledWithin(Promise.resolve('fr'), 1000)).resolves.toBe('fr');
  });

  it('stops waiting at the deadline, and never rejects', async () => {
    vi.useFakeTimers();
    const waiting = settledWithin(never<string>(), 4000);
    vi.advanceTimersByTime(4000);
    await expect(waiting).resolves.toBeUndefined();
    await expect(
      settledWithin(Promise.reject(new Error('offline')), 4000),
    ).resolves.toBeUndefined();
  });
});
