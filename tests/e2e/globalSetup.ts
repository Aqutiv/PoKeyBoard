import { preview, type PreviewServer } from 'vite';
import { restoreServiceWorkerIfNeeded } from './serviceWorkerFile';

const PREVIEW_URL = 'http://127.0.0.1:4173';

async function existingLocalPreview(): Promise<boolean> {
  if (process.env.CI) return false;
  try {
    const response = await fetch(PREVIEW_URL, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Run Vite in Playwright's own process so Windows teardown can await
 * server.close() instead of waiting on child-process tree termination.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (restoreServiceWorkerIfNeeded()) {
    console.warn('globalSetup: repaired dist/service-worker.js from a run that was killed.');
  }
  if (await existingLocalPreview()) return async () => undefined;

  let server: PreviewServer | null = await preview({
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    logLevel: 'warn',
  });
  return async () => {
    await server?.close();
    server = null;
  };
}
