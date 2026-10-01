import type {
  SampleLoadPhase,
  SampleLoadProgress,
  SamplePackFileEntry,
  SamplePackManifest,
  SampleSelection,
} from './audioTypes';
import { BACKGROUND_CONCURRENCY, SampleTraffic } from './sampleTraffic';
import { releaseTcFor, UNDAMPED_FROM_MIDI } from './sampleVoice';
import { TONE_CALIBRATIONS } from './toneCalibration';
import { toneCalibrationCovers, voiceTone, type ToneCalibration } from './toneCalibrationMath';
import { VELOCITY_CALIBRATIONS } from './velocityCalibration';
import {
  calibratedGain,
  calibrationCovers,
  type VelocityCalibration,
} from './velocityCalibrationMath';
import {
  layerLabels,
  layerSearchOrder,
  mediumLayer,
  velocityGain,
  velocityThresholds,
  velocityToLayer,
  type LayerLabel,
} from './velocityLayers';

/**
 * The layers a piano decodes after it is ready to play rather than before:
 * its pianissimo recordings. Until one arrives the soft layer stands in for
 * it, at the bottom of its tone ramp and on the velocity curve, so the first
 * note waits only for the core it always waited for.
 */
const DEFERRED_LAYERS: ReadonlySet<LayerLabel> = new Set<LayerLabel>(['pianissimo']);

/** Keyboard center (F#4-ish) used to prioritize sample loading order. */
const LOAD_CENTER_MIDI = 66;

/** How far from its root a recording may be pitched to stand in for a key. */
export const MAX_ROOT_DISTANCE_SEMITONES = 9;
/**
 * Files a load someone waits for fetches at once: a bank's own, and a download
 * for offline use (`AudioEngine.downloadFullSamplePack`). See `SampleTraffic`
 * for the rest.
 */
export const FETCH_CONCURRENCY = 4;
const FETCH_RETRIES = 2;

/** How far into a recording the attack is looked for. */
const ONSET_SEARCH_S = 0.25;
/** A sample counts as sounding once it reaches this far below its attack's peak. */
const ONSET_THRESHOLD_DB = -40;
/** Kept ahead of the onset, so the fade-in never lands on the hammer itself. */
const ONSET_PREROLL_S = 0.001;
/** No recording should need more trimmed than this; anything past it is left. */
const MAX_ONSET_TRIM_S = 0.05;

/**
 * Where a recording's sound actually begins, in buffer seconds.
 *
 * Sample libraries leave a little room before each note — the Salamander pack
 * a median of about 12 ms, and up to 30 — and a voice started at the top of
 * the buffer plays that silence before every note, a delay a player feels and
 * an uneven one. The first moment the recording rises to within 40 dB of its
 * attack's peak is the onset; the voice starts a millisecond before it.
 */
export function onsetOffsetOf(buffer: AudioBuffer): number {
  const rate = buffer.sampleRate;
  const searchEnd = Math.min(buffer.length, Math.round(rate * ONSET_SEARCH_S));
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    channels.push(buffer.getChannelData(channel));
  }
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < searchEnd; i += 1) peak = Math.max(peak, Math.abs(data[i] as number));
  }
  if (peak === 0) return 0;
  const threshold = peak * 10 ** (ONSET_THRESHOLD_DB / 20);
  let first = searchEnd;
  for (const data of channels) {
    for (let i = 0; i < first; i += 1) {
      if (Math.abs(data[i] as number) >= threshold) {
        first = i;
        break;
      }
    }
  }
  const trimmed = Math.max(0, first - Math.round(rate * ONSET_PREROLL_S)) / rate;
  return Math.min(trimmed, MAX_ONSET_TRIM_S);
}

interface LayerRoots {
  /** rootMidi → manifest entry, for every file in the pack. */
  entries: Map<number, SamplePackFileEntry>;
  /** Every root the layer was recorded at, sorted. */
  roots: number[];
  /** Sorted midi roots whose buffers are decoded and playable. */
  loadedRoots: number[];
}

/**
 * Loads, decodes, and maps the versioned piano sample pack. Buffers are
 * decoded once and shared between the live context and offline renders.
 */
