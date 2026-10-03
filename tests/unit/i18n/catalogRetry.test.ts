import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('@/i18n/es');
  vi.resetModules();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a catalog that fails to arrive', () => {
  it('is asked for again when the connection comes back, and announced when it arrives', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('@/i18n/es', async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return { es: { nav: { play: 'Tocar' } } };
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const i18n = await import('@/i18n');
    const heard = vi.fn();
    i18n.subscribeCatalogs(heard);

    // Offline: English meanwhile, and nothing announced.
    const first = await i18n.loadCatalog('es');
    expect(first.nav.play).toBe('Play');
    expect(i18n.loadedCatalog('es')).toBeUndefined();
    expect(heard).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(i18n.loadedCatalog('es')).toBeDefined());
    expect(heard).toHaveBeenCalledOnce();
    expect(attempts).toBe(2);
  });

  it('is asked for again in a while even if no connection event comes', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let attempts = 0;
    vi.doMock('@/i18n/es', async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return { es: { nav: { play: 'Tocar' } } };
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const i18n = await import('@/i18n');
    await i18n.loadCatalog('es');
    expect(i18n.loadedCatalog('es')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(i18n.loadedCatalog('es')).toBeDefined());
  });
});
