/**
 * Builds a PoKeyBoard piano sample pack from a freely licensed upstream source.
 *
 * Usage: node scripts/build-sample-pack.mjs <pack-version> [--pin]
 *   salamander-grand-v4  Salamander Grand Piano v3 (Yamaha C5, Alexander Holm)
 *   headroom-grand-v2    Headroom Piano (Yamaha C3, Bengt Nilsson)
 *   bitklavier-grand-v2  bitKlavier Grand, Lip Cardioid (Steinway D, Princeton)
 *   wurlitzer-ep203w-v1  Wurlitzer EP203W (Greg Sullivan), native looped FLACs
 *
 * Build the reference pack first — every other pack is level-matched against
 * its converted files on disk.
 *
 * Downloads a few velocity layers of the upstream recordings at minor-third
 * roots into samples-staging/<pack-version>/, converts each to a trimmed,
 * faded stereo 16-bit FLAC in public/piano/<pack-version>/ (the .sample
 * extension keeps download managers from intercepting fetches; browsers decode
 * from the bytes, never the extension or Content-Type), and writes a
 * manifest.json describing every file (midi root, layer, pack membership, size)
 * plus the per-layer level match against the reference pack. A layer the pack
 * re-uses from an earlier generation is listed from where that one published
 * it, never fetched or converted again.
 *
 * A pack whose source fetches are pinned (bitklavier-grand-v2) checks every
 * one against its pins; `--pin` rewrites the pins from what upstream serves
 * now, and converts nothing.
 *
 * Idempotent: existing staged sources and converted samples are reused.
 * Requires: Node 20.19+ or 22.12+ and ffmpeg on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { bitKlavierFetcher, pinBitKlavier, pinsPathFor } from './lib/bitklavier.mjs';
import { END_WINDOW_S, endsFaded, FADE_S, fadeOut } from './lib/sampleFade.mjs';
import { buildWurlitzer } from './lib/wurlitzer.mjs';

const STAGING_ROOT = 'samples-staging';

// Upstream files use literal sharps ("D#1v5.flac"); we keep an "s" variant
// locally so nothing served over HTTP ever contains a "#".
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi) {
  const pitch = PITCH_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pitch}${octave}`;
}

function safeName(sourceName) {
  return sourceName.replace('#', 's');
}

/**
 * Every pack we can build. `layers` maps the upstream velocity layers we sample
 * onto the app's labelled ones — pianissimo, soft, medium, loud, softest first
 * (src/audio/velocityLayers.ts) — and `sourceName` names the upstream file
 * (extension excluded) for a given root and layer. A layer's `gainDb`, where it
 * has one, is applied before the 16-bit quantisation; see `measureSourceGains`.
 * A pack with its own `fetcher` (and `pin`) fetches its sources that way
 * instead of from `rawBase`.
 *
 * A layer with `from` re-uses that earlier generation's published files as
 * they are (`reusedLayers`): the same recordings at the same URLs, so a new
 * generation that only adds a layer costs players only that layer. The pack
 * it names is then part of this one, and stays on disk as long as this does.
 *
 * `fadeFromTrim` marks a pack published before the fade-out learned a short
 * recording's length (scripts/lib/sampleFade.mjs): its fade starts 1.5 s before
 * the trim even where the recording ends sooner, so it starts past the end or
 * is cut off partway. Kept so this script still reproduces the files it
 * published, byte for byte; a new generation drops it, as salamander-grand-v4
 * did — the v3 files it re-uses keep the fade they were published with.
 *
 * Only the *current* packs live here. Published packs are immutable (see
 * src/audio/instruments.ts), so a superseded version is never rebuilt — check
 * out the script at its tag if you ever need to reproduce one.
 *
 * `sampleRate` is always the source's own rate: resampling here would alter the
 * samples and cost us the losslessness that is the whole point of FLAC. The
 * browser resamples to the output rate at decode anyway, and playbackRate
 * pitch-shifting already puts its resampler in the path of most notes.
 */
