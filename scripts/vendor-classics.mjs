/**
 * Vendors the Classics score pack from the MuseTrainer public-domain MusicXML
 * library (https://github.com/musetrainer/library) into
 * public/scores/classics-v1/.
 *
 * Upstream ships no LICENSE file and no per-score provenance — it asserts
 * "public domain" in its README, and its filenames match MuseScore.com
 * uploads. Two consequences shape this script:
 *
 *   1. EXCLUSIONS below drops modern copyrighted compositions (several are
 *      misattributed to Chopin or Bach) and unresolved arrangements of older
 *      works. Each entry carries its reason.
 *   2. Straightforward transcriptions are retained under the upstream public-domain
 *      designation. Unresolved arrangements are excluded. Every decision is
 *      recorded in store/score-rights.json and SOURCES.md with its upstream blob hash,
 *      so the curation decision is auditable and reversible per file.
 *
 * Even for public-domain compositions, a typeset edition can carry rights of
 * its own; these engravings are third-party work. That call belongs to the
 * repository owner, which is what SOURCES.md documents.
 *
 * Pinned to one upstream commit and verified by git blob hash, so a re-run
 * either reproduces the same bytes or fails loudly. Idempotent: files already
 * present with the right hash are left alone.
 *
 * Usage: node scripts/vendor-classics.mjs
 * Requires: Node 20.19+ or 22.12+ (global fetch).
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = 'musetrainer/library';
/** Pinned upstream commit (2024-11-29); the repo has been dormant since. */
const PINNED_SHA = '9128876f6164d96997c877a2be843349a32bdabb';
const OUT_DIR = fileURLToPath(new URL('../public/scores/classics-v1/', import.meta.url));

/**
 * Files left behind, by upstream filename: modern compositions and unresolved
 * arrangements, including several misleading composer attributions.
 */
const EXCLUSIONS = {
  'Ave_Maria_D839_-_Schubert_-_Solo_Piano_Arrg..mxl':
    'Piano arrangement credited to Simon Ewers; no arrangement permission documented.',
  'Bach_Toccata_and_Fugue_in_D_Minor_Piano_solo.mxl':
    'Piano adaptation of organ work; arranger and arrangement permission not established.',
  'Beethoven_Symphony_No._5_1st_movement_Piano_solo.mxl':
    'Piano reduction of orchestral work; arranger and permission not established.',
  'Bella_Ciao.mxl':
    'Unattributed piano setting of a traditional song; arrangement provenance unresolved.',
  'Canon_in_D.mxl':
    'Piano adaptation of a work for strings and continuo; arrangement provenance unresolved.',
  'Canon_in_D_3.mxl':
    'Credits arrangement to Jacob Danao and carries a 2016 rights notice; no permission documented.',
  'Canon_in_D_easy.mxl':
    'Simplified piano arrangement; no arrangement permission documented. Lesson now uses a new authored excerpt.',
  'Carol_of_the_Bells.mxl':
    'Credits Will_Ross rather than the historical composer; arrangement permission unresolved.',
  'Carol_of_the_Bells_easy_piano.mxl':
    'Modern simplified piano arrangement; edition permission unresolved.',
  'Dance_of_the_sugar_plum_fairy.mxl':
    'Piano adaptation of orchestral ballet; arranger and permission unresolved.',
  'Flight_of_the_Bumblebee.mxl':
    'Piano adaptation of operatic orchestral music; arranger and permission unresolved.',
  'Fur_Elise_-_Beethoven_-_for_beginner_piano.mxl':
    'Beginner adaptation; arrangement permission unresolved.',
  'Fur_Elise_Easy_Piano.mxl': 'Simplified adaptation; arrangement permission unresolved.',
  'Fur_Elise_fingered.mxl':
    'Explicitly credits arr. Verona and pianolessenassen.nl/bladmuziek; edition permission unresolved.',
  'Greensleeves_for_Piano_easy_and_beautiful.mxl':
    'Unattributed piano arrangement of traditional melody; permission unresolved.',
  'Happy_Birthday_To_You_Piano.mxl':
    'Explicitly credits Arranged by Manjuprasad; arrangement permission unresolved.',
  'J._S._Bach_-_Air_on_the_G_String_Piano_arrangement.mxl':
    'Piano arrangement without documented arranger permission.',
  'Lacrimosa_-_Requiem.mxl':
    'Piano reduction of choral/orchestral work; arrangement permission unresolved.',
  'Nocturne_in_E-flat_Major_Op._9_No._2_Easy.mxl':
    'Explicitly credits arranger Murilo Pedroza; no arrangement permission documented.',
  'Ode_to_Joy_Easy_variation.mxl':
    'Unattributed new variation; permission unresolved. Authored first-steps version remains.',
  'Swan_Lake.mxl': 'Piano adaptation of orchestral ballet; arrangement provenance unresolved.',
  'Waltz_of_the_Flowers.mxl':
    'Piano adaptation of orchestral ballet; arrangement provenance unresolved.',

  'Mariage_dAmour.mxl': 'Paul de Senneville, 1979 — in copyright, not Chopin.',
  'Chopin_-_Spring_Waltz.mxl': "Same piece as Mariage d'Amour; not by Chopin.",
  'Spring_Waltz_Mariage_dAmour_-_Chopin.mxl': "Same piece as Mariage d'Amour; not by Chopin.",
  'G_Minor_Bach.mxl': "Luo Ni's modern arrangement, not Bach's original.",
  'G_Minor_Bach_Original.mxl': "Luo Ni's modern arrangement, not Bach's original.",
  'Hungarian_Sonata.mxl': 'Senneville/Clayderman, modern — in copyright.',
  'Passacaglia.mxl': 'Circulating version is the modern arrangement, not Handel-Halvorsen.',
  'Passacaglia2.mxl': 'Circulating version is the modern arrangement, not Handel-Halvorsen.',
  'Bella_Ciao_-_La_Casa_de_Papel.mxl': 'Tune is traditional; this arrangement is not.',
};

