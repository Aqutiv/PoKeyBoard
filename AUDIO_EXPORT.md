# Audio export

Goal: a rendered take must be sendable through WhatsApp and similar apps and playable inline by any recipient. **MP3** (audio/mpeg, 48 kHz stereo, 128 or 192 kbps CBR) is the deliberate format: WhatsApp accepts it, every platform plays it, and LAME-as-WebAssembly is a small, patent-free encoder that behaves identically in every browser. The microphone is never used.

## Pipeline (src/audio/AudioExportService.ts)

1. **Hash** the audible content (`takeHash`): notes/pedals (id-independent), tempo, reverb, sample-pack version + exporter version, bitrate, metronome inclusion, loudness mode — not the volume slider, which the render ignores. A cache hit in the `audioCache` table returns the stored MP3 instantly. The sample-pack version is how choosing a different piano invalidates a cached export: the take is re-stamped when the selection changes, so the render always uses the piano the user just heard.
2. **Save** the take (forced autosave flush).
3. **Render** via `OfflineTakeRenderer`: `OfflineAudioContext` (2ch/48kHz, take + 3 s tail), the same `PianoGraphFactory` graph, `SampleBank` buffers, and envelope constants as live playback; sustain pedal pre-applied to durations. Every sample is chosen before the render starts, but the voices are made as it goes: the render pauses (`suspend`) every 2 s to make those of the next few seconds, because an offline context works through every voice it holds on every 128-frame quantum, started or not — made all at once, the 11-minute Chopin Ballade took 22 minutes to render in desktop Chrome, and this way takes about 20 s. Firefox cannot pause an offline render, so there every voice is made up front, as before. The piano plays at the default volume and without the live peak guard (see Level below); the optional metronome is a click track rather than a render — one accented click and one plain one, each rendered by the live metronome's own synthesis, and the time of every beat — so it costs a few kilobytes instead of another full-length channel, and never counts toward the piano's loudness.
4. **Master and encode** in `mp3Encoder.worker`: channel copies are **transferred** (no clones), `masterExport` sets the level and holds the peaks in place, LAME encodes in ~2 s chunks with progress messages, and the finished buffer transfers back. Where the worker cannot run, the same mastering and encoder run on the main thread a slice at a time — about 25 ms of work, then a turn for the page — so a long take never freezes it and Cancel is taken between slices; the file comes out the same either way.
5. **Validate** (non-empty, plausible size for duration·bitrate), **cache** the bare MP3 in `audioCache` keyed by take id + hash, and present the ready panel with the file **tagged** (below).

## Progress

The dialog fills one bar per stage. **Rendering piano…** counts up from the render's pauses, each an exact measure of how far it has got, and fills once the render is done — its last pause can fall up to 2 s short of the end; until the first pause, while any missing samples decode, the bar slides instead, as it does throughout in Firefox, where an offline render cannot pause. **Compressing audio…** is mastering and then encoding on one bar: mastering fills its first 15%, about its share of the time, by counting its steps against a plan of the steps its passes will take, and the encoder fills the rest, chunk by chunk. The worker reports whole percents, and only as they rise; where it fails and the main thread masters over again, the bar holds where the worker left it until the new attempt passes it. Progress from an export that has been cancelled, or has finished, is dropped, since a cancelled render runs on to its end.

## Level (src/audio/loudness.ts)

Loudness is measured the way broadcasters and streaming services measure it, ITU-R BS.1770-4: K-weighted, in 400 ms blocks every 100 ms, gated at −70 LUFS and at 10 LU below the rest, so pauses and the reverb tail do not pull the figure down. The export dialog offers two levels:

- **Even** (the default) brings every take to **−16 LUFS**, the level Apple Music plays at. A take that would need more than 5 dB of limiting to get there — a pianissimo piece with one crashing chord — stops short instead, since a piano's attack is much of its sound. The library's own tracks need at most about 4 dB.
- **As played** keeps the take's own level: as loud as the app sounds at the default volume. Everything the live output stage gives the piano under its limiter's threshold — the output gain ahead of the limiter and the limiter's own automatic makeup, 2.9 dB together (`gainStaging.ts`) — is added back, since the export's graph leaves that stage out.

