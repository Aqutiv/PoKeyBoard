# Architecture

## Principles

1. **The audio clock owns time.** `AudioContext.currentTime` is the only timing authority. React never schedules sound; components read clocks on one shared animation-frame loop (`app/frameClock.ts`), which runs only while something on screen is moving — key lights and the pedal cue are drawn straight onto the keys from it, and React renders only when a readout changes.
2. **Services are module singletons outside React.** The audio engine, transport controller, metronome, scrub controller, persistence, and lifecycle services are plain objects; React subscribes via `useSyncExternalStore` with referentially stable subscribe functions and stable snapshots.
3. **One piano, two contexts.** Live playback and offline export share the same sample bank (decoded `AudioBuffer`s), the same graph factory, and the same envelope constants — so exports sound like the performance.
4. **Structured events are the source of truth.** A take is JSON note/pedal events (see TAKE_FORMAT.md); audio is always derived, never recorded from a microphone.

## Module map

```
src/
  audio/        AudioEngine (facade singleton), instruments (the piano
                registry), SampleBank (+ velocityCurve, and the generated
                velocityCalibration with its maths), VoiceManager,
                PianoGraphFactory, reverbImpulse (the reverb's procedural
                rooms), MetronomeEngine,
                OfflineTakeRenderer, AudioExportService, loudness (BS.1770
                loudness, true peak, look-ahead limiter), id3,
                audioCapabilities, iosAudioSession
  workers/      mp3Encoder.worker (mastering + LAME wasm, transferred PCM)
  domain/       takeTypes, takeSchema (Zod, migrate→repair→validate→normalize),
                takeMigrations, noteEvents, takeHash (export cache key),
                tempoMap (piecewise beats↔ms; shared by import, library, score),
                hands (which hand plays a note), midiExport (Standard MIDI
                File writer), trainingGate (pure)
  data/         db (Dexie v1), takeRepository, settingsRepository,
                audioCacheRepository, metadataRepository, persistence (autosave)
  features/
    keyboard/   geometry, velocityResponse (every input's velocity curve),
                per-pointer tracker, computer keyboard, game controller, Web
                MIDI (shared access service, input, and the shell-level
                useMidiInput), PianoKeyboard
    learn/      chapter catalog, pure exercise spec + matcher, useExercise,
                LearnPage (outline), ChapterRunner, KeyboardDiagram,
                StaffSnippet, per-locale lesson content
    notation/   staffMapping, pitchSpelling (letters in context), keyDetection
                (key and mode), quantization, notationLayout, scoreRenderer
                (canvas), MusicScore (rAF + scrub gestures), scrubMath,
                scrubController, sheetLayout (pure paginated engraving),
                sheetRenderer (print-style page canvas)
    transport/  transportMachine (pure), transportClock, transportController,
                sustainPedal, modes, TransportControls, ModeMenu
    metronome/  MetronomeControls
    takes/      takesService, TakesPage, ImportTakeDialog, ImportUrlDialog,
                remoteImportMessage
    export/     ShareMenu, AudioExportDialog, SheetExportDialog, sheetPdfService
                (pdf-lib, dynamic import — see SHEET_EXPORT.md), midiFile
    settings/   SettingsPage (playing, appearance, app, storage, diagnostics,
                reset), PianoSection (piano choice with its own offline pack,
                levels)
    play/       PlayPage, SaveStatusBadge
  pwa/          service-worker (Workbox injectManifest), updateManager,
                install, cacheNames
  state/        zustand stores: take, settings, export-ui
  app/          hash router, providers (service wiring), lifecycle, hooks
```

## Audio clock ownership

`TransportClock` maps audio seconds ↔ take milliseconds with an anchor pair, a rate (playback speed: take ms per audio ms) and optionally a loop. Looping folds take time back on itself, so the clock also keeps the run's unwrapped timeline ("virtual time", which keeps growing through every pass); the note scheduler, the metronome grid and the training holds all schedule ahead in virtual time, where the loop's next pass is simply further on and the seam needs no special case. Recording anchors beat zero slightly ahead on the audio clock (count-in aligned); input events carry `AudioContext.currentTime` and are converted through the anchor, so UI latency never skews recorded timing. Playback schedules notes 150 ms ahead on a 25 ms tick; the metronome schedules clicks the same way. Nothing audible is driven by `setTimeout` timestamps.

