import { Workbox } from 'workbox-window';

/**
 * Service-worker registration and the "Update available" flow. A new worker
 * always waits; nothing activates until the user applies the update at a
 * safe time (the UI never offers it mid-recording/playback/export).
 */
class UpdateManager {
  private wb: Workbox | null = null;
  private updateWaiting = false;
  private applying = false;
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
