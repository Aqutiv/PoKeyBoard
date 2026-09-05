import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const WURLITZER_REVISION = '8c3e581acda3594b553948ff0222d4f84a698376';
const REPO = 'https://github.com/sfzinstruments/GregSullivan.E-Pianos';
const RAW = `https://raw.githubusercontent.com/sfzinstruments/GregSullivan.E-Pianos/${WURLITZER_REVISION}`;
const PACK = 'wurlitzer-ep203w-v1';

/** Read native FLAC stream info and libFLAC's preserved RIFF smpl application block. */
export function readFlacMetadata(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'fLaC') throw new Error('Expected native FLAC');
  let offset = 4;
  let info;
  let frames;
  for (;;) {
    if (offset + 4 > bytes.length) throw new Error('Truncated FLAC header');
    const header = bytes[offset];
    const length = bytes.readUIntBE(offset + 1, 3);
    const start = offset + 4;
    const end = start + length;
    if (end > bytes.length) throw new Error('Truncated FLAC metadata');
    const type = header & 127;
    if (type === 0) {
      if (length !== 34) throw new Error('Invalid STREAMINFO');
      const packed = bytes.readBigUInt64BE(start + 10);
      info = {
        sampleRate: Number(packed >> 44n),
        channels: Number((packed >> 41n) & 7n) + 1,
        bits: Number((packed >> 36n) & 31n) + 1,
        totalSamples: Number(packed & 0xfffffffffn),
      };
    }
    if (type === 2 && bytes.toString('ascii', start, start + 8) === 'riffsmpl') {
      if (length < 72) throw new Error('Truncated smpl loop');
      const smpl = start + 12;
      if (
        bytes.readUInt32LE(smpl + 28) !== 1 ||
        bytes.readUInt32LE(smpl + 40) !== 0 ||
        bytes.readUInt32LE(smpl + 56) !== 0
      )
        throw new Error('Expected one infinite forward loop');
      frames = { start: bytes.readUInt32LE(smpl + 44), end: bytes.readUInt32LE(smpl + 48) + 1 };
    }
    offset = end;
    if (header & 128) break;
  }
  if (
    !info ||
    !info.sampleRate ||
    !frames ||
    frames.start >= frames.end ||
    frames.end > info.totalSamples
  ) {
    throw new Error('Missing or invalid Wurlitzer loop metadata');
  }
  return {
    ...info,
    loop: { start: frames.start / info.sampleRate, end: frames.end / info.sampleRate },
  };
}

/** The pinned SFZ has simple groups/regions; deliberately not a general SFZ interpreter. */
export function parseWurlitzerRegions(sfz) {
  let group;
  const regions = [];
  const groups = [];
  for (const match of sfz.matchAll(/<(group|region)>\s*([^<]*)/g)) {
    const fields = Object.fromEntries(
      [...match[2].matchAll(/(\w+)=([^\s]+)/g)].map((m) => [m[1], m[2]]),
    );
    if (match[1] === 'group') {
      group = {
        lowVelocity: Number(fields.lovel),
        highVelocity: Number(fields.hivel),
        layer: groups.length,
      };
      groups.push({ index: group.layer, sourceLayer: group.layer + 1, label: fields.group_label });
    } else {
      if (!group || !/^[a-z0-9]+\.\$EXT$/.test(fields.sample))
        throw new Error('Unexpected SFZ region');
      regions.push({
        ...group,
        file: fields.sample.replace('.$EXT', '.sample'),
        lowKey: Number(fields.lokey) === 33 ? 21 : Number(fields.lokey),
        highKey: Number(fields.hikey) === 96 ? 108 : Number(fields.hikey),
        root: Number(fields.pitch_keycenter),
        tune: Number(fields.tune ?? 0),
        gain: Math.pow(10, Number(fields.volume ?? 0) / 20),
      });
    }
  }
  if (groups.length !== 4 || regions.length !== 48) throw new Error('Unexpected Wurlitzer mapping');
  for (let key = 21; key <= 108; key++)
    for (let velocity = 1; velocity <= 127; velocity++) {
      if (
        regions.filter(
          (r) =>
            key >= r.lowKey &&
            key <= r.highKey &&
            velocity >= r.lowVelocity &&
            velocity <= r.highVelocity,
        ).length !== 1
      ) {
        throw new Error(`Ambiguous or missing mapping: ${key}/${velocity}`);
      }
    }
  return { regions, velocityLayers: groups };
}

async function readOptional(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function cachedDownload(url, file) {
  const existing = await readOptional(file);
  if (existing) return existing;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(`${file}.partial`, bytes);
  await rename(`${file}.partial`, file);
  return bytes;
}

function rms(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-t', '2', '-ac', '1', '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks = [];
    let errors = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(errors));
      const bytes = Buffer.concat(chunks);
      let energy = 0;
      for (let i = 0; i < bytes.length; i += 4) energy += bytes.readFloatLE(i) ** 2;
      resolve(Math.sqrt(energy / (bytes.length / 4)));
    });
  });
}