export class SampleBank {
  private manifest: SamplePackManifest | null = null;
  /** The manifest's fetch while it is on its way; see `loadManifest`. */
  private manifestLoad: Promise<SamplePackManifest> | null = null;
  /** The manifest's velocity calibration, when there is one covering all of it. */
  private calibration: VelocityCalibration | null = null;
  /** Its tone calibration, likewise; only ever with a velocity calibration. */
  private tone: ToneCalibration | null = null;
  /** A grand's layers by index (see velocityLayers.ts); none for a pack mapped by regions. */
  private labels: LayerLabel[] = [];
  /** Where each of its layers above the softest takes over, in velocity. */
  private thresholds: readonly number[] = [];
  /** The layers it decodes once it plays; see `DEFERRED_LAYERS`. */
  private deferredLayers: ReadonlySet<number> = new Set();
  /**
   * Whether the deferred layers load along with the keys they serve: from the
   * moment the engine makes this the piano that sounds (`loadDeferred`) until
   * its buffers are released. A piano still decoding for a switch never
   * fetches them, nor holds them while the one it replaces plays on.
   */
  private deferredOn = false;
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Each decoded file's onset; see `onsetOffsetOf`. */
  private readonly onsets = new Map<string, number>();
  private readonly layers = new Map<number, LayerRoots>();
  private readonly listeners = new Set<(progress: SampleLoadProgress) => void>();
  private readonly inFlight = new Map<string, Promise<void>>();
  /** Shared with the engine's other banks, so a switch's loads go first; see `SampleTraffic`. */
  private readonly traffic: SampleTraffic;
  /**
   * This bank's foreground loads under way, each holding the background back.
   * A release ends them all, since nobody waits for a load called off, even
   * while its last files land.
   */
  private readonly holds = new Set<() => void>();

  private phase: SampleLoadPhase = 'idle';
  private loadedFiles = 0;
  private loadedBytes = 0;
  private coreLoadedBytes = 0;
  private coreTotalBytes = 0;
  private lastError: string | undefined;
  private progressSnapshot: SampleLoadProgress | null = null;
  /** Bumped by releaseBuffers so in-flight decodes cannot repopulate. */
  private generation = 0;

  private readonly baseUrl: string;

  constructor(baseUrl: string, traffic: SampleTraffic = new SampleTraffic()) {
    this.baseUrl = baseUrl;
    this.traffic = traffic;
  }

  getManifest(): SamplePackManifest | null {
    return this.manifest;
  }

  urlFor(file: string): string {
    return `${this.baseUrl}${file}`;
  }

  /**
   * The pack's manifest, fetched once. A load that asks while it is on its way
   * waits for that fetch rather than starting another: each fetch takes its
   * manifest on, and a second would list every root again and count the core
   * twice, stopping the loading readout at half. A fetch that fails, or brings
   * a manifest that is refused, leaves nothing behind, so the next load to ask
   * fetches afresh.
   */
  async loadManifest(): Promise<SamplePackManifest> {
    if (this.manifest) return this.manifest;
    this.setPhase('loading-manifest');
    // Once it is over, a manifest taken on answers for itself, and a failure is
    // not what the next load waits on.
    this.manifestLoad ??= this.fetchManifest().finally(() => {
      this.manifestLoad = null;
    });
    return this.manifestLoad;
  }

