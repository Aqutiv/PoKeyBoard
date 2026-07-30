/**
 * Builds a PoKeyBoard piano sample pack from a freely licensed upstream source.
 *
 * Usage: node scripts/build-sample-pack.mjs <pack-version>
 *   salamander-grand-v2  Salamander Grand Piano v3 (Yamaha C5, Alexander Holm)
 *   headroom-grand-v1    Headroom Piano (Yamaha C3, Bengt Nilsson)
 *
 * Downloads a 3-velocity-layer, minor-third-root subset of the upstream FLACs
 * into samples-staging/<pack-version>/, converts each to a trimmed, faded
 * 128kbps MP3 in public/piano/<pack-version>/ (the .sample extension keeps
 * download managers from intercepting fetches; the payload is still MP3), and
 * writes a manifest.json describing every file (midi root, layer, pack
 * membership, size) plus the per-layer level match against the reference pack.
 *
 * Idempotent: existing staged FLACs and converted MP3s are reused.
 * Requires: Node 20.19+ or 22.12+ and ffmpeg with libmp3lame on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
 * onto our fixed soft/medium/loud triple, and `sourceName` names the upstream
 * file (extension excluded) for a given root and layer.
 */
const INSTRUMENTS = {
  'salamander-grand-v2': {
    rawBase: 'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples',
    layers: [
      { index: 0, sourceLayer: 5, label: 'soft' },
      { index: 1, sourceLayer: 10, label: 'medium' },
      { index: 2, sourceLayer: 15, label: 'loud' },
    ],
    sourceName: (midi, layer) => `${midiToNoteName(midi)}v${layer.sourceLayer}`,
    source: 'Salamander Grand Piano v3 by Alexander Holm',
    license: 'CC-BY 3.0',
    sourceUrl: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
  },
  'headroom-grand-v1': {
    rawBase:
      'https://raw.githubusercontent.com/sfzinstruments/BengtNilsson.HeadroomPiano/master/Samples',
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
    source: 'Headroom Piano (Yamaha C3) by Bengt Nilsson, sfz mapping by kinwie',
    license: 'CC-BY 4.0',
    sourceUrl: 'https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano',
  },
};

/**
 * The pack every other pack is level-matched against, so switching pianos
 * changes their character and not their loudness. Its own manifest carries no
 * level match (SampleBank's LAYER_TRIM already describes it).
 */
const REFERENCE_PACK = 'salamander-grand-v2';

/** Core pack roots cover the default visible C3-B5 range (with margins). */
const CORE_ROOT_MIN = 45; // A2
const CORE_ROOT_MAX = 84; // C6

/** Seconds of each sample's attack that the level measurement listens to. */
const LEVEL_WINDOW_S = 2;

/** Widest level correction a pack may ask for, either direction. */
const MAX_LEVEL_MATCH = 8;

/** Roots every minor third from A0 (21) to C8 (108). */
function rootMidis() {
  const midis = [];
  for (let midi = 21; midi <= 108; midi += 3) midis.push(midi);
  return midis;
}

