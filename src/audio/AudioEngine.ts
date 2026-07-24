import { PIANO_SAMPLE_CACHE } from '@/pwa/cacheNames';
import { DEFAULT_MASTER_VOLUME, DEFAULT_REVERB_MIX } from '@/domain/takeTypes';
import type {
  EngineStatus,
  NoteSourceId,
  SampleLoadProgress,
  ScheduledNoteEvent,
} from './audioTypes';
import { ensurePlaybackSession } from './iosAudioSession';
import { createPianoGraph, type PianoGraph } from './PianoGraphFactory';
import { SampleBank } from './SampleBank';
import { VoiceManager } from './VoiceManager';

// v2 delivers the same Salamander audio under a .sample extension so download
// managers (IDM etc.) stop intercepting sample fetches. v1 (*.mp3) is retained
// on disk untouched so already-published URLs never 404 for un-updated clients.
export const SAMPLE_PACK_PATH = 'piano/salamander-grand-v2/';

/** Live input events with audio-clock timestamps (the recorder subscribes). */
export type InputNoteEvent =
  | { type: 'on'; midi: number; velocity: number; audioTime: number; sourceId: NoteSourceId }
  | { type: 'off'; midi: number; audioTime: number; sourceId: NoteSourceId }
  | { type: 'sustain'; down: boolean; audioTime: number; sourceId: NoteSourceId };

/**
 * The stable piano service. A module singleton created outside React render
 * cycles; components call methods and subscribe to its events. The audio
 * clock lives here, never in React state.
 */
export class AudioEngine {
  readonly bank: SampleBank;

  private context: AudioContext | null = null;
  private graph: PianoGraph | null = null;
  private voices: VoiceManager | null = null;

  private status: EngineStatus = 'uninitialized';
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private reverbMix = DEFAULT_REVERB_MIX;

  private readonly statusListeners = new Set<(status: EngineStatus) => void>();
  private readonly activeNoteListeners = new Set<(midis: ReadonlySet<number>) => void>();
  private readonly inputListeners = new Set<(event: InputNoteEvent) => void>();
  private currentActiveNotes: ReadonlySet<number> = new Set();
  private coreLoadStarted = false;

  constructor() {
    this.bank = new SampleBank(`${import.meta.env.BASE_URL}${SAMPLE_PACK_PATH}`);
  }

