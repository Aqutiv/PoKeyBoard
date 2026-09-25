import { createTakeTempoMap, type TempoMap, type TempoMapInput } from '@/domain/tempoMap';
import type { PlaybackLoop, TimeSignature } from '@/domain/takeTypes';

export interface MetronomeConfig {
  volume: number;
}

/**
 * Where the clicks fall. Beats are numbered from the grid's own start, and the
 * grid — not the engine — decides where each one lands, so a take whose tempo
 * moves clicks on its own bar lines instead of a fixed pulse.
 */
export interface ClickGrid {
  /** Audio-context time of click `index`. */
  audioTimeAt(index: number): number;
  /** Bar starts are accented. */
  isAccent(index: number): boolean;
  /** Where click `index` falls in its bar, 0 on the bar line: the beat dot it lights. */
  beatInBar(index: number): number;
  /** Fractional click index at an audio time; negative before the first. */
  indexAt(audioTime: number): number;
  /** Beats per bar. */
  readonly numerator: number;
}

/** One steady tempo from `startAudioTime`: the practice click and count-ins. */
export function constantClickGrid(
  startAudioTime: number,
  beatMs: number,
  numerator: number,
): ClickGrid {
  const beatS = beatMs / 1000;
  return {
    audioTimeAt: (index) => startAudioTime + index * beatS,
    isAccent: (index) => index % numerator === 0,
    beatInBar: (index) => index % numerator,
    indexAt: (audioTime) => (audioTime - startAudioTime) / beatS,
    numerator,
  };
}

/**
 * The active take's own beat grid: click `n` sounds where the tempo map puts
 * beat `n`, which is exactly where the notation draws it. Bars are `numerator`
 * beats in that same beat space, so accents land on bar lines through every
 * tempo change.
 */
export function takeClickGrid(
  map: TempoMap,
  numerator: number,
  audioTimeForTakeMs: (takeMs: number) => number,
  takeMsForAudioTime: (audioTime: number) => number,
): ClickGrid {
  return {
    audioTimeAt: (index) => audioTimeForTakeMs(map.msAtBeat(index)),
    isAccent: (index) => index % numerator === 0,
    beatInBar: (index) => index % numerator,
    indexAt: (audioTime) => map.beatAtMs(takeMsForAudioTime(audioTime)),
    numerator,
  };
}

/**
 * What a click grid needs of a running transport: the timeline it plays, which
 * keeps growing through a loop's passes (`TransportClock`'s virtual time), and
 * the loop folding take time back, if there is one.
 */
export interface ClickTimeline {
  audioTimeForVirtualMs(virtualMs: number): number;
  virtualMsForAudioTime(audioTime: number): number;
  readonly loop: PlaybackLoop | null;
}

/**
 * A beat this close to a loop's edge, in milliseconds, is on it. Marks are
 * stored as whole milliseconds, so at 104 bpm a beat at 576.923 ms is marked
 * 577 — which must still count as that beat, not the next.
 */
const LOOP_EDGE_TOLERANCE_MS = 0.5;

/**
 * The take's beat grid played round a loop. Click indices run on through the
 * passes, as the clicks themselves do: the take's own beats up to the loop's
 * end, then the beats inside the loop again and again. Each click keeps the
 * accent of the beat it stands for, so a loop from a bar line clicks its bars.
 */
export function loopClickGrid(
  map: TempoMap,
  numerator: number,
  timeline: ClickTimeline,
  loop: PlaybackLoop,
): ClickGrid {
  const length = loop.endMs - loop.startMs;
  /** The first beat inside the loop, and the first at or past its end. */
  const first = Math.ceil(map.beatAtMs(loop.startMs - LOOP_EDGE_TOLERANCE_MS));
  const end = Math.ceil(map.beatAtMs(loop.endMs - LOOP_EDGE_TOLERANCE_MS));
  const perPass = end - first;
  const beatOf = (index: number): { beat: number; pass: number } | null => {
    if (index < end) return { beat: index, pass: 0 };
    if (perPass <= 0) return null;
    return {
      beat: first + ((index - end) % perPass),
      pass: 1 + Math.floor((index - end) / perPass),
    };
  };
  // A pass need not be whole bars (three beats of a 4/4 bar, say), so a
  // click's place in its bar comes from the beat it stands for, not its index.
  const beatInBar = (index: number): number => (beatOf(index)?.beat ?? index) % numerator;
  return {
    audioTimeAt: (index) => {
      const at = beatOf(index);
      if (!at) return Number.POSITIVE_INFINITY;
      return timeline.audioTimeForVirtualMs(map.msAtBeat(at.beat) + at.pass * length);
    },
    isAccent: (index) => beatInBar(index) === 0,
    beatInBar,
    indexAt: (audioTime) => {
      const virtualMs = timeline.virtualMsForAudioTime(audioTime);
      if (virtualMs < loop.endMs) return map.beatAtMs(virtualMs);
      const pass = 1 + Math.floor((virtualMs - loop.endMs) / length);
      const takeMs = loop.startMs + ((virtualMs - loop.endMs) % length);
      return end + (pass - 1) * perPass + (map.beatAtMs(takeMs) - first);
    },
    numerator,
  };
}

