import type { TimeSignature } from '@/domain/takeTypes';
import { beatDurationMs } from '@/utils/timing';

export interface MetronomeConfig {
  bpm: number;
  timeSignature: TimeSignature;
  volume: number;
}

const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;
const ACCENT_FREQ = 1660;
const BEAT_FREQ = 1108;
const CLICK_DECAY_S = 0.045;

/**
 * Scheduled-ahead metronome on the audio-context clock (never a raw
 * setInterval as the timing source — the interval only tops up the schedule).
 * Also provides static click scheduling for offline export rendering.
 */
export class MetronomeEngine {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private config: MetronomeConfig = {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    volume: 0.6,
  };

  private timer: ReturnType<typeof setInterval> | null = null;
  private startAudioTime = 0;
  private nextBeatIndex = 0;
  private running = false;

  attach(context: AudioContext): void {
    if (this.context === context) return;
    this.context = context;
    this.gain = context.createGain();
    this.gain.gain.value = this.config.volume;
    // Own output path: independent of piano master volume and reverb.
    this.gain.connect(context.destination);
  }

  configure(config: Partial<MetronomeConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.gain && config.volume !== undefined && this.context) {
      this.gain.gain.setTargetAtTime(config.volume, this.context.currentTime, 0.02);
    }
  }

  getConfig(): MetronomeConfig {
    return this.config;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get beatMs(): number {
    return beatDurationMs(this.config.bpm, this.config.timeSignature);
  }

  /**
   * Start clicking with beat 0 exactly at `atAudioTime` (defaults to a beat
   * from now). Returns the audio time of beat 0 so callers can align
   * count-ins and recording starts to it.
   */
  start(atAudioTime?: number): number {
    if (!this.context || !this.gain) return 0;
    this.stop();
    this.startAudioTime = atAudioTime ?? this.context.currentTime + 0.05;
    this.nextBeatIndex = 0;
    this.running = true;
    this.scheduleWindow();
    this.timer = setInterval(() => this.scheduleWindow(), LOOKAHEAD_INTERVAL_MS);
    return this.startAudioTime;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /** Beat index at an audio time (fractional; negative before start). */
  beatAt(audioTime: number): number {
    if (!this.running) return -1;
    return ((audioTime - this.startAudioTime) * 1000) / this.beatMs;
  }

  private scheduleWindow(): void {
    const context = this.context;
    const gain = this.gain;
    if (!context || !gain || !this.running) return;
    const beatS = this.beatMs / 1000;
    const horizon = context.currentTime + SCHEDULE_AHEAD_S;
    for (;;) {
      const beatTime = this.startAudioTime + this.nextBeatIndex * beatS;
      if (beatTime > horizon) break;
      if (beatTime >= context.currentTime - 0.01) {
        const accent = this.nextBeatIndex % this.config.timeSignature.numerator === 0;
        scheduleClick(context, gain, beatTime, accent);
      }
      this.nextBeatIndex += 1;
    }
  }
}

/** One click voice: short sine burst, higher and louder on the accent. */
export function scheduleClick(
  context: BaseAudioContext,
  destination: AudioNode,
  when: number,
  accent: boolean,
): void {
  const osc = context.createOscillator();
  const env = context.createGain();
  osc.frequency.value = accent ? ACCENT_FREQ : BEAT_FREQ;
  const peak = accent ? 1 : 0.62;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + 0.002);
  env.gain.exponentialRampToValueAtTime(0.001, when + CLICK_DECAY_S);
  osc.connect(env);
  env.connect(destination);
  osc.start(when);
  osc.stop(when + CLICK_DECAY_S + 0.02);
}

/** Schedule the clicks of a time range into an offline render. */
export function scheduleClicksForRange(
  context: BaseAudioContext,
  destination: AudioNode,
  config: { bpm: number; timeSignature: TimeSignature; volume: number },
  fromMs: number,
  toMs: number,
): void {
  const gain = context.createGain();
  gain.gain.value = config.volume;
  gain.connect(destination);
  const beatMs = beatDurationMs(config.bpm, config.timeSignature);
  const firstBeat = Math.max(0, Math.ceil(fromMs / beatMs));
  for (let beat = firstBeat; beat * beatMs <= toMs; beat += 1) {
    const accent = beat % config.timeSignature.numerator === 0;
    scheduleClick(context, gain, (beat * beatMs - fromMs) / 1000, accent);
  }
}
