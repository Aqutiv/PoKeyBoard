import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { LIBRARY_SCORE_CACHE, PIANO_SAMPLE_CACHE, STALE_PIANO_SAMPLE_CACHES } from './cacheNames';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

// Precache the application shell (small: js/css/html/icons, never samples).
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Offline navigation fallback: every navigation serves the precached shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Versioned, immutable piano samples: Cache First, shared with the explicit
// "Download piano for offline use" flow. Purging on quota pressure protects
// user takes in IndexedDB from eviction pressure caused by sample audio.
//
// The entry cap is a safety valve, not a size budget (purgeOnQuotaError is the
// real protection): both pianos fully downloaded is 182 entries, and LRU
// eviction is silent, so it has to sit well clear of that or "available offline"
// would quietly stop being true.
registerRoute(
  ({ url }) => url.pathname.includes('/piano/'),
  new CacheFirst({
    cacheName: PIANO_SAMPLE_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: 512, purgeOnQuotaError: true })],
  }),
);

// Vendored library scores: same Cache First treatment as the samples, and for
// the same reason — the files are immutable under a versioned path, so a score
// stays playable offline once it has been opened. Deliberately left out of the
// precache: 1.2 MB of scores would otherwise ride along with every install and
// every app update, for tracks most users never open.
//
// Matched narrowly, on purpose. URL import fetches arbitrary links, and the
// obvious one to paste is this pack's own upstream — musetrainer.github.io,
// whose paths also contain "/scores/". A looser match would serve those from
// cache instead of letting the import run its own CORS and size checks.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/scores/classics-v1/'),
  new CacheFirst({
    cacheName: LIBRARY_SCORE_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: 128, purgeOnQuotaError: true })],
  }),
);

// cleanupOutdatedCaches() only covers workbox precaches, so superseded sample
// caches (keyed by the old .mp3 URLs) are dropped explicitly.
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(Promise.all(STALE_PIANO_SAMPLE_CACHES.map((name) => caches.delete(name))));
});

// Updates activate only when the user applies them at a safe moment
// (updateManager sends SKIP_WAITING); never mid-recording.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

clientsClaim();