/** The grid a take implies, given a running transport clock. */
export function gridForTake(
  tempo: TempoMapInput & { timeSignature: TimeSignature },
  clock: ClickTimeline,
): ClickGrid {
  const map = createTakeTempoMap(tempo);
  const { numerator } = tempo.timeSignature;
  if (clock.loop) return loopClickGrid(map, numerator, clock, clock.loop);
  return takeClickGrid(
    map,
    numerator,
    (ms) => clock.audioTimeForVirtualMs(ms),
    (audioTime) => clock.virtualMsForAudioTime(audioTime),
  );
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
  private config: MetronomeConfig = { volume: 0.6 };

  private timer: ReturnType<typeof setInterval> | null = null;
  private grid: ClickGrid | null = null;
  private nextBeatIndex = 0;
  /** The latest click already handed to the audio clock. */
  private scheduledUntil = Number.NEGATIVE_INFINITY;
  private running = false;

  attach(context: AudioContext, destination: AudioNode = context.destination): void {
    if (this.context === context) return;
    this.context = context;
    this.gain = context.createGain();
    this.gain.gain.value = this.config.volume;
    // Own output path: independent of piano master volume and reverb, but it
    // joins ahead of the graph's limiter so the click can't push the sum past
    // full scale during loud playback.
    this.gain.connect(destination);
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

  /** Start clicking on `grid`, from its first beat that has not passed. */
  start(grid: ClickGrid): void {
    if (!this.context || !this.gain) return;
    this.stop();
    this.grid = grid;
    this.running = true;
    this.scheduledUntil = Number.NEGATIVE_INFINITY;
    this.seekToNow();
    this.scheduleWindow();
    this.timer = setInterval(() => this.scheduleWindow(), LOOKAHEAD_INTERVAL_MS);
  }

  /**
   * Swap the grid without interrupting the click — used when the tempo, the
   * speed or the loop changes mid-flight. Clicks already inside the scheduling
   * horizon still sound at their old times, and the new grid picks up after
   * the last of them, so none sounds twice.
   */
  setGrid(grid: ClickGrid): void {
    this.grid = grid;
    if (this.running) this.seekToNow();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  /** Beat within the bar at an audio time, for the beat dots; -1 when silent. */
  beatInBarAt(audioTime: number): number {
    const grid = this.grid;
    if (!this.running || !grid) return -1;
    const index = grid.indexAt(audioTime);
    if (index < 0) return -1;
    return grid.beatInBar(Math.floor(index));
  }

  /** Top up from an external audio-render clock while page timers are throttled. */
  topUpSchedule(): void {
    this.scheduleWindow();
  }

  /** Resume scheduling at the first beat at or after the current audio time. */
  private seekToNow(): void {
    const context = this.context;
    if (!context || !this.grid) return;
    const from = Math.max(context.currentTime, this.scheduledUntil + 0.001);
    this.nextBeatIndex = Math.max(0, Math.ceil(this.grid.indexAt(from)));
  }

  private scheduleWindow(): void {
    const context = this.context;
    const gain = this.gain;
    const grid = this.grid;
    if (!context || !gain || !grid || !this.running) return;
    const horizon = context.currentTime + SCHEDULE_AHEAD_S;
    for (;;) {
      const beatTime = grid.audioTimeAt(this.nextBeatIndex);
      if (!Number.isFinite(beatTime) || beatTime > horizon) break;
      if (beatTime >= context.currentTime - 0.01) {
        scheduleClick(context, gain, beatTime, grid.isAccent(this.nextBeatIndex));
        this.scheduledUntil = Math.max(this.scheduledUntil, beatTime);
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

/**
 * Schedule the clicks of a time range into an offline render. Beats come from
 * the take's tempo map, so an exported click track follows its tempo changes
 * exactly as the live one does.
 */
export function scheduleClicksForRange(
  context: BaseAudioContext,
  destination: AudioNode,
  tempo: TempoMapInput & { timeSignature: TimeSignature },
  volume: number,
  fromMs: number,
  toMs: number,
): void {
  const gain = context.createGain();
  gain.gain.value = volume;
  gain.connect(destination);
  const map = createTakeTempoMap(tempo);
  const { numerator } = tempo.timeSignature;
  const firstBeat = Math.max(0, Math.ceil(map.beatAtMs(fromMs)));
  for (let beat = firstBeat; ; beat += 1) {
    const atMs = map.msAtBeat(beat);
    if (atMs > toMs) break;
    scheduleClick(context, gain, (atMs - fromMs) / 1000, beat % numerator === 0);
  }
}
