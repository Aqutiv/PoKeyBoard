import { audioEngine } from '@/audio/AudioEngine';
import { roomTailSeconds } from '@/audio/reverbImpulse';
import { ALL_NOTES_OFF_S } from '@/audio/VoiceManager';
import { scrubController } from '@/features/notation/scrubController';
import { transportController } from '@/features/transport/transportController';
import { isBusyState } from '@/features/transport/transportMachine';
import { useSettingsStore } from '@/state/useSettingsStore';

/** Stable id for the interruption banner, translated at the render site. */
export type InterruptionMessageKey = 'recordingInterrupted';

export interface InterruptionSnapshot {
  message: InterruptionMessageKey | null;
}

/**
 * App lifecycle: pause and save safely when the page hides, never blast
 * audio on return, surface interrupted recordings, and hold a screen wake
 * lock (progressive enhancement only) while the transport is busy.
 */
class LifecycleService {
  private snapshot: InterruptionSnapshot = { message: null };
  private readonly listeners = new Set<() => void>();
  private wakeLock: WakeLockSentinel | null = null;
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const onHidden = () => {
      const state = transportController.getState();
      const wasRecording = state === 'recording' || state === 'countIn';
      const keepPlaying = state === 'playing' && useSettingsStore.getState().backgroundPlayback;
      if (keepPlaying) return;
      if (scrubController.isActive) scrubController.end();
      transportController.handleInterruption();
      audioEngine.allNotesOff();
      if (wasRecording) {
        this.setMessage('recordingInterrupted');
      }
      // Nothing left to play: once the last release and the room's tail have
      // died away, the audio device sleeps until the page is back. A practice
      // click left running keeps it awake, as it always has.
      audioEngine.sleepAfter(
        ALL_NOTES_OFF_S + roomTailSeconds(audioEngine.getReverbRoom()),
        () =>
          document.visibilityState === 'hidden' &&
          !isBusyState(transportController.getState()) &&
          !transportController.isMetronomeOn(),
      );
      // Autosave flushes via its own visibilitychange listener.
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHidden();
      // On return: no automatic sound — waking is silent, every note having
      // been let go — and a key pressed straight away sounds on time.
      else audioEngine.wake();
    });
    window.addEventListener('pagehide', onHidden);

    // Wake lock follows transport busyness.
    transportController.subscribeState(() => {
      const busy = isBusyState(transportController.getState());
      if (busy) this.acquireWakeLock();
      else this.releaseWakeLock();
    });
  }

  getSnapshot(): InterruptionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dismissMessage(): void {
    this.setMessage(null);
  }

  private setMessage(message: InterruptionMessageKey | null): void {
    this.snapshot = { message };
    for (const listener of this.listeners) listener();
  }

  private acquireWakeLock(): void {
    if (this.wakeLock || !('wakeLock' in navigator)) return;
    navigator.wakeLock
      .request('screen')
      .then((sentinel) => {
        this.wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.wakeLock === sentinel) this.wakeLock = null;
        });
      })
      .catch(() => {
        // Enhancement only — correctness never depends on it.
      });
  }

  private releaseWakeLock(): void {
    const sentinel = this.wakeLock;
    this.wakeLock = null;
    void sentinel?.release().catch(() => undefined);
  }
}

export const lifecycleService = new LifecycleService();
