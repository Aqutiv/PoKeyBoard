/**
 * Extracts the music symbols the printed sheet draws from Bravura, Steinberg's
 * SMuFL font, into two generated modules:
 *
 *   src/features/notation/glyphs/musicGlyphMetrics.ts   advances, boxes, anchors
 *   src/features/notation/glyphs/musicGlyphOutlines.ts  the outlines themselves
 *
 * and copies the font's licence to public/licenses/music-glyphs-OFL.txt, where
 * the deployed app serves it.
 *
 * Bravura is under the SIL Open Font License 1.1 with the Reserved Font Name
 * "Bravura". The modules are a subset of the font's outlines — a Modified
 * Version under the OFL — so nothing they export is named after it, and each
 * starts with a legal comment carrying the copyright line, that statement and
 * the whole licence. The font file itself is never shipped.
 *
 * Every source is pinned in scripts/lib/music-glyphs.pins.json — the exact
 * URL, its size and the SHA-256 of its bytes — and checked before anything is
 * read, so a re-run either works from the very bytes the modules were made from
 * or stops and says why. Downloads are staged in music-font-staging/ (ignored
 * by git) and reused while they still match. `--pin` rewrites the pins from
 * what the URLs serve now; a normal run leaves that file unchanged.
 *
 * The outlines are checked as they are read: the font must be CFF with 1000
 * units to the em (250 to the staff space), every coordinate an integer, no
 * quadratic segment anywhere, and each glyph's control box within 0.02 staff
 * spaces of the bounding box the font's own metadata gives it.
 *
 * Usage: node scripts/extract-music-glyphs.mjs [--pin]
 * Requires: Node 20.19+ or 22.12+ (global fetch).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import * as prettier from 'prettier';
import { controlBox, decodeOutline, encodeOutline } from './lib/musicGlyphCodec.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PINS_PATH = path.join(ROOT, 'scripts/lib/music-glyphs.pins.json');
const STAGING_DIR = path.join(ROOT, 'music-font-staging');
const METRICS_PATH = path.join(ROOT, 'src/features/notation/glyphs/musicGlyphMetrics.ts');
const OUTLINES_PATH = path.join(ROOT, 'src/features/notation/glyphs/musicGlyphOutlines.ts');
const LICENSE_PATH = path.join(ROOT, 'public/licenses/music-glyphs-OFL.txt');

const BRAVURA_COMMIT = '37b194378b710cc40e406ab6c4b07608bb9548ae';
const BRAVURA_TAG = 'bravura-1.482';
const SMUFL_COMMIT = '753f551ca6f96bf24ba38aa2d8a317e706238c51';
const BRAVURA_RAW = `https://raw.githubusercontent.com/steinbergmedia/bravura/${BRAVURA_COMMIT}`;

/** What is fetched, by the name it is staged and pinned under. */
const SOURCES = {
  'Bravura.otf': `${BRAVURA_RAW}/redist/otf/Bravura.otf`,
  'Bravura.json': `${BRAVURA_RAW}/redist/Bravura.json`,
  'LICENSE.txt': `${BRAVURA_RAW}/LICENSE.txt`,
  'glyphnames.json': `https://raw.githubusercontent.com/w3c-cg/smufl/${SMUFL_COMMIT}/metadata/glyphnames.json`,
};

/** A SMuFL staff space is a quarter of the em. */
const UNITS_PER_EM = 1000;
const UNITS_PER_SPACE = UNITS_PER_EM / 4;
/** How far a control box may sit from the metadata's bounding box, in staff spaces. */
const BOX_TOLERANCE_SP = 0.02;

/**
 * The glyphs the printed sheet draws, by SMuFL name, in the order the modules
 * list them.
 */
const GLYPHS = [
  'gClef',
  'fClef',
  'gClefChange',
  'fClefChange',
  'brace',
  'noteheadBlack',
  'noteheadHalf',
  'noteheadWhole',
  'augmentationDot',
  'flag8thUp',
  'flag8thDown',
  'flag16thUp',
  'flag16thDown',
  'flag32ndUp',
  'flag32ndDown',
  'flag64thUp',
  'flag64thDown',
  'accidentalFlat',
  'accidentalNatural',
  'accidentalSharp',
  'accidentalDoubleSharp',
  'accidentalDoubleFlat',
  'restWhole',
  'restHalf',
  'restQuarter',
  'rest8th',
  'rest16th',
  'rest32nd',
  'rest64th',
  ...Array.from({ length: 10 }, (_, digit) => `timeSig${digit}`),
  ...Array.from({ length: 10 }, (_, digit) => `tuplet${digit}`),
  'dynamicPiano',
  'dynamicForte',
  'dynamicPPP',
  'dynamicPP',
  'dynamicMP',
  'dynamicMF',
  'dynamicFF',
  'dynamicFFF',
  'ottavaAlta',
  'ottavaBassaVb',
  'metNoteQuarterUp',
];

