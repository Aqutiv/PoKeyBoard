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

`vite-plugin-pwa` stays at **1.3.0** and `workbox-build` at **7.4.1** — the `injectManifest` config in `vite.config.ts` is untouched. When revisiting, re-verify with the gates in [PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md): the precache manifest must stay shell-only (39 entries / ~2.0 MB, no `.sample` or `/piano/` URLs) and the `/piano/` runtime route must keep `ExpirationPlugin({ maxEntries: 512, purgeOnQuotaError: true })`.

## Host configuration

- [ ] HTTPS with a valid certificate (service worker + share + install all require it)
- [ ] SPA-friendly: unknown paths can 404 — navigation uses hash routes, but `/index.html` must be served at the base path
- [ ] Caching headers per the table in [PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md) — critically: `service-worker.js` and `index.html` **no-cache**; hashed `assets/*` and `piano/*` **immutable**
- [ ] Correct MIME types: `.webmanifest` → `application/manifest+json`, `.wasm` → `application/wasm`. Piano samples use a `.sample` extension on purpose so download managers (IDM etc.) never intercept them — any MIME (typically `application/octet-stream`) is fine, since the app decodes them from bytes, never from Content-Type

## Post-deploy verification

- [ ] Fresh profile: app loads, piano ready, a key sounds after first tap
- [ ] DevTools → Application: manifest parsed (installable), service worker **activated**
- [ ] Reload offline: shell loads
- [ ] Settings → Piano: the download completes for **each** piano; airplane-mode launch plays all keys
- [ ] Settings → Piano: switching sounds different, survives a reload, and leaves no stuck key when a note is held across the switch
- [ ] Record → Share audio → MP3 renders; share sheet (mobile) or download (desktop)
- [ ] Second deploy later: "Update available" appears and applies on request

## App version

`version` in `package.json` is a **milestone label, not a per-PR counter.** Every merge to `main`
deploys, and the package is `private`, so nothing downstream depends on the number — bumping it on
each PR would only produce a merge counter that rots the first time someone forgets.

- **Bump the minor** (`0.2.0` → `0.3.0`) when a user-visible milestone ships, **the patch** for a
  fix-only release. `1.0.0` is reserved for the milestone [README.md](README.md) describes.
- **Don't bump per PR.** Individual builds identify themselves: `vite.config.ts` stamps the short
  commit SHA and commit date into the bundle, and About shows `Version 0.2.0 (a1b2c3d · 2026-08-02)`.
  That is what to ask a user for when triaging a bug report. Settings shows the bare semver, since
  that line is about service-worker update state.
- The version is **decorative for caching.** Shell invalidation is Workbox revision hashing; sample
  invalidation is the cache names below. Bumping the semver invalidates nothing.

## Sample pack and cache bumps

- [ ] **Changing** a published pack's audio: bump its directory name (`<name>-vN`) and `PIANO_SAMPLE_CACHE` in `src/pwa/cacheNames.ts` — never mutate a published pack in place
- [ ] **Adding a new instrument** needs neither bump — its files live at new immutable URLs and nothing existing becomes dead, so bumping would only make users re-download samples they already have. Do check the `ExpirationPlugin` `maxEntries` headroom in `src/pwa/service-worker.ts`: it is 512 against 91 entries per pack, and LRU eviction is silent
- [ ] **Replacing the audio generation** (new `-vN` for packs that already ship) **does** need a `PIANO_SAMPLE_CACHE` bump, with the old name added to `STALE_PIANO_SAMPLE_CACHES`. The new packs are new URLs, so nothing evicts the old entries and nothing in the UI can reach them — a user who had downloaded a piano offline would otherwise carry the superseded generation forever. Bumping costs them nothing here, because the replacement audio is a fresh download either way
- [ ] **Retain exactly one generation back.** A superseded pack directory stays on disk so clients still running the previous app shell keep resolving their URLs; the generation before that is deleted. `scripts/build-sample-pack.mjs` lists retired packs and refuses to rebuild them
- [ ] Piano packs are stereo 16-bit FLAC. If a release ever changes that, note that the piano will sound wider or narrower than the previous release, and that an old take's cached MP3 export only re-renders the next time that take is opened (it is re-stamped with the selected piano on load)
