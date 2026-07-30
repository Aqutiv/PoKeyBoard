# Deployment checklist

PoKeyBoard deploys to **any static HTTPS host** (no backend). The reference CI is `.github/workflows/ci.yml`.

## Build

- [ ] `npm ci`
- [ ] `npm run format:check && npm run lint && npm run typecheck && npm run test`
- [ ] Root deploy: `npm run build` · Subpath deploy: `POKEYBOARD_BASE=/your-path/ npm run build`
- [ ] `npm run test:e2e` (smoke against the exact artifact)
- [ ] Upload the `dist/` directory

## Dependency overrides

`package.json` carries three `overrides`, all of them build-time-only transitive deps under the `vite-plugin-pwa` devDependency. None ship in `dist/`. They exist because `npm audit`'s suggested fix is a **downgrade** to `vite-plugin-pwa@1.2.0`, and `--force` would take it: 1.3.0 is already the latest release, so there is no version to upgrade _to_.

| Override                                      | Pinned to    | Replaces                              | Why                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@trickfilm400/rollup-plugin-off-main-thread` | `4.0.0-pre2` | `3.0.0-pre1` (via `workbox-build`)    | v4 depends on `ejs@^6`, which has **zero** dependencies. That one pin drops the whole `ejs 3 → jake → filelist → minimatch → brace-expansion` chain — six advisories and 95 packages. `workbox-build@7.4.1` requests `^3.0.0-pre1`; both lines are prereleases, so this is a fork-track bump, not a stability downgrade. |
| `brace-expansion`                             | `^5.0.9`     | `5.0.7` (via `eslint` → `minimatch`)  | GHSA-mh99-v99m-4gvg is fixed only in 5.0.8+ — there is no 1.x/2.x backport. Same major as `minimatch@10`'s `^5.0.5`, so it is a patch bump. Not a workbox dep at all.                                                                                                                                                    |
| `fast-uri`                                    | `^3.1.4`     | `3.1.3` (via `workbox-build` → `ajv`) | 3.1.4 is the patched release inside the 3.x line, satisfying `ajv@8`'s `^3.0.1`. Avoids the 4.x major that `npm audit` would otherwise reach for.                                                                                                                                                                        |

`vite-plugin-pwa` stays at **1.3.0** and `workbox-build` at **7.4.1** — the `injectManifest` config in `vite.config.ts` is untouched. When revisiting, re-verify with the gates in [PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md): the precache manifest must stay shell-only (39 entries / ~2.0 MiB, no `.sample` or `/piano/` URLs) and the `/piano/` runtime route must keep `ExpirationPlugin({ maxEntries: 512, purgeOnQuotaError: true })`.

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
- [ ] **Adding** a pack needs neither bump — the files live at new immutable URLs, and bumping the cache name would make every existing user re-download samples they already have. Do check the `ExpirationPlugin` `maxEntries` headroom in `src/pwa/service-worker.ts`: it is 512 against 91 entries per pack, and LRU eviction is silent