  /** Fetch the manifest and take it on; see `loadManifest`. */
  private async fetchManifest(): Promise<SamplePackManifest> {
    const response = await fetch(`${this.baseUrl}manifest.json`);
    if (!response.ok) {
      this.fail(`Sample manifest failed to load (${response.status}).`);
      throw new Error(`Manifest fetch failed: ${response.status}`);
    }
    const manifest = (await response.json()) as SamplePackManifest;
    // Checked before it is taken on: a grand whose layers make no sense would
    // play its recordings at the wrong velocities, and a manifest taken on and
    // then refused would leave the piano loading forever.
    let labels: LayerLabel[] = [];
    try {
      if (!manifest.regions) labels = layerLabels(manifest.velocityLayers);
    } catch (error) {
      console.error('Sample manifest refused:', error);
      this.fail('The piano’s sample manifest could not be read.');
      throw error;
    }
    this.manifest = manifest;
    this.labels = labels;
    this.thresholds = velocityThresholds(labels);
    this.deferredLayers = new Set(
      labels.flatMap((label, index) => (DEFERRED_LAYERS.has(label) ? [index] : [])),
    );
    this.calibration = calibrationFor(manifest);
    this.tone = this.calibration ? toneCalibrationFor(manifest) : null;
    for (const entry of manifest.files) {
      let layer = this.layers.get(entry.layer);
      if (!layer) {
        layer = { entries: new Map(), roots: [], loadedRoots: [] };
        this.layers.set(entry.layer, layer);
      }
      layer.entries.set(entry.midi, entry);
      layer.roots.push(entry.midi);
      if (entry.pack === 'core' && !this.isDeferred(entry)) this.coreTotalBytes += entry.bytes;
    }
    for (const layer of this.layers.values()) layer.roots.sort((a, b) => a - b);
    return manifest;
  }

  /** Whether a file belongs to a layer decoded once the piano plays; see `DEFERRED_LAYERS`. */
  private isDeferred(entry: SamplePackFileEntry): boolean {
    return this.deferredLayers.has(entry.layer);
  }

  /**
   * Decode the core pack, nearest-to-center files first so the visible
   * keyboard range becomes playable as early as possible.
   */
  async loadCorePack(context: BaseAudioContext): Promise<void> {
    // Someone is waiting for this piano from its manifest on, so the
    // background holds back from the first request to the last, and in
    // between them.
    const end = this.holdBackground();
    try {
      await this.loadCore(context);
    } finally {
      end();
    }
  }

  private async loadCore(context: BaseAudioContext): Promise<void> {
    // A release calls a load off, from wherever it has got to — even its
    // manifest — and a load called off like that is no failure: it reports
    // nothing, and leaves nothing decoded behind it.
    const generation = this.generation;
    const manifest = await this.loadManifest();
    if (generation !== this.generation) return;
    this.lastError = undefined;
    this.setPhase('loading-core');
    // Medium first among a root's layers: the one every other falls back to
    // soonest. A pack mapped by regions has no labels, and keeps layer 1.
    const center = this.labels.length > 0 ? mediumLayer(this.labels) : 1;
    const core = manifest.files
      .filter((entry) => entry.pack === 'core' && !this.isDeferred(entry))
      .sort(
        (a, b) =>
          Math.abs(a.midi - LOAD_CENTER_MIDI) - Math.abs(b.midi - LOAD_CENTER_MIDI) ||
          Math.abs(a.layer - center) - Math.abs(b.layer - center),
      );
    try {
      await this.loadEntries(context, core, generation);
      if (generation !== this.generation) return;
      if (!this.isCoreReady()) throw new Error('Core sample pack is incomplete.');
      this.lastError = undefined;
      this.setPhase('core-ready');
    } catch (error) {
      if (generation !== this.generation) return;
      this.fail(
        error instanceof Error ? error.message : 'The core piano samples could not be loaded.',
      );
      throw error;
    }
  }

  /**
   * Decode any additional roots needed to play [lowMidi, highMidi]. Runs
   * concurrently with the core load; the phase is recomputed from actual
   * loaded state afterwards (never captured-and-restored — that races).
   *
   * Resolves once the range plays. Its deferred recordings (`DEFERRED_LAYERS`)
   * are nothing it waits for or reports on. On the piano that sounds they
   * follow in the background (`SampleTraffic`), and until they do the soft
   * layer stands in.
   */
  async ensureRangeLoaded(
    context: BaseAudioContext,
    lowMidi: number,
    highMidi: number,
  ): Promise<void> {
    const generation = this.generation;
    const manifest = await this.loadManifest();
    if (generation !== this.generation) return;
    const plays = playsRange(manifest, lowMidi, highMidi);
    const needed = manifest.files.filter((entry) => !this.buffers.has(entry.file) && plays(entry));
    const now = needed.filter((entry) => !this.isDeferred(entry));
    const later = needed.filter((entry) => this.isDeferred(entry));
    if (now.length > 0) {
      if (this.phase === 'core-ready') this.setPhase('loading-extra');
      try {
        await this.loadEntries(context, now, generation);
        if (generation !== this.generation) return;
        if (this.isCoreReady()) {
          this.lastError = undefined;
          this.setPhase('core-ready');
        }
      } catch (error) {
        if (generation !== this.generation) return;
        this.fail(error instanceof Error ? error.message : 'Piano samples could not be loaded.');
        throw error;
      }
    }
    if (this.deferredOn) void this.loadQuietly(context, later, generation, { background: true });
  }