const INSTRUMENTS = {
  'salamander-grand-v4': {
    rawBase: 'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples',
    sampleRate: 48000,
    // v3's three layers as they were published, and a pianissimo under them:
    // upstream's v2, whose own level sits at a median velocity of 0.25 across
    // the keyboard (0.09–0.38) where v5, the soft layer, sits at 0.42 — so it
    // takes the band under 0.30 (BS.1770, 300 ms from the onset, as the velocity
    // calibration measures). v3's files keep their fade from the trim; the new
    // ones fade from the recording's end where that comes first.
    layers: [
      { index: 0, sourceLayer: 2, label: 'pianissimo' },
      { index: 1, sourceLayer: 5, label: 'soft', from: 'salamander-grand-v3' },
      { index: 2, sourceLayer: 10, label: 'medium', from: 'salamander-grand-v3' },
      { index: 3, sourceLayer: 15, label: 'loud', from: 'salamander-grand-v3' },
    ],
    sourceName: (midi, layer) => `${midiToNoteName(midi)}v${layer.sourceLayer}`,
    source: 'Salamander Grand Piano v3 by Alexander Holm',
    license: 'CC-BY 3.0',
    sourceUrl: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
  },
  'headroom-grand-v2': {
    rawBase:
      'https://raw.githubusercontent.com/sfzinstruments/BengtNilsson.HeadroomPiano/master/Samples',
    sampleRate: 44100,
    // Upstream splits MIDI velocity 5 ways (1-59, 60-89, 90-105, 106-119,
    // 120-127); levels 1/3/5 spread our three layers across that range.
    layers: [
      { index: 0, sourceLayer: 1, label: 'soft' },
      { index: 1, sourceLayer: 3, label: 'medium' },
      { index: 2, sourceLayer: 5, label: 'loud' },
    ],
    // The close mic stays dry, so the app's reverb slider keeps full control;
    // the alternative Decca Tree position bakes the room into the samples.
    sourceName: (midi, layer) => `HEADROOM PIANO LEVEL${layer.sourceLayer} CLOSE ${midi}`,
    fadeFromTrim: true,
    source: 'Headroom Piano (Yamaha C3) by Bengt Nilsson, sfz mapping by kinwie',
    license: 'CC-BY 4.0',
    sourceUrl: 'https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano',
  },
  'bitklavier-grand-v2': {
    sampleRate: 48000,
    // Sixteen layers spread over the whole Steinway D, 1.4–2.4 dB apart, so the
    // v5/v10/v15 that Salamander ships would step 9.7 and 7.7 dB here, where
    // Salamander's own step 5.6 and 6.2 (K-weighted, 300 ms from the onset,
    // over ten roots A0–C8). v1 published v7/v10/v14, which step 5.4 and 6.3,
    // each layer inside the band the app's thresholds (0.45, 0.78) cut from
    // bitKlavier's own linear velocity map: v1–v7, v8–v12, v13–v16. v14 also
    // keeps the loud layer clear of F♯6's v15, which clips in the source.
    //
    // v2 re-uses those three as published, and adds a pianissimo under them:
    // upstream's v5, 4–5 dB under v7, whose own level sits at velocity 0.24–0.37
    // across the keyboard (0.30 at middle C) — the band under 0.30, as
    // Salamander's v2 takes it.
    //
    // The gains are measured (see `measureSourceGains`; the build insists on
    // them). v1 found 7.1 and 5.8 dB bring the soft and medium layers to
    // Salamander's level, while the loud layer's 5 dB is held to 0.33 by F♯6
    // v14, which peaks at −1.34 dBFS; its manifest levelMatch carries the rest.
    // v2 found 6.3 dB brings the pianissimo layer to Salamander's, far under
    // its ceiling: its loudest recording, C6 v5, peaks at −19.6 dBFS.
    layers: [
      { index: 0, sourceLayer: 5, label: 'pianissimo', gainDb: 6.29 },
      { index: 1, sourceLayer: 7, label: 'soft', from: 'bitklavier-grand-v1' },
      { index: 2, sourceLayer: 10, label: 'medium', from: 'bitklavier-grand-v1' },
      { index: 3, sourceLayer: 14, label: 'loud', from: 'bitklavier-grand-v1' },
    ],
    sourceName: (midi, layer) => `${midiToNoteName(midi)}v${layer.sourceLayer}`,
    sourceExtension: 'wav',
    fetcher: (stagingDir) =>
      bitKlavierFetcher(stagingDir, trimSecondsFor, pinsPathFor('bitklavier-grand-v2')),
    pin: (jobs, stagingDir) =>
      pinBitKlavier(jobs, stagingDir, trimSecondsFor, pinsPathFor('bitklavier-grand-v2')),
    source:
      'bitKlavier Grand Sample Library—Lip Cardioid Mic Image (Steinway D) by Matthew Wang, ' +
      'Andrés Villalta, Jeffrey Gordon, Katie Chou, Christien Ayers and Daniel Trueman, ' +
      'Princeton University',
    license: 'CC-BY 4.0',
    sourceUrl: 'https://doi.org/10.34770/xm18-yr83',
  },
};

