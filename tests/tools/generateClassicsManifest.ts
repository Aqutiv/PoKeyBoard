/**
 * Generates src/features/library/classicsManifest.ts from the vendored score
 * pack, by parsing every file through the real importer. The list view needs
 * duration, note count and tempo without fetching 60 scores, so they are
 * computed once here rather than at runtime.
 *
 * Doubles as the import check: a score that fails to parse is reported and
 * left out of the manifest instead of failing in front of a user.
 *
 * The manifest is machine-owned and regenerating overwrites it. Display names
 * are hand-curated in classicsNames.ts, which this only ever *creates* —
 * seeded from each score's own metadata on the first run, never overwritten
 * afterwards, so the editing pass survives.
 *
 * Not part of `npm test` (which only globs tests/unit and tests/integration).
 * Run it explicitly:
 *
 *   npx vitest run --config vitest.tools.config.ts
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { it } from 'vitest';
import { musicXmlToTake } from '@/domain/musicXmlImport';
import { extractMusicXmlText } from '@/domain/mxlContainer';

// Paths hang off the project root: under jsdom, import.meta.url is an http
// URL rather than a file one, so it cannot anchor them.
const SCORES_DIR = path.resolve(process.cwd(), 'public/scores/classics-v1');
const LIBRARY_DIR = path.resolve(process.cwd(), 'src/features/library');
const MANIFEST_PATH = path.join(LIBRARY_DIR, 'classicsManifest.ts');
const NAMES_PATH = path.join(LIBRARY_DIR, 'classicsNames.ts');

interface Entry {
  trackId: string;
  file: string;
  bpm: number;
  durationMs: number;
  noteCount: number;
}

/**
 * Stable slug from the upstream filename; the library take id derives from it.
 * Namespaced, because the pack holds works this library already ships as
 * authored tracks — an unprefixed `fur-elise` would collide with the authored
 * one and be silently shadowed by it in resolveLibraryTake.
 */
function toTrackId(file: string): string {
  return `score-${file
    .replace(/\.mxl$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()}`;
}

/** The composer credit the score carries, if any. */
function readComposer(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  for (const creator of Array.from(doc.getElementsByTagName('creator'))) {
    if (creator.getAttribute('type') === 'composer') return creator.textContent?.trim() ?? '';
  }
  return doc.getElementsByTagName('creator')[0]?.textContent?.trim() ?? '';
}

function renderManifest(entries: readonly Entry[]): string {
  const rows = entries
    .map((entry) =>
      [
        '  {',
        `    trackId: ${JSON.stringify(entry.trackId)},`,
        `    file: ${JSON.stringify(entry.file)},`,
        `    bpm: ${entry.bpm},`,
        `    durationMs: ${entry.durationMs},`,
        `    noteCount: ${entry.noteCount},`,
        '  },',
      ].join('\n'),
    )
    .join('\n');
  return `/**
 * The vendored Classics score pack, as list metadata.
 *
 * GENERATED — do not edit. Every field here is derived by parsing the score,
 * so editing one by hand only makes the list lie about what plays. Display
 * names live in classicsNames.ts; regenerate this with:
 *
 *   npx vitest run --config vitest.tools.config.ts
 */
export interface ClassicScoreEntry {
  /** Stable slug; the library take id is \`library:\${trackId}\`. */
  trackId: string;
  /** Filename under public/scores/classics-v1/. */
  file: string;
  bpm: number;
  durationMs: number;
  noteCount: number;
}

export const CLASSIC_SCORES: readonly ClassicScoreEntry[] = [
${rows}
];
`;
}

function renderNamesSeed(seeds: readonly { trackId: string; title: string; composer: string }[]) {
  const rows = seeds
    .map(
      (seed) =>
        `  ${JSON.stringify(seed.trackId)}: { title: ${JSON.stringify(seed.title)}, composer: ${JSON.stringify(seed.composer)} },`,
    )
    .join('\n');
  return `/**
 * How the vendored classics are named in the Library.
 *
 * Hand-curated: the upstream files are named after MuseScore uploads, so their
 * embedded titles are inconsistent and sometimes mojibake. Seeded once from
 * each score's own metadata and edited by hand since; the generator never
 * overwrites this file.
 *
 * Keyed by the trackId in classicsManifest.ts — a manifest entry with no name
 * here is a test failure, not a silent fallback.
 */
export interface ClassicScoreName {
  title: string;
  composer: string;
}

export const CLASSIC_SCORE_NAMES: Record<string, ClassicScoreName> = {
${rows}
};
`;
}

// Parsing the whole pack runs well past the default per-test timeout.
it('generates the classics manifest', { timeout: 300_000 }, async () => {
  const files = (await readdir(SCORES_DIR)).filter((name) => name.endsWith('.mxl')).sort();
  const entries: Entry[] = [];
  const seeds: { trackId: string; title: string; composer: string }[] = [];
  const failures: string[] = [];

  for (const file of files) {
    const bytes = new Uint8Array(await readFile(path.join(SCORES_DIR, file)));
    try {
      const xml = extractMusicXmlText(bytes);
      const take = musicXmlToTake(xml, file);
      const trackId = toTrackId(file);
      entries.push({
        trackId,
        file,
        bpm: take.tempo.bpm,
        durationMs: take.durationMs,
        noteCount: take.notes.length,
      });
      seeds.push({ trackId, title: take.title, composer: readComposer(xml) });
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await writeFile(MANIFEST_PATH, renderManifest(entries));
  const seededNames = !existsSync(NAMES_PATH);
  if (seededNames) await writeFile(NAMES_PATH, renderNamesSeed(seeds));

  console.log(`\nParsed ${entries.length}/${files.length} scores into the manifest.`);
  console.log(
    seededNames ? 'Seeded classicsNames.ts — curate it by hand.' : 'Kept classicsNames.ts.',
  );
  if (failures.length > 0) {
    console.log(`\n${failures.length} score(s) failed to import and were left out:`);
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  const noComposer = seeds.filter((seed) => seed.composer === '');
  if (noComposer.length > 0) {
    console.log(`\n${noComposer.length} score(s) carry no composer credit:`);
    for (const seed of noComposer) console.log(`  - ${seed.trackId}`);
  }
});