/** The anchors the sheet places by: where stems meet heads and flags, and each dynamic's optical centre. */
const ANCHORS = {
  noteheadBlack: ['stemUpSE', 'stemDownNW'],
  noteheadHalf: ['stemUpSE', 'stemDownNW'],
  flag8thUp: ['stemUpNW'],
  flag16thUp: ['stemUpNW'],
  flag32ndUp: ['stemUpNW'],
  flag64thUp: ['stemUpNW'],
  flag8thDown: ['stemDownSW'],
  flag16thDown: ['stemDownSW'],
  flag32ndDown: ['stemDownSW'],
  flag64thDown: ['stemDownSW'],
  dynamicPiano: ['opticalCenter'],
  dynamicForte: ['opticalCenter'],
  dynamicPPP: ['opticalCenter'],
  dynamicPP: ['opticalCenter'],
  dynamicMP: ['opticalCenter'],
  dynamicMF: ['opticalCenter'],
  dynamicFF: ['opticalCenter'],
  dynamicFFF: ['opticalCenter'],
};

const REGENERATE = 'node scripts/extract-music-glyphs.mjs';

// --------------------------------------------------------------- sources --

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return -1;
  }
}

async function fetchBytes(url, attempt = 1) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (attempt >= 4) throw new Error(`Fetch failed for ${url}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    return fetchBytes(url, attempt + 1);
  }
}

async function writeAtomically(filePath, bytes) {
  const temporary = `${filePath}.partial`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

/** A staged file's bytes, when it is there and still matches its pin. */
async function stagedIfPinned(name, pin) {
  const staged = path.join(STAGING_DIR, name);
  if ((await fileSize(staged)) !== pin.bytes) return null;
  const bytes = await readFile(staged);
  return sha256(bytes) === pin.sha256 ? bytes : null;
}

/**
 * Every source's bytes, checked against its pin: from staging when a copy
 * there still matches, fetched and staged otherwise. A fetch that does not
 * match stops the run, naming the file and both hashes, with nothing staged.
 */
async function loadPinnedSources() {
  const pins = JSON.parse(await readFile(PINS_PATH, 'utf8'));
  const sources = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const pin = pins.files[name];
    if (!pin) throw new Error(`${name} is not pinned. Run with --pin, then review the diff.`);
    if (pin.url !== url) {
      throw new Error(`${name} is pinned to ${pin.url}, but this script reads ${url}. Re-pin.`);
    }
    let bytes = await stagedIfPinned(name, pin);
    if (!bytes) {
      bytes = await fetchBytes(url);
      const digest = sha256(bytes);
      if (bytes.length !== pin.bytes || digest !== pin.sha256) {
        throw new Error(
          `${name}: fetched ${bytes.length} bytes with SHA-256 ${digest}, but the pin is ` +
            `${pin.bytes} bytes with SHA-256 ${pin.sha256}. ${url} no longer serves the ` +
            `file the glyphs were extracted from; nothing was staged.`,
        );
      }
      await writeAtomically(path.join(STAGING_DIR, name), bytes);
    }
    sources[name] = bytes;
  }
  return sources;
}

/** Fetch every source afresh, stage it and write the pins. Returns the bytes. */
async function pinSources() {
  const previous = await readFile(PINS_PATH, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  const files = {};
  const sources = {};
  for (const [name, url] of Object.entries(SOURCES)) {
    const bytes = await fetchBytes(url);
    await writeAtomically(path.join(STAGING_DIR, name), bytes);
    files[name] = { url, bytes: bytes.length, sha256: sha256(bytes) };
    sources[name] = bytes;
  }
  const pins = {
    font: `Bravura ${BRAVURA_TAG} (https://github.com/steinbergmedia/bravura, ${BRAVURA_COMMIT})`,
    glyphNames: `SMuFL glyphnames.json (https://github.com/w3c-cg/smufl, ${SMUFL_COMMIT})`,
    files,
  };
  const text = `${JSON.stringify(pins, null, 2)}\n`;
  await writeFile(PINS_PATH, text);
  const changed = Object.entries(files).filter(([name, pin]) => {
    const old = previous?.files?.[name];
    return old?.url !== pin.url || old?.bytes !== pin.bytes || old?.sha256 !== pin.sha256;
  });
  console.log(
    `Pinned ${Object.keys(files).length} files; ${changed.length} changed` +
      (changed.length > 0 ? `: ${changed.map(([name]) => name).join(', ')}` : '.'),
  );
  return sources;
}

