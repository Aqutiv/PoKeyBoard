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
- [ ] Correct MIME types: `.webmanifest` → `application/manifest+json`, `.wasm` → `application/wasm`, `.mp3` → `audio/mpeg`

## Post-deploy verification

- [ ] Fresh profile: app loads, piano ready, a key sounds after first tap
- [ ] DevTools → Application: manifest parsed (installable), service worker **activated**
- [ ] Reload offline: shell loads
- [ ] Settings → Download piano for offline use completes; airplane-mode launch plays all keys
- [ ] Record → Share audio → MP3 renders; share sheet (mobile) or download (desktop)
- [ ] Second deploy later: "Update available" appears and applies on request

## Version bump

- [ ] Update `version` in `package.json` (shown in Settings/About)
- [ ] If piano samples ever change, bump the pack directory name (`salamander-grand-vN`) and `PIANO_SAMPLE_CACHE` in `src/pwa/cacheNames.ts` — never mutate a published pack in place