  /**
   * Make this the piano whose deferred recordings load: every one of a key it
   * already plays, now, and from here on every one of a range it is asked for.
   * The engine calls it on the piano that sounds, once it plays. They load in
   * the background (`SampleTraffic`): two at a time across the pianos, at low
   * priority, and no new one starts while a load someone waits for is under
   * way. Resolves when those it starts on are decoded, or have failed and left
   * their stand-ins (logged, and tried again the next time they are needed);
   * never rejects.
   */
  loadDeferred(context: BaseAudioContext): Promise<void> {
    const manifest = this.manifest;
    if (!manifest || this.deferredLayers.size === 0) return Promise.resolve();
    this.deferredOn = true;
    const playable = new Set<number>();
    for (const [index, layer] of this.layers) {
      if (!this.deferredLayers.has(index)) for (const root of layer.loadedRoots) playable.add(root);
    }
    const wanted = manifest.files
      .filter(
        (entry) =>
          this.isDeferred(entry) && !this.buffers.has(entry.file) && playable.has(entry.midi),
      )
      .sort((a, b) => Math.abs(a.midi - LOAD_CENTER_MIDI) - Math.abs(b.midi - LOAD_CENTER_MIDI));
    return this.loadQuietly(context, wanted, this.generation, { background: true });
  }

  /**
   * Decode the deferred recordings these notes ask for, and wait for them: an
   * export renders the recording each of its notes wants, not the one that
   * stands in while it loads. Someone is waiting for these, so they load the
   * way the core does, four at a time at full priority, holding the
   * background back rather than queueing behind it. One that cannot be had —
   * offline before it was ever fetched, say — is left to its stand-in, as
   * live, and `getSample` marks the note so the export knows. Never rejects.
   */
  async loadRecordingsFor(
    context: BaseAudioContext,
    notes: readonly { midi: number; velocity: number }[],
  ): Promise<void> {
    const generation = this.generation;
    await this.loadManifest();
    if (generation !== this.generation || this.deferredLayers.size === 0) return;
    const wanted = new Map<string, SamplePackFileEntry>();
    for (const note of notes) {
      const layer = velocityToLayer(note.velocity, this.thresholds);
      if (!this.deferredLayers.has(layer)) continue;
      const entry = this.ownRecording(layer, note.midi);
      if (entry && !this.buffers.has(entry.file)) wanted.set(entry.file, entry);
    }
    await this.loadQuietly(context, [...wanted.values()], generation);
  }

  /**
   * The recording of `layer` made at `midi`'s own nearest root, loaded or not;
   * undefined past the reach of any.
   */
  private ownRecording(layer: number, midi: number): SamplePackFileEntry | undefined {
    const recorded = this.layers.get(layer);
    if (!recorded) return undefined;
    const root = nearestValue(recorded.roots, midi);
    if (root === undefined || Math.abs(root - midi) > MAX_ROOT_DISTANCE_SEMITONES) return undefined;
    return recorded.entries.get(root);
  }

  /**
   * Decode `entries` without saying anything to the player: a file that fails
   * is logged and left to its stand-in, and never sets the bank's error, which
   * the Play page would show whatever the phase. (A player who saved this
   * piano for offline use before its deferred layers existed plays offline
   * without them, and that is no error.) A `background` load is one nobody
   * waits for, and it gives way to every load somebody does (`SampleTraffic`).
   */
  private loadQuietly(
    context: BaseAudioContext,
    entries: readonly SamplePackFileEntry[],
    generation: number,
    { background = false }: { background?: boolean } = {},
  ): Promise<void> {
    if (entries.length === 0) return Promise.resolve();
    return this.loadEntries(context, entries, generation, { quiet: true, background }).catch(
      (error: unknown) => {
        if (generation !== this.generation) return;
        console.warn(
          'Some pianissimo recordings could not be loaded; the soft layer plays for them.',
          error,
        );
      },
    );
  }

