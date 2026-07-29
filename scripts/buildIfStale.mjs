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
import { spawn } from 'node:child_process';
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

/**
 * Build-time configuration that lives in no watched file. vite.config.ts turns
 * POKEYBOARD_BASE into asset URLs, the web manifest and the service-worker
 * scope, so changing it has to invalidate dist/ even when every source file is
 * older than the build — otherwise `POKEYBOARD_BASE=/subpath/ npm run test:e2e`
 * would quietly test the previous root build.
 */
const BUILD_ENV = JSON.stringify({ base: process.env.POKEYBOARD_BASE ?? '/' });
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
if (!witness) {
  await build('no dist/index.html');
} else if ((await recordedBuildEnv()) !== BUILD_ENV) {
  await build('dist/ was built with a different POKEYBOARD_BASE');
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
