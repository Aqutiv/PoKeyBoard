import type { PlaybackLoop } from '@/domain/takeTypes';

/** A loop shorter than this is no passage at all, and is not played round. */
export const MIN_LOOP_MS = 100;

export interface ClockRun {
  /** Take milliseconds per audio millisecond: 0.5 plays at half speed. */
  rate?: number;
  /** The passage to play round and round, or none. */
  loop?: PlaybackLoop | null;
}

/**
 * Maps between the audio-context clock (seconds) and take time (ms). The
 * audio clock is the single timing authority; React never owns time.
 *
 * A run can go slower or faster than the take (`rate`), and can repeat a
 * passage (`loop`). Looping makes take time fold back on itself, so this also
 * keeps the *unwrapped* timeline a run actually plays — virtual time, which
 * keeps growing through every pass. Virtual and take time agree until the
 * first time the run reaches the loop's end; pass `p` after that plays take
 * time `t` at virtual time `t + p × (end − start)`. Anything scheduling ahead
 * (notes, clicks) works in virtual time, where the future is never ambiguous.
 */
export class TransportClock {
  private anchorAudioTime = 0;
  private anchorTakeMs = 0;
  private running = false;
  private runRate = 1;
  private runLoop: PlaybackLoop | null = null;
  private readonly now: () => number;

  /** `now` returns the current audio-context time in seconds. */
  constructor(now: () => number) {
    this.now = now;
  }

  /**
   * Begin advancing from `takeMs`, anchored at audio time `atAudioTime`
   * (default: now). A loop only folds time from its end on, so a run that
   * starts before it plays into it; starting past its end is the caller's to
   * avoid.
   */
  start(takeMs: number, atAudioTime?: number, run: ClockRun = {}): void {
    this.anchorTakeMs = takeMs;
    this.anchorAudioTime = atAudioTime ?? this.now();
    this.runRate = run.rate ?? 1;
    this.runLoop = run.loop ?? null;
    this.running = true;
  }

  /**
   * Change the rate or the loop of a running clock from now on. The position
   * carries straight on; virtual time starts again from it, as if the run had
   * just started there.
   */
  retime(run: ClockRun): void {
    if (!this.running) return;
    const now = this.now();
    this.anchorTakeMs = this.fold(this.virtualMsAt(now));
    this.anchorAudioTime = now;
    if (run.rate !== undefined) this.runRate = run.rate;
    if (run.loop !== undefined) this.runLoop = run.loop;
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
    return this.fold(this.virtualMsAt(this.now()));
  }

  /** Where the run is on its unwrapped timeline; see the class note. */
  currentVirtualMs(): number {
    if (!this.running) return this.anchorTakeMs;
    return this.virtualMsAt(this.now());
  }

  /** Audio-context time at which the run reaches `virtualMs` (while running). */
  audioTimeForVirtualMs(virtualMs: number): number {
    return this.anchorAudioTime + (virtualMs - this.anchorTakeMs) / 1000 / this.runRate;
  }

  /** The run's virtual time at an audio-context timestamp (while running). */
  virtualMsForAudioTime(audioTime: number): number {
    return this.virtualMsAt(audioTime);
  }

  /**
   * Audio-context time at which the given take time occurs (while running),
   * on its first pass: before a loop repeats anything, the only one there is.
   */
  audioTimeForTakeMs(takeMs: number): number {
    return this.audioTimeForVirtualMs(takeMs);
  }

  /** Take time corresponding to an audio-context timestamp (while running). */
  takeMsForAudioTime(audioTime: number): number {
    return this.fold(this.virtualMsAt(audioTime));
  }

  get isRunning(): boolean {
    return this.running;
  }

  get rate(): number {
    return this.runRate;
  }

  get loop(): PlaybackLoop | null {
    return this.runLoop;
  }

  private virtualMsAt(audioTime: number): number {
    return this.anchorTakeMs + (audioTime - this.anchorAudioTime) * 1000 * this.runRate;
  }

  /** Virtual time back to take time: past the loop's end, round again. */
  private fold(virtualMs: number): number {
    return this.runLoop ? foldIntoLoop(this.runLoop, virtualMs) : virtualMs;
  }
}

/** Which pass of `loop` virtual time `virtualMs` falls in: 0 until its first end. */
export function loopPassAt(loop: PlaybackLoop, virtualMs: number): number {
  if (virtualMs < loop.endMs) return 0;
  return 1 + Math.floor((virtualMs - loop.endMs) / (loop.endMs - loop.startMs));
}

/** The take time virtual time `virtualMs` plays, folded round `loop`. */
export function foldIntoLoop(loop: PlaybackLoop, virtualMs: number): number {
  if (virtualMs < loop.endMs) return virtualMs;
  const length = loop.endMs - loop.startMs;
  return loop.startMs + ((virtualMs - loop.endMs) % length);
}