  /**
   * Idempotent setup: creates the (suspended) context and graph and starts
   * decoding the core samples so the piano is ready by first gesture.
   * Safe to call before any user interaction — nothing audible happens.
   */
  initialize(): void {
    if (this.context) return;
    try {
      this.context = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
      console.error('AudioContext unavailable:', error);
      this.setStatus('error');
      return;
    }
    this.graph = createPianoGraph(this.context, {
      masterVolume: this.masterVolume,
      reverbMix: this.reverbMix,
    });
    this.voices = new VoiceManager(this.context, this.graph.voiceDestination);
    this.voices.subscribeActiveNotes((midis) => {
      this.currentActiveNotes = midis;
      for (const listener of this.activeNoteListeners) listener(midis);
    });
    this.setStatus(this.context.state === 'running' ? 'running' : 'suspended');

    this.context.addEventListener('statechange', () => {
      if (!this.context || this.status === 'error') return;
      this.setStatus(this.context.state === 'running' ? 'running' : 'suspended');
    });

    // Last line of stuck-note defense; the lifecycle module adds the rest.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.allNotesOff();
    });

    void this.loadCoreSamples();
  }

  /** Resume audio from a real user gesture (required on iOS/Chrome). */
  async unlockFromUserGesture(): Promise<void> {
    this.initialize();
    if (!this.context) return;
    // Keep Web Audio audible with the iPhone silent switch engaged.
    ensurePlaybackSession();
    if (this.context.state !== 'running') {
      try {
        await this.context.resume();
      } catch (error) {
        console.warn('AudioContext resume failed:', error);
      }
    }
    // A one-frame silent buffer nudges iOS into actually opening the output.
    if (this.context.state === 'running') {
      const silent = this.context.createBuffer(1, 1, this.context.sampleRate);
      const source = this.context.createBufferSource();
      source.buffer = silent;
      source.connect(this.context.destination);
      source.start();
    }
  }

  async loadCoreSamples(): Promise<void> {
    this.initialize();
    if (!this.context || this.coreLoadStarted) return;
    this.coreLoadStarted = true;
    try {
      await this.bank.loadCorePack(this.context);
    } catch (error) {
      console.error('Core sample load failed:', error);
      this.coreLoadStarted = false; // allow retry from the UI
    }
  }

  /** Decode extra roots when the keyboard range shifts beyond the core. */
  async ensurePlayableRange(lowMidi: number, highMidi: number): Promise<void> {
    if (!this.context) return;
    await this.bank.ensureRangeLoaded(this.context, lowMidi, highMidi);
  }

  /**
   * Pin every sample of the full pack into Cache Storage for offline use.
   * Shares PIANO_SAMPLE_CACHE with the service worker's runtime caching.
   */
  async downloadFullSamplePack(
    onProgress?: (loadedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const manifest = await this.bank.loadManifest();
    const cache = await caches.open(PIANO_SAMPLE_CACHE);
    let loadedBytes = 0;
    for (const entry of manifest.files) {
      const url = this.bank.urlFor(entry.file);
      const cached = await cache.match(url);
      if (!cached) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Sample download failed (${response.status}) for ${entry.file}`);
        }
        await cache.put(url, response);
      }
      loadedBytes += entry.bytes;
      onProgress?.(loadedBytes, manifest.totalBytes);
    }
  }

  async isFullPackOffline(): Promise<boolean> {
    if (!('caches' in globalThis)) return false;
    const manifest = await this.bank.loadManifest();
    const cache = await caches.open(PIANO_SAMPLE_CACHE);
    for (const entry of manifest.files) {
      if (!(await cache.match(this.bank.urlFor(entry.file)))) return false;
    }
    return true;
  }

  /** Remove downloaded sample audio without touching any take data. */
  async deleteDownloadedSamples(): Promise<void> {
    if ('caches' in globalThis) await caches.delete(PIANO_SAMPLE_CACHE);
  }

  noteOn(midi: number, velocity: number, sourceId: NoteSourceId): boolean {
    if (!this.context || !this.voices) return false;
    if (this.context.state !== 'running') {
      // noteOn always originates from a gesture; resume opportunistically.
      void this.unlockFromUserGesture();
    }
    const sample = this.bank.getSample(midi, velocity);
    if (!sample) return false;
    this.voices.noteOn(sample, midi, sourceId);
    this.emitInput({ type: 'on', midi, velocity, audioTime: this.currentTime, sourceId });
    return true;
  }

  noteOff(midi: number, sourceId: NoteSourceId): void {
    this.voices?.noteOff(midi, sourceId);
    this.emitInput({ type: 'off', midi, audioTime: this.currentTime, sourceId });
  }

  setSustain(down: boolean, sourceId: NoteSourceId): void {
    this.voices?.setSustain(down, sourceId);
    this.emitInput({ type: 'sustain', down, audioTime: this.currentTime, sourceId });
  }

  subscribeInput(listener: (event: InputNoteEvent) => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  private emitInput(event: InputNoteEvent): void {
    for (const listener of this.inputListeners) listener(event);
  }

  allNotesOff(): void {
    this.voices?.allNotesOff();
  }

  /** Schedule a complete note on the audio clock (playback/scrub path). */
  scheduleNote(
    event: ScheduledNoteEvent,
    audioTime: number,
    sourceId: NoteSourceId = 'playback',
  ): void {
    if (!this.voices) return;
    const sample = this.bank.getSample(event.midi, event.velocity);
    if (!sample) return;
    this.voices.scheduleNote(sample, event.midi, sourceId, audioTime, event.durationMs / 1000);
  }

  setMasterVolume(value: number): void {
    this.masterVolume = value;
    this.graph?.setMasterVolume(value);
  }

  setReverbMix(value: number): void {
    this.reverbMix = value;
    this.graph?.setReverbMix(value);
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getReverbMix(): number {
    return this.reverbMix;
  }

  async suspend(): Promise<void> {
    this.allNotesOff();
    await this.context?.suspend();
  }

  /** Resume from a lifecycle event that carries user activation. */
  async resume(): Promise<void> {
    await this.unlockFromUserGesture();
  }

  dispose(): void {
    this.voices?.dispose();
    this.graph?.dispose();
    void this.context?.close();
    this.context = null;
    this.graph = null;
    this.voices = null;
    this.setStatus('uninitialized');
  }

  /** The audio clock. 0 until initialized. */
  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get running(): boolean {
    return this.status === 'running';
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  /** Estimated output latency in ms, for diagnostics. */
  getOutputLatencyMs(): number {
    if (!this.context) return 0;
    const base = this.context.baseLatency ?? 0;
    const output = (this.context as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return Math.round((base + output) * 1000);
  }

  getAudioContext(): AudioContext | null {
    return this.context;
  }

  subscribeStatus(listener: (status: EngineStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  /** Stable snapshot of live-input notes; reference changes only on events. */
  getActiveNotes(): ReadonlySet<number> {
    return this.currentActiveNotes;
  }

  /**
   * Change subscription only — listeners are NOT invoked at subscribe time
   * (useSyncExternalStore reads getActiveNotes itself).
   */
  subscribeActiveNotes(listener: (midis: ReadonlySet<number>) => void): () => void {
    this.activeNoteListeners.add(listener);
    return () => this.activeNoteListeners.delete(listener);
  }

  subscribeLoadProgress(listener: (progress: SampleLoadProgress) => void): () => void {
    return this.bank.subscribe(listener);
  }

  private setStatus(status: EngineStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

/** The app-wide piano engine instance. */
export const audioEngine = new AudioEngine();
