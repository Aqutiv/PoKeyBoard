# Testing

## Automated

```bash
npm run test          # 448 Vitest unit tests (jsdom + fake-indexeddb)
npm run test:e2e      # 45 Playwright tests against the production preview build
npm run test:e2e:fast # the same, without the is-dist-stale build check
npm run lint && npm run typecheck && npm run format:check
```

`test:e2e` rebuilds only when `dist/` is older than its sources
(`scripts/buildIfStale.mjs`); the suite serves `dist/` through Vite preview, so a
build has to exist. `test:e2e:fast` skips that check for when you know it is
current.

The preview runs on port 4173 and an already-running one is reused, which makes
re-runs quick. Every worktree defaults to that same port, though, so `globalSetup`
compares the served `index.html` against this checkout's before trusting it and
refuses anything else — reusing another checkout's server would test its build
while these tests write to yours, which is exactly how `dist/service-worker.js`
once ended up truncated. To run two checkouts at once, give one its own port:

```bash
POKEYBOARD_E2E_PORT=4273 npx playwright test
```

**Two speed defaults you should know about**, both in `tests/e2e/fixtures.ts` and
`playwright.config.ts`. Every test starts from a fresh browser context with an
empty cache, so a plain visit costs ~12 MB and 42 `decodeAudioData` calls before
`data-piano-ready` flips — paid once per test. So by default **every** pack's
manifest (one per selectable piano, from `PIANO_INSTRUMENTS`) is routed to six
real samples of that pack (one velocity layer, roots spaced so every one of the
88 keys still sounds, pitch-shifted), and the service worker is blocked. Stubbing
just the default pack is not enough: Settings reads both manifests for their
offline sizes, and `pianoInstrument.spec.ts` makes the second pack active. The
suite also runs `fullyParallel` across workers, with `serviceWorker.spec.ts`
isolated in a serial project that runs last — one of its tests byte-mutates
`dist/service-worker.js`, and both wait on a real install that cannot be timed
reliably against a contended preview server.

Specs that are _about_ those things opt back out via `test.use`. `export.spec.ts`
takes `samplePack: 'real'` — its file-size and MP3-header assertions are what
prove the real pack still decodes to audible audio. `serviceWorker.spec.ts` takes
`serviceWorkers: 'allow'`, and its update test the real pack as well, so the one
test covering a real worker and a real pack together is deterministic. Its
offline-shell test deliberately does _not_ wait for the sample pack: the shell and
the worker are all it asserts. To run everything the unmodified way — real pack,
real worker, the pre-release fidelity check:

```bash
POKEYBOARD_E2E_REAL_PACK=1 npx playwright test
```

In PowerShell: `$env:POKEYBOARD_E2E_REAL_PACK = '1'; npx playwright test`. Traces
are recorded on first retry, so locally (retries: 0) nothing is captured — add
`--trace on` when debugging a specific failure.

To hunt flakiness, repeat one project at a time — **not** the whole suite:

```bash
npx playwright test --project=e2e --repeat-each=3
npx playwright test --project=service-worker --no-deps --repeat-each=3 --workers=1
```

`--repeat-each` on the whole suite is misleading and destructive here. Because the
`e2e` project is a `dependencies` entry it counts as a setup project, and
Playwright neither repeats nor filters those — so a bare `--repeat-each=3` repeats
only the two worker tests and silently leaves the other 43 running once. Worse,
those repeated copies are not serialized by `fullyParallel: false`, so they run
concurrently and fight over `dist/service-worker.js`. `--workers=1` above is what
keeps them apart. `--grep` is subject to the same rule: it cannot narrow the `e2e`
project while anything depends on it.