Clicks come from a `ClickGrid`, not from one bpm: while the transport moves, the grid puts beat _n_ where the take's tempo map puts it, so clicks land on the same bar lines the score draws and follow every tempo change; stopped, it is a steady grid at the tempo in force under the playhead; a count-in is a steady grid at the tempo recording will start in, whose last click lands on the record anchor. The exported click track (`scheduleClicksForRange`) walks the same map. The BPM field edits the tempo _at the playhead_: at the start it is the take's tempo, and stopped further in — the record-a-part, change-tempo, record-again flow — it writes a tempo change on the nearest bar line and parks the playhead there.

## Transport state machine

`transportMachine.ts` is a pure `(state, event) → state|null` table over
`idle, countIn, recording, playing, paused, scrubbing, renderingAudio, encodingAudio, audioReady, error`. The controller sends events; invalid transitions are no-ops, which is what makes rapid transport taps and duplicate schedulers impossible (the scheduler interval exists only inside `playing`).

## Recording

The engine emits input events (`on/off/sustain`, audio-clock stamped) for live sources. The controller keeps per-`sourceId` open notes, commits each on release (prompt score display), finalizes leftovers on stop, appends pedal events, and tracks the pass's note ids for undo. Overdub is the default; replace deletes-from-playhead only after explicit confirmation. A recording interrupted by backgrounding finalizes, saves, and explains itself. Overdub/replace and the playback mode share one menu on the transport row (two selects do not fit a phone), and both are ordinary settings rather than component state.

## Training playback

Training stops playback at every note the chosen hand has to play and waits for
the user to play it. `nextTrainingGate` (`domain/trainingGate.ts`) is pure: given
the sorted notes, a time, and left/right/both it returns the next onset and the
pitches due there, gathered over a 50 ms window because a chord a human played
never lands on one millisecond. Which hand a note belongs to is `noteHand`'s
answer — the staff an import wrote it on, or the middle-C split for a recorded
take — so the key bed, the score and training all agree.

The controller owns the gate because the clamp has to happen inside the private
scheduler: the lookahead horizon is capped just under the gate, so nothing past
it is scheduled early, and the tick that crosses it pauses at the gate's own
millisecond rather than wherever the 25 ms tick landed. Waiting is an ordinary
`paused` plus a flag, not a new transport state — nothing that switches on
`TransportState` has to learn about training. While it holds, the controller
subscribes to the same input stream recording uses; presses accumulate (a mouse
is one pointer and cannot hold a chord), extra keys flash and are ignored rather
than blocking, and the notes the user just sounded are skipped by id when
playback resumes, or the take would echo them a beat later. Pressing Play at a
hold lets that note through, so the feature can never wedge the transport.

Only plain playback gates. An overdub pass sounds its backing through the same
scheduler and must never stop to ask for a note.

## Choosing a piano

`audio/instruments.ts` lists the selectable pianos, each one a versioned sample
pack directory under `public/piano/`. The engine keeps a `SampleBank` per
instrument but lets only the active one hold decoded buffers — a full pack of
stereo float32 PCM is ~312 MB, so two resident packs is not an option on a phone.

Switching (`AudioEngine.setInstrument`) releases sounding notes rather than
cross-fading two different pianos, re-points the load-progress fan-out at the new
bank (which is why `data-piano-ready` drops to false), decodes the new core pack,
replays the last requested keyboard range, and only then frees the outgoing
bank's buffers — so a rapid A→B→A toggle never re-decodes, and there is no window
where nothing is playable. A generation counter stops an out-of-order switch from
freeing the bank that just became active.

Progress subscription lives on the engine, not the bank: `useSyncExternalStore`
captures its subscribe callback once, so a per-bank subscription would go deaf
the first time the piano changed.

On a cold start `loadCoreSamples` waits (≤1.5 s, then gives up) for the
persistence layer to apply the stored instrument, so a user on the second piano
never decodes 5.7 MB of the first one first.

