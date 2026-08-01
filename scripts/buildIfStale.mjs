/**
 * Runs `npm run build` only when dist/ is older than the sources that produce
 * it. The e2e suite serves dist/ through Vite preview, so it needs a build — but
 * rebuilding on every `npm run test:e2e` costs a full `vite build` even when
 * only a spec changed, which is most of the time while iterating.
 *
 * mtime comparison, not hashing: a build is cheap to redo and expensive to skip
 * wrongly, so anything ambiguous rebuilds. `npm run test:e2e:fast` skips this
 * check entirely.
 */
import { execFileSync, spawn } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Everything whose change should invalidate dist/. */
const WATCHED = [
  'src',
  // Generator scripts are not listed: what they emit lands in public/.
  'public',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tsconfig.worker.json',
];

const WITNESS = path.join('dist', 'index.html');

/** Git metadata, or '' outside a checkout. Mirrors the helper in vite.config.ts. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Build-time configuration that lives in no watched file. Each entry is derived
 * the same way vite.config.ts derives it — deliberately re-read rather than
 * imported, since this script runs as plain Node against a TypeScript config.
 *
 * - `base`: vite.config.ts turns POKEYBOARD_BASE into asset URLs, the web
 *   manifest and the service-worker scope, so changing it has to invalidate
 *   dist/ even when every source file is older than the build — otherwise
 *   `POKEYBOARD_BASE=/subpath/ npm run test:e2e` would quietly test the
 *   previous root build.
 * - `commit`/`date`: the build stamp shown in About. Git metadata is in no
 *   watched path, so a commit that touches only tests/ or a doc would leave
 *   dist/ current by mtime while its stamp still named the previous commit.
 *
 * Uncommitted edits do not move HEAD, so iterating on a spec still skips the
 * build; only an actual checkout or commit rebuilds, which is when the artifact
 * genuinely differs.
 */
const BUILD_ENV = JSON.stringify({
  base: process.env.POKEYBOARD_BASE ?? '/',
  commit: process.env.GITHUB_SHA?.slice(0, 7) ?? git('rev-parse', '--short', 'HEAD'),
  date: git('log', '-1', '--format=%cs'),
});
const BUILD_ENV_STAMP = path.join('dist', '.buildIfStale-env');

/** The newest mtime at or under `target`, with the file that carries it. */
async function newest(target) {
  let entry;
  try {
    entry = await stat(target);
  } catch {
    return null; // Absent inputs simply do not vote.
  }
  if (!entry.isDirectory()) return { path: target, mtimeMs: entry.mtimeMs };

  // A directory's own mtime counts, not just its children's: it moves when an
  // entry is added, renamed or *deleted*, and a deletion leaves every surviving
  // file's mtime untouched. Without this, removing a source file would leave its
  // output stranded in dist/ while the build was skipped as current.
  let best = { path: target, mtimeMs: entry.mtimeMs };
  for (const child of await readdir(target, { withFileTypes: true })) {
    const found = await newest(path.join(target, child.name));
    if (found && found.mtimeMs > best.mtimeMs) best = found;
  }
  return best;
}

/** The BUILD_ENV recorded by the last build here, or null if there is none. */
async function recordedBuildEnv() {
  try {
    return await readFile(BUILD_ENV_STAMP, 'utf8');
  } catch {
    return null; // No stamp: a dist/ from before this check, so rebuild.
  }
}

/** Names the BUILD_ENV entries that moved, so the rebuild says which one it was. */
function changedBuildEnvKeys(recorded) {
  let previous;
  try {
    previous = JSON.parse(recorded);
  } catch {
    return ['an unreadable stamp']; // Truncated or hand-edited: rebuild anyway.
  }
  const current = JSON.parse(BUILD_ENV);
  return Object.keys(current).filter((key) => current[key] !== previous[key]);
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`build exited ${code}`));
    });
  });
}

async function build(reason) {
  console.log(`buildIfStale: ${reason} — building.`);
  await runBuild();
  // Written after the build so a failed one leaves no misleading stamp.
  await writeFile(BUILD_ENV_STAMP, BUILD_ENV);
}

const witness = await newest(WITNESS);
const recorded = await recordedBuildEnv();
if (!witness) {
  await build('no dist/index.html');
} else if (recorded === null) {
  await build('dist/ predates the build-input stamp');
} else if (recorded !== BUILD_ENV) {
  await build(`dist/ was built with a different ${changedBuildEnvKeys(recorded).join(' and ')}`);
} else {
  const candidates = await Promise.all(WATCHED.map(newest));
  const stale = candidates
    .filter((found) => found !== null)
    .filter((found) => found.mtimeMs > witness.mtimeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (stale.length === 0) {
    console.log('buildIfStale: dist/ is current — skipping the build.');
  } else {
    await build(`${stale[0].path} is newer than dist/`);
  }
}