/**
 * The pack every other pack is level-matched against, so switching pianos
 * changes their character and not their loudness. Its own manifest carries no
 * level match (the uncalibrated trims in velocityLayers.ts already describe
 * it). It must be built first, since every other pack is measured against its
 * files on disk — layer by layer, by label.
 */
const REFERENCE_PACK = 'salamander-grand-v4';

/**
 * Published packs that are no longer built. Named rather than merely absent so
 * asking for one gives a reason instead of "unknown pack". Retired is not gone:
 * salamander-grand-v3 and bitklavier-grand-v1 are no longer built, but their
 * successors list their files (`from`), so they stay on disk as part of them.
 */
const RETIRED_PACKS = new Set([
  'salamander-grand-v1',
  'salamander-grand-v2',
  'salamander-grand-v3',
  'headroom-grand-v1',
  'bitklavier-grand-v1',
]);

/** Core pack roots cover the default visible C3-B5 range (with margins). */
const CORE_ROOT_MIN = 45; // A2
const CORE_ROOT_MAX = 84; // C6

/** Seconds of each sample's attack that the level measurement listens to. */
const LEVEL_WINDOW_S = 2;

/** Widest level correction a pack may ask for, either direction. */
const MAX_LEVEL_MATCH = 8;

/**
 * The highest any sample may peak once its layer's gain before dither is
 * applied, in dBFS: room for the dither itself, and for the peaks between
 * samples that resampling to the device's rate brings out.
 */
const GAIN_CEILING_DB = -1;

/** Roots every minor third from A0 (21) to C8 (108). */
function rootMidis() {
  const midis = [];
  for (let midi = 21; midi <= 108; midi += 3) midis.push(midi);
  return midis;
}

/**
 * Trim lengths balance natural decay against decoded-PCM memory on phones
 * (stereo float32 at 48kHz costs ~384KB per second per sample).
 */
function trimSecondsFor(midi) {
  // Low strings ring far longer; keep more of their natural decay.
  if (midi < 48) return 12;
  if (midi < 72) return 9;
  return 7;
}

async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch {
    return 0;
  }
}

async function download(job, attempt = 1) {
  if ((await fileSize(job.staged)) > 0) return { skipped: true };
  const url = `${job.rawBase}/${encodeURIComponent(`${job.sourceName}.flac`)}`;
  const response = await fetch(url);
  if (!response.ok) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      return download(job, attempt + 1);
    }
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000) {
    throw new Error(`Suspiciously small download for ${job.name} (${bytes.length} bytes)`);
  }
  const temporary = `${job.staged}.partial`;
  await writeFile(temporary, bytes);
  if ((await fileSize(temporary)) !== bytes.length) {
    throw new Error(`Incomplete temporary download for ${job.name}`);
  }
  await rename(temporary, job.staged);
  return { bytes: bytes.length };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

/**
 * A file decoded to float at `sampleRate`, in stereo: its samples, one array
 * per channel, and how many seconds it really holds. Decoded rather than read
 * from a header, which for a range-fetched WAV names the whole upstream file,
 * not the bytes that were fetched.
 */
