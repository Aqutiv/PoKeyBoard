/** Identifies who triggered a note: 'pointer:<id>', 'kbd', 'playback', 'scrub'. */
export type NoteSourceId = string;

export interface SamplePackVelocityLayer {
  index: number;
  sourceLayer: number;
  label: string;
}

export interface SamplePackFileEntry {
  file: string;
  midi: number;
  layer: number;
  pack: 'core' | 'full';
  bytes: number;
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
}

/** A resolved sample for one note-on. */
export interface SampleSelection {
  buffer: AudioBuffer;
  /** 2^(semitones/12) pitch correction from the sample's root. */
  playbackRate: number;
  /** Combined layer trim and velocity gain to apply to the voice. */
  gain: number;
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
