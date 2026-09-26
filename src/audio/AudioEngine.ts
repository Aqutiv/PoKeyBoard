import { PIANO_SAMPLE_CACHE } from '@/pwa/cacheNames';
import {
  DEFAULT_MASTER_VOLUME,
  DEFAULT_REVERB_MIX,
  DEFAULT_REVERB_ROOM,
  type ReverbRoom,
} from '@/domain/takeTypes';
import type {
  EngineStatus,
  NoteSourceId,
  SampleLoadProgress,
  ScheduledNoteEvent,
} from './audioTypes';
import { ensurePlaybackSession } from './iosAudioSession';
import {
  DEFAULT_PIANO_INSTRUMENT_ID,
  pianoInstrument,
  type PianoInstrument,
  type PianoInstrumentId,
} from './instruments';
import { createPianoGraph, type PianoGraph } from './PianoGraphFactory';
import { SampleBank } from './SampleBank';
import { VoiceManager } from './VoiceManager';

/**
 * How long loadCoreSamples waits for the stored instrument before giving up and
 * decoding the default. Persistence releases the gate in single-digit ms; the
 * timeout only exists so a broken restore can never leave the piano silent.
 */
const INSTRUMENT_RESTORE_TIMEOUT_MS = 1_500;

/** Live input events with audio-clock timestamps (the recorder subscribes). */
export type InputNoteEvent =
  | { type: 'on'; midi: number; velocity: number; audioTime: number; sourceId: NoteSourceId }
  | { type: 'off'; midi: number; audioTime: number; sourceId: NoteSourceId }
  | { type: 'sustain'; down: boolean; audioTime: number; sourceId: NoteSourceId };

/** A stretch of the keyboard: its lowest and highest keys, as MIDI notes. */
export interface KeySpan {
  low: number;
  high: number;
}

/**
 * Where a change of piano stands, for the pickers. A snapshot: a new object
 * only when a field changes, as useSyncExternalStore requires.
 */
export interface InstrumentSwitchState {
  /** The piano decoding while the previous one plays on; see `setInstrument`. */
  pending: PianoInstrumentId | null;
  /** The piano that last could not be loaded, until the next switch starts. */
  failed: PianoInstrumentId | null;
}

interface PendingSwitch {
  id: PianoInstrumentId;
  generation: number;
  /**
   * Whether the previous piano plays on until this one is ready. The other
   * kind, taken when there is nothing playable to keep, points the engine at
   * the new bank at once.
   */
  seamless: boolean;
  /** Keys the new piano must sound from its first note, besides `lastRange`. */
  cover: KeySpan | null;
  promise: Promise<void>;
}

