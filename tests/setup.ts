import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { vi } from 'vitest';

// The app fetches the MP3 encoder's .wasm by URL; tests have no server to fetch
// it from, so they get the same bytes as a data URI.
vi.mock('wasm-media-encoders/wasm/mp3?url', () => {
  const path = createRequire(import.meta.url).resolve('wasm-media-encoders/wasm/mp3');
  return { default: `data:application/wasm;base64,${readFileSync(path).toString('base64')}` };
});