  /**
   * What loading the core and the keys of `span` decodes in all, counted in
   * file bytes as `loadedBytes` is — so the two make a load's progress. Null
   * until the manifest is in. The deferred layers are no part of it: nothing
   * waits for them.
   */
  bytesFor(span: { low: number; high: number } | null): number | null {
    const manifest = this.manifest;
    if (!manifest) return null;
    const plays = span ? playsRange(manifest, span.low, span.high) : () => false;
    let total = 0;
    for (const entry of manifest.files) {
      if (this.isDeferred(entry)) continue;
      if (entry.pack === 'core' || plays(entry)) total += entry.bytes;
    }
    return total;
  }

  /**
   * Drop every decoded buffer, keeping the manifest and the root→entry index
   * (kilobytes of JSON, and refetching it would show a spurious manifest phase).
   * A manifest still on its way is kept too: unlike a decode, its fetch brings
   * what the bank keeps whenever it lands, so the next load waits for it rather
   * than fetching the manifest again (see `loadManifest`).
   * Voices already sounding hold their buffer through their source node and
   * finish normally.
   */
  releaseBuffers(): void {
    this.generation += 1;
    this.deferredOn = false;
    // The decodes still under way will drop what they bring, so a load after
    // this one must not wait on them: it would wait for nothing. Nor must the
    // background, on the load called off.
    this.inFlight.clear();
    for (const end of [...this.holds]) end();
    this.buffers.clear();
    this.onsets.clear();
    for (const layer of this.layers.values()) layer.loadedRoots.length = 0;
    this.loadedFiles = 0;
    this.loadedBytes = 0;
    this.coreLoadedBytes = 0;
    this.lastError = undefined;
    this.setPhase('idle');
  }

  /** Whether the core plays: every core file decoded, but for the deferred layers'. */
  isCoreReady(): boolean {
    if (!this.manifest) return false;
    return this.manifest.files
      .filter((entry) => entry.pack === 'core' && !this.isDeferred(entry))
      .every((entry) => this.buffers.has(entry.file));
  }

  isFileLoaded(file: string): boolean {
    return this.buffers.has(file);
  }

  /**
   * Whether this pack plays by a velocity calibration, so a note's velocity
   * sets its loudness on the one curve (velocityCurve.ts) and nothing else.
   * False until its manifest has loaded, and for any pack that keeps its own
   * velocity model: one mapped by regions, like the Wurlitzer, where the
   * velocity also picks the recording, or one no table wholly covers.
   */
  isCalibrated(): boolean {
    return this.calibration !== null;
  }

  /** True when a playable buffer exists near this key (any layer). */
  isMidiPlayable(midi: number): boolean {
    if (this.manifest?.regions) {
      return this.manifest.regions.some(
        (region) =>
          midi >= region.lowKey && midi <= region.highKey && this.buffers.has(region.file),
      );
    }
    for (const layer of this.layers.values()) {
      for (const root of layer.loadedRoots) {
        if (Math.abs(root - midi) <= MAX_ROOT_DISTANCE_SEMITONES) return true;
      }
    }
    return false;
  }

