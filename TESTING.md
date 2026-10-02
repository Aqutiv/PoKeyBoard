# Testing

## Automated

```bash
npm run test          # 2513 Vitest unit tests (jsdom + fake-indexeddb)
npm run test:e2e      # 226 Playwright tests against the production preview build
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
only the two worker tests and silently leaves the other 199 running once. Worse,
those repeated copies are not serialized by `fullyParallel: false`, so they run
concurrently and fight over `dist/service-worker.js`. `--workers=1` above is what
keeps them apart. `--grep` is subject to the same rule: it cannot narrow the `e2e`
project while anything depends on it.

**Unit coverage** (tests/unit): MIDI name conversion and round-trips, staff mapping (splits, accidentals, ledgers, stems), visual quantization grids and duration symbols, notation layout (chords, measures, rests, 2000-note budget), take schema validation/repair/normalization (a printed finger kept, and one no hand has dropped without failing the take), migrations (chain, future-version rejection), deterministic sorting, take duration, export-hash stability and invalidation triggers, filename sanitization, timing math, transport state machine (all legal/illegal transitions, busy states), transport clock (count-in anchoring), sustain application, scrub crossings (directions, chords, boundary-jitter dedupe, 20k-note jump performance, and round a loop: each pass's own notes, its top but never its end, only as many passes as are heard, and where a scrub's pass began; and a score that goes away mid-fling letting its scrub go), key lights (each key's hand and the velocity heard on it — the later strike, the louder of two copies, a strike held inside a longer played note, never a silent note over a heard one, and nothing once only a silent note lights the key — the scrub flashes' velocities, the live keys' velocities through the engine, and how deep each shade is), the falling notes (each bar over its key and reaching it as its note starts, at any speed and during a count-in, cut at the keys and at the top, folded round a loop with passes enough to fill the tallest view and no more, a dense loop's passes held to a budget of bars even partway through one, each drawn only to the top edge, a note playback won't strike (held from before where its pass began, or into a loop) drawn as an outline, marks for notes off the key bed, bar lines where the take's tempo puts them (each bar's start listed by `barStartsBetween`, through tempo changes) folded round a loop clear of its restart lines, the notes a Training hold waits for marked, a 20,000-note take inside a frame budget; the palette against `themes.css` and its OKLab mix against Chromium's `color-mix`; the painter's colours, outlines, hollow written-only notes, bar lines, names written where they fit in ink for the key, finger numbers at a bar's foot a size up with the name over them, fainter, where there is room for both, the hold's glow (lit within its key colour's layer, so a black key's note stays over it), and paint order; names spelled note for note as the score spells them (the golden study take and Für Elise), hidden notes by their source's spelling or their key; fingers (the C, G and D major scales in both hands as they are taught, the thumb kept off black keys in F, B♭ and E♭ major, five-finger positions, triads, a take with no staff split at middle C, a chord a hand spreads, the score's own fingers kept with the rest fitted around them, a sixth key and an unplayed note left unfingered, a 20,000-note take inside a time budget, and agreement with the library's 1,428 printed fingers held where it stood), and the importer reading them (a change of finger, chords, ties, grace notes); the view drawing once and sleeping, following the key bed, the transport, the theme, the shading and the fall speed (its − and + and Ctrl/⌘ + wheel steps, Safari's trackpad pinch stepping it while a touch screen's is only stopped, held at either end), scrubbed by a vertical drag (only the main pointer at rest, from where the view stands, round a loop as it is drawn, taking over a scrub left running elsewhere, let go if the view goes away), names and finger numbers following their settings, bar lines following the tempo, a hold's glow swelling on the frame clock or held still for less motion, and following that preference as it changes mid-hold, standing where play would start (a loop's top, from past its end), and running on the frame clock only while the notes move), the Play view switch, keyboard geometry/hit testing/velocity curve/reveal-anchor, pointer tracker (chords, glissando, cancel paths), MIDI input (note-on/off, velocity-0 releases, the CC64 threshold and its edge-only pedal events, omni channels, out-of-piano notes, pitch-bend latching, ignored realtime/sysex bytes, panic CCs, hot-plug and unplug-mid-note, hidden-tab and modal stand-down, detach-before-permission-resolves, denied permission), shell-level MIDI (plays with no key bed mounted, CC7 reaching the master volume, sample-range widening, keyboard handlers attaching and detaching), playable-range union across contributors, velocity layer mapping, the velocity curve and calibration (every grand's layers meeting without a step on every key, its default loudness held, a table for every grand), capability detection, take repository CRUD/revisions/cascades, settings persistence round-trips, import-link parsing (scheme rejection, scheme-less upgrade, file name derivation, dropped `text/uri-list` vs plain text) and remote import (kind sniffing, redirects, size guards against a lying Content-Length, blocked/offline/timeout/cancel classification), the vector sheet PDF (operators decoded back out of a real pdf-lib page: the y-flip, paths re-emitted per paint, arcs and quadratics as cubics, stroke scaling under a transform, the Times faces and unkerned alignment, text normalization, the soft-masked image fallback; the whole export in jsdom with its progress and Cancel; title accidentals drawn as glyphs), and the music font on paper (every glyph of the generated subset present and within the font's own boxes, the licence and the Modified Version statement in both modules, the outline codec read back on both sides, a glyph drawn as one path and one fill or written once per PDF as a Form XObject, every placement rule read back from the SVG's `<use>` elements, octave lines read back half a space clear of everything drawn under them — the Waltz, Op. 64 No. 2 among them — and accidentals stacked by the glyphs' boxes) and on screen (the live score's glyphs read back through a pass-through `drawGlyph` spy: heads and what lights them, clefs, flags at their anchors, right-aligned accidentals, dots, rests, a time signature set smaller rather than the gutter widened, tuplet digits, dynamics by their optical centre, the 8va label and the tempo note; and room kept for a flagged 64th's ink); Settings' sections (one at a time, the section remembered and kept through Reset, an update offered on every section, the device details folded), its one-row choices as real radio groups, and each piano's offline state outliving its card.

**Sheet goldens:** `tests/unit/notation/sheetGolden.test.ts` engraves page 1 of Für Elise, the Chopin E♭ Nocturne and a synthetic study through the PDF's vector surface as SVG and compares them with `tests/unit/notation/__goldens__/`. Open a golden in a browser to see the page. A notation change that moves anything changes them: look at the new page, then rewrite them with `npx vitest run tests/unit/notation/sheetGolden.test.ts -u`.

**E2E coverage** (tests/e2e, against the production build with the real wasm encoder; real service worker and real sample pack where the test is about them — see above): shell load, mouse key press with aria-pressed, velocity shading (a soft and a hard press lit apart, alike once the setting is off, and the setting remembered across a reload), falling notes (the view chosen and remembered across a reload, the canvas standing on the key bed with each bar over its key read back from its pixels, before and after the bed moves, the fall speed stepped to its end and remembered, a drag down scrubbing on, the glow beside the note a Training hold waits for and not over a key it does not ask for, finger numbers inked at a note's foot once switched on and remembered across a reload, and its layouts on a phone and in short landscape), Settings in sections (opening on Sound, one section at a time, the section kept across a reload and through Reset, a choice moved with the arrow keys, the device details folded until asked for, and a piano's download carrying on, still in view, through a trip to another section), computer-keyboard input, sustain latch, offline shell reload via SW, recording (with and without count-in) → playback → auto-pause → reload persistence, undo pass, metronome beat indicator, takes list/rename/duplicate/delete, JSON export download and validated import (plus invalid-file rejection), import from a pasted link (happy path, blocked download falling back to the file picker, invalid scheme), import from a dropped link (plus dropped non-link text being ignored), full backup download, MP3 export with downloaded-file header/size validation, cached-export reuse, FLAC export decoded back by Chromium with its choices remembered across a reload, download fallback (headless has no share targets), switching piano in Settings (the new pack decodes for real and the choice survives a reload, plus a per-piano download button on each piano card), switching mid-playback from Play or Settings (the music plays on with the old pack while the new one loads, then plays on the new pack), sheet-music PDF export (vector content with no images, the Times fonts, a per-page size budget, pdf-lib loading only when Generate is pressed, a title Times cannot set arriving as a soft-masked image, the music glyphs written as Form XObjects, and the font's licence served and carried in the chunk that brings the glyphs, which loads with the live score), and a service-worker update prompt driven by byte-modifying the served worker.

## Manual physical-device checklist

Run per release on: iPhone Safari · installed iPhone Home-Screen app · Android Chrome · installed Android PWA · Windows Chrome · Windows Edge · desktop Firefox · macOS Safari (where available).

1. **Audio unlock:** first tap anywhere enables sound; no sound before any gesture.
2. **Multi-touch chords:** three fingers → three simultaneous notes; all release cleanly.
3. **Glissando:** slide a held finger across an octave; every key retriggers; none stick.
4. **Latency:** touch-to-sound feels immediate (≈ ≤50 ms perceived).
5. **Velocity:** top-of-key taps are soft, bottom strong, and the key lights paler or deeper to match; Settings → fixed velocity overrides.
6. **Rotation & safe areas:** portrait ↔ landscape keeps keyboard playable; no notch overlap; no horizontal page scroll; keyboard usable while the browser address bar expands/collapses.
7. **Record → score:** notes appear promptly while recording; held notes extend.
8. **Metronome:** no audible drift over 2+ minutes; count-in accents align with beat 1.
9. **Playback sync:** score playhead, highlighted notes, key animation (soft notes lit paler, loud ones deeper, in each hand's colour), and audio stay together.
10. **Scrubbing:** paused drag auditions notes both directions; speed follows the finger; flick coasts with sound; nothing stuck afterwards.
11. **Interruption:** receive a call / lock the screen while recording → on return, the recording is finalized, saved, and explained; nothing keeps sounding.
12. **Background/foreground:** backgrounding pauses sound by default; with background playback enabled, a recorded take continues while hidden. Recordings still stop safely and returning never auto-blasts interrupted audio.
13. **MIDI keyboard** (Windows/Android Chrome or Edge; the Gamepad and Web MIDI APIs cannot be driven from Playwright, so this is unit-tested and then checked by hand): enable it in Settings → Playing and grant the prompt; the device name appears. Keys sound with their own velocity — soft and hard are audibly different — and light up on screen, paler for soft and deeper for hard. A released chord leaves nothing hanging. The sustain button composes with Space and the on-screen pedal. Shifting the controller's own octave down twice still sounds, and the keyboard view follows. A bend button steps the range once per press. The volume control moves the master volume slider — watch it track live while sitting on the Settings tab. Playing works from every tab, not just Play. Unplug mid-chord and nothing sticks. Switching browser tabs releases held notes; clicking another window does not.
14. **iPhone silent switch:** with the switch on silent, the piano still sounds after the first gesture (workaround active); Settings hint present.
15. **MP3 and FLAC export & share sheet:** render a take in each format; share sheet opens from the button; WhatsApp appears only when installed; the received file plays (a FLAC in the phone's own player and file preview too); on Firefox desktop the file downloads instead.
16. **Offline launch:** enable airplane mode after downloading a piano in Settings → Sound → installed app launches, full keyboard plays, takes list intact. Download only one piano and confirm deleting it leaves the other still marked available offline.
17. **Piano choice:** switch piano in Settings → Sound → the preview note and the keys sound different at the same volume; switch during playback (Moonlight, La Campanella) → the music never stops, and the new piano takes over within a moment, mid-phrase, with no click; hold a key down _while_ switching → it keeps its old sound until let go, the next note sounds the new piano, and no key sticks; the choice survives a relaunch. On a phone, listen for crackle while the new piano decodes under playback.
18. **Storage restoration:** force-quit and relaunch → last take and playhead restored; installed-app storage is separate from the browser tab (verify and note).
19. **Install flows:** Android/desktop prompt installs with correct icon; iOS Add-to-Home-Screen icon and standalone launch look right.
20. **Update flow:** deploy a new build → "update available" appears in Settings, above whichever section is open, and applies only on request, never during recording.
