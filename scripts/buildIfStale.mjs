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
import { readdir, stat } from 'node:fs/promises';
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

/** The newest mtime at or under `target`, with the file that carries it. */
async function newest(target) {
  let entry;
  try {
    entry = await stat(target);
  } catch {
    return null; // Absent inputs simply do not vote.
  }
  if (!entry.isDirectory()) return { path: target, mtimeMs: entry.mtimeMs };

  let best = null;
  for (const child of await readdir(target, { withFileTypes: true })) {
    const found = await newest(path.join(target, child.name));
    if (found && (!best || found.mtimeMs > best.mtimeMs)) best = found;
  }
  return best;
}

function build() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`build exited ${code}`));
    });
  });
}

const witness = await newest(WITNESS);
if (!witness) {
  console.log('buildIfStale: no dist/index.html — building.');
  await build();
} else {
  const candidates = await Promise.all(WATCHED.map(newest));
  const stale = candidates
    .filter((found) => found !== null)
    .filter((found) => found.mtimeMs > witness.mtimeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (stale.length === 0) {
    console.log('buildIfStale: dist/ is current — skipping the build.');
  } else {
    console.log(`buildIfStale: ${stale[0].path} is newer than dist/ — building.`);
    await build();
  }
}