Packs are mastered at different levels — Headroom sits ~15 dB below Salamander —
and within a pack each recording at its own, note by note. So a grand plays by a
velocity calibration: every one of its recordings is measured once
(`tests/tools/generateVelocityCalibration.ts`, K-weighted over the 300 ms after
its onset) into `velocityCalibration.ts`, keyed by pack version — in code, since
a published pack and its manifest never change — and `SampleBank` gives a voice
the gain that takes its recording from that level to where its velocity asks:
one decibel curve for every pack (`velocityCurve.ts`), tilted from bass to
treble as the pack's medium layer is, and anchored so C3–B5 at the computer
keyboard's velocity plays exactly as loudly as before. The layers then change
the timbre and never the loudness. The gain is keyed on the recording actually
resolved rather than the one requested, because a stand-in during a partial
load was recorded at its own level. A pack without a table falls back to
per-layer trims (`velocityGain`) times the per-layer `levelMatch` the build
script writes into its manifest; the Wurlitzer keeps its own region gains.

The selected piano is authoritative everywhere, including export: `setTake`
stamps the take's `samplePackVersion` from the active instrument, so live
playback and the rendered MP3 always agree, and since `takeHash` already hashes
that field, a switch invalidates cached exports on its own.

## Live/offline engine reuse

`PianoGraphFactory` builds `voices → bus → (dry + convolver send) → master → output gain → limiter → soft clip → destination`, the live metronome joining after the limiter, which starts out with a fast release to be over its first moments' duck at once, for **any** `BaseAudioContext`. `OfflineTakeRenderer` constructs an `OfflineAudioContext` and replays sustain-applied notes through the same factory with the same attack/release constants and the same `SampleBank` buffers. Two things differ, both about level: the piano plays at the default volume (the volume slider is for the room, not the file), and without the graph's live peak guard (`peakGuard: false`) — a compressor has to react to peaks it cannot see coming, while an export can look ahead. The metronome travels as a click track: its two click sounds, rendered once, and where every beat falls. The encoder worker then masters the render (`loudness.masterExport`: BS.1770 loudness to −16 LUFS, or the played level, then a true-peak look-ahead limiter at −1 dBTP) before encoding; see AUDIO_EXPORT.md.

A voice behaves like the string it stands for, the same way live and offline (`sampleVoice.ts`). It starts at its recording's onset rather than the top of the file (`onsetOffsetOf`, found once at decode), which takes the libraries' lead-in silence out of every note. Its damper falls more slowly in the bass than the treble (`releaseTcFor`), and above F6 there is none, so a released key there rings on. Striking a key that still sounds fades the old voice from the new one's start (`VoiceManager.restrike`, `scheduleTakeVoices` for exports) instead of stacking a second copy of one string, which would build up level and comb-filter.

## Scrubbing

`getCrossedNoteOnsets(prev, next, sortedNotes)` is pure and binary-searched with asymmetric boundaries — forward `(prev, next]`, backward `(next, prev)` — so chords travel together and boundary jitter can't double-fire. The scrub controller adds hysteresis (3 ms), a per-move audition cap, clamped preview voices, and a key-flash set; `MusicScore` translates drags into times (playhead visually fixed, score moves) and continues feeding the controller during inertial coasting.

`MusicScore`'s render loop runs only while something on the score moves — playback, recording, a scrub or its coast, a fading ghost note — and sleeps otherwise; the transport, the take, the theme, a resize, a key played or a finger on the score wakes it. Each pass of `scoreRenderer` finds its place in the take by binary search (`firstAtOrAfter`; beams through a per-layout index, since they are in bar order but not time order within a bar), so a frame costs the same twenty minutes into a take as at its start. Spacing is time-proportional, stretched per take (`scoreZoom.basePxPerMsFor`, at most 3×) so its closest common onsets stand 16 px apart, then scaled by the take's `display.zoom`.

## Learn

A chapter is data, not code: an ordered list of steps, each either theory (prose
plus an optional keyboard diagram, staff snippet, or Listen demo) or an exercise
carrying an `ExerciseSpec`. `exerciseMatcher.ts` is a pure reducer over that spec
— no React, no `AudioContext` — so the whole matching suite runs headless;
`useExercise` adds only the `subscribeInput` subscription, the held-note
bookkeeping the engine does not do for us, and the hint/skip timers. Adding a
chapter should add content, not engine.

