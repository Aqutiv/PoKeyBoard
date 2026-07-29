import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Shared by serviceWorker.spec.ts, which mutates the built service worker, and
 * globalSetup.ts, which repairs it.
 *
 * The mutation rewrites real build output, so getting it wrong is expensive:
 * a truncated or half-written service-worker.js still returns HTTP 200, and the
 * only symptom is `ServiceWorker script evaluation failed` — swallowed by the
 * `void wb.register()` in src/pwa/updateManager.ts. Every worker test then hangs
 * waiting for a controller that can never arrive, and stays broken across runs
 * until someone happens to rebuild. Hence two defences here: every write is
 * atomic, and the pristine bytes live on disk rather than in a variable that
 * dies with the process.
 */
export const SW_PATH = path.resolve('dist', 'service-worker.js');

/** Presence of this file means a run died mid-mutation. */
export const SW_BACKUP_PATH = `${SW_PATH}.e2e-backup`;

/**
 * Replace the service worker without ever exposing a partial file: write beside
 * it, then rename over it. Node's rename replaces the destination atomically, so
 * a concurrent reader sees either the old script or the new one.
 */
export function writeServiceWorkerAtomically(contents: string): void {
  const temporary = `${SW_PATH}.e2e-tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, SW_PATH);
}

/**
 * Put the pristine service worker back, if a previous run left one behind.
 * Called from globalSetup so a killed run cannot poison the next one.
 */
export function restoreServiceWorkerIfNeeded(): boolean {
  if (!existsSync(SW_BACKUP_PATH)) return false;
  copyFileSync(SW_BACKUP_PATH, `${SW_PATH}.e2e-tmp`);
  renameSync(`${SW_PATH}.e2e-tmp`, SW_PATH);
  rmSync(SW_BACKUP_PATH);
  return true;
}
