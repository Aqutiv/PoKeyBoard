/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// One configurable base path drives Vite, the manifest, and the service
// worker scope so the app can deploy to a subpath host (e.g. GitHub Pages).
const basePath = process.env.POKEYBOARD_BASE ?? '/';

// Read package.json rather than process.env.npm_package_version: the env var
// only exists when Vite is launched from an npm script, so a bare `vite build`
// would otherwise ship a placeholder version to users.
const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** Git metadata, or '' outside a checkout (e.g. a build from a source tarball). */
function git(...args: string[]): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// GITHUB_SHA is the commit Actions checked out; prefer it so the stamp is right
// even if the checkout is detached or shallow in ways that confuse rev-parse.
const buildCommit = process.env.GITHUB_SHA?.slice(0, 7) ?? git('rev-parse', '--short', 'HEAD');
// The commit date, not the wall clock: a build-time date would rehash the entry
// chunk on every rebuild and make the service worker announce a phantom update.
const buildDate = git('log', '-1', '--format=%cs');

export default defineConfig({
  base: basePath,
  // Bind the dev/preview server to all interfaces so phones on the same
  // Wi-Fi can reach it at http://<machine-ip>:5173 (Vite prints the URL).
  // PORT lets a launcher assign a free port when 5173 is taken.
  server: { host: true, port: Number(process.env.PORT) || undefined },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'service-worker.ts',
      injectRegister: false, // registration is handled by src/pwa/updateManager.ts
      manifest: {
        id: basePath,
        name: 'PoKeyBoard',
        short_name: 'PoKeyBoard',
        description: 'Play, record, and share piano performances from your browser.',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'any',
        background_color: '#141110',
        theme_color: '#1d1916',
        icons: [
          {
            src: 'icons/icon-transparent-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-transparent-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Precache the shell only; the piano sample pack is runtime-cached
        // (Cache First) and explicitly downloadable for offline use.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        globIgnores: ['**/piano/**'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
  },
});
