import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Runs the one-off generators under tests/tools/. They need the app's
 * TypeScript, the `@` alias and jsdom's DOMParser, but must stay out of
 * `npm test` — hence a separate config rather than a wider include glob.
 * Standalone rather than merged with vite.config.ts, whose `include` would
 * concatenate and drag the whole unit suite along.
 *
 *   npx vitest run --config vitest.tools.config.ts
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/tools/**/*.ts'],
  },
});
