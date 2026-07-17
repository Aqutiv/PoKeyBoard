import type {
  SampleLoadPhase,
  SampleLoadProgress,
  SamplePackFileEntry,
  SamplePackManifest,
  SampleSelection,
} from './audioTypes';

/** Velocity below the first threshold → soft layer, below the second → medium. */
export const VELOCITY_LAYER_THRESHOLDS: readonly [number, number] = [0.45, 0.78];

/** Perceptual center velocity each recorded layer represents. */
const LAYER_REFERENCE_VELOCITY = [0.3, 0.6, 0.9] as const;

/** Static trims that roughly balance the layers' recorded loudness. */
const LAYER_TRIM = [1.35, 1.1, 0.95] as const;

/** Keyboard center (F#4-ish) used to prioritize sample loading order. */
const LOAD_CENTER_MIDI = 66;

const MAX_ROOT_DISTANCE_SEMITONES = 9;
const FETCH_CONCURRENCY = 4;
const FETCH_RETRIES = 2;

export function velocityToLayer(velocity: number): number {
  if (velocity < VELOCITY_LAYER_THRESHOLDS[0]) return 0;
  if (velocity < VELOCITY_LAYER_THRESHOLDS[1]) return 1;
  return 2;
}

/**
 * Per-voice gain: the layer's static trim scaled by how far the played
 * velocity sits from the layer's reference, keeping loudness continuous
 * across layer boundaries without flattening the samples' own dynamics.
 */
export function velocityGain(velocity: number, layer: number): number {
  const clamped = Math.min(1, Math.max(0.02, velocity));
  const reference = LAYER_REFERENCE_VELOCITY[layer] ?? 0.6;
  const trim = LAYER_TRIM[layer] ?? 1;
  const gain = trim * Math.pow(clamped / reference, 0.6);
  return Math.min(1.7, Math.max(0.25, gain));
}

interface LayerRoots {
  /** rootMidi → manifest entry, for every file in the pack. */
  entries: Map<number, SamplePackFileEntry>;
  /** Sorted midi roots whose buffers are decoded and playable. */
  loadedRoots: number[];
}

/**
 * Loads, decodes, and maps the versioned piano sample pack. Buffers are
 * decoded once and shared between the live context and offline renders.
 */
export class SampleBank {
  private manifest: SamplePackManifest | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly layers = new Map<number, LayerRoots>();
  private readonly listeners = new Set<(progress: SampleLoadProgress) => void>();
  private readonly inFlight = new Map<string, Promise<void>>();

  private phase: SampleLoadPhase = 'idle';
  private loadedFiles = 0;
  private loadedBytes = 0;
  private lastError: string | undefined;
  private progressSnapshot: SampleLoadProgress | null = null;

  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  getManifest(): SamplePackManifest | null {
    return this.manifest;
  }

  urlFor(file: string): string {
    return `${this.baseUrl}${file}`;
  }

  async loadManifest(): Promise<SamplePackManifest> {
    if (this.manifest) return this.manifest;
    this.setPhase('loading-manifest');
    const response = await fetch(`${this.baseUrl}manifest.json`);
    if (!response.ok) {
      this.fail(`Sample manifest failed to load (${response.status}).`);
      throw new Error(`Manifest fetch failed: ${response.status}`);
    }
    const manifest = (await response.json()) as SamplePackManifest;
    this.manifest = manifest;
    for (const entry of manifest.files) {
      let layer = this.layers.get(entry.layer);
      if (!layer) {
        layer = { entries: new Map(), loadedRoots: [] };
        this.layers.set(entry.layer, layer);
      }
      layer.entries.set(entry.midi, entry);
    }
    return manifest;
  }

  /**
   * Decode the core pack, nearest-to-center files first so the visible
   * keyboard range becomes playable as early as possible.
   */
  async loadCorePack(context: BaseAudioContext): Promise<void> {
    const manifest = await this.loadManifest();
    this.setPhase('loading-core');
    const core = manifest.files
      .filter((entry) => entry.pack === 'core')
      .sort(
        (a, b) =>
          Math.abs(a.midi - LOAD_CENTER_MIDI) - Math.abs(b.midi - LOAD_CENTER_MIDI) ||
          Math.abs(a.layer - 1) - Math.abs(b.layer - 1),
      );
    await this.loadEntries(context, core);
    this.setPhase(this.isCoreReady() ? 'core-ready' : 'error');
  }