Three facts about the engine shape the design. `scheduleNote` emits no input
events, so a Listen demo can never be mistaken for the user playing — that is
what makes the "press Listen, the exercise stays at 0 of 3" guarantee free.
`noteOn` emits nothing when no sample is decoded, so the runner gates exercises
on `subscribeLoadProgress` and reports readiness through the same
`data-piano-ready` attribute Play uses. `noteOff` emits unconditionally, so the
matcher tolerates orphan releases.

A chapter runs full-screen on the Learn route rather than as a dialog over Play,
because two mounted `PianoKeyboard`s would each attach a `ComputerKeyboardInput`
to `window` — doubling every keypress into two voices under one source id — and
the second unmount would clear the first one's sustain. The runner keeps its own
keyboard anchor (`anchorMidi` / `onAnchorChange`) so a lesson never relocates the
Play keyboard, and `targetMidis` lights the keys a step is asking for, styled
apart from the keys the user is holding. Simultaneity specs always allow a short
onset window as well as a true overlap: a mouse is one pointer and physically
cannot hold two keys.

Chapter titles and blurbs live in `Messages`, translated in all four locales;
lesson prose lives in per-locale modules under `features/learn/content/` with a
per-string English fallback. Prose in the catalog would ship every locale's text
to every user (`i18n/index.ts` imports all four eagerly) and length-lock every
paragraph across locales (the parity test walks arrays by index). The level
toggle is an ordinary setting; chapter progress is a metadata row, Zod-parsed on
read and therefore device-local rather than part of the settings backup.

## Persistence and cache invalidation

Dexie v1: `takes` (denormalized summary columns + full JSON — lists never parse takes), `audioCache` (MP3 blobs in a separate table so lists never load audio), `settings`, `metadata`. Schema versions are the migration mechanism. The persistence service debounces autosaves (800 ms), forces saves on recording stop / page hide / before export, restores the last take + playhead, and requests persistent storage after the first meaningful save.

Export caching: `takeHash` hashes only audible content (notes/pedals/tempo/reverb mix and room/pack + bitrate + metronome + loudness + exporter version); the take store bumps a `contentRevision` only for audible edits, and the autosave layer invalidates the cached MP3 exactly when that moves — renames, playhead changes and the volume slider never rerender audio.

## Theming

Two named themes share one token vocabulary in `src/themes.css`: Conservatory (dark) is the default on `:root`, Ivory recital (light) overrides colors under `html[data-theme='light']`; `color-scheme` flips with them so native controls follow. The preference (`dark | light | system`, default dark) is an ordinary setting (store + zod schema + Dexie row). `src/app/theme.ts` resolves preference × `prefers-color-scheme`, stamps `html[data-theme]`, updates the `theme-color` meta, and mirrors the preference to `localStorage['pokeyboard.theme']`; a tiny inline script in `index.html` reads that mirror **before first paint** so a light-theme user never flashes dark while Dexie loads (the controller deliberately applies nothing at init — the first store emit after hydration reconciles mirror vs Dexie truth, Dexie winning). The live score canvas can't read CSS variables at draw time, so `SCORE_PALETTES` in `scoreRenderer.ts` duplicates both palettes (kept in sync by comment convention) and the theme joins `MusicScore`'s redraw signature; sheet/PDF engraving stays print-monochrome and is untouched by theming. Display type is a self-hosted Fraunces 600 latin subset (`@fontsource/fraunces`), precached by the existing `woff2` glob.

## MP3 encoding

The export service copies the rendered buffer's channels, **transfers** them to a Worker running LAME (wasm-media-encoders), streams progress per ~2 s chunk, validates plausibility (size vs duration·bitrate), stores the blob in `audioCache`, and hands the UI a `File` for `navigator.share` — called only from a fresh click, with download as the universal fallback.

## PWA

Workbox `injectManifest`: shell precache (~2.0 MB), SPA navigation fallback, Cache First runtime caching for every versioned sample pack in one named cache shared with the explicit per-piano download flow in Settings → Piano (which downloads and deletes per piano, enumerating the cache by pack path). Updates wait until the user applies them (`SKIP_WAITING` message) and the UI refuses to offer them while the transport is busy.