function decodeStereo(filePath, sampleRate) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-i', filePath, '-ac', '2', '-ar', String(sampleRate), '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks = [];
    let errors = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      errors += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code} on ${filePath}: ${errors.slice(-600)}`));
        return;
      }
      const bytes = Buffer.concat(chunks);
      const frames = Math.floor(bytes.length / 8);
      const channels = [new Float32Array(frames), new Float32Array(frames)];
      for (let frame = 0; frame < frames; frame += 1) {
        channels[0][frame] = bytes.readFloatLE(frame * 8);
        channels[1][frame] = bytes.readFloatLE(frame * 8 + 4);
      }
      resolve({ channels, seconds: frames / sampleRate });
    });
  });
}

/** Seconds as ffmpeg reads them, to the microsecond, without float noise ("5.5", "1.992"). */
function secondsArg(seconds) {
  return String(Number(seconds.toFixed(6)));
}

async function convert(job) {
  if ((await fileSize(job.output)) > 0) return { skipped: true };
  const trim = trimSecondsFor(job.midi);
  // The fade runs over the last FADE_S of what the sample keeps: the trim, or
  // the whole recording where that is shorter.
  const { startS, lengthS } = job.fadeFromTrim
    ? { startS: trim - FADE_S, lengthS: FADE_S }
    : fadeOut(trim, (await decodeStereo(job.staged, job.sampleRate)).seconds);
  // The gain runs in float with the fade, so both land ahead of the one
  // quantisation to 16 bits below, and its dither is added at the level the
  // pack plays from.
  const filters = [`afade=t=out:st=${secondsArg(startS)}:d=${secondsArg(lengthS)}`];
  if (job.layer.gainDb !== undefined) {
    filters.unshift(`volume=${job.layer.gainDb}dB:precision=float`);
  }
  // ffmpeg picks the muxer from the extension, so encode to .flac and rename.
  // The temp file lives in staging, never in the published pack directory: an
  // aborted build must not leave a .partial.flac where `vite build` would copy
  // it into dist/. Same volume as the output, so the rename stays atomic.
  const temporary = path.join(job.stagingDir, `${path.basename(job.file, '.sample')}.partial.flac`);
  // Stereo, because the mono downmix was throwing away most of what makes a
  // piano sound real on headphones — the recorded image, which the app was
  // then approximating with decorrelated reverb noise. FLAC because it is the
  // only candidate with no encoder priming delay: lossy codecs push the attack
  // later (AAC by ~48ms), which an instrument cannot afford.
  await runFfmpeg([
    '-y',
    '-i',
    job.staged,
    '-t',
    String(trim),
    '-af',
    filters.join(','),
    '-ar',
    String(job.sampleRate),
    '-ac',
    '2',
    '-sample_fmt',
    's16',
    // swresample dithers nothing by default, and dithers only where the chain
    // leaves 16 bits: a 24-bit source, or a gain in float. A 16-bit source
    // (Headroom) stays 16-bit throughout, so there this does nothing — the audio
    // ahead of the fade stays bit-identical to the source, and afade requantizes
    // the fade itself undithered. High-passed TPDF keeps the noise out of the
    // way; noise-shaped modes would stack audible hiss across three layers
    // sounding at once.
    '-dither_method',
    'triangular_hp',
    '-c:a',
    'flac',
    '-compression_level',
    '8',
    // Reproducible bytes across ffmpeg versions: no version-stamped vendor
    // string, no inherited upstream tags. Protects the no-op rebuild guarantee.
    '-map_metadata',
    '-1',
    '-bitexact',
    temporary,
  ]);
  if ((await fileSize(temporary)) === 0) {
    throw new Error(`ffmpeg produced an empty temporary file for ${job.name}`);
  }
  // A sample that stops short of silence clicks as it ends, and an undamped
  // key plays its sample to the very end, so nothing is published that does.
  // The packs that predate this fade are left to reproduce what they shipped.
  if (!job.fadeFromTrim) {
    const written = await decodeStereo(temporary, job.sampleRate);
    const { faded, last, ceiling } = endsFaded(written.channels, job.sampleRate, lengthS);
    if (!faded) {
      throw new Error(
        `${job.file} does not end faded: its last ${END_WINDOW_S * 1000} ms peak at ` +
          `${toDb(last).toFixed(1)} dBFS, over the ${toDb(ceiling).toFixed(1)} dBFS its fade allows`,
      );
    }
  }
  await rename(temporary, job.output);
  return {};
}

/** RMS level of a converted sample's attack, in dBFS. */
async function measureRms(filePath) {
  const stderr = await runFfmpeg([
    '-hide_banner',
    '-t',
    String(LEVEL_WINDOW_S),
    '-i',
    filePath,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ]);
  const match = /mean_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(stderr);
  if (!match) throw new Error(`volumedetect reported no mean_volume for ${filePath}`);
  return Math.pow(10, Number(match[1]) / 20);
}

/** The largest sample magnitude over a file's first `seconds`, as a linear amplitude. */
function samplePeak(filePath, seconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-t', String(seconds), '-i', filePath, '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks = [];
    let errors = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      errors += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code} on ${filePath}: ${errors.slice(-600)}`));
        return;
      }
      const bytes = Buffer.concat(chunks);
      let peak = 0;
      for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
        peak = Math.max(peak, Math.abs(bytes.readFloatLE(offset)));
      }
      resolve(peak);
    });
  });
}

