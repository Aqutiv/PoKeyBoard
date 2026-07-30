# Deployment checklist

PoKeyBoard deploys to **any static HTTPS host** (no backend). The reference CI is `.github/workflows/ci.yml`.

## Build

- [ ] `npm ci`
- [ ] `npm run format:check && npm run lint && npm run typecheck && npm run test`
- [ ] Root deploy: `npm run build` · Subpath deploy: `POKEYBOARD_BASE=/your-path/ npm run build`
- [ ] `npm run test:e2e` (smoke against the exact artifact)
- [ ] Upload the `dist/` directory

## Host configuration

- [ ] HTTPS with a valid certificate (service worker + share + install all require it)
- [ ] SPA-friendly: unknown paths can 404 — navigation uses hash routes, but `/index.html` must be served at the base path
- [ ] Caching headers per the table in [PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md) — critically: `service-worker.js` and `index.html` **no-cache**; hashed `assets/*` and `piano/*` **immutable**
- [ ] Correct MIME types: `.webmanifest` → `application/manifest+json`, `.wasm` → `application/wasm`. Piano samples use a `.sample` extension on purpose so download managers (IDM etc.) never intercept them — any MIME (typically `application/octet-stream`) is fine, since the app decodes them from bytes, never from Content-Type

## Post-deploy verification

- [ ] Fresh profile: app loads, piano ready, a key sounds after first tap
- [ ] DevTools → Application: manifest parsed (installable), service worker **activated**
- [ ] Reload offline: shell loads
- [ ] Settings → Download piano for offline use completes for **each** piano; airplane-mode launch plays all keys
- [ ] Settings → Piano: switching sounds different, survives a reload, and leaves no stuck key when a note is held across the switch
- [ ] Record → Share audio → MP3 renders; share sheet (mobile) or download (desktop)
- [ ] Second deploy later: "Update available" appears and applies on request

## Version bump

- [ ] Update `version` in `package.json` (shown in Settings/About)
- [ ] **Changing** a published pack's audio: bump its directory name (`<name>-vN`) and `PIANO_SAMPLE_CACHE` in `src/pwa/cacheNames.ts` — never mutate a published pack in place
- [ ] **Adding a new instrument** needs neither bump — its files live at new immutable URLs and nothing existing becomes dead, so bumping would only make users re-download samples they already have. Do check the `ExpirationPlugin` `maxEntries` headroom in `src/pwa/service-worker.ts`: it is 512 against 91 entries per pack, and LRU eviction is silent
- [ ] **Replacing the audio generation** (new `-vN` for packs that already ship) **does** need a `PIANO_SAMPLE_CACHE` bump, with the old name added to `STALE_PIANO_SAMPLE_CACHES`. The new packs are new URLs, so nothing evicts the old entries and nothing in the UI can reach them — a user who had downloaded a piano offline would otherwise carry the superseded generation forever. Bumping costs them nothing here, because the replacement audio is a fresh download either way
- [ ] **Retain exactly one generation back.** A superseded pack directory stays on disk so clients still running the previous app shell keep resolving their URLs; the generation before that is deleted. `scripts/build-sample-pack.mjs` lists retired packs and refuses to rebuild them
- [ ] Piano packs are stereo 16-bit FLAC. If a release ever changes that, note that the piano will sound wider or narrower than the previous release, and that an old take's cached MP3 export only re-renders the next time that take is opened (it is re-stamped with the selected piano on load)