Either way a **look-ahead limiter** then holds the result under a **−1 dBTP** true-peak ceiling: 4× oversampled (a 12-tap-a-phase Kaiser-windowed sinc, like the interpolator BS.1770 suggests) so the peaks a decoder reconstructs between samples count too, with both channels turned down together. Gain comes down over a 5 ms ramp before a peak and recovers with a 150 ms time constant. The decoded MP3 measures a few tenths of a dB under the master (0.4 at 128 kbps, 0.3 at 192), because the encoder's low-pass removes air that K-weighting counts; its true peak stays under the ceiling, which is what the headroom is for.

Metronome clicks join after the level is set, at half their live level, so an accented click at full volume never has the limiter ducking the piano on its own.

Each note's own level is set before any of this, exactly as live: by its velocity, on the one curve every recording of the grands is calibrated to (see ARCHITECTURE.md, Choosing a piano). Exporter version 6 is the first to render that way, so exports cached before it render again. A take played at the computer keyboard's velocity is as loud as it was; one played softer or harder spans about twice the range it did.

## Tags

An ID3v2.3 tag (the version every player reads, Windows' own among them) names the take (`TIT2`), a library track's composer (`TPE1`, `TCOM`), the album `PoKeyBoard` and the piano it was rendered on (`TSSE`). The cache holds the untagged MP3 and the tag is written each time the file is handed over, so a take renamed after its export never carries its old title.

## MIDI (.mid)

**Share → MIDI (.mid)** is the one export without a dialog: `midiExport.takeToMidi` writes a Standard MIDI File (format 1, 960 ticks a quarter) from the take's freshest copy as the Share menu opens, so choosing it can hand the file to the share sheet inside the click. Tempo, meter and key go on a track of their own — the key the notation writes, declared or read from the pitches, minor where the score says so and otherwise major or minor as the pitches read — then the right hand and the left on channels 1 and 2 (split as the grand staff splits them), each with the sustain pedal and the General MIDI program nearest the piano (Acoustic Grand, or Electric Piano 1 for the Wurlitzer). Times go through the take's tempo map, so a bar in the file is a bar on the page. A key a hand strikes again while it is still down becomes a re-strike held until both notes have let go — one MIDI note-off cannot end one of two notes on the same key.

Cancel is available at every stage (the worker is terminated, or the main-thread fallback stops at its next slice); failures surface actionable messages and return the transport to idle.

## Sharing

The ready panel offers **Share audio** (builds a `File`, checks `navigator.canShare({files})`, calls `navigator.share` directly from that click — the OS lists compatible targets; WhatsApp appears only if installed), **Download MP3** (universal fallback, also used automatically when file sharing is unsupported), **Play preview**, and **Delete cached export**. `navigator.share` is never called after an async gap — the render finishes first, then the user's next explicit click shares the cached file.

## Cache invalidation

The take store bumps `contentRevision` only on audible edits (notes, pedals, tempo, piano, reverb, clear/undo). The autosave layer deletes the cached MP3 exactly when that revision moves. Renaming a take, moving the playhead or moving the volume slider keeps the cache (the filename is regenerated from the current title at share time, and the render plays at the default volume). Deleting a take cascades its cached audio.

## Memory management

- Working-set estimate ≈ `seconds × 48000 × 2ch × 4B × 2` (render buffer + PCM copy); the export dialog warns above 8 minutes and refuses above 20.
- PCM moves to the worker by **transfer**; the worker's output transfers back; large references die with the worker.
- Out-of-memory or encoder crashes reject with a user-readable error — the UI never freezes silently.

## Transport integration

Export drives the machine states `renderingAudio → encodingAudio → audioReady` (cache hits fast-forward). Export starts only from `idle`/`paused`, and the service-worker update prompt is suppressed throughout.