/** Git's object hash for a blob, so downloads can be checked against the tree. */
function gitBlobHash(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'pokeyboard-vendor-classics' },
  });
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return response.json();
}

async function listUpstreamScores() {
  const tree = await fetchJson(
    `https://api.github.com/repos/${REPO}/git/trees/${PINNED_SHA}?recursive=1`,
  );
  return tree.tree
    .filter((entry) => entry.type === 'blob' && /^scores\/.+\.mxl$/.test(entry.path))
    .map((entry) => ({ name: path.posix.basename(entry.path), sha: entry.sha, size: entry.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readIfHashMatches(file, sha) {
  try {
    const existing = await readFile(path.join(OUT_DIR, file));
    return gitBlobHash(existing) === sha ? existing : null;
  } catch {
    return null;
  }
}

async function download(name) {
  const url = `https://raw.githubusercontent.com/${REPO}/${PINNED_SHA}/scores/${encodeURIComponent(name)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function sourcesMarkdown(kept) {
  const rows = kept.map(({ name, sha, size }) => `| \`${name}\` | ${size} | \`${sha}\` |`);
  const dropped = Object.entries(EXCLUSIONS).map(([name, why]) => `| \`${name}\` | ${why} |`);
  return [
    '# Classics score pack — sources',
    '',
    'Vendored from the MuseTrainer public-domain MusicXML library.',
    '',
    `- Upstream: https://github.com/${REPO}`,
    `- Pinned commit: \`${PINNED_SHA}\``,
    `- Retrieved: ${new Date().toISOString().slice(0, 10)}`,
    `- Regenerate with: \`node scripts/vendor-classics.mjs\``,
    '',
    'Upstream ships no LICENSE file; its README asserts these are public-domain',
    'works. Straightforward transcriptions are retained under that designation.',
    'Unresolved piano arrangements and adaptations are excluded after the',
    '2026-11-07 review. See store/score-rights.json for per-file evidence.',
    '',
    '## Included',
    '',
    '| File | Bytes | Upstream blob |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## Excluded',
    '',
    'Not shipped: modern compositions or arrangements whose permissions remain',
    'unresolved. An exclusion is not a claim that the original composition is protected.',
    '',
    '| File | Reason |',
    '| --- | --- |',
    ...dropped,
    '',
  ].join('\n');
}

async function main() {
  const upstream = await listUpstreamScores();
  const kept = upstream.filter((entry) => !(entry.name in EXCLUSIONS));
  const unknownExclusions = Object.keys(EXCLUSIONS).filter(
    (name) => !upstream.some((entry) => entry.name === name),
  );
  if (unknownExclusions.length > 0) {
    throw new Error(`Exclusions not found upstream: ${unknownExclusions.join(', ')}`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  let downloaded = 0;
  let reused = 0;
  let bytes = 0;
  for (const entry of kept) {
    const cached = await readIfHashMatches(entry.name, entry.sha);
    if (cached) {
      reused += 1;
      bytes += cached.length;
      continue;
    }
    const data = await download(entry.name);
    const actual = gitBlobHash(data);
    if (actual !== entry.sha) {
      throw new Error(`${entry.name}: hash mismatch (expected ${entry.sha}, got ${actual})`);
    }
    await writeFile(path.join(OUT_DIR, entry.name), data);
    downloaded += 1;
    bytes += data.length;
  }

  await writeFile(path.join(OUT_DIR, 'SOURCES.md'), sourcesMarkdown(kept));

  // Vendored files that upstream no longer lists would silently rot otherwise.
  const onDisk = (await readdir(OUT_DIR)).filter((name) => name.endsWith('.mxl'));
  const orphans = onDisk.filter((name) => !kept.some((entry) => entry.name === name));

  console.log(
    `Vendored ${kept.length} scores (${downloaded} downloaded, ${reused} reused), ` +
      `${(bytes / 1024).toFixed(0)} KiB total.`,
  );
  console.log(`Excluded ${Object.keys(EXCLUSIONS).length} files; see SOURCES.md.`);
  if (orphans.length > 0) console.log(`Stale files to remove: ${orphans.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