// ------------------------------------------------------------ extraction --

function parseFont(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'OTTO') {
    throw new Error('Bravura.otf is not a CFF-flavoured OpenType font (no OTTO signature)');
  }
  const font = opentype.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  );
  if (font.outlinesFormat !== 'cff') {
    throw new Error(`Bravura.otf has ${font.outlinesFormat} outlines, not CFF`);
  }
  if (font.unitsPerEm !== UNITS_PER_EM) {
    throw new Error(`Bravura.otf has ${font.unitsPerEm} units to the em, not ${UNITS_PER_EM}`);
  }
  return font;
}

/** Staff spaces from font units, rounded clear of binary noise. */
function spaces(units) {
  return Math.round((units / UNITS_PER_SPACE) * 1e6) / 1e6;
}

function assertPair(name, pair, what) {
  if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) {
    throw new Error(`${name}: Bravura.json has no usable ${what}`);
  }
  return [pair[0], pair[1]];
}

/**
 * One glyph: its outline from the font, checked, and its metrics from the
 * font's metadata. Throws, naming the glyph, at anything unexpected.
 */
function extractGlyph(name, font, glyphNames, metadata) {
  const entry = glyphNames[name];
  if (!entry) throw new Error(`${name} is not a SMuFL 1.4 glyph name`);
  const codePoint = Number.parseInt(entry.codepoint.replace(/^U\+/, ''), 16);
  const glyph = font.charToGlyph(String.fromCodePoint(codePoint));
  if (!glyph || glyph.index === 0) {
    throw new Error(`${name} (${entry.codepoint}) is not in Bravura's character map`);
  }

  const commands = glyph.path.commands.map((command) => ({ ...command }));
  for (const command of commands) {
    if (!['M', 'L', 'C', 'Z'].includes(command.type)) {
      throw new Error(`${name}: a "${command.type}" segment; only lines and cubics are expected`);
    }
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
      if (key in command && !Number.isInteger(command[key])) {
        throw new Error(`${name}: coordinate ${key} = ${command[key]} is not an integer`);
      }
    }
  }
  const encoded = encodeOutline(commands);
  const decoded = decodeOutline(encoded);
  if (JSON.stringify(decoded) !== JSON.stringify(commands.map(canonical))) {
    throw new Error(`${name}: the outline does not survive encoding`);
  }

  const box = metadata.glyphBBoxes[name];
  if (!box) throw new Error(`${name}: Bravura.json gives it no bounding box`);
  const [left, bottom] = assertPair(name, box.bBoxSW, 'bBoxSW');
  const [right, top] = assertPair(name, box.bBoxNE, 'bBoxNE');
  const advance = metadata.glyphAdvanceWidths[name];
  if (!Number.isFinite(advance)) throw new Error(`${name}: Bravura.json gives it no advance`);

  // The decoded control box must hold the metadata's box, and sit within the
  // tolerance of it: a control point can overshoot the curve it shapes.
  const control = controlBox(decoded);
  const sides = [
    ['left', spaces(control.left), left, -1],
    ['bottom', spaces(control.bottom), bottom, -1],
    ['right', spaces(control.right), right, 1],
    ['top', spaces(control.top), top, 1],
  ];
  for (const [side, drawn, stated, outward] of sides) {
    const overshoot = (drawn - stated) * outward;
    if (overshoot < -BOX_TOLERANCE_SP || overshoot > BOX_TOLERANCE_SP) {
      throw new Error(
        `${name}: the outline's ${side} edge is at ${drawn} sp, the metadata says ${stated} sp`,
      );
    }
  }

  const wanted = ANCHORS[name] ?? [];
  const anchors = {};
  for (const anchor of wanted) {
    anchors[anchor] = assertPair(name, metadata.glyphsWithAnchors[name]?.[anchor], anchor);
  }
  const segments = commands.filter((command) => command.type === 'L' || command.type === 'C');
  return {
    name,
    codePoint: entry.codepoint,
    encoded,
    advance,
    bbox: [left, bottom, right, top],
    anchors,
    segments: segments.length,
  };
}

