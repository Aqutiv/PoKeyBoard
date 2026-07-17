import { isStandaloneDisplayMode } from '@/audio/audioCapabilities';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pokeyboard.installDismissedAt';
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Install-prompt handling. Captures beforeinstallprompt where the browser
 * offers one; elsewhere (e.g. iOS Safari) the UI shows manual Add-to-Home-
 * Screen instructions instead — there is no programmatic prompt on iOS.
 */
class InstallService {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed = isStandaloneDisplayMode();
  private readonly listeners = new Set<() => void>();

  init(): void {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferred = event as BeforeInstallPromptEvent;
      this.emit();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.installed = true;
      this.emit();
    });
  }

  get isStandalone(): boolean {
    return this.installed;
  }

  /** True when a native prompt is available and the user hasn't recently declined. */
  get canPromptInstall(): boolean {
    return this.deferred !== null && !this.recentlyDismissed();
  }

  /** True when install exists but only via the browser's own menu (e.g. iOS). */
  get needsManualInstructions(): boolean {
    return !this.installed && this.deferred === null;
  }

  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const event = this.deferred;
    if (!event) return 'unavailable';
    this.deferred = null;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'dismissed') {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        // Storage unavailable — cooldown just won't persist.
      }
    }
    this.emit();
    return choice.outcome;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private recentlyDismissed(): boolean {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const installService = new InstallService();
