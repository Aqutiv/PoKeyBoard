import { existsSync, readFileSync } from 'node:fs';
import { preview, type PreviewServer } from 'vite';
import { INDEX_PATH, PREVIEW_HOST, PREVIEW_PORT, PREVIEW_URL } from './previewServer';
import { restoreServiceWorkerIfNeeded } from './serviceWorkerFile';

type ExistingServer =
  | { kind: 'none' }
  /** Serving byte-identical output, so reusing it is free. */
  | { kind: 'ours' }
  /** Something is on the port, but it is not this build. */
  | { kind: 'foreign'; reason: string };

/**
 * Identify whatever is already on the preview port.
 *
 * Reusing a running server makes an iteration loop much faster, but reusing the
 * *wrong* one is silently destructive: every worktree of this repo defaults to
 * 4173, so a second run happily tests another checkout's dist while writing to
 * its own — which is how a concurrent run once left dist/service-worker.js
 * truncated. Compare the served index.html against the local one and refuse
 * anything that does not match.
 */
async function inspectExistingPreview(): Promise<ExistingServer> {
  let served: string;
  try {
    const response = await fetch(PREVIEW_URL, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok)
      return { kind: 'foreign', reason: `it answers / with HTTP ${response.status}` };
    served = await response.text();
  } catch {
    // Nothing listening, or nothing that speaks HTTP in time.
    return { kind: 'none' };
  }
  if (!existsSync(INDEX_PATH)) {
    return {
      kind: 'foreign',
      reason: 'this checkout has no dist/index.html to compare it against',
    };
  }
  if (served !== readFileSync(INDEX_PATH, 'utf8')) {
    return { kind: 'foreign', reason: 'it serves a different index.html than this checkout built' };
  }
  return { kind: 'ours' };
}

function foreignServerError(reason: string): Error {
  return new Error(
    `Something is already serving ${PREVIEW_URL} and ${reason}.\n\n` +
      'Almost certainly another checkout or worktree of this repo — they all default\n' +
      'to this port, and reusing that server would test its build while these tests\n' +
      'write to this one. Either stop the other run, or give this one its own port:\n\n' +
      '  POKEYBOARD_E2E_PORT=4273 npx playwright test\n' +
      "  $env:POKEYBOARD_E2E_PORT = '4273'; npx playwright test    # PowerShell",
  );
}

/**
 * Run Vite in Playwright's own process so Windows teardown can await
 * server.close() instead of waiting on child-process tree termination.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (restoreServiceWorkerIfNeeded()) {
    console.warn('globalSetup: repaired dist/service-worker.js from a run that was killed.');
  }

  const existing = await inspectExistingPreview();
  if (existing.kind === 'foreign') throw foreignServerError(existing.reason);
  if (existing.kind === 'ours') {
    // On CI nothing should be listening at all; a match there still means some
    // other job is sharing this machine's port, so start our own and let
    // strictPort complain rather than interleaving with it.
    if (!process.env.CI) return async () => undefined;
  }

  let server: PreviewServer | null = await preview({
    preview: { host: PREVIEW_HOST, port: PREVIEW_PORT, strictPort: true },
    logLevel: 'warn',
  });
  return async () => {
    await server?.close();
    server = null;
  };
}