/** A command with only the keys its type carries, in the codec's order. */
function canonical(command) {
  switch (command.type) {
    case 'M':
    case 'L':
      return { type: command.type, x: command.x, y: command.y };
    case 'C': {
      const { x1, y1, x2, y2, x, y } = command;
      return { type: 'C', x1, y1, x2, y2, x, y };
    }
    default:
      return { type: 'Z' };
  }
}

/** The engraving defaults that are lengths, in staff spaces. */
function engravingDefaults(metadata) {
  const defaults = {};
  for (const [key, value] of Object.entries(metadata.engravingDefaults ?? {}).sort()) {
    if (typeof value === 'number') defaults[key] = value;
  }
  for (const key of ['stemThickness', 'legerLineThickness', 'legerLineExtension']) {
    if (!(key in defaults)) throw new Error(`Bravura.json has no engraving default ${key}`);
  }
  return defaults;
}

// --------------------------------------------------------------- modules --

/**
 * The legal comment both modules open with: the font's copyright line and
 * Reserved Font Name, the statement that this subset is a Modified Version not
 * named after it, then the licence as the font ships it. `/*!` marks it as a
 * legal comment, which the production build keeps.
 */
function legalComment(licence) {
  if (licence.includes('*/'))
    throw new Error('LICENSE.txt would end the comment it is copied into');
  const lines = licence.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const blank = lines.indexOf('');
  if (blank < 1 || !/Reserved Font Name "Bravura"/.test(lines.slice(0, blank).join(' '))) {
    throw new Error('LICENSE.txt does not open with the copyright line and Reserved Font Name');
  }
  const body = [
    ...lines.slice(0, blank),
    '',
    'This subset is a Modified Version of the font and is not named Bravura.',
    ...lines.slice(blank),
  ];
  return ['/*! @license', ...body.map((line) => (line ? ` * ${line}` : ' *')), ' */'].join('\n');
}

function generatedNote(what, fontVersion) {
  return [
    ' *',
    ` * GENERATED — do not edit. ${what} by`,
    ` * scripts/extract-music-glyphs.mjs, from Bravura ${fontVersion} (tag ${BRAVURA_TAG},`,
    ` * commit ${BRAVURA_COMMIT}) and the glyph names of`,
    ' * SMuFL 1.4, each source pinned in scripts/lib/music-glyphs.pins.json.',
    ' * Regenerate with:',
    ' *',
    ` *   ${REGENERATE}`,
  ].join('\n');
}

function metricsModule(licence, glyphs, defaults, fontVersion) {
  const names = glyphs.map((glyph) => `  '${glyph.name}',`).join('\n');
  const metrics = glyphs
    .map(
      (glyph) =>
        `  ${glyph.name}: { advance: ${glyph.advance}, bbox: [${glyph.bbox.join(', ')}] },`,
    )
    .join('\n');
  const anchors = glyphs
    .filter((glyph) => Object.keys(glyph.anchors).length > 0)
    .map((glyph) => {
      const entries = Object.entries(glyph.anchors)
        .map(([anchor, [x, y]]) => `${anchor}: [${x}, ${y}]`)
        .join(', ');
      return `  ${glyph.name}: { ${entries} },`;
    })
    .join('\n');
  const engraving = Object.entries(defaults)
    .map(([key, value]) => `  ${key}: ${value},`)
    .join('\n');
  return `${legalComment(licence)}

/**
 * How big the printed sheet's music symbols are and where they attach: each
 * glyph's advance and bounding box, the anchors the page places stems, flags
 * and dynamics by, and the engraving defaults of the font they come from. All
 * in staff spaces, y up, measured from the glyph's SMuFL origin — the point a
 * glyph is drawn at (\`drawGlyph\`). The outlines are musicGlyphOutlines.ts, kept
 * apart so layout code can read these without loading them.
${generatedNote('Read from the font metadata', fontVersion)}
 */

/** Every glyph the sheet draws, by its SMuFL name. */
export const MUSIC_GLYPH_NAMES = [
${names}
] as const;

export type MusicGlyphName = (typeof MUSIC_GLYPH_NAMES)[number];

/** Font units to a staff space: a SMuFL font's em is four of them. */
export const GLYPH_UNITS_PER_SPACE = ${UNITS_PER_SPACE};

export interface MusicGlyphMetrics {
  /** How far the glyph advances, in staff spaces. */
  advance: number;
  /** Its bounding box, \`[left, bottom, right, top]\` in staff spaces, y up. */
  bbox: readonly [number, number, number, number];
}

export const MUSIC_GLYPH_METRICS: Readonly<Record<MusicGlyphName, MusicGlyphMetrics>> = {
${metrics}
};

/**
 * The anchors the sheet places by, as SMuFL defines them, in staff spaces from
 * the glyph's origin: where a stem meets a notehead (\`stemUpSE\`,
 * \`stemDownNW\`), how far a stem is lengthened to meet its flag (\`stemUpNW\`,
 * \`stemDownSW\`), and a dynamic's optical centre.
 */
export const MUSIC_GLYPH_ANCHORS = {
${anchors}
} as const satisfies Partial<Record<MusicGlyphName, Record<string, readonly [number, number]>>>;

/** The font's engraving defaults — line thicknesses and the like — in staff spaces. */
export const ENGRAVING_DEFAULTS = {
${engraving}
} as const;
`;
}

