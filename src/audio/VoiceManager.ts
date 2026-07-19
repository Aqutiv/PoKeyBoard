import type { NoteSourceId, SampleSelection } from './audioTypes';

export const MAX_VOICES = 48;
/** Envelope constants shared with the offline renderer so exports match. */
export const ATTACK_S = 0.003;
/** Time constant for the exponential-ish release ramp. */
export const RELEASE_TC = 0.07;
/** How long after release begins the source is hard-stopped. */
export const RELEASE_STOP_AFTER_S = 0.6;
const STEAL_FADE_TC = 0.012;
const ALL_OFF_FADE_TC = 0.02;

interface Voice {
  id: number;
  midi: number;
  sourceId: NoteSourceId;
  startTime: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
  releasing: boolean;
  heldByPedal: boolean;
  /** Counts toward the shared active-note model (live input only). */
  uiActive: boolean;
}

/**
 * Polyphony, envelopes, sustain, and voice stealing. Lives outside React;
 * the UI subscribes to the active-note set it exposes.
 */
export class VoiceManager {
  private readonly voices = new Set<Voice>();
  private readonly sustainSources = new Set<NoteSourceId>();
  private readonly activeListeners = new Set<(midis: ReadonlySet<number>) => void>();
  private nextVoiceId = 1;

  private readonly context: BaseAudioContext;
  private readonly destination: GainNode;
  private readonly maxVoices: number;

  constructor(context: BaseAudioContext, destination: GainNode, maxVoices: number = MAX_VOICES) {
    this.context = context;
    this.destination = destination;
    this.maxVoices = maxVoices;
  }

  get sustainDown(): boolean {
    return this.sustainSources.size > 0;
  }

  noteOn(
    sample: SampleSelection,
    midi: number,
    sourceId: NoteSourceId,
    when: number = this.context.currentTime,
    uiActive = true,
  ): Voice {
    this.stealIfNeeded();

    const source = this.context.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = sample.playbackRate;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(sample.gain, when + ATTACK_S);

    source.connect(gain);
    gain.connect(this.destination);
    source.start(when);

    const voice: Voice = {
      id: this.nextVoiceId++,
      midi,
      sourceId,
      startTime: when,
      source,
      gain,
      releasing: false,
      heldByPedal: false,
      uiActive,
    };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      this.disconnectVoice(voice);
    };
    if (uiActive) this.emitActive();
    return voice;
  }

  noteOff(midi: number, sourceId: NoteSourceId, when: number = this.context.currentTime): void {
    let changed = false;
    for (const voice of this.voices) {
      if (voice.midi !== midi || voice.sourceId !== sourceId || voice.releasing) continue;
      if (voice.uiActive) {
        voice.uiActive = false;
        changed = true;
      }
      if (this.sustainDown) {
        voice.heldByPedal = true;
      } else {
        this.releaseVoice(voice, when);
      }
    }
    if (changed) this.emitActive();
  }

  /**
   * Schedule a complete note (playback/offline path): starts at `when`,
   * releases after `durationS`. Not part of the live active-note set — the
   * transport clock drives playback animation.
   */
  scheduleNote(
    sample: SampleSelection,
    midi: number,
    sourceId: NoteSourceId,
    when: number,
    durationS: number,
  ): void {
    const voice = this.noteOn(sample, midi, sourceId, when, false);
    this.releaseVoice(voice, when + durationS, false);
  }

  setSustain(down: boolean, sourceId: NoteSourceId): void {
    const wasDown = this.sustainDown;
    if (down) this.sustainSources.add(sourceId);
    else this.sustainSources.delete(sourceId);
    if (wasDown && !this.sustainDown) {
      const now = this.context.currentTime;
      for (const voice of this.voices) {
        if (voice.heldByPedal && !voice.releasing) this.releaseVoice(voice, now);
      }
    }
  }

  /** Fast-fade everything; the guarantee behind "never a stuck note". */
  allNotesOff(): void {
    const now = this.context.currentTime;
    this.sustainSources.clear();
    let changed = false;
    for (const voice of this.voices) {
      if (voice.uiActive) {
        voice.uiActive = false;
        changed = true;
      }
      if (!voice.releasing) {
        voice.releasing = true;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, ALL_OFF_FADE_TC);
        this.safeStop(voice, now + 0.25);
      }
    }
    if (changed) this.emitActive();
  }

  /** Live-input notes currently held (drives key highlighting). */
  activeMidis(): Set<number> {
    const midis = new Set<number>();
    for (const voice of this.voices) {
      if (voice.uiActive && !voice.releasing) midis.add(voice.midi);
    }
    return midis;
  }

  /** Change subscription only; the current set is read via activeMidis(). */
  subscribeActiveNotes(listener: (midis: ReadonlySet<number>) => void): () => void {
    this.activeListeners.add(listener);
    return () => this.activeListeners.delete(listener);
  }

  get voiceCount(): number {
    return this.voices.size;
  }

  dispose(): void {
    this.allNotesOff();
    this.activeListeners.clear();
  }

  private releaseVoice(voice: Voice, when: number, markReleasingNow = true): void {
    if (markReleasingNow) {
      if (voice.releasing) return;
      voice.releasing = true;
    }
    voice.heldByPedal = false;
    const start = Math.max(when, this.context.currentTime);
    voice.gain.gain.cancelScheduledValues(start);
    voice.gain.gain.setTargetAtTime(0, start, RELEASE_TC);
    this.safeStop(voice, start + RELEASE_STOP_AFTER_S);
  }

  /**
   * Predictable stealing: oldest already-releasing voice first, then the
   * oldest pedal-held voice, then the oldest voice overall.
   */
  private stealIfNeeded(): void {
    while (this.voices.size >= this.maxVoices) {
      const candidate =
        this.oldestWhere((v) => v.releasing) ??
        this.oldestWhere((v) => v.heldByPedal) ??
        this.oldestWhere(() => true);
      if (!candidate) return;
      const now = this.context.currentTime;
      candidate.gain.gain.cancelScheduledValues(now);
      candidate.gain.gain.setTargetAtTime(0, now, STEAL_FADE_TC);
      this.safeStop(candidate, now + 0.08);
      this.voices.delete(candidate);
      if (candidate.uiActive) {
        candidate.uiActive = false;
        this.emitActive();
      }
    }
  }

  private oldestWhere(predicate: (voice: Voice) => boolean): Voice | undefined {
    let oldest: Voice | undefined;
    for (const voice of this.voices) {
      if (!predicate(voice)) continue;
      if (!oldest || voice.startTime < oldest.startTime) oldest = voice;
    }
    return oldest;
  }

  private safeStop(voice: Voice, when: number): void {
    try {
      voice.source.stop(when);
    } catch {
      // Already stopped — fine.
    }
  }

  private disconnectVoice(voice: Voice): void {
    try {
      voice.source.disconnect();
      voice.gain.disconnect();
    } catch {
      // Already disconnected — fine.
    }
  }

  private emitActive(): void {
    const midis = this.activeMidis();
    for (const listener of this.activeListeners) listener(midis);
  }
}