**Unit coverage** (tests/unit): MIDI name conversion and round-trips, staff mapping (splits, accidentals, ledgers, stems), visual quantization grids and duration symbols, notation layout (chords, measures, rests, 2000-note budget), take schema validation/repair/normalization, migrations (chain, future-version rejection), deterministic sorting, take duration, export-hash stability and invalidation triggers, filename sanitization, timing math, transport state machine (all legal/illegal transitions, busy states), transport clock (count-in anchoring), sustain application, scrub crossings (directions, chords, boundary-jitter dedupe, 20k-note jump performance), keyboard geometry/hit testing/velocity curve, pointer tracker (chords, glissando, cancel paths), velocity layer mapping, capability detection, take repository CRUD/revisions/cascades, settings persistence round-trips, import-link parsing (scheme rejection, scheme-less upgrade, file name derivation, dropped `text/uri-list` vs plain text) and remote import (kind sniffing, redirects, size guards against a lying Content-Length, blocked/offline/timeout/cancel classification).

**E2E coverage** (tests/e2e, against the production build with the real wasm encoder; real service worker and real sample pack where the test is about them — see above): shell load, mouse key press with aria-pressed, computer-keyboard input, sustain latch, offline shell reload via SW, recording (with and without count-in) → playback → auto-pause → reload persistence, undo pass, metronome beat indicator, takes list/rename/duplicate/delete, JSON export download and validated import (plus invalid-file rejection), import from a pasted link (happy path, blocked download falling back to the file picker, invalid scheme), import from a dropped link (plus dropped non-link text being ignored), full backup download, MP3 export with downloaded-file header/size validation, cached-export reuse, download fallback (headless has no share targets), switching piano in Settings (the new pack decodes for real and the choice survives a reload, plus a per-piano download button on each piano card), and a service-worker update prompt driven by byte-modifying the served worker.

## Manual physical-device checklist

Run per release on: iPhone Safari · installed iPhone Home-Screen app · Android Chrome · installed Android PWA · Windows Chrome · Windows Edge · desktop Firefox · macOS Safari (where available).

1. **Audio unlock:** first tap anywhere enables sound; no sound before any gesture.
2. **Multi-touch chords:** three fingers → three simultaneous notes; all release cleanly.
3. **Glissando:** slide a held finger across an octave; every key retriggers; none stick.
4. **Latency:** touch-to-sound feels immediate (≈ ≤50 ms perceived).
5. **Velocity:** top-of-key taps are soft, bottom strong; Settings → fixed velocity overrides.
6. **Rotation & safe areas:** portrait ↔ landscape keeps keyboard playable; no notch overlap; no horizontal page scroll; keyboard usable while the browser address bar expands/collapses.
7. **Record → score:** notes appear promptly while recording; held notes extend.
8. **Metronome:** no audible drift over 2+ minutes; count-in accents align with beat 1.
9. **Playback sync:** score playhead, highlighted notes, key animation, and audio stay together.
10. **Scrubbing:** paused drag auditions notes both directions; speed follows the finger; flick coasts with sound; nothing stuck afterwards.
11. **Interruption:** receive a call / lock the screen while recording → on return, the recording is finalized, saved, and explained; nothing keeps sounding.
12. **Background/foreground:** backgrounding pauses sound by default; with background playback enabled, a recorded take continues while hidden. Recordings still stop safely and returning never auto-blasts interrupted audio.
13. **iPhone silent switch:** with the switch on silent, the piano still sounds after the first gesture (workaround active); Settings hint present.
14. **MP3 export & share sheet:** render a take; share sheet opens from the button; WhatsApp appears only when installed; the received file plays; on Firefox desktop the MP3 downloads instead.
15. **Offline launch:** enable airplane mode after downloading a piano in Settings → Piano → installed app launches, full keyboard plays, takes list intact. Download only one piano and confirm deleting it leaves the other still marked available offline.
16. **Piano choice:** switch piano in Settings → the preview note and the keys sound different at the same volume; hold a key down _while_ switching → the note releases cleanly and no key sticks; the choice survives a relaunch.
17. **Storage restoration:** force-quit and relaunch → last take and playhead restored; installed-app storage is separate from the browser tab (verify and note).
18. **Install flows:** Android/desktop prompt installs with correct icon; iOS Add-to-Home-Screen icon and standalone launch look right.
19. **Update flow:** deploy a new build → "update available" appears in Settings and applies only on request, never during recording.