/**
 * Each layer's gain before dither, measured from the staged sources: the
 * level match against the reference pack's same layer, measured exactly as
 * the manifest's `levelMatch` is (attack RMS, averaged over the layer's
 * roots), but held down where it would take any of the layer's samples over
 * GAIN_CEILING_DB across the part the pack keeps.
 *
 * A source mastered well below the reference would otherwise be quantised to
 * 16 bits where it sits, and every dB the app then adds at playback would lift
 * the dither floor with it. Whatever the ceiling holds back is left to the
 * manifest's `levelMatch`, which the app applies in float after decoding.
 */
async function measureSourceGains(jobs, layers) {
  const referenceManifest = await builtPackManifest(REFERENCE_PACK);
  if (!referenceManifest) {
    throw new Error(`Reference pack ${REFERENCE_PACK} is not built, so gains cannot be measured.`);
  }
  const reference = await measurePackLevels(REFERENCE_PACK, referenceManifest);
  const levels = new Map();
  const failures = await runPool(
    jobs,
    async (job) => {
      const rms = await measureRms(job.staged);
      const peak = await samplePeak(job.staged, trimSecondsFor(job.midi));
      const bucket = levels.get(job.layer.label) ?? { total: 0, count: 0, peak: 0, loudest: '' };
      bucket.total += rms;
      bucket.count += 1;
      if (peak > bucket.peak) Object.assign(bucket, { peak, loudest: job.name });
      levels.set(job.layer.label, bucket);
    },
    4,
  );
  if (failures > 0) throw new Error('Source level measurement failed.');
  return layers.map((layer) => {
    const bucket = levels.get(layer.label);
    // Matched by what the layers are, not where they are numbered: a pack's
    // pianissimo layer against the reference's pianissimo, its soft against soft.
    const referenceRms = reference.get(layer.label);
    if (!bucket || !referenceRms) {
      throw new Error(`No ${layer.label} layer to measure against in ${REFERENCE_PACK}.`);
    }
    const matchDb = toDb(referenceRms / (bucket.total / bucket.count));
    const ceilingDb = GAIN_CEILING_DB - toDb(bucket.peak);
    // Rounded to a hundredth of a dB; down, where the ceiling decides, and
    // clear of it by more than the dither can add (2 LSB, 0.0006 dB there).
    const gainDb = Math.min(
      Number(matchDb.toFixed(2)),
      Math.floor((ceilingDb - 0.001) * 100) / 100,
    );
    return {
      layer,
      matchDb,
      ceilingDb,
      gainDb,
      peakDb: toDb(bucket.peak),
      loudest: bucket.loudest,
    };
  });
}

/**
 * The layers a pack re-uses from one it extends (`from`): for each, keyed by
 * label, the source pack's own description of it and its files as entries of
 * this pack's manifest, each listed by its path from here
 * (`../<source>/<file>`) — the very URL the source pack publishes it at, so a
 * player who has it cached has it, and nothing is downloaded twice.
 *
 * Checked against the disk: every file there at the size its manifest gives,
 * and the source the same piano. (Deleting a piano's saved samples matches
 * every generation of that piano by name, so a file shared between two
 * pianos would go with either.)
 */
