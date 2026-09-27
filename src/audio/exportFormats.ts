import type { LoudnessMode } from './loudness';

/**
 * What an audio export can be written as. Nothing here is imported at run
 * time, so the settings, which load with the app, can name a format without
 * pulling an encoder in with them.
 */

/** MP3 to send to anyone; FLAC to keep every sample the render made. */
export const EXPORT_FORMATS = ['mp3', 'flac'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The MP3 bitrates on offer, both in the encoder's constant-bitrate set. */
export const MP3_BITRATES = [128, 192] as const;
export type ExportBitrateKbps = (typeof MP3_BITRATES)[number];

/** The bit depths a FLAC export is written at. */
export const FLAC_BIT_DEPTHS = [16, 24] as const;
export type FlacBitDepth = (typeof FLAC_BIT_DEPTHS)[number];

/** A format and its one setting: how the mastered render is written down. */
export type ExportEncoding =
  { format: 'mp3'; kbps: ExportBitrateKbps } | { format: 'flac'; bits: FlacBitDepth };

/** The two levels an export can be mastered to; see loudness.ts. */
export const LOUDNESS_MODES = ['normalized', 'asPlayed'] as const satisfies readonly LoudnessMode[];

export const FORMAT_MIME_TYPE: Record<ExportFormat, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
};

export const FORMAT_EXTENSION: Record<ExportFormat, string> = {
  mp3: 'mp3',
  flac: 'flac',
};

/** As people write it, on a button: "Download FLAC". */
export const FORMAT_NAME: Record<ExportFormat, string> = {
  mp3: 'MP3',
  flac: 'FLAC',
};