/**
 * The stable piano service. A module singleton created outside React render
 * cycles; components call methods and subscribe to its events. The audio
 * clock lives here, never in React state.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private graph: PianoGraph | null = null;
  private voices: VoiceManager | null = null;

  private status: EngineStatus = 'uninitialized';
  private masterVolume = DEFAULT_MASTER_VOLUME;
  private reverbMix = DEFAULT_REVERB_MIX;
  private reverbRoom: ReverbRoom = DEFAULT_REVERB_ROOM;

  private readonly statusListeners = new Set<(status: EngineStatus) => void>();
  private readonly activeNoteListeners = new Set<(midis: ReadonlySet<number>) => void>();
  private readonly sustainListeners = new Set<(down: boolean) => void>();
  private readonly inputListeners = new Set<(event: InputNoteEvent) => void>();
  private readonly schedulerTickListeners = new Set<() => void>();
  private schedulerTicker: AudioWorkletNode | null = null;
  private currentActiveNotes: ReadonlySet<number> = new Set();
  private currentSustainDown = false;
  private coreLoadStarted = false;

  /**
   * One bank per instrument. The objects are cached (their manifests are worth
   * keeping) but only the sounding one holds decoded buffers, and while a switch
   * decodes, the one about to take over — two full packs of stereo float32 PCM
   * would be ~620MB.
   */
  private readonly banks = new Map<PianoInstrumentId, SampleBank>();
  /** The piano the user chose, which takes are stamped with. */
  private selectedId: PianoInstrumentId = DEFAULT_PIANO_INSTRUMENT_ID;
  /** The piano that plays: behind `selectedId` while a seamless switch decodes. */
  private soundingId: PianoInstrumentId = DEFAULT_PIANO_INSTRUMENT_ID;
  private switchGeneration = 0;
  private pendingSwitch: PendingSwitch | null = null;
  private switchState: InstrumentSwitchState = { pending: null, failed: null };
  private readonly switchListeners = new Set<() => void>();

  /** Last range the keyboard asked for, replayed after an instrument switch. */
  private lastRange: KeySpan | null = null;

  /**
   * Progress fan-out lives on the engine, not the bank: useSyncExternalStore
   * captures its subscribe callback once, so a per-bank subscription would go
   * deaf the first time the instrument changes.
   */
  private readonly progressListeners = new Set<(progress: SampleLoadProgress) => void>();
  private unsubscribeBankProgress: (() => void) | null = null;

  private restoreGateResolve: (() => void) | null = null;
  private readonly restoreGate: Promise<void>;

  constructor() {
    this.restoreGate = new Promise<void>((resolve) => {
      this.restoreGateResolve = resolve;
    });
    setTimeout(() => this.markInstrumentRestored(), INSTRUMENT_RESTORE_TIMEOUT_MS);
    this.watchBankProgress();
  }

  /** The bank of the piano that is sounding. */
  get bank(): SampleBank {
    return this.bankFor(this.soundingId);
  }

  /**
   * The piano the user chose. It changes the moment they choose, so a take can
   * be stamped with it at once, though for as long as the new piano takes to
   * decode the previous one may still be the one heard (`soundingInstrument`).
   */
  get activeInstrument(): PianoInstrument {
    return pianoInstrument(this.selectedId);
  }

  /** The piano whose samples are played right now. */
  get soundingInstrument(): PianoInstrument {
    return pianoInstrument(this.soundingId);
  }

  bankFor(id: PianoInstrumentId): SampleBank {
    const existing = this.banks.get(id);
    if (existing) return existing;
    const bank = new SampleBank(`${import.meta.env.BASE_URL}${pianoInstrument(id).path}`);
    this.banks.set(id, bank);
    return bank;
  }

  /**
   * Choose the piano.
   *
   * While the piano playing now is ready, the change is seamless: it plays on
   * while the new one decodes in the background — its core, the keys the
   * player can reach (`lastRange`) and `cover`, the notes a take will play —
   * and the new one takes over from the next note struck. Nothing is released:
   * a note sounding, or queued in playback's look-ahead, finishes on the piano
   * it began on, which its voice holds a buffer of. If the new piano cannot be
   * loaded, the one playing is chosen again and `getSwitchState` says so.
   *
   * With nothing playable to keep — the first load, or a piano that failed —
   * the switch is immediate: sounding notes are released, and the engine points
   * at the new bank, progress and all, while it decodes.
   *
   * Either way, once the new piano plays every other bank's buffers are freed;
   * not before, so a rapid A→B→A toggle never re-decodes anything.
   */
  setInstrument(
    id: PianoInstrumentId,
    { cover = null }: { cover?: KeySpan | null } = {},
  ): Promise<void> {
    const pending = this.pendingSwitch;
    if (pending?.id === id) {
      // The store's setter, persistence and the transport all ask for the one
      // change; whichever knows what the take needs widens it.
      if (cover) pending.cover = spanUnion(pending.cover, cover);
      return pending.promise;
    }
    const generation = ++this.switchGeneration;
    this.abandonPendingSwitch();
    this.selectedId = id;
    if (id === this.soundingId) {
      // Back to the piano still playing: a switch under way is simply called off.
      if (pending) this.setSwitchState({ pending: null, failed: null });
      return Promise.resolve();
    }
    if (!this.context || !this.bank.isCoreReady()) return this.switchNow(id, generation);
    return this.switchSeamlessly(id, generation, cover);
  }

  /** True while a new piano decodes and the previous one plays on. */
  isSwitching(): boolean {
    return this.switchState.pending !== null;
  }

  /** Stable snapshot: the same object until something changes (React-safe). */
  getSwitchState(): InstrumentSwitchState {
    return this.switchState;
  }

  /** Change subscription only, like subscribeActiveNotes. */
  subscribeSwitch(listener: () => void): () => void {
    this.switchListeners.add(listener);
    return () => this.switchListeners.delete(listener);
  }

  /**
   * Resolves once no switch is under way, so work that has to use the chosen
   * piano — an export, named after it — never starts on the one it replaces.
   */
  async whenSwitchSettled(): Promise<void> {
    while (this.pendingSwitch) {
      await this.pendingSwitch.promise.catch(() => undefined);
    }
  }

  /** The switch for when nothing playable is left to keep; see `setInstrument`. */
  private switchNow(id: PianoInstrumentId, generation: number): Promise<void> {
    this.allNotesOff();
    this.soundingId = id;
    // Re-points progress at the new bank, whose phase is 'idle' — which is what
    // drops data-piano-ready back to false while the new pack decodes.
    this.watchBankProgress();
    this.coreLoadStarted = false;
    this.setSwitchState({ pending: null, failed: null });

    const promise = (async () => {
      this.markInstrumentRestored();
      await this.loadCoreSamples();
      if (generation !== this.switchGeneration) return;
      if (this.lastRange) {
        try {
          await this.ensurePlayableRange(this.lastRange.low, this.lastRange.high);
        } catch {
          // Optional roots: the core plays, and progress shows the error.
        }
      }
      if (generation !== this.switchGeneration) return;
      this.releaseIdleBanks();
    })().finally(() => this.clearPendingSwitch(generation));
    this.pendingSwitch = { id, generation, seamless: false, cover: null, promise };
    return promise;
  }

  /** The switch that keeps the piano playing until the new one is ready. */
  private switchSeamlessly(
    id: PianoInstrumentId,
    generation: number,
    cover: KeySpan | null,
  ): Promise<void> {
    const context = this.context!;
    const next = this.bankFor(id);
    const stale = () => generation !== this.switchGeneration;

    const promise = (async () => {
      try {
        await next.loadCorePack(context);
        if (!stale() && !next.isCoreReady()) throw new Error('Core sample pack is incomplete.');
      } catch (error) {
        if (!stale()) this.failSwitch(id, error);
        return;
      }
      // Every key that has to sound from the new piano's first note: those the
      // player can reach, and the take's. Asked again after each load, since the
      // keyboard can move while it runs.
      let span = this.switchSpan();
      while (span && !stale()) {
        try {
          await next.ensureRangeLoaded(context, span.low, span.high);
        } catch {
          // Optional roots, as for the first load: the core is ready, and plays.
          break;
        }
        const wanted = this.switchSpan();
        if (!wanted || (wanted.low === span.low && wanted.high === span.high)) break;
        span = wanted;
      }
      if (stale()) return;
      this.takeOver(id);
    })().finally(() => this.clearPendingSwitch(generation));
    this.pendingSwitch = { id, generation, seamless: true, cover, promise };
    this.setSwitchState({ pending: id, failed: null });
    return promise;
  }

  /** What a seamless switch must have decoded before it takes over. */
  private switchSpan(): KeySpan | null {
    return spanUnion(this.lastRange, this.pendingSwitch?.cover ?? null);
  }

  /** The new piano plays from the next note struck. */
  private takeOver(id: PianoInstrumentId): void {
    this.soundingId = id;
    // Its core is decoded, so a retry from the UI has nothing left to start.
    this.coreLoadStarted = true;
    this.watchBankProgress();
    this.pendingSwitch = null;
    this.releaseIdleBanks();
    this.setSwitchState({ pending: null, failed: null });
  }

  /** The new piano could not be loaded: the one playing stays, and is chosen again. */
  private failSwitch(id: PianoInstrumentId, error: unknown): void {
    console.error(`Could not switch to ${id}:`, error);
    this.selectedId = this.soundingId;
    this.pendingSwitch = null;
    this.releaseIdleBanks();
    this.setSwitchState({ pending: null, failed: id });
  }

  /** Drop a switch a newer choice replaces; a seamless one's bank never played. */
  private abandonPendingSwitch(): void {
    const pending = this.pendingSwitch;
    if (!pending) return;
    this.pendingSwitch = null;
    if (pending.seamless) this.bankFor(pending.id).releaseBuffers();
  }

  private clearPendingSwitch(generation: number): void {
    if (this.pendingSwitch?.generation === generation) this.pendingSwitch = null;
  }

  /**
   * Free every bank but the sounding one, and one a switch is decoding. A voice
   * still sounding holds its own buffer, so nothing it plays is cut short.
   */
  private releaseIdleBanks(): void {
    const keep = new Set<SampleBank>([this.bank]);
    if (this.pendingSwitch) keep.add(this.bankFor(this.pendingSwitch.id));
    for (const bank of this.banks.values()) {
      if (!keep.has(bank)) bank.releaseBuffers();
    }
  }

  private setSwitchState(next: InstrumentSwitchState): void {
    const current = this.switchState;
    if (next.pending === current.pending && next.failed === current.failed) return;
    this.switchState = next;
    for (const listener of this.switchListeners) listener();
  }

  /**
   * Let the core load proceed. Called by the persistence layer once the stored
   * instrument has been applied, so a cold start never decodes the wrong piano.
   */
  markInstrumentRestored(): void {
    this.restoreGateResolve?.();
    this.restoreGateResolve = null;
  }

  private watchBankProgress(): void {
    this.unsubscribeBankProgress?.();
    this.unsubscribeBankProgress = this.bank.subscribe((progress) => {
      for (const listener of this.progressListeners) listener(progress);
    });
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
      reverbRoom: this.reverbRoom,
    });
    this.voices = new VoiceManager(this.context, this.graph.voiceDestination);
    this.voices.subscribeActiveNotes((midis) => {
      this.currentActiveNotes = midis;
      for (const listener of this.activeNoteListeners) listener(midis);
    });
    this.voices.subscribeSustain((down) => {
      this.currentSustainDown = down;
      for (const listener of this.sustainListeners) listener(down);
    });
    this.setStatus(this.context.state === 'running' ? 'running' : 'suspended');

    this.context.addEventListener('statechange', () => {
      if (!this.context || this.status === 'error') return;
      this.setStatus(this.context.state === 'running' ? 'running' : 'suspended');
    });

    // An AudioWorklet remains tied to audio rendering when browsers throttle
    // page timers. It only posts timing pulses; the existing audio-clock
    // scheduler remains the source of truth.
    void this.initializeSchedulerTicker(this.context);

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
    // Wait for the stored instrument before committing to a ~12MB decode.
    await this.restoreGate;
    const bank = this.bank;
    try {
      await bank.loadCorePack(this.context);
    } catch (error) {
      console.error('Core sample load failed:', error);
      this.coreLoadStarted = false; // allow retry from the UI
    }
  }

  /**
   * Decode extra roots when the keyboard range shifts beyond the core.
   *
   * The range is remembered and replayed after an instrument switch, because
   * it is the standing request of whatever is on screen (merged across the
   * key bed and MIDI by playableRange.ts). A one-off caller — an export, a
   * lesson demo — passes `remember: false`: its range says nothing about what
   * the player will reach for next, and remembering it would leave the next
   * piano decoding only the notes that caller happened to need.
   */
  async ensurePlayableRange(
    lowMidi: number,
    highMidi: number,
    { remember = true }: { remember?: boolean } = {},
  ): Promise<void> {
    if (remember) this.lastRange = { low: lowMidi, high: highMidi };
    if (!this.context) return;
    await this.bank.ensureRangeLoaded(this.context, lowMidi, highMidi);
  }

  /**
   * Pin every sample of the full pack into Cache Storage for offline use.
   * Shares PIANO_SAMPLE_CACHE with the service worker's runtime caching.
   */
  async downloadFullSamplePack(
    instrumentId: PianoInstrumentId = this.selectedId,
    onProgress?: (loadedBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const bank = this.bankFor(instrumentId);
    const manifest = await bank.loadManifest();
    const cache = await caches.open(PIANO_SAMPLE_CACHE);
    let loadedBytes = 0;
    for (const entry of manifest.files) {
      const url = bank.urlFor(entry.file);
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

  async isFullPackOffline(instrumentId: PianoInstrumentId = this.selectedId): Promise<boolean> {
    if (!('caches' in globalThis)) return false;
    const bank = this.bankFor(instrumentId);
    const manifest = await bank.loadManifest();
    const cache = await caches.open(PIANO_SAMPLE_CACHE);
    for (const entry of manifest.files) {
      if (!(await cache.match(bank.urlFor(entry.file)))) return false;
    }
    return true;
  }

  /**
   * Remove downloaded sample audio without touching any take data. Scoped to one
   * piano when given an id, which is enumerated from the cache rather than the
   * manifest so the pack's manifest.json goes too and the offline state cannot
   * disagree with what is actually stored.
   *
   * Matches *every* generation of that piano, not just the one currently
   * selected: pack directories are `<instrument id>-vN`, and after an upgrade a
   * superseded generation can still be sitting in the cache. Deleting a piano
   * should reclaim all of its bytes, or the number the user is shown is a lie.
   */
  async deleteDownloadedSamples(instrumentId?: PianoInstrumentId): Promise<void> {
    if (!('caches' in globalThis)) return;
    if (!instrumentId) {
      await caches.delete(PIANO_SAMPLE_CACHE);
      return;
    }
    const cache = await caches.open(PIANO_SAMPLE_CACHE);
    // The leading slash anchors this to the pack directory segment, so one
    // instrument id can never match another's path.
    const marker = `/${instrumentId}-v`;
    for (const request of await cache.keys()) {
      if (new URL(request.url).pathname.includes(marker)) await cache.delete(request);
    }
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

  /** Timing pulses which continue while ordinary page timers are throttled. */
  subscribeSchedulerTick(listener: () => void): () => void {
    this.schedulerTickListeners.add(listener);
    return () => this.schedulerTickListeners.delete(listener);
  }

  private async initializeSchedulerTicker(context: AudioContext): Promise<void> {
    if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') return;
    try {
      await context.audioWorklet.addModule(
        `${import.meta.env.BASE_URL}audio/transport-scheduler-worklet.js`,
      );
      if (this.context !== context) return;
      const ticker = new AudioWorkletNode(context, 'pokeyboard-transport-scheduler');
      ticker.port.onmessage = () => {
        for (const listener of this.schedulerTickListeners) listener();
      };
      // The processor emits silence, but connecting it keeps it participating
      // in the render graph (and therefore ticking) in the background.
      ticker.connect(context.destination);
      this.schedulerTicker = ticker;
    } catch (error) {
      // The normal setInterval scheduler remains available as a fallback.
      console.warn('Background playback scheduler unavailable:', error);
    }
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

  /** Call off `sourceId`'s notes that start after `after`; see `VoiceManager`. */
  cancelPending(sourceId: NoteSourceId, after: number): void {
    this.voices?.cancelPending(sourceId, after);
  }

  /** Move the key-ups still to come of `sourceId`'s notes sounding at `from`. */
  retimeReleases(sourceId: NoteSourceId, from: number, at: (releaseTime: number) => number): void {
    this.voices?.retimeReleases(sourceId, from, at);
  }

  setMasterVolume(value: number): void {
    this.masterVolume = value;
    this.graph?.setMasterVolume(value);
  }

  setReverbMix(value: number): void {
    this.reverbMix = value;
    this.graph?.setReverbMix(value);
  }

  /** Move the reverb to another room; the graph ducks it across the switch. */
  setReverbRoom(room: ReverbRoom): void {
    this.reverbRoom = room;
    this.graph?.setReverbRoom(room);
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  getReverbMix(): number {
    return this.reverbMix;
  }

  getReverbRoom(): ReverbRoom {
    return this.reverbRoom;
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
    // A switch still decoding has no context left to take over in.
    this.switchGeneration += 1;
    this.pendingSwitch = null;
    this.setSwitchState({ pending: null, failed: null });
    this.schedulerTicker?.disconnect();
    this.schedulerTicker = null;
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

  /**
   * Where non-piano sources (the metronome) should connect: past master volume
   * and reverb, and past the limiter, so a click never turns the piano down,
   * but still inside the graph's soft clipper.
   */
  getOutputDestination(): AudioNode | null {
    return this.graph?.outputDestination ?? null;
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

  /** True while any source holds the damper up — the pedal's only truth. */
  isSustainDown(): boolean {
    return this.currentSustainDown;
  }

  /** Change subscription only, like subscribeActiveNotes. */
  subscribeSustain(listener: (down: boolean) => void): () => void {
    this.sustainListeners.add(listener);
    return () => this.sustainListeners.delete(listener);
  }

  /** Progress for the piano that is sounding; survives instrument switches. */
  getLoadProgress(): SampleLoadProgress {
    return this.bank.getProgress();
  }

  subscribeLoadProgress(listener: (progress: SampleLoadProgress) => void): () => void {
    this.progressListeners.add(listener);
    listener(this.getLoadProgress());
    return () => this.progressListeners.delete(listener);
  }

  private setStatus(status: EngineStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

/** The smallest span holding both; either may be missing. */
function spanUnion(a: KeySpan | null, b: KeySpan | null): KeySpan | null {
  if (!a) return b;
  if (!b) return a;
  return { low: Math.min(a.low, b.low), high: Math.max(a.high, b.high) };
}

/** The app-wide piano engine instance. */
export const audioEngine = new AudioEngine();
