import type { NoteSourceId, SampleSelection } from './audioTypes';
import {
  dampSampleVoice,
  holdSampleVoice,
  releaseSampleVoice,
  startSampleVoice,
  type SampleVoice,
} from './sampleVoice';

export const MAX_VOICES = 48;
/** Envelope constants shared with the offline renderer so exports match. */
export { ATTACK_S, RELEASE_TC, RELEASE_STOP_AFTER_S, RESTRIKE_TC } from './sampleVoice';
const STEAL_FADE_TC = 0.012;
const ALL_OFF_FADE_TC = 0.02;

interface Voice extends SampleVoice {
  id: number;
  midi: number;
  sourceId: NoteSourceId;
  releasing: boolean;
  heldByPedal: boolean;
  /** Counts toward the shared active-note model (live input only). */
  uiActive: boolean;
  /** Already fading out under a new strike of the same key. */
  restruck?: boolean;
}

/**
 * Polyphony, envelopes, sustain, and voice stealing. Lives outside React;
 * the UI subscribes to the active-note set it exposes.
 */
export class VoiceManager {
  private readonly voices = new Set<Voice>();
  private readonly sustainSources = new Set<NoteSourceId>();
  private readonly activeListeners = new Set<(midis: ReadonlySet<number>) => void>();
  private readonly sustainListeners = new Set<(down: boolean) => void>();
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
    return this.strike(sample, midi, sourceId, when, uiActive).voice;
  }

  private strike(
    sample: SampleSelection,
    midi: number,
    sourceId: NoteSourceId,
    when: number,
    uiActive: boolean,
  ): { voice: Voice; heldUntil: number } {
    const heldUntil = this.restrike(midi, when);
    this.stealIfNeeded();

    const playback = startSampleVoice(this.context, this.destination, sample, when);

    const voice: Voice = {
      ...playback,
      id: this.nextVoiceId++,
      midi,
      sourceId,
      startTime: when,
      releasing: false,
      heldByPedal: false,
      uiActive,
    };
    // Playback schedules ahead, so a key struck by hand can land before a
    // strike of it that playback has already queued: this sound gives way to
    // that one when it comes, as the queued one would have to this.
    const struckAgainAt = this.nextStrikeAfter(midi, when);
    if (struckAgainAt !== undefined) {
      dampSampleVoice(voice, struckAgainAt);
      voice.restruck = true;
    }
    this.voices.add(voice);
    voice.source.onended = () => {
      this.voices.delete(voice);
      this.disconnectVoice(voice);
      // A key still held when its sound ends — its recording run out, or
      // playback striking it again — has nothing left to light.
      if (voice.uiActive) this.emitActive();
    };
    if (uiActive) this.emitActive();
    return { voice, heldUntil };
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
   *
   * A key another scheduled note is still holding stays down until both have
   * let go: a half note with an eighth struck on the same key inside it, the
   * way two voices share a key, is struck twice and held for the half note.
   */
  scheduleNote(
    sample: SampleSelection,
    midi: number,
    sourceId: NoteSourceId,
    when: number,
    durationS: number,
  ): void {
    const { voice, heldUntil } = this.strike(sample, midi, sourceId, when, false);
    this.releaseVoice(voice, Math.max(when + durationS, heldUntil), false);
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
    if (wasDown !== this.sustainDown) this.emitSustain();
  }

  /** Change subscription only; the current state is read via sustainDown. */
  subscribeSustain(listener: (down: boolean) => void): () => void {
    this.sustainListeners.add(listener);
    return () => this.sustainListeners.delete(listener);
  }

  private emitSustain(): void {
    for (const listener of this.sustainListeners) listener(this.sustainDown);
  }

  /**
   * Fast-fade everything; the guarantee behind "never a stuck note".
   *
   * Voices already let go are faded too. Most would be gone in a moment
   * anyway, but not all: a key with no damper rings for as long as its sample
   * lasts, and one struck again is only damped from the new strike, which
   * playback may have scheduled for later.
   */
  allNotesOff(): void {
    const now = this.context.currentTime;
    // A panic reset drops the pedal too, so anything showing it has to hear.
    const sustainWasDown = this.sustainDown;
    this.sustainSources.clear();
    if (sustainWasDown) this.emitSustain();
    let changed = false;
    for (const voice of this.voices) {
      if (voice.uiActive) {
        voice.uiActive = false;
        changed = true;
      }
      voice.releasing = true;
      voice.heldByPedal = false;
      holdSampleVoice(voice, now);
      voice.gain.gain.setTargetAtTime(0, now, ALL_OFF_FADE_TC);
      this.safeStop(voice, now + 0.25);
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
    this.sustainListeners.clear();
  }

  private releaseVoice(voice: Voice, when: number, markReleasingNow = true): void {
    if (markReleasingNow) {
      if (voice.releasing) return;
      voice.releasing = true;
    }
    voice.heldByPedal = false;
    const start = Math.max(when, this.context.currentTime);
    releaseSampleVoice(voice, start);
  }

  /**
   * A key struck while its string still sounds: the old sound gives way to the
   * new one from the moment the new one starts (see `dampSampleVoice`). Every
   * source counts — a MIDI key and a finger on the same note play one string.
   * Only voices started by then and not already let go before it, the same
   * test `scheduleTakeVoices` makes, so an export sounds as playback does. That
   * includes one starting at the very same moment: a note two voices share is
   * one key struck once, not two strings sounding together. A note scheduled
   * later is its own, and this one gives way to it in turn; see `strike`.
   *
   * Returns the latest key-up still to come among the voices it damped, which
   * playback scheduled with their notes; see `scheduleNote`.
   *
   * Playback schedules ahead, so the new strike can still be to come. Then only
   * the fade is scheduled: until the strike, the key is its source's as before
   * — lit while held, and let go normally if it is let go first. A sound due
   * to give way to such a strike gives way sooner to one that comes first.
   */
  private restrike(midi: number, when: number): number {
    let heldUntil = Number.NEGATIVE_INFINITY;
    let changed = false;
    for (const voice of this.voices) {
      if (voice.midi !== midi || voice.startTime > when) continue;
      // Let go, or given way to another strike, before this one.
      if (voice.releaseTime !== undefined && voice.releaseTime <= when) continue;
      // A strike's fade is not a key-up: nothing is holding that key down.
      if (voice.releaseTime !== undefined && !voice.restruck) {
        heldUntil = Math.max(heldUntil, voice.releaseTime);
      }
      dampSampleVoice(voice, when);
      voice.restruck = true;
      if (when > this.context.currentTime) continue;
      voice.releasing = true;
      voice.heldByPedal = false;
      if (voice.uiActive) {
        voice.uiActive = false;
        changed = true;
      }
    }
    if (changed) this.emitActive();
    return heldUntil;
  }

  /**
   * The next strike of `midi` after `when` that playback has already queued,
   * if any. One a panic stop cut off before it started never comes.
   */
  private nextStrikeAfter(midi: number, when: number): number | undefined {
    let next: number | undefined;
    for (const voice of this.voices) {
      if (voice.midi !== midi || voice.startTime <= when || voice.releasing) continue;
      if (next === undefined || voice.startTime < next) next = voice.startTime;
    }
    return next;
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
      holdSampleVoice(candidate, now);
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
