/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// One configurable base path drives Vite, the manifest, and the service
// worker scope so the app can deploy to a subpath host (e.g. GitHub Pages).
const basePath = process.env.POKEYBOARD_BASE ?? '/';

export default defineConfig({
  base: basePath,
  // Bind the dev/preview server to all interfaces so phones on the same
  // Wi-Fi can reach it at http://<machine-ip>:5173 (Vite prints the URL).
  // PORT lets a launcher assign a free port when 5173 is taken.
  server: { host: true, port: Number(process.env.PORT) || undefined },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
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
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
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