async function reusedLayers(packVersion, layers) {
  const reused = new Map();
  for (const layer of layers) {
    if (!layer.from) continue;
    if (instrumentOf(layer.from) !== instrumentOf(packVersion)) {
      throw new Error(`${packVersion} can re-use a pack of its own piano only, not ${layer.from}.`);
    }
    const source = await builtPackManifest(layer.from);
    if (!source) {
      throw new Error(`${layer.from} is not on disk, so ${packVersion} cannot re-use it.`);
    }
    const described = source.velocityLayers.find((entry) => entry.label === layer.label);
    if (!described || described.sourceLayer !== layer.sourceLayer) {
      throw new Error(
        `${layer.from} has no ${layer.label} layer of upstream v${layer.sourceLayer} to re-use.`,
      );
    }
    const entries = [];
    for (const entry of source.files.filter((file) => file.layer === described.index)) {
      const onDisk = await fileSize(path.join('public', 'piano', layer.from, entry.file));
      if (onDisk !== entry.bytes) {
        throw new Error(
          `${layer.from}/${entry.file} is ${onDisk ? 'not the size its manifest gives' : 'missing'}.`,
        );
      }
      // A URL path whatever the platform, so never path.join here.
      entries.push({ ...entry, file: `../${layer.from}/${entry.file}`, layer: layer.index });
    }
    reused.set(layer.label, { layer: described, entries });
  }
  return reused;
}

/** The piano a pack version belongs to: its directory's name less the `-vN`. */
function instrumentOf(packVersion) {
  return packVersion.replace(/-v\d+$/, '');
}

/** An already-built pack's manifest, read from disk; null if it is not there. */
async function builtPackManifest(packVersion) {
  const manifestPath = path.join('public', 'piano', packVersion, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

/**
 * Mean attack RMS per layer label, energy-averaged across every root of a pack
 * already converted on disk (its `files`, all of them unless said). Used only
 * to level-match packs against each other, layer for layer by what they are.
 * A file listed as `../other-pack/…` is read where it lives.
 */
async function measurePackLevels(packVersion, manifest, files = manifest.files) {
  const labelOf = new Map(manifest.velocityLayers.map((layer) => [layer.index, layer.label]));
  const sums = new Map();
  const jobs = files.map((entry) => ({
    name: entry.file,
    run: async () => {
      const rms = await measureRms(path.join('public', 'piano', packVersion, entry.file));
      const label = labelOf.get(entry.layer);
      const bucket = sums.get(label) ?? { total: 0, count: 0 };
      bucket.total += rms;
      bucket.count += 1;
      sums.set(label, bucket);
    },
  }));
  const failures = await runPool(jobs, (job) => job.run(), 4);
  if (failures > 0) throw new Error(`Level measurement failed for ${packVersion}.`);
  const levels = new Map();
  for (const [label, bucket] of sums) levels.set(label, bucket.total / bucket.count);
  return levels;
}

function toDb(rms) {
  return 20 * Math.log10(rms);
}

async function runPool(items, worker, concurrency) {
  const queue = [...items];
  let failures = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (error) {
        failures += 1;
        console.error(`FAILED: ${item.name}:`, error.message);
      }
    }
  });
  await Promise.all(runners);
  return failures;
}

/**
 * Measures every layer's gain before dither and insists it is the one the
 * instrument names, so the numbers in INSTRUMENTS are always what the
 * measurement gives — never a value tuned by hand, and never a stale one.
 */
async function verifySourceGains(jobs, layers) {
  console.log(`Measuring each layer's gain before dither against ${REFERENCE_PACK}...`);
  const measured = await measureSourceGains(jobs, layers);
  const stale = [];
  for (const { layer, matchDb, ceilingDb, gainDb, peakDb, loudest } of measured) {
    console.log(
      `  layer ${layer.index} (${layer.label}, v${layer.sourceLayer}): match ` +
        `${matchDb.toFixed(3)} dB, ceiling ${ceilingDb.toFixed(3)} dB (loudest peak ` +
        `${peakDb.toFixed(3)} dBFS, ${loudest}) -> gainDb ${gainDb}`,
    );
    // A layer that names no gain at all is as stale as one that names the wrong
    // one (a bare comparison with undefined would let it through as NaN).
    if (layer.gainDb === undefined || Math.abs(gainDb - layer.gainDb) > 0.005) {
      stale.push(`${layer.label} ${gainDb}`);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `The layers' gainDb no longer match their measurement (${stale.join(', ')} dB). ` +
        'Update them in INSTRUMENTS and rerun.',
    );
  }
}

