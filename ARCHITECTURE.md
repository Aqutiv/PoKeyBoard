# Architecture

## Principles

1. **The audio clock owns time.** `AudioContext.currentTime` is the only timing authority. React never schedules sound; components read clocks in rAF loops or coarse polls.
2. **Services are module singletons outside React.** The audio engine, transport controller, metronome, scrub controller, persistence, and lifecycle services are plain objects; React subscribes via `useSyncExternalStore` with referentially stable subscribe functions and stable snapshots.
3. **One piano, two contexts.** Live playback and offline export share the same sample bank (decoded `AudioBuffer`s), the same graph factory, and the same envelope constants — so exports sound like the performance.
4. **Structured events are the source of truth.** A take is JSON note/pedal events (see TAKE_FORMAT.md); audio is always derived, never recorded from a microphone.

## Module map

```
src/
  audio/        AudioEngine (facade singleton), SampleBank, VoiceManager,
                PianoGraphFactory (+ procedural reverb IR), MetronomeEngine,
                OfflineTakeRenderer, AudioExportService, audioCapabilities,
                iosAudioSession
  workers/      mp3Encoder.worker (LAME wasm, transferred PCM)
  domain/       takeTypes, takeSchema (Zod, migrate→repair→validate→normalize),
                takeMigrations, noteEvents, takeHash (export cache key)
  data/         db (Dexie v1), takeRepository, settingsRepository,
                audioCacheRepository, metadataRepository, persistence (autosave)
  features/
    keyboard/   geometry, per-pointer tracker, computer keyboard, PianoKeyboard
    notation/   staffMapping, quantization, notationLayout, scoreRenderer
                (canvas), MusicScore (rAF + scrub gestures), scrubMath,
                scrubController, sheetLayout (pure paginated engraving),
                sheetRenderer (print-style page canvas)
    transport/  transportMachine (pure), transportClock, transportController,
                sustainPedal, TransportControls
    metronome/  MetronomeControls
    takes/      takesService, TakesPage, ImportTakeDialog
    export/     AudioExportDialog, SheetExportDialog, sheetPdfService
                (pdf-lib, dynamic import — see SHEET_EXPORT.md)
    settings/   SettingsPage (offline pack, diagnostics, install, updates)
    play/       PlayPage, SaveStatusBadge
  pwa/          service-worker (Workbox injectManifest), updateManager,
                install, cacheNames
  state/        zustand stores: take, settings, export-ui
  app/          hash router, providers (service wiring), lifecycle, hooks
```

## Audio clock ownership

`TransportClock` maps audio seconds ↔ take milliseconds with an anchor pair. Recording anchors beat zero slightly ahead on the audio clock (count-in aligned); input events carry `AudioContext.currentTime` and are converted through the anchor, so UI latency never skews recorded timing. Playback schedules notes 150 ms ahead on a 25 ms tick; the metronome schedules clicks the same way. Nothing audible is driven by `setTimeout` timestamps.

## Transport state machine

`transportMachine.ts` is a pure `(state, event) → state|null` table over
`idle, countIn, recording, playing, paused, scrubbing, renderingAudio, encodingAudio, audioReady, error`. The controller sends events; invalid transitions are no-ops, which is what makes rapid transport taps and duplicate schedulers impossible (the scheduler interval exists only inside `playing`).

## Recording

The engine emits input events (`on/off/sustain`, audio-clock stamped) for live sources. The controller keeps per-`sourceId` open notes, commits each on release (prompt score display), finalizes leftovers on stop, appends pedal events, and tracks the pass's note ids for undo. Overdub is the default; replace deletes-from-playhead only after explicit confirmation. A recording interrupted by backgrounding finalizes, saves, and explains itself.

## Live/offline engine reuse

`PianoGraphFactory` builds `voices → bus → (dry + convolver send) → master → limiter → destination` for **any** `BaseAudioContext`. `OfflineTakeRenderer` constructs an `OfflineAudioContext`, replays sustain-applied notes through the same factory with the same attack/release constants and the same `SampleBank` buffers, optionally adds scheduled metronome clicks, and rescales only if the peak would clip.

## Scrubbing

`getCrossedNoteOnsets(prev, next, sortedNotes)` is pure and binary-searched with asymmetric boundaries — forward `(prev, next]`, backward `(next, prev)` — so chords travel together and boundary jitter can't double-fire. The scrub controller adds hysteresis (3 ms), a per-move audition cap, clamped preview voices, and a key-flash set; `MusicScore` translates drags into times (playhead visually fixed, score moves) and continues feeding the controller during inertial coasting.

## Persistence and cache invalidation

Dexie v1: `takes` (denormalized summary columns + full JSON — lists never parse takes), `audioCache` (MP3 blobs in a separate table so lists never load audio), `settings`, `metadata`. Schema versions are the migration mechanism. The persistence service debounces autosaves (800 ms), forces saves on recording stop / page hide / before export, restores the last take + playhead, and requests persistent storage after the first meaningful save.

Export caching: `takeHash` hashes only audible content (notes/pedals/tempo/instrument/pack + bitrate + metronome + exporter version); the take store bumps a `contentRevision` only for audible edits, and the autosave layer invalidates the cached MP3 exactly when that moves — renames and playhead changes never rerender audio.

## Theming

Two named themes share one token vocabulary in `src/themes.css`: Conservatory (dark) is the default on `:root`, Ivory recital (light) overrides colors under `html[data-theme='light']`; `color-scheme` flips with them so native controls follow. The preference (`dark | light | system`, default dark) is an ordinary setting (store + zod schema + Dexie row). `src/app/theme.ts` resolves preference × `prefers-color-scheme`, stamps `html[data-theme]`, updates the `theme-color` meta, and mirrors the preference to `localStorage['pokeyboard.theme']`; a tiny inline script in `index.html` reads that mirror **before first paint** so a light-theme user never flashes dark while Dexie loads (the controller deliberately applies nothing at init — the first store emit after hydration reconciles mirror vs Dexie truth, Dexie winning). The live score canvas can't read CSS variables at draw time, so `SCORE_PALETTES` in `scoreRenderer.ts` duplicates both palettes (kept in sync by comment convention) and the theme joins `MusicScore`'s redraw signature; sheet/PDF engraving stays print-monochrome and is untouched by theming. Display type is a self-hosted Fraunces 600 latin subset (`@fontsource/fraunces`), precached by the existing `woff2` glob.

## MP3 encoding

The export service copies the rendered buffer's channels, **transfers** them to a Worker running LAME (wasm-media-encoders), streams progress per ~2 s chunk, validates plausibility (size vs duration·bitrate), stores the blob in `audioCache`, and hands the UI a `File` for `navigator.share` — called only from a fresh click, with download as the universal fallback.

## PWA

Workbox `injectManifest`: shell precache (~1.2 MB), SPA navigation fallback, Cache First runtime caching for the versioned sample pack in a named cache shared with the explicit "Download piano for offline use" flow. Updates wait until the user applies them (`SKIP_WAITING` message) and the UI refuses to offer them while the transport is busy.