  /**
   * Resolve the buffer for a note: preferred velocity layer first, then the
   * nearest loaded root in any layer so partially loaded states still sound.
   * On a grand with a tone calibration, the note also gets the lowpass that
   * plays it at the brightness its velocity asks for (`voiceTone`): a
   * recording of the layer asked for follows its ramp, and a stand-in from
   * another layer during a partial load plays as near that tone as it can.
   * With `tone: false` (Settings → Sound → Tone follows touch, off) it gets
   * neither the lowpass nor its make-up, and plays its recording open, as every
   * note did before the ramps.
   *
   * A deferred layer (`DEFERRED_LAYERS`) plays only its recording of the
   * note's own root: until that one is decoded — or where it could not be — a
   * recording of the next layer at the right pitch stands in, rather than one of
   * its own pitched from further away. Any stand-in is marked `standIn`.
   */
  getSample(
    midi: number,
    velocity: number,
    { tone: toneFollowsTouch = true }: { tone?: boolean } = {},
  ): SampleSelection | null {
    if (this.manifest?.regions) return this.getMappedSample(midi, velocity);
    const preferredLayer = velocityToLayer(velocity, this.thresholds);
    for (const layerIndex of layerSearchOrder(preferredLayer, this.labels.length)) {
      const layer = this.layers.get(layerIndex);
      if (!layer || layer.loadedRoots.length === 0) continue;
      const root = nearestValue(
        this.deferredLayers.has(layerIndex) ? layer.roots : layer.loadedRoots,
        midi,
      );
      if (root === undefined || Math.abs(root - midi) > MAX_ROOT_DISTANCE_SEMITONES) continue;
      const entry = layer.entries.get(root);
      if (!entry) continue;
      const buffer = this.buffers.get(entry.file);
      if (!buffer) continue;
      // The gain is keyed on the recording actually found, not the one asked
      // for — during a partial load another layer or root stands in — since
      // what it corrects is how loudly that file was recorded. A calibrated
      // pack takes it from the level it measured to the one the velocity asks
      // for, so every layer lands on one loudness. Otherwise the pack's level
      // match multiplies the clamped velocity gain rather than feeding into it,
      // so a quietly mastered pack is not clipped back down by velocityGain's
      // own ceiling.
      const calibrated = this.calibration
        ? calibratedGain(this.calibration, velocity, midi, layerIndex, root)
        : undefined;
      const playbackRate = Math.pow(2, (midi - root) / 12);
      // The table's cutoffs are at the recording's own pitch; played higher or
      // lower, its spectrum moves with it, and so does the cutoff.
      const tone =
        this.tone && toneFollowsTouch
          ? voiceTone(this.tone, this.thresholds, velocity, preferredLayer, layerIndex, root)
          : undefined;
      const label = this.labels[preferredLayer] as LayerLabel;
      return {
        buffer,
        playbackRate,
        gain: calibrated ?? velocityGain(velocity, label) * this.levelMatchFor(layerIndex),
        offset: this.onsets.get(entry.file) ?? 0,
        releaseTc: releaseTcFor(midi),
        ...(midi >= UNDAMPED_FROM_MIDI ? { undamped: true } : {}),
        ...(tone
          ? { toneCutoffHz: tone.cutoffHz * playbackRate, toneMakeupDb: tone.makeupDb }
          : {}),
        ...(layerIndex !== preferredLayer ? { standIn: true } : {}),
      };
    }
    return null;
  }

  private getMappedSample(midi: number, velocity: number): SampleSelection | null {
    const manifest = this.manifest!;
    const clamped = Math.min(1, Math.max(0, velocity));
    const midiVelocity = Math.max(1, Math.round(clamped * 127));
    // Keep the right key mapping during partial loads; fall back only in velocity.
    const candidates = manifest
      .regions!.filter((region) => midi >= region.lowKey && midi <= region.highKey)
      .sort((a, b) => {
        const distance = (r: typeof a) =>
          Math.max(r.lowVelocity - midiVelocity, midiVelocity - r.highVelocity, 0);
        return distance(a) - distance(b);
      });
    for (const region of candidates) {
      const buffer = this.buffers.get(region.file);
      if (!buffer) continue;
      const loop = manifest.files.find((entry) => entry.file === region.file)?.loop;
      // An electric piano's tines are damped all the way up, by its own
      // envelope; only the recording's lead-in is trimmed here.
      return {
        buffer,
        playbackRate: Math.pow(2, (midi - region.root + region.tune / 100) / 12),
        gain: clamped * clamped * region.gain * (manifest.levelMatch ?? 1),
        offset: this.onsets.get(region.file) ?? 0,
        ...(loop ? { loop } : {}),
        ...(manifest.envelope ? { envelope: manifest.envelope } : {}),
      };
    }
    return null;
  }

