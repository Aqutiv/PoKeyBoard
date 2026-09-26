/**
 * The pianos the app can play. Each one is a versioned sample pack under
 * public/piano/, built by scripts/build-sample-pack.mjs.
 *
 * A pack directory is immutable once published: changing the audio means a new
 * `packVersion` (see DEPLOYMENT.md), because takes record the version they were
 * played with and the export cache keys off it.
 */
export type PianoInstrumentId =
  'salamander-grand' | 'headroom-grand' | 'bitklavier-grand' | 'wurlitzer-ep203w';

export interface PianoInstrument {
  id: PianoInstrumentId;
  /** Pack directory name, also the take's `samplePackVersion`. */
  packVersion: string;
  /** Short name of the piano, used in export file names. Not translated. */
  name: string;
  /** Sample path relative to BASE_URL. */
  path: string;
  /**
   * The General MIDI program a MIDI export names, numbered from zero: what a
   * sequencer that never heard of this piano should play instead.
   */
  midiProgram: number;
}

export const DEFAULT_PIANO_INSTRUMENT_ID: PianoInstrumentId = 'salamander-grand';

// The immediately-previous generation stays on disk untouched so already-
// published URLs never 404 for clients still running an older app shell —
// currently salamander-grand-v2 and headroom-grand-v1, the mono 128kbps MP3
// packs this stereo FLAC generation replaces. Older generations than that are
// retired: salamander-grand-v1 (*.mp3, from before the neutral extension) was
// dropped when v3 shipped.
export const PIANO_INSTRUMENTS: readonly PianoInstrument[] = [
  {
    id: 'salamander-grand',
    packVersion: 'salamander-grand-v3',
    name: 'Salamander',
    path: 'piano/salamander-grand-v3/',
    midiProgram: 0, // Acoustic Grand Piano
  },
  {
    id: 'headroom-grand',
    packVersion: 'headroom-grand-v2',
    name: 'Headroom',
    path: 'piano/headroom-grand-v2/',
    midiProgram: 0, // Acoustic Grand Piano
  },
  {
    // The bitKlavier Grand's Steinway D, shown by the piano's name; the id and
    // the pack keep the library's, since takes and settings store them.
    id: 'bitklavier-grand',
    packVersion: 'bitklavier-grand-v1',
    name: 'Steinway',
    path: 'piano/bitklavier-grand-v1/',
    midiProgram: 0, // Acoustic Grand Piano
  },
  {
    id: 'wurlitzer-ep203w',
    name: 'Wurlitzer',
    packVersion: 'wurlitzer-ep203w-v1',
    path: 'piano/wurlitzer-ep203w-v1/',
    midiProgram: 4, // Electric Piano 1, General MIDI's nearest to a Wurlitzer
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
 * The instrument a stored take's `samplePackVersion` refers to. A retired pack
 * version still resolves to its piano — every pack directory is `<id>-vN`, so
 * dropping the version suffix leaves the instrument id. Anything unrecognised
 * resolves to the default piano, which is what such a take will be played with.
 */
export function instrumentForPackVersion(version: string): PianoInstrument {
  const exact = PIANO_INSTRUMENTS.find((instrument) => instrument.packVersion === version);
  if (exact) return exact;
  const base = version.replace(/-v\d+$/, '');
  const retired = PIANO_INSTRUMENTS.find((instrument) => instrument.id === base);
  return retired ?? pianoInstrument(DEFAULT_PIANO_INSTRUMENT_ID);
}
