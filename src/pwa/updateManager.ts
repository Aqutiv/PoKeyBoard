import { Workbox } from 'workbox-window';

/**
 * How stale a visible tab lets its update check get. The browser re-checks the
 * worker on real navigations, and a hash-routed app kept open in one tab — or
 * an installed one resumed from the background — may never make another.
 */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Service-worker registration and the "Update available" flow. A new worker
 * always waits; nothing activates until the user applies the update at a
 * safe time (the UI never offers it mid-recording/playback/export).
 */
class UpdateManager {
  private wb: Workbox | null = null;
  private updateWaiting = false;
  private applying = false;
  private lastCheckAt = 0;
  private readonly listeners = new Set<(updateAvailable: boolean) => void>();

  register(): void {
    if (!import.meta.env.PROD) return;
    if (!('serviceWorker' in navigator)) return;
    if (this.wb) return;

    this.wb = new Workbox(`${import.meta.env.BASE_URL}service-worker.js`);

    this.wb.addEventListener('waiting', () => {
      this.updateWaiting = true;
      this.emit();
    });

    this.wb.addEventListener('controlling', () => {
      // Fires after the waiting worker takes over (post-SKIP_WAITING).
      if (this.applying) window.location.reload();
    });

    void this.wb.register();
    // Registering fetches the worker script, which is a check in itself.
    this.lastCheckAt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkForUpdate();
    });
  }

  /**
   * Ask the server for a newer build, at most once per `minIntervalMs`. A
   * build that arrives still waits for the user like any other; this only
   * keeps "Up to date" from being a guess.
   */
  checkForUpdate(minIntervalMs = UPDATE_CHECK_INTERVAL_MS): void {
    if (!this.wb || this.updateWaiting) return;
    const now = Date.now();
    if (now - this.lastCheckAt < minIntervalMs) return;
    this.lastCheckAt = now;
    this.wb.update().catch(() => {
      // Offline, or the server hiccuped: the next check asks again.
    });
  }

  get updateAvailable(): boolean {
    return this.updateWaiting;
  }

  /** Activate the waiting worker and reload. Call only at a safe moment. */
  applyUpdate(): void {
    if (!this.wb || !this.updateWaiting) return;
    this.applying = true;
    void this.wb.messageSkipWaiting();
  }

  subscribe(listener: (updateAvailable: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.updateWaiting);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.updateWaiting);
  }
}

export const updateManager = new UpdateManager();
