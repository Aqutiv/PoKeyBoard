import path from 'node:path';

/**
 * Where the e2e preview server lives. Shared by playwright.config.ts (which
 * needs it for baseURL, before globalSetup runs) and globalSetup.ts.
 *
 * Override the port to run two checkouts at once — worktrees of this repo all
 * default to 4173, and a run that silently reuses another checkout's server
 * tests the wrong build.
 */
export const PREVIEW_PORT = Number(process.env.POKEYBOARD_E2E_PORT) || 4173;
export const PREVIEW_HOST = '127.0.0.1';
export const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;

/** Served at `/`, and the fingerprint used to tell our build from another's. */
export const INDEX_PATH = path.resolve('dist', 'index.html');
