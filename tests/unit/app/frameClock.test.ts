import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the browser's frame scheduler, run by hand. */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(next, callback);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  return {
    pending: () => pending.size,
    runFrame(now: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    },
  };
}

describe('the frame clock', () => {
  let frames: ReturnType<typeof fakeFrames>;

  beforeEach(() => {
    vi.resetModules();
    frames = fakeFrames();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs one loop for every subscriber, and none once they have all gone', async () => {
    const { subscribeFrame, frameSubscriberCount } = await import('@/app/frameClock');
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeFrame(a);
    const stopB = subscribeFrame(b);
    expect(frames.pending()).toBe(1);

    frames.runFrame(16);
    expect(a).toHaveBeenCalledWith(16);
    expect(b).toHaveBeenCalledWith(16);
    expect(frames.pending()).toBe(1);

    stopA();
    frames.runFrame(33);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    stopB();
    expect(frameSubscriberCount()).toBe(0);
    expect(frames.pending()).toBe(0);
  });

  it('lets a subscriber stop from inside its own frame', async () => {
    const { subscribeFrame } = await import('@/app/frameClock');
    let stop: () => void = () => {};
    const once = vi.fn(() => stop());
    stop = subscribeFrame(once);
    frames.runFrame(16);
    frames.runFrame(33);
    expect(once).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
  });
});