  /**
   * Decode any additional roots needed to play [lowMidi, highMidi]. Runs
   * concurrently with the core load; the phase is recomputed from actual
   * loaded state afterwards (never captured-and-restored — that races).
   */
  async ensureRangeLoaded(
    context: BaseAudioContext,
    lowMidi: number,
    highMidi: number,
  ): Promise<void> {
    const manifest = await this.loadManifest();
    const needed = manifest.files.filter(
      (entry) =>
        !this.buffers.has(entry.file) &&
        entry.midi >= lowMidi - MAX_ROOT_DISTANCE_SEMITONES &&
        entry.midi <= highMidi + MAX_ROOT_DISTANCE_SEMITONES,
    );
    if (needed.length === 0) return;
    if (this.phase === 'core-ready') this.setPhase('loading-extra');
    await this.loadEntries(context, needed);
    if (this.isCoreReady()) this.setPhase('core-ready');
  }

  isCoreReady(): boolean {
    if (!this.manifest) return false;
    return this.manifest.files
      .filter((entry) => entry.pack === 'core')
      .every((entry) => this.buffers.has(entry.file));
  }

  isFileLoaded(file: string): boolean {
    return this.buffers.has(file);
  }

  /** True when a playable buffer exists near this key (any layer). */
  isMidiPlayable(midi: number): boolean {
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
   */
  getSample(midi: number, velocity: number): SampleSelection | null {
    const preferredLayer = velocityToLayer(velocity);
    const order = [preferredLayer, 1, 0, 2].filter((v, i, arr) => arr.indexOf(v) === i);
    for (const layerIndex of order) {
      const layer = this.layers.get(layerIndex);
      if (!layer || layer.loadedRoots.length === 0) continue;
      const root = nearestValue(layer.loadedRoots, midi);
      if (root === undefined || Math.abs(root - midi) > MAX_ROOT_DISTANCE_SEMITONES) continue;
      const entry = layer.entries.get(root);
      if (!entry) continue;
      const buffer = this.buffers.get(entry.file);
      if (!buffer) continue;
      return {
        buffer,
        playbackRate: Math.pow(2, (midi - root) / 12),
        gain: velocityGain(velocity, preferredLayer),
      };
    }
    return null;
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

  private async loadEntries(
    context: BaseAudioContext,
    entries: SamplePackFileEntry[],
  ): Promise<void> {
    const queue = [...entries];
    const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
      for (;;) {
        const entry = queue.shift();
        if (!entry) return;
        await this.loadEntry(context, entry);
      }
    });
    await Promise.all(workers);
  }

  private loadEntry(context: BaseAudioContext, entry: SamplePackFileEntry): Promise<void> {
    if (this.buffers.has(entry.file)) return Promise.resolve();
    const existing = this.inFlight.get(entry.file);
    if (existing) return existing;
    const task = this.fetchAndDecode(context, entry)
      .catch((error: unknown) => {
        this.lastError = `Could not load piano sample ${entry.file}.`;
        console.error('Sample load failed:', entry.file, error);
      })
      .finally(() => this.inFlight.delete(entry.file));
    this.inFlight.set(entry.file, task);
    return task;
  }

  private async fetchAndDecode(
    context: BaseAudioContext,
    entry: SamplePackFileEntry,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${entry.file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        this.buffers.set(entry.file, buffer);
        const layer = this.layers.get(entry.layer);
        if (layer && !layer.loadedRoots.includes(entry.midi)) {
          layer.loadedRoots.push(entry.midi);
          layer.loadedRoots.sort((a, b) => a - b);
        }
        this.loadedFiles += 1;
        this.loadedBytes += entry.bytes;
        this.emit();
        return;
      } catch (error) {
        lastError = error;
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
