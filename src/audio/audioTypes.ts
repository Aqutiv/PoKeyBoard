/** Identifies who triggered a note: 'pointer:<id>', 'kbd', 'gamepad', 'midi', 'playback', 'scrub'. */
export type NoteSourceId = string;

export interface SamplePackVelocityLayer {
  index: number;
  sourceLayer: number;
  label: string;
  /**
   * Gain multiplier that brings this layer up to the loudness of the same layer
   * in the reference pack, measured at build time. Absent on the reference pack
   * itself, where SampleBank's own layer trims already describe the level.
   */
  levelMatch?: number;
}

export interface SamplePackFileEntry {
  file: string;
  midi: number;
  layer: number;
  pack: 'core' | 'full';
  bytes: number;
  /** Seconds in the source audio, independent of the context's decode rate. */
  loop?: { start: number; end: number };
}

export interface SampleEnvelope {
  attack: number;
  hold: number;
  decay: number;
  release: number;
}

export interface SampleRegion {
  file: string;
  lowKey: number;
  highKey: number;
  root: number;
  lowVelocity: number;
  highVelocity: number;
  layer: number;
  tune: number;
  gain: number;
}

export interface SamplePackManifest {
  version: string;
  source: string;
  license: string;
  sourceUrl: string;
  format: string;
  velocityLayers: SamplePackVelocityLayer[];
  coreBytes: number;
  totalBytes: number;
  files: SamplePackFileEntry[];
  /** Explicit mapping for instruments with irregular roots and velocity bands. */
  regions?: SampleRegion[];
  envelope?: SampleEnvelope;
  /** One instrument-wide gain, preserving the source's relative dynamics. */
  levelMatch?: number;
}

/** A resolved sample for one note-on. */
export interface SampleSelection {
  buffer: AudioBuffer;
  /** 2^(semitones/12) pitch correction from the sample's root. */
  playbackRate: number;
  /** Combined layer trim and velocity gain to apply to the voice. */
  gain: number;
  loop?: { start: number; end: number };
  envelope?: SampleEnvelope;
}

export type SampleLoadPhase =
  'idle' | 'loading-manifest' | 'loading-core' | 'core-ready' | 'loading-extra' | 'error';

export interface SampleLoadProgress {
  phase: SampleLoadPhase;
  loadedFiles: number;
  totalFiles: number;
  loadedBytes: number;
  totalBytes: number;
  error?: string;
}

export type EngineStatus = 'uninitialized' | 'suspended' | 'running' | 'error';

export interface ScheduledNoteEvent {
  midi: number;
  velocity: number;
  durationMs: number;
}
