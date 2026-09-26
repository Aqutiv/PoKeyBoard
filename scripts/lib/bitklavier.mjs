/**
 * Fetches the bitKlavier Grand's recordings for the pack build: the Lip
 * Cardioid mic image of a Steinway D, in its 48 kHz / 24-bit release
 * (https://doi.org/10.34770/xm18-yr83, CC BY 4.0).
 *
 * Princeton's data commons serves every file of the dataset over plain HTTPS
 * from a Globus endpoint, and honours Range requests, so only what the pack
 * keeps is fetched: each WAV's header and the first trim + SOURCE_MARGIN_S
 * seconds of its audio — 252 MB of the 730 MB those 90 files hold whole.
 *
 * Every fetch is pinned in bitklavier-grand-v1.pins.json: the exact number of
 * bytes asked for and the SHA-256 of what came back. They are checked before
 * anything is staged, so a rebuild either works from the very bytes the pack
 * was made from or stops and says why. `--pin` wrote that file from what
 * upstream served; run again, it must leave the file unchanged.
 *
 * Sharp-named recordings were renamed on the storage in 2024 to satisfy S3:
 * "D#1v7.wav" now lives at "D_1v7(280).wav", and 41 more of the 90. The
 * dataset's own renamed_files.txt, pinned like the audio, maps each original
 * name to where it lives now.
 */
import { createHash } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const HOST = 'https://g-ef94ef.f0ad1.36fe.data.globus.org/';
const DATASET = '10.34770/xm18-yr83/395';
const FOLDER = 'bitKlavierGrand_LipCardioid_48k24b';
const RENAME_LIST = 'renamed_files.txt';

/** Committed next to this module. Relative to the repository root, where the build runs. */
export const PINS_PATH = 'scripts/lib/bitklavier-grand-v1.pins.json';

/**
 * Seconds of audio past its trim that each fetch keeps, so the conversion's
 * `-t` always ends inside the bytes rather than at a truncated end.
 */
const SOURCE_MARGIN_S = 1;

/** The only release the build takes: 48 kHz, 24-bit PCM stereo. */
const EXPECTED = { format: 1, channels: 2, sampleRate: 48000, bitsPerSample: 24 };

/** Enough of every file to hold its RIFF header and the chunks ahead of its audio. */
const HEADER_PROBE_BYTES = 4096;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

/** A path under HOST, each segment escaped as the dataset's own listing escapes it. */
function urlFor(storedPath) {
  const escape = (segment) =>
    encodeURIComponent(segment).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `${HOST}${storedPath.split('/').map(escape).join('/')}`;
}

/**
 * The first `length` bytes of `url`, which must be that long: the server
 * refuses a range past the end (416) and reports no total size (`bytes
 * 0-4095/*`), so lengths come from the WAV header instead. A server that
 * ignores the Range header and sends the whole file (200) still gives the
 * right prefix.
 */
async function fetchPrefix(url, length, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { Range: `bytes=0-${length - 1}` } });
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length < length || (response.status === 206 && body.length !== length)) {
      throw new Error(`asked for ${length} bytes, got ${body.length}`);
    }
    return body.subarray(0, length);
  } catch (error) {
    if (attempt >= 4) throw new Error(`Fetch failed for ${url}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    return fetchPrefix(url, length, attempt + 1);
  }
}

/** A whole file. Asked for as a range, a length past its end is refused (416), not clamped. */
async function fetchWhole(url, attempt = 1) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (attempt >= 4) throw new Error(`Fetch failed for ${url}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    return fetchWhole(url, attempt + 1);
  }
}

/** The format and where the audio starts, read from a WAV's leading bytes. */
function parseWavHeader(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let format;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = {
        format: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        blockAlign: bytes.readUInt16LE(offset + 20),
        bitsPerSample: bytes.readUInt16LE(offset + 22),
      };
    }
    if (id === 'data') {
      if (!format) throw new Error('data chunk before its format');
      return { ...format, dataOffset: offset + 8, dataSize: size };
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error('no data chunk in the header bytes');
}

function checkFormat(header, name) {
  for (const [key, value] of Object.entries(EXPECTED)) {
    if (header[key] !== value) {
      throw new Error(`${name}: expected ${key} ${value}, found ${header[key]}`);
    }
  }
}

/** Every original dataset path that now lives somewhere else, to where. */
function parseRenames(text) {
  const renames = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [original, renamed] = line.split('\t').map((part) => part.trim());
    if (original?.startsWith('10.34770/') && renamed?.startsWith('10.34770/')) {
      renames.set(original, renamed);
    }
  }
  return renames;
}

/** Where a recording ("D#1v7") lives now, as a path under HOST. */
function storedPath(sourceName, renames) {
  const original = `${DATASET}/${FOLDER}/${sourceName}.wav`;
  return renames.get(original) ?? original;
}

