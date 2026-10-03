import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistenceService } from '@/data/persistence';
import { transportController } from '@/features/transport/transportController';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('autosave while recording', () => {
  it('saves at most every ten seconds, not at every pause', () => {
    vi.useFakeTimers();
    vi.spyOn(transportController, 'getState').mockReturnValue('recording');
    const flush = vi.spyOn(persistenceService, 'flushSave').mockResolvedValue();
    for (let i = 0; i < 20; i += 1) {
      persistenceService.scheduleSave();
      vi.advanceTimersByTime(900); // a pause longer than the debounce
    }
    // 18 s of playing: one save at 10 s; the next change after it, at 10.8 s,
    // is saved at 20.8 s.
    expect(flush).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_799);
    expect(flush).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('keeps the short debounce otherwise', () => {
    vi.useFakeTimers();
    vi.spyOn(transportController, 'getState').mockReturnValue('idle');
    const flush = vi.spyOn(persistenceService, 'flushSave').mockResolvedValue();
    persistenceService.scheduleSave();
    vi.advanceTimersByTime(500);
    persistenceService.scheduleSave();
    vi.advanceTimersByTime(799);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledOnce();
  });
});
