import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, themeController, THEME_STORAGE_KEY } from '@/app/theme';
import { db } from '@/data/db';
import { loadSettings, saveSettings } from '@/data/settingsRepository';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/state/useSettingsStore';

// jsdom has no matchMedia; the stub below is installed before the singleton
// controller ever calls init(), and stays controllable across tests via the
// module-level `prefersLight` flag (the controller reads `.matches` lazily).
let prefersLight = false;
const mediaListeners = new Set<() => void>();

function installMatchMediaStub(): void {
  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return prefersLight;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => {
        mediaListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        mediaListeners.delete(listener);
      },
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function fireSystemChange(nextPrefersLight: boolean): void {
  prefersLight = nextPrefersLight;
  for (const listener of mediaListeners) listener();
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="theme-color"]');
}

describe('resolveTheme', () => {
  it('maps every preference/matchMedia combination', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('light');
  });
});

describe('themeController', () => {
  beforeEach(() => {
    installMatchMediaStub();
    prefersLight = false;
    document.documentElement.removeAttribute('data-theme');
    themeColorMeta()?.remove();
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', '#141110');
    document.head.append(meta);
    localStorage.clear();
    themeController.init(); // singleton: only the first call wires listeners
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });

  it('applies the dark default once the store emits', () => {
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeController.getResolved()).toBe('dark');
    expect(themeColorMeta()?.getAttribute('content')).toBe('#141110');
  });

  it('switching the preference updates attribute, meta, and mirror', () => {
    useSettingsStore.getState().setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(themeColorMeta()?.getAttribute('content')).toBe('#f7f3ea');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(themeController.getResolved()).toBe('light');
  });

  it('notifies subscribers only when the resolved theme changes', () => {
    let notified = 0;
    const unsubscribe = themeController.subscribe(() => {
      notified += 1;
    });
    useSettingsStore.getState().setTheme('light');
    expect(notified).toBe(1);
    useSettingsStore.getState().setMetronomeVolume(0.5);
    expect(notified).toBe(1);
    unsubscribe();
  });

  it('follows matchMedia changes in system mode without a store write', () => {
    useSettingsStore.getState().setTheme('system');
    expect(themeController.getResolved()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');

    fireSystemChange(true);
    expect(themeController.getResolved()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');

    fireSystemChange(false);
    expect(themeController.getResolved()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('survives a missing theme-color meta', () => {
    themeColorMeta()?.remove();
    useSettingsStore.getState().setTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('theme setting persistence', () => {
  beforeEach(async () => {
    await db.settings.clear();
    useSettingsStore.setState({ ...SETTINGS_DEFAULTS });
  });

  it('defaults to dark', () => {
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('round-trips a chosen theme through the settings repository', async () => {
    useSettingsStore.getState().setTheme('system');
    await saveSettings(useSettingsStore.getState());
    const loaded = await loadSettings();
    expect(loaded.theme).toBe('system');
  });

  it('rejects invalid stored values', async () => {
    await db.settings.put({ key: 'theme', value: 'neon' });
    const loaded = await loadSettings();
    expect(loaded.theme).toBeUndefined();
  });
});