/**
 * Trim lengths balance natural decay against decoded-PCM memory on phones
 * (mono float32 at 48kHz costs ~192KB per second per sample).
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

async function convert(job) {
  if ((await fileSize(job.output)) > 0) return { skipped: true };
  const trim = trimSecondsFor(job.midi);
  const fadeStart = trim - 1.5;
  // ffmpeg picks the muxer from the extension, so encode to .mp3 and rename.
  const temporary = job.output.replace(/\.sample$/i, '.partial.mp3');
  // Mono keeps decoded AudioBuffer memory phone-friendly; the app's stereo
  // reverb restores a sense of space.
  await runFfmpeg([
    '-y',
    '-i',
    job.staged,
    '-t',
    String(trim),
    '-af',
    `afade=t=out:st=${fadeStart}:d=1.5`,
    '-ar',
    '48000',
    '-ac',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    temporary,
  ]);
  if ((await fileSize(temporary)) === 0) {
    throw new Error(`ffmpeg produced an empty temporary file for ${job.name}`);
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

/** The file list of an already-built pack, read from its manifest on disk. */
async function builtPackFiles(packVersion) {
  const manifestPath = path.join('public', 'piano', packVersion, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  return manifest.files;
}

/**
 * Mean attack RMS per layer index, energy-averaged across every root of a pack
 * already converted on disk. Used only to level-match packs against each other.
 */
async function measurePackLevels(packVersion, packFiles) {
  const sums = new Map();
  const jobs = packFiles.map((entry) => ({
    name: entry.file,
    run: async () => {
      const rms = await measureRms(path.join('public', 'piano', packVersion, entry.file));
      const bucket = sums.get(entry.layer) ?? { total: 0, count: 0 };
      bucket.total += rms;
      bucket.count += 1;
      sums.set(entry.layer, bucket);
    },
  }));
  const failures = await runPool(jobs, (job) => job.run(), 4);
  if (failures > 0) throw new Error(`Level measurement failed for ${packVersion}.`);
  const levels = new Map();
  for (const [layer, bucket] of sums) levels.set(layer, bucket.total / bucket.count);
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

async function main(packVersion) {
  const instrument = INSTRUMENTS[packVersion];
  const stagingDir = path.join(STAGING_ROOT, packVersion);
  const outDir = path.join('public', 'piano', packVersion);
  await mkdir(stagingDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const jobs = [];
  for (const midi of rootMidis()) {
    for (const layer of instrument.layers) {
      const sourceName = instrument.sourceName(midi, layer);
      // Output names are derived from the root and upstream layer rather than
      // the upstream filename, which may hold spaces or other awkward characters.
      const file = `${safeName(midiToNoteName(midi))}v${layer.sourceLayer}.sample`;
      jobs.push({
        name: sourceName,
        sourceName,
        rawBase: instrument.rawBase,
        midi,
        layer,
        file,
        staged: path.join(
          stagingDir,
          `${safeName(midiToNoteName(midi))}v${layer.sourceLayer}.flac`,
        ),
        output: path.join(outDir, file),
      });
    }
  }
  console.log(
    `${packVersion}: ${jobs.length} samples (${rootMidis().length} roots x ${instrument.layers.length} layers)`,
  );

  // A sample already converted needs neither its source nor another encode, so
  // re-running over a published pack costs no network and changes no bytes.
  const pending = [];
  for (const job of jobs) {
    if ((await fileSize(job.output)) === 0) pending.push(job);
  }
  console.log(`${jobs.length - pending.length} already converted, ${pending.length} to build.`);

  if (pending.length > 0) {
    console.log('Downloading FLACs...');
    const downloadFailures = await runPool(pending, (job) => download(job), 6);
    if (downloadFailures > 0) {
      throw new Error(`${downloadFailures} downloads failed; rerun to retry.`);
    }
    console.log('Downloads complete. Converting with ffmpeg...');

    const convertFailures = await runPool(pending, (job) => convert(job), 4);
    if (convertFailures > 0) {
      throw new Error(`${convertFailures} conversions failed; rerun to retry.`);
    }
  }

  const files = [];
  let coreBytes = 0;
  let totalBytes = 0;
  for (const job of jobs) {
    const bytes = await fileSize(job.output);
    if (bytes === 0) throw new Error(`Missing converted file ${job.file}`);
    const pack = job.midi >= CORE_ROOT_MIN && job.midi <= CORE_ROOT_MAX ? 'core' : 'full';
    if (pack === 'core') coreBytes += bytes;
    totalBytes += bytes;
    files.push({ file: job.file, midi: job.midi, layer: job.layer.index, pack, bytes });
  }

  files.sort((a, b) => a.midi - b.midi || a.layer - b.layer);

  const velocityLayers = instrument.layers.map((layer) => ({ ...layer }));
  if (packVersion !== REFERENCE_PACK) {
    console.log(`Measuring levels against ${REFERENCE_PACK}...`);
    const referenceFiles = await builtPackFiles(REFERENCE_PACK);
    if (!referenceFiles) {
      throw new Error(
        `Reference pack ${REFERENCE_PACK} is not built, so levels cannot be matched.`,
      );
    }
    const reference = await measurePackLevels(REFERENCE_PACK, referenceFiles);
    // Measured from the files just converted, which the manifest below describes.
    const own = await measurePackLevels(packVersion, files);
    for (const layer of velocityLayers) {
      const referenceRms = reference.get(layer.index);
      const ownRms = own.get(layer.index);
      if (!referenceRms || !ownRms) continue;
      // Sources are mastered at wildly different levels (Headroom sits ~15 dB
      // below Salamander), so the range is wide; the clamp only guards against a
      // measurement gone wrong. The match is applied after decoding, in float,
      // so a large boost cannot clip — it lands ahead of the graph's limiter.
      const levelMatch = Math.min(
        MAX_LEVEL_MATCH,
        Math.max(1 / MAX_LEVEL_MATCH, referenceRms / ownRms),
      );
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
    format: 'mp3-128k-48khz-mono',
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
if (!requested || !(requested in INSTRUMENTS)) {
  console.error(
    `Usage: node scripts/build-sample-pack.mjs <pack-version>\n` +
      `Known packs: ${Object.keys(INSTRUMENTS).join(', ')}`,
  );
  process.exit(1);
}

main(requested).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