async function readIfPinned(filePath, pin) {
  if ((await fileSize(filePath)) !== pin.bytes) return null;
  const bytes = await readFile(filePath);
  return sha256(bytes) === pin.sha256 ? bytes : null;
}

async function writeAtomically(filePath, bytes) {
  const temporary = `${filePath}.partial`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

/** The rename list, from staging when it is already there, checked against its pin either way. */
async function loadRenames(stagingDir, pin) {
  const staged = path.join(stagingDir, RENAME_LIST);
  let bytes = await readIfPinned(staged, pin);
  if (!bytes) {
    bytes = await fetchWhole(urlFor(`${DATASET}/${RENAME_LIST}`));
    if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) {
      throw new Error(
        `${RENAME_LIST} no longer matches its pin (${bytes.length} bytes, SHA-256 ` +
          `${sha256(bytes)}). Upstream changed it; review before re-pinning.`,
      );
    }
    await writeAtomically(staged, bytes);
  }
  return parseRenames(bytes.toString('utf8'));
}

async function readPins() {
  return JSON.parse(await readFile(PINS_PATH, 'utf8'));
}

/**
 * A fetcher for the build: stages one recording's pinned bytes, and fails —
 * naming the file and both hashes — the moment upstream serves anything else.
 * A staged copy that already matches its pin is used as it is.
 */
export async function bitKlavierFetcher(stagingDir, trimSecondsFor) {
  const pins = await readPins();
  let renames = null;
  return async (job) => {
    const name = `${job.sourceName}.wav`;
    const pin = pins.files[name];
    if (!pin) {
      throw new Error(`${name} is not pinned. Run the build with --pin, then review the diff.`);
    }
    if (await readIfPinned(job.staged, pin)) return { skipped: true };
    renames ??= await loadRenames(stagingDir, pins.renameList);
    const url = urlFor(storedPath(job.sourceName, renames));
    const bytes = await fetchPrefix(url, pin.bytes);
    const digest = sha256(bytes);
    if (digest !== pin.sha256) {
      throw new Error(
        `${name}: fetched ${bytes.length} bytes with SHA-256 ${digest}, but the pin is ` +
          `${pin.sha256}. Upstream no longer serves the audio this pack was built from; ` +
          `nothing was staged.`,
      );
    }
    const header = parseWavHeader(bytes);
    checkFormat(header, name);
    const audio = bytes.length - header.dataOffset;
    const held = audio / (header.sampleRate * header.blockAlign);
    if (held < trimSecondsFor(job.midi) && audio < header.dataSize) {
      throw new Error(`${name}: the pinned bytes hold ${held.toFixed(2)} s, short of the trim`);
    }
    await writeAtomically(job.staged, bytes);
    return { bytes: bytes.length };
  };
}

/**
 * Writes the pins from what upstream serves now: for each recording, its WAV
 * header plus the first trim + SOURCE_MARGIN_S seconds of audio (the whole
 * file, where it is shorter), and the SHA-256 of those bytes; the rename list
 * whole. The fetched bytes are staged too, so the build that follows reuses
 * them. Returns how many pins changed.
 */
export async function pinBitKlavier(jobs, stagingDir, trimSecondsFor) {
  const previous = await readPins().catch(() => null);
  const list = await fetchWhole(urlFor(`${DATASET}/${RENAME_LIST}`));
  await writeAtomically(path.join(stagingDir, RENAME_LIST), list);
  const renames = parseRenames(list.toString('utf8'));
  const renameList = { bytes: list.length, sha256: sha256(list) };

  const files = {};
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const name = `${job.sourceName}.wav`;
        const url = urlFor(storedPath(job.sourceName, renames));
        const header = parseWavHeader(await fetchPrefix(url, HEADER_PROBE_BYTES));
        checkFormat(header, name);
        const seconds = trimSecondsFor(job.midi) + SOURCE_MARGIN_S;
        const audio = Math.round(seconds * header.sampleRate) * header.blockAlign;
        const bytes = await fetchPrefix(url, header.dataOffset + Math.min(audio, header.dataSize));
        await writeAtomically(job.staged, bytes);
        files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
      }
    }),
  );

  const ordered = Object.fromEntries(
    jobs.map((job) => `${job.sourceName}.wav`).map((name) => [name, files[name]]),
  );
  const pins = {
    dataset: 'https://doi.org/10.34770/xm18-yr83',
    folder: `${HOST}${DATASET}/${FOLDER}/`,
    renameList,
    // Keyed by each recording's original name; the rename list says where it lives now.
    files: ordered,
  };
  await writeFile(PINS_PATH, `${JSON.stringify(pins, null, 2)}\n`);
  const same = (a, b) => a?.bytes === b?.bytes && a?.sha256 === b?.sha256;
  const changed =
    Object.entries(ordered).filter(([name, pin]) => !same(previous?.files?.[name], pin)).length +
    (same(previous?.renameList, renameList) ? 0 : 1);
  return { pinned: Object.keys(ordered).length, changed };
}