export async function buildWurlitzer() {
  const output = path.join('public', 'piano', PACK);
  const staging = path.join('samples-staging', PACK);
  await mkdir(output, { recursive: true });
  await mkdir(staging, { recursive: true });
  const manifestFile = path.join(output, 'manifest.json');
  const existing = await readOptional(manifestFile);
  if (existing) {
    const manifest = JSON.parse(existing);
    if (manifest.sourceRevision !== WURLITZER_REVISION)
      throw new Error('Published source revision mismatch');
    for (const entry of manifest.files) {
      const bytes = await readFile(path.join(output, entry.file));
      if (bytes.length !== entry.bytes) throw new Error(`Published file changed: ${entry.file}`);
      readFlacMetadata(bytes);
    }
    console.log(`${PACK}: already built, ${manifest.files.length} files, no changes.`);
    return;
  }
  const sfz = await cachedDownload(
    `${RAW}/Wurlitzer%20EP200/Wurlitzer%20EP200.sfz`,
    path.join(staging, 'source.sfz'),
  );
  const { regions, velocityLayers } = parseWurlitzerRegions(sfz.toString('utf8'));
  const files = [];
  let format;
  for (const file of [...new Set(regions.map((r) => r.file))].sort()) {
    const bytes = await cachedDownload(
      `${RAW}/Wurlitzer%20EP200/Samples/${file.replace('.sample', '.flac')}`,
      path.join(staging, file),
    );
    const metadata = readFlacMetadata(bytes);
    const sampleFormat = `flac-${metadata.bits}bit-${metadata.sampleRate / 1000}khz-${metadata.channels === 1 ? 'mono' : 'stereo'}`;
    if (format && format !== sampleFormat) throw new Error('Mixed sample formats');
    format = sampleFormat;
    const mappings = regions.filter((r) => r.file === file);
    const first = mappings[0];
    files.push({
      file,
      midi: first.root,
      layer: first.layer,
      bytes: bytes.length,
      pack: mappings.some((r) => r.lowKey <= 84 && r.highKey >= 45) ? 'core' : 'full',
      loop: metadata.loop,
    });
    const destination = path.join(output, file);
    const current = await readOptional(destination);
    if (!current || !current.equals(bytes)) await writeFile(destination, bytes);
  }
  // Match the same C3-B5 keys at the app's default fixed velocity. Apply just
  // one gain after source region trims and v²; never rebalance individual layers.
  const referenceDir = path.join('public', 'piano', 'salamander-grand-v3');
  const reference = JSON.parse(await readFile(path.join(referenceDir, 'manifest.json'), 'utf8'));
  const levels = new Map();
  const measure = async (file) => {
    if (!levels.has(file)) levels.set(file, await rms(file));
    return levels.get(file);
  };
  let ownEnergy = 0;
  let referenceEnergy = 0;
  const velocity = 0.75;
  for (let key = 48; key <= 83; key++) {
    const region = regions.find(
      (r) => key >= r.lowKey && key <= r.highKey && 95 >= r.lowVelocity && 95 <= r.highVelocity,
    );
    const sourceLevel = await measure(path.join(output, region.file));
    ownEnergy += (sourceLevel * region.gain * velocity ** 2) ** 2;
    const entry = reference.files
      .filter((f) => f.layer === 1)
      .sort((a, b) => Math.abs(a.midi - key) - Math.abs(b.midi - key))[0];
    const referenceLevel = await measure(path.join(referenceDir, entry.file));
    referenceEnergy += (referenceLevel * 1.1 * Math.pow(velocity / 0.6, 0.6)) ** 2;
  }
  const levelMatch = Math.sqrt(referenceEnergy / ownEnergy);
  if (!Number.isFinite(levelMatch) || levelMatch < 1 / 8 || levelMatch > 8)
    throw new Error(`Unexpected level match: ${levelMatch}`);
  const manifest = {
    version: PACK,
    source: 'Wurlitzer EP203W by Greg Sullivan; SFZ mapping by kinwie',
    sourceUrl: REPO,
    sourceRevision: WURLITZER_REVISION,
    license: 'CC-BY 3.0',
    format,
    velocityLayers,
    envelope: { attack: 0.001, hold: 5, decay: 25, release: 0.1 },
    levelMatch: Number(levelMatch.toFixed(6)),
    coreBytes: files.filter((f) => f.pack === 'core').reduce((sum, f) => sum + f.bytes, 0),
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    files,
    regions,
  };
  const license = await cachedDownload(`${RAW}/LICENSE`, path.join(staging, 'LICENSE.txt'));
  await writeFile(path.join(output, 'LICENSE.txt'), license);
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${PACK}: ${files.length} samples, ${(manifest.totalBytes / 1e6).toFixed(2)} MB, gain ${manifest.levelMatch}`,
  );
}