function outlinesModule(licence, glyphs, fontVersion) {
  const rows = glyphs.map((glyph) => `  ${glyph.name}: '${glyph.encoded}',`).join('\n');
  return `${legalComment(licence)}

/**
 * The outlines of the printed sheet's music symbols, one string per glyph, in
 * the form \`scripts/lib/musicGlyphCodec.mjs\` writes and \`decodeGlyphOutline\`
 * reads: commands \`m\`, \`l\`, \`c\` and \`z\`, every coordinate pair an integer
 * delta from the one before, in font units (${UNITS_PER_SPACE} to the staff space), y up,
 * from the glyph's SMuFL origin. Filled with the nonzero rule, as a canvas and
 * a PDF fill by default: some glyphs overlap contours that wind the same way.
 * One glyph to a line, which the formatter would otherwise wrap.
${generatedNote('Extracted from the font', fontVersion)}
 */
import type { MusicGlyphName } from './musicGlyphMetrics';

// prettier-ignore
export const MUSIC_GLYPH_OUTLINES: Readonly<Record<MusicGlyphName, string>> = {
${rows}
};
`;
}

async function writeFormatted(filePath, source) {
  const options = await prettier.resolveConfig(filePath);
  await writeFile(filePath, await prettier.format(source, { ...options, filepath: filePath }));
}

async function main() {
  const pin = process.argv.includes('--pin');
  await mkdir(STAGING_DIR, { recursive: true });
  const sources = pin ? await pinSources() : await loadPinnedSources();

  const font = parseFont(sources['Bravura.otf']);
  const glyphNames = JSON.parse(sources['glyphnames.json'].toString('utf8'));
  const metadata = JSON.parse(sources['Bravura.json'].toString('utf8'));
  if (metadata.fontName !== 'Bravura') {
    throw new Error(`Bravura.json describes ${metadata.fontName}, not Bravura`);
  }
  const fontVersion = String(metadata.fontVersion);
  const licence = sources['LICENSE.txt'].toString('utf8');

  const glyphs = GLYPHS.map((name) => extractGlyph(name, font, glyphNames, metadata));
  const defaults = engravingDefaults(metadata);

  await mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await writeFormatted(METRICS_PATH, metricsModule(licence, glyphs, defaults, fontVersion));
  await writeFormatted(OUTLINES_PATH, outlinesModule(licence, glyphs, fontVersion));
  if (licence.includes('*/')) throw new Error('LICENSE.txt contains "*/"');
  await mkdir(path.dirname(LICENSE_PATH), { recursive: true });
  await writeFile(LICENSE_PATH, sources['LICENSE.txt']);

  const segments = glyphs.reduce((sum, glyph) => sum + glyph.segments, 0);
  const characters = glyphs.reduce((sum, glyph) => sum + glyph.encoded.length, 0);
  console.log(
    `Extracted ${glyphs.length} glyphs from Bravura ${metadata.fontVersion}: ` +
      `${segments} segments, ${characters} characters of outline.`,
  );
  for (const filePath of [METRICS_PATH, OUTLINES_PATH, LICENSE_PATH]) {
    console.log(`Wrote ${path.relative(ROOT, filePath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
