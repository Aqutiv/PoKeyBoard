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
import { PIANO_SAMPLE_CACHE, STALE_PIANO_SAMPLE_CACHES } from './cacheNames';

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
registerRoute(
  ({ url }) => url.pathname.includes('/piano/'),
  new CacheFirst({
    cacheName: PIANO_SAMPLE_CACHE,
    plugins: [new ExpirationPlugin({ maxEntries: 256, purgeOnQuotaError: true })],
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
