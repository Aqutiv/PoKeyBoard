/**
 * Builds the PoKeyBoard piano sample pack from the Salamander Grand Piano v3
 * (Alexander Holm, CC-BY 3.0, https://github.com/sfzinstruments/SalamanderGrandPiano).
 *
 * Downloads a 3-velocity-layer, minor-third-root subset of the 48kHz/24bit
 * FLACs into samples-staging/, converts each to a trimmed, faded 128kbps MP3
 * in public/piano/salamander-grand-v1/, and writes a manifest.json describing
 * every file (midi root, layer, pack membership, size).
 *
 * Idempotent: existing staged FLACs and converted MP3s are reused.
 * Requires: Node >= 20 (global fetch) and ffmpeg with libmp3lame on PATH.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const RAW_BASE =
  'https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples';
const PACK_VERSION = 'salamander-grand-v1';
const STAGING_DIR = 'samples-staging';
const OUT_DIR = path.join('public', 'piano', PACK_VERSION);

/** Salamander source velocity layers used for our soft/medium/loud set. */
const VELOCITY_LAYERS = [
  { index: 0, sourceLayer: 5, label: 'soft' },
  { index: 1, sourceLayer: 10, label: 'medium' },
  { index: 2, sourceLayer: 15, label: 'loud' },
];

/** Core pack roots cover the default visible C3-B5 range (with margins). */
const CORE_ROOT_MIN = 45; // A2
const CORE_ROOT_MAX = 84; // C6

// Upstream files use literal sharps ("D#1v5.flac"); we keep an "s" variant
// locally so nothing served over HTTP ever contains a "#".
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToSalamanderName(midi) {
  const pitch = PITCH_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${pitch}${octave}`;
}

function safeName(sourceName) {
  return sourceName.replace('#', 's');
}

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

async function download(name, attempt = 1) {
  const target = path.join(STAGING_DIR, `${safeName(name)}.flac`);
  if ((await fileSize(target)) > 0) return { name, skipped: true };
  const url = `${RAW_BASE}/${encodeURIComponent(`${name}.flac`)}`;
  const response = await fetch(url);
  if (!response.ok) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      return download(name, attempt + 1);
    }
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000) {
    throw new Error(`Suspiciously small download for ${name} (${bytes.length} bytes)`);
  }
  await writeFile(target, bytes);
  return { name, bytes: bytes.length };
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
      if (code === 0) resolve(undefined);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

async function convert(name, midi) {
  const input = path.join(STAGING_DIR, `${safeName(name)}.flac`);
  const output = path.join(OUT_DIR, `${safeName(name)}.mp3`);
  if ((await fileSize(output)) > 0) return { output, skipped: true };
  const trim = trimSecondsFor(midi);
  const fadeStart = trim - 1.5;
  // Mono keeps decoded AudioBuffer memory phone-friendly; the app's stereo
  // reverb restores a sense of space.
  await runFfmpeg([
    '-y',
    '-i',
    input,
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
    output,
  ]);
  return { output };
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

async function main() {
  await mkdir(STAGING_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const jobs = [];
  for (const midi of rootMidis()) {
    for (const layer of VELOCITY_LAYERS) {
      const name = `${midiToSalamanderName(midi)}v${layer.sourceLayer}`;
      jobs.push({ name, midi, layer });
    }
  }
  console.log(
    `Sample jobs: ${jobs.length} (${rootMidis().length} roots x ${VELOCITY_LAYERS.length} layers)`,
  );

  console.log('Downloading FLACs...');
  const downloadFailures = await runPool(jobs, (job) => download(job.name), 6);
  if (downloadFailures > 0) {
    throw new Error(`${downloadFailures} downloads failed; rerun to retry.`);
  }
  console.log('Downloads complete. Converting with ffmpeg...');

  const convertFailures = await runPool(jobs, (job) => convert(job.name, job.midi), 4);
  if (convertFailures > 0) {
    throw new Error(`${convertFailures} conversions failed; rerun to retry.`);
  }

  const files = [];
  let coreBytes = 0;
  let totalBytes = 0;
  for (const job of jobs) {
    const file = `${safeName(job.name)}.mp3`;
    const bytes = await fileSize(path.join(OUT_DIR, file));
    if (bytes === 0) throw new Error(`Missing converted file ${file}`);
    const pack = job.midi >= CORE_ROOT_MIN && job.midi <= CORE_ROOT_MAX ? 'core' : 'full';
    if (pack === 'core') coreBytes += bytes;
    totalBytes += bytes;
    files.push({ file, midi: job.midi, layer: job.layer.index, pack, bytes });
  }

  files.sort((a, b) => a.midi - b.midi || a.layer - b.layer);

  const manifest = {
    version: PACK_VERSION,
    source: 'Salamander Grand Piano v3 by Alexander Holm',
    license: 'CC-BY 3.0',
    sourceUrl: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
    format: 'mp3-128k-48khz-mono',
    velocityLayers: VELOCITY_LAYERS,
    coreBytes,
    totalBytes,
    files,
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Manifest written: ${files.length} files`);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
