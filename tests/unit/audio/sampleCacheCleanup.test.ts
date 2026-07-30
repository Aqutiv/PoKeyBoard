import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '@/audio/AudioEngine';
import { PIANO_SAMPLE_CACHE, STALE_PIANO_SAMPLE_CACHES } from '@/pwa/cacheNames';

/**
 * Minimal Cache Storage stand-in: only the surface deleteDownloadedSamples uses
 * (open → keys → delete), keyed by URL string.
 */
function stubCaches(urls: string[]) {
  const entries = new Set(urls);
  const cache = {
    keys: async () => [...entries].map((url) => new Request(url)),
    delete: async (request: Request) => entries.delete(request.url),
  };
  vi.stubGlobal('caches', {
    open: async () => cache,
    delete: async () => true,
  });
  return entries;
}

const BASE = 'https://example.test/piano';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deleting one piano’s downloaded samples', () => {
  it('reclaims every generation of that piano, not just the current pack', async () => {
    // What an upgraded user's cache looks like: they downloaded the old
    // generation offline, then the app shipped a new one at new URLs.
    const entries = stubCaches([
      `${BASE}/salamander-grand-v2/C4v10.sample`,
      `${BASE}/salamander-grand-v2/manifest.json`,
      `${BASE}/salamander-grand-v3/C4v10.sample`,
      `${BASE}/salamander-grand-v3/manifest.json`,
      `${BASE}/headroom-grand-v1/C4v3.sample`,
      `${BASE}/headroom-grand-v2/C4v3.sample`,
    ]);

    await audioEngine.deleteDownloadedSamples('salamander-grand');

    // Every Salamander generation is gone; Headroom is untouched.
    expect([...entries].sort()).toEqual([
      `${BASE}/headroom-grand-v1/C4v3.sample`,
      `${BASE}/headroom-grand-v2/C4v3.sample`,
    ]);
  });

  it('does not let one instrument id match another’s path', async () => {
    const entries = stubCaches([
      `${BASE}/headroom-grand-v2/C4v3.sample`,
      `${BASE}/salamander-grand-v3/C4v10.sample`,
    ]);

    await audioEngine.deleteDownloadedSamples('headroom-grand');

    expect([...entries]).toEqual([`${BASE}/salamander-grand-v3/C4v10.sample`]);
  });
});

describe('the sample cache generation', () => {
  it('retires every superseded name it has ever used', () => {
    // A superseded pack lives at URLs nothing fetches and nothing evicts, so the
    // only thing that reclaims it is the activation-time cache sweep.
    expect(STALE_PIANO_SAMPLE_CACHES).not.toContain(PIANO_SAMPLE_CACHE);
    const generation = Number(/-v(\d+)$/.exec(PIANO_SAMPLE_CACHE)?.[1]);
    expect(generation).toBeGreaterThan(0);
    for (let previous = 1; previous < generation; previous += 1) {
      expect(STALE_PIANO_SAMPLE_CACHES).toContain(`pokeyboard-piano-samples-v${previous}`);
    }
  });
});
