import { describe, expect, it, vi } from 'vitest';
import { loadOnce } from '@/utils/loadOnce';

describe('loadOnce', () => {
  it('starts the load on the first call and shares it with every later one', async () => {
    const load = vi.fn(() => Promise.resolve('page'));
    const get = loadOnce(load);
    const first = get();
    expect(get()).toBe(first);
    await expect(first).resolves.toBe('page');
    expect(get()).toBe(first);
    expect(load).toHaveBeenCalledOnce();
  });

  it('forgets a failure, so the next call tries again', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('page');
    const get = loadOnce(load);
    await expect(get()).rejects.toThrow('offline');
    await expect(get()).resolves.toBe('page');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
