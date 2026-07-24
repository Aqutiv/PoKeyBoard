import { useSettingsStore, type ThemePreference } from '@/state/useSettingsStore';

export type ResolvedTheme = 'dark' | 'light';

/** localStorage mirror of the theme preference, read by the pre-paint
 * script in index.html before the store hydrates from Dexie. */
export const THEME_STORAGE_KEY = 'pokeyboard.theme';

/** Browser-chrome color per resolved theme. Keep in sync with --surface-0
 * in src/themes.css and the pre-paint script in index.html. */
const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#141110',
  light: '#f7f3ea',
};

/** Pure preference → resolved theme. The pre-paint script in index.html
 * duplicates this logic in miniature — keep the two in sync. */
export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'system') return prefersLight ? 'light' : 'dark';
  return 'dark';
}

/**
 * Applies the theme preference to the document: html[data-theme], the
 * theme-color meta, and the localStorage mirror for the pre-paint script.
 * init() deliberately applies nothing — the pre-paint script already set
 * the attribute, and the store still holds pre-hydration defaults until
 * persistence loads; the store subscription reconciles once it emits
 * (persistence.initialize always calls setState, which always notifies).
 */
class ThemeController {
  private resolved: ResolvedTheme = 'dark';
  private media: MediaQueryList | null = null;
  private readonly listeners = new Set<() => void>();
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Trust the pre-paint script's attribute until the store hydrates.
    this.resolved = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

    if (typeof window.matchMedia === 'function') {
      this.media = window.matchMedia('(prefers-color-scheme: light)');
      this.media.addEventListener('change', () => this.update());
    }
    useSettingsStore.subscribe(() => this.update());
  }

  getResolved(): ResolvedTheme {
    return this.resolved;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(): void {
    const preference = useSettingsStore.getState().theme;
    const resolved = resolveTheme(preference, this.media?.matches ?? false);

    if (document.documentElement.dataset.theme !== resolved) {
      document.documentElement.dataset.theme = resolved;
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLORS[resolved]);
    try {
      if (localStorage.getItem(THEME_STORAGE_KEY) !== preference) {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
      }
    } catch {
      // Storage unavailable (private mode) — the pre-paint script simply
      // falls back to dark on the next launch.
    }

    if (resolved !== this.resolved) {
      this.resolved = resolved;
      for (const listener of this.listeners) listener();
    }
  }
}

export const themeController = new ThemeController();
