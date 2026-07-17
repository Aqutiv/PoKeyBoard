/**
 * Maps between the audio-context clock (seconds) and take time (ms). The
 * audio clock is the single timing authority; React never owns time.
 */
export class TransportClock {
  private anchorAudioTime = 0;
  private anchorTakeMs = 0;
  private running = false;
  private readonly now: () => number;

  /** `now` returns the current audio-context time in seconds. */
  constructor(now: () => number) {
    this.now = now;
  }

  /** Begin advancing from `takeMs`, anchored at audio time `atAudioTime` (default: now). */
  start(takeMs: number, atAudioTime?: number): void {
    this.anchorTakeMs = takeMs;
    this.anchorAudioTime = atAudioTime ?? this.now();
    this.running = true;
  }

  /** Freeze at the current position. */
  pause(): void {
    if (!this.running) return;
    this.anchorTakeMs = this.currentTakeMs();
    this.running = false;
  }

  /** Move the frozen position (invalid while running). */
  seek(takeMs: number): void {
    this.anchorTakeMs = takeMs;
    if (this.running) this.anchorAudioTime = this.now();
  }

  currentTakeMs(): number {
    if (!this.running) return this.anchorTakeMs;
    return this.anchorTakeMs + (this.now() - this.anchorAudioTime) * 1000;
  }

  /** Audio-context time at which the given take time occurs (while running). */
  audioTimeForTakeMs(takeMs: number): number {
    return this.anchorAudioTime + (takeMs - this.anchorTakeMs) / 1000;
  }

  /** Take time corresponding to an audio-context timestamp (while running). */
  takeMsForAudioTime(audioTime: number): number {
    return this.anchorTakeMs + (audioTime - this.anchorAudioTime) * 1000;
  }

  get isRunning(): boolean {
    return this.running;
  }
}