  /**
   * How much this pack's layer must be lifted to sit at the reference pack's
   * loudness, where no calibration measures every file instead. 1 for the
   * reference pack itself, and for any manifest predating the measurement.
   */
  private levelMatchFor(layer: number): number {
    const layers = this.manifest?.velocityLayers;
    return layers?.find((entry) => entry.index === layer)?.levelMatch ?? 1;
  }

  /** Stable snapshot: same reference until progress changes (React-safe). */
  getProgress(): SampleLoadProgress {
    if (!this.progressSnapshot) {
      const progress: SampleLoadProgress = {
        phase: this.phase,
        loadedFiles: this.loadedFiles,
        totalFiles: this.manifest?.files.length ?? 0,
        loadedBytes: this.loadedBytes,
        totalBytes: this.manifest?.totalBytes ?? 0,
        coreLoadedBytes: this.coreLoadedBytes,
        coreTotalBytes: this.coreTotalBytes,
      };
      if (this.lastError !== undefined) progress.error = this.lastError;
      this.progressSnapshot = progress;
    }
    return this.progressSnapshot;
  }

  subscribe(listener: (progress: SampleLoadProgress) => void): () => void {
    this.listeners.add(listener);
    listener(this.getProgress());
    return () => this.listeners.delete(listener);
  }

  /**
   * Hold the background back until the returned function is called, or this
   * bank is released; see `SampleTraffic`.
   */
  private holdBackground(): () => void {
    const done = this.traffic.foreground();
    const end = () => {
      this.holds.delete(end);
      done();
    };
    this.holds.add(end);
    return end;
  }