async function main(packVersion, { pin = false } = {}) {
  const instrument = INSTRUMENTS[packVersion];
  const stagingDir = path.join(STAGING_ROOT, packVersion);
  const outDir = path.join('public', 'piano', packVersion);
  await mkdir(stagingDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const sourceExtension = instrument.sourceExtension ?? 'flac';
  // Only the layers this pack records afresh are fetched and converted; one it
  // re-uses (`from`) is another pack's published files, listed as they are.
  const built = instrument.layers.filter((layer) => !layer.from);
  const jobs = [];
  for (const midi of rootMidis()) {
    for (const layer of built) {
      const sourceName = instrument.sourceName(midi, layer);
      // Output names are derived from the root and upstream layer rather than
      // the upstream filename, which may hold spaces or other awkward characters.
      const file = `${safeName(midiToNoteName(midi))}v${layer.sourceLayer}.sample`;
      jobs.push({
        name: sourceName,
        sourceName,
        rawBase: instrument.rawBase,
        sampleRate: instrument.sampleRate,
        fadeFromTrim: instrument.fadeFromTrim === true,
        stagingDir,
        midi,
        layer,
        file,
        staged: path.join(
          stagingDir,
          `${safeName(midiToNoteName(midi))}v${layer.sourceLayer}.${sourceExtension}`,
        ),
        output: path.join(outDir, file),
      });
    }
  }
  console.log(
    `${packVersion}: ${jobs.length} samples to build (${rootMidis().length} roots x ` +
      `${built.length} layers), ${instrument.layers.length - built.length} layers re-used`,
  );
  const reused = await reusedLayers(packVersion, instrument.layers);

  if (pin) {
    if (!instrument.pin) throw new Error(`${packVersion} has no pinned sources.`);
    console.log('Pinning what upstream serves now...');
    const { pinned, changed } = await instrument.pin(jobs, stagingDir);
    console.log(
      `Pinned ${pinned} sources in ${pinsPathFor(packVersion)}; ${changed} pins changed.`,
    );
    return;
  }

  // A sample already converted needs neither its source nor another encode, so
  // re-running over a published pack costs no network and changes no bytes.
  const pending = [];
  for (const job of jobs) {
    if ((await fileSize(job.output)) === 0) pending.push(job);
  }
  console.log(`${jobs.length - pending.length} already converted, ${pending.length} to build.`);

  if (pending.length > 0) {
    const fetchSource = instrument.fetcher ? await instrument.fetcher(stagingDir) : download;
    // A layer's gain is measured over all of its recordings, so a pack with
    // gains needs every source at hand to convert any one of them.
    const gained = built.some((layer) => layer.gainDb !== undefined);
    const needed = gained ? jobs : pending;
    console.log(`Fetching ${needed.length} sources...`);
    const downloadFailures = await runPool(needed, (job) => fetchSource(job), 6);
    if (downloadFailures > 0) {
      throw new Error(`${downloadFailures} downloads failed; rerun to retry.`);
    }
    if (gained) await verifySourceGains(jobs, built);
    console.log('Downloads complete. Converting with ffmpeg...');

    const convertFailures = await runPool(pending, (job) => convert(job), 4);
    if (convertFailures > 0) {
      throw new Error(`${convertFailures} conversions failed; rerun to retry.`);
    }
  }

  const files = [];
  for (const job of jobs) {
    const bytes = await fileSize(job.output);
    if (bytes === 0) throw new Error(`Missing converted file ${job.file}`);
    const pack = job.midi >= CORE_ROOT_MIN && job.midi <= CORE_ROOT_MAX ? 'core' : 'full';
    files.push({ file: job.file, midi: job.midi, layer: job.layer.index, pack, bytes });
  }
  const builtFiles = [...files];
  for (const { entries } of reused.values()) files.push(...entries);
  files.sort((a, b) => a.midi - b.midi || a.layer - b.layer);
  let coreBytes = 0;
  let totalBytes = 0;
  for (const entry of files) {
    if (entry.pack === 'core') coreBytes += entry.bytes;
    totalBytes += entry.bytes;
  }

  // What each layer is, for the manifest: a re-used one as the pack it comes
  // from describes it (its gain before dither, its level match), renumbered.
  const velocityLayers = instrument.layers.map(({ from, ...layer }) => {
    if (!from) return { ...layer };
    const { index: _, ...described } = reused.get(layer.label).layer;
    return { index: layer.index, ...described };
  });
  if (packVersion !== REFERENCE_PACK && builtFiles.length > 0) {
    console.log(`Measuring levels against ${REFERENCE_PACK}...`);
    const referenceManifest = await builtPackManifest(REFERENCE_PACK);
    if (!referenceManifest) {
      throw new Error(
        `Reference pack ${REFERENCE_PACK} is not built, so levels cannot be matched.`,
      );
    }
    const reference = await measurePackLevels(REFERENCE_PACK, referenceManifest);
    // Measured from the files just converted, which the manifest below describes;
    // a re-used layer keeps the match it was published with.
    const own = await measurePackLevels(packVersion, { velocityLayers }, builtFiles);
    for (const layer of velocityLayers) {
      if (reused.has(layer.label)) continue;
      const referenceRms = reference.get(layer.label);
      const ownRms = own.get(layer.label);
      if (!referenceRms || !ownRms) continue;
      // Sources are mastered at wildly different levels (Headroom sits ~15 dB
      // below Salamander), so the range is wide; the clamp only guards against a
      // measurement gone wrong. The match is applied after decoding, in float,
      // so a large boost cannot clip — it lands ahead of the graph's limiter.
      // A pack with gains before dither is near 1 here, except where a layer's
      // ceiling held its gain back.
      const raw = referenceRms / ownRms;
      const levelMatch = Math.min(MAX_LEVEL_MATCH, Math.max(1 / MAX_LEVEL_MATCH, raw));
      if (raw !== levelMatch) {
        // Clamping silently would ship a pack that quietly fails to match.
        console.warn(
          `  WARNING: layer ${layer.index} wanted ${raw.toFixed(2)}x but was clamped to ` +
            `${levelMatch}x — this pack will not actually match the reference.`,
        );
      }
      layer.levelMatch = Number(levelMatch.toFixed(4));
      console.log(
        `  layer ${layer.index} (${layer.label}): ${toDb(ownRms).toFixed(1)} dB vs ` +
          `${toDb(referenceRms).toFixed(1)} dB reference -> levelMatch ${layer.levelMatch}`,
      );
    }
  }

  const manifest = {
    version: packVersion,
    source: instrument.source,
    license: instrument.license,
    sourceUrl: instrument.sourceUrl,
    format: `flac-16bit-${instrument.sampleRate / 1000}khz-stereo`,
    velocityLayers,
    coreBytes,
    totalBytes,
    files,
  };
  // Written only when the content actually differs, so re-running the script
  // over an already-published pack leaves the working tree clean.
  const manifestPath = path.join(outDir, 'manifest.json');
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const existing = await readFile(manifestPath, 'utf8').catch(() => null);
  if (existing === serialized) {
    console.log(`Manifest unchanged: ${files.length} files`);
  } else {
    await writeFile(manifestPath, serialized);
    console.log(`Manifest written: ${files.length} files`);
  }
  console.log(`Core pack:  ${(coreBytes / 1e6).toFixed(1)} MB`);
  console.log(`Full pack:  ${(totalBytes / 1e6).toFixed(1)} MB`);
}

// Guard against accidentally running from the wrong directory.
if (!existsSync('package.json')) {
  console.error('Run from the repository root.');
  process.exit(1);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.name !== 'pokeyboard') {
  console.error('Unexpected working directory; aborting.');
  process.exit(1);
}

const requested = process.argv[2];
const pin = process.argv.slice(3).includes('--pin');
if (requested === 'wurlitzer-ep203w-v1') {
  await buildWurlitzer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
  process.exit(process.exitCode ?? 0);
}
if (RETIRED_PACKS.has(requested)) {
  console.error(
    `${requested} is published and immutable — rebuilding it would rewrite audio ` +
      `clients are already caching. See DEPLOYMENT.md; the recipe that made it is ` +
      `in git history.`,
  );
  process.exit(1);
}
if (!requested || !(requested in INSTRUMENTS)) {
  console.error(
    `Usage: node scripts/build-sample-pack.mjs <pack-version> [--pin]\n` +
      `Known packs: ${[...Object.keys(INSTRUMENTS), 'wurlitzer-ep203w-v1'].join(', ')}`,
  );
  process.exit(1);
}

main(requested, { pin }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
