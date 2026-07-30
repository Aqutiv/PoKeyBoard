/**
 * The pianos the app can play. Each one is a versioned sample pack under
 * public/piano/, built by scripts/build-sample-pack.mjs.
 *
 * A pack directory is immutable once published: changing the audio means a new
 * `packVersion` (see DEPLOYMENT.md), because takes record the version they were
 * played with and the export cache keys off it.
 */
export type PianoInstrumentId = 'salamander-grand' | 'headroom-grand';

export interface PianoInstrument {
  id: PianoInstrumentId;
  /** Pack directory name, also the take's `samplePackVersion`. */
  packVersion: string;
  /** Sample path relative to BASE_URL. */
  path: string;
}

export const DEFAULT_PIANO_INSTRUMENT_ID: PianoInstrumentId = 'salamander-grand';

export const PIANO_INSTRUMENTS: readonly PianoInstrument[] = [
  // v2 delivers the same Salamander audio as v1 under a .sample extension so
  // download managers (IDM etc.) stop intercepting sample fetches. The v1
  // (*.mp3) pack is retained on disk untouched so already-published URLs never
  // 404 for un-updated clients.
  {
    id: 'salamander-grand',
    packVersion: 'salamander-grand-v2',
    path: 'piano/salamander-grand-v2/',
  },
  {
    id: 'headroom-grand',
    packVersion: 'headroom-grand-v1',
    path: 'piano/headroom-grand-v1/',
  },
];

export const PIANO_INSTRUMENT_IDS = PIANO_INSTRUMENTS.map(
  (instrument) => instrument.id,
) as readonly PianoInstrumentId[];

export function pianoInstrument(id: PianoInstrumentId): PianoInstrument {
  const found = PIANO_INSTRUMENTS.find((instrument) => instrument.id === id);
  return found ?? pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID);
}

/**
 * The instrument a stored take's `samplePackVersion` refers to. Retired pack
 * versions (salamander-grand-v1) and anything unrecognised resolve to the
 * default piano, which is what such a take will actually be played with.
 */
export function instrumentForPackVersion(version: string): PianoInstrument {
  const exact = PIANO_INSTRUMENTS.find((instrument) => instrument.packVersion === version);
  if (exact) return exact;
  if (version.startsWith('salamander-grand')) return pianoInstrument('salamander-grand');
  return pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID);
}