  /**
   * Load `entries`, stopping at the next file once `generation` is released.
   * A `quiet` load's failures are the caller's to handle; they never become the
   * bank's error (see `loadQuietly`).
   *
   * Someone waits for a load, unless it is `background`: then it takes a turn
   * for each file (`SampleTraffic.backgroundTurn`), fetched at low priority,
   * and every other load holds it back while it runs.
   */
  private async loadEntries(
    context: BaseAudioContext,
    entries: readonly SamplePackFileEntry[],
    generation: number,
    { quiet = false, background = false }: { quiet?: boolean; background?: boolean } = {},
  ): Promise<void> {
    const end = background ? null : this.holdBackground();
    const queue = [...entries];
    const failures: unknown[] = [];
    const concurrency = background ? BACKGROUND_CONCURRENCY : FETCH_CONCURRENCY;
    const workers = Array.from({ length: concurrency }, async () => {
      for (;;) {
        // Files still queued would start after the release, and keep what they
        // decode; a release has to stop them too, not only those under way.
        if (generation !== this.generation || queue.length === 0) return;
        const turn = background ? await this.traffic.backgroundTurn() : null;
        // Released, or left with nothing, while it waited for its turn.
        const entry = generation === this.generation ? queue.shift() : undefined;
        try {
          if (!entry) return;
          await this.loadEntry(context, entry, { quiet, background });
        } catch (error) {
          failures.push(error);
        } finally {
          turn?.();
        }
      }
    });
    try {
      await Promise.all(workers);
    } finally {
      end?.();
    }
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} piano sample${failures.length === 1 ? '' : 's'} could not be loaded.`,
        { cause: failures[0] },
      );
    }
  }

  private loadEntry(
    context: BaseAudioContext,
    entry: SamplePackFileEntry,
    { quiet, background }: { quiet: boolean; background: boolean },
  ): Promise<void> {
    if (this.buffers.has(entry.file)) return Promise.resolve();
    const existing = this.inFlight.get(entry.file);
    if (existing) return existing;
    const generation = this.generation;
    const task: Promise<void> = this.fetchAndDecode(context, entry, background)
      .catch((error: unknown) => {
        // A load released mid-flight has no one left to tell.
        if (generation === this.generation) {
          if (quiet) {
            console.warn('Sample load failed:', entry.file, error);
          } else {
            this.lastError = `Could not load piano sample ${entry.file}.`;
            console.error('Sample load failed:', entry.file, error);
          }
        }
        throw error;
      })
      .finally(() => {
        // Only its own entry: after a release, a newer load may hold the key.
        if (this.inFlight.get(entry.file) === task) this.inFlight.delete(entry.file);
      });
    this.inFlight.set(entry.file, task);
    return task;
  }

  private async fetchAndDecode(
    context: BaseAudioContext,
    entry: SamplePackFileEntry,
    background: boolean,
  ): Promise<void> {
    let lastError: unknown;
    const generation = this.generation;
    // Released meanwhile, the load is called off: what is still to come — a
    // decode, a retry — would only fetch and decode something to discard.
    const released = () => generation !== this.generation;
    const url = `${this.baseUrl}${entry.file}`;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
      if (released()) return;
      try {
        // A hint, where the browser takes it (the Fetch Priority API): the
        // connections and the bandwidth go to what someone is waiting for.
        const response = await (background ? fetch(url, { priority: 'low' }) : fetch(url));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        if (released()) return;
        const buffer = await context.decodeAudioData(bytes);
        // Released mid-decode: discard rather than resurrect a freed buffer.
        if (released()) return;
        this.buffers.set(entry.file, buffer);
        this.onsets.set(entry.file, onsetOffsetOf(buffer));
        const layer = this.layers.get(entry.layer);
        if (layer && !layer.loadedRoots.includes(entry.midi)) {
          layer.loadedRoots.push(entry.midi);
          layer.loadedRoots.sort((a, b) => a - b);
        }
        this.loadedFiles += 1;
        // Progress is the piano becoming playable, which a deferred layer never
        // holds up; see `bytesFor` and `coreTotalBytes`.
        if (!this.isDeferred(entry)) {
          this.loadedBytes += entry.bytes;
          if (entry.pack === 'core') this.coreLoadedBytes += entry.bytes;
        }
        this.emit();
        return;
      } catch (error) {
        lastError = error;
        if (released()) return;
        await delay(300 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private setPhase(phase: SampleLoadPhase): void {
    this.phase = phase;
    this.emit();
  }

  private fail(message: string): void {
    this.lastError = message;
    this.setPhase('error');
  }

  private emit(): void {
    this.progressSnapshot = null;
    const progress = this.getProgress();
    for (const listener of this.listeners) listener(progress);
  }
}

/**
 * Whether a file plays some key of [lowMidi, highMidi]: a mapped region over
 * it, or a root near enough to stand in for one of its keys.
 */
function playsRange(
  manifest: SamplePackManifest,
  lowMidi: number,
  highMidi: number,
): (entry: SamplePackFileEntry) => boolean {
  if (manifest.regions) {
    const mapped = new Set(
      manifest.regions
        .filter((region) => region.lowKey <= highMidi && region.highKey >= lowMidi)
        .map((region) => region.file),
    );
    return (entry) => mapped.has(entry.file);
  }
  return (entry) =>
    entry.midi >= lowMidi - MAX_ROOT_DISTANCE_SEMITONES &&
    entry.midi <= highMidi + MAX_ROOT_DISTANCE_SEMITONES;
}

/**
 * The velocity calibration a manifest plays by: its pack version's entry in the
 * generated table, and only when that covers every file the manifest lists,
 * which it always should — both are fixed once a pack is published. A pack
 * mapped by regions (the Wurlitzer) keeps its own velocity model.
 */
function calibrationFor(manifest: SamplePackManifest): VelocityCalibration | null {
  if (manifest.regions) return null;
  const calibration = VELOCITY_CALIBRATIONS[manifest.version];
  return calibration && calibrationCovers(calibration, manifest.files) ? calibration : null;
}

/**
 * The tone calibration a manifest plays by, found the same way: its pack
 * version's entry in the generated table, when that holds every file the
 * manifest lists. Without one the layers keep their own tones, stepping in
 * brightness where they meet, as they always did.
 */
function toneCalibrationFor(manifest: SamplePackManifest): ToneCalibration | null {
  const tone = TONE_CALIBRATIONS[manifest.version];
  return tone && toneCalibrationCovers(tone, manifest.files) ? tone : null;
}

function nearestValue(sorted: readonly number[], target: number): number | undefined {
  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const value of sorted) {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
