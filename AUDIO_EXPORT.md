# Audio export

Goal: a rendered take must be sendable through WhatsApp and similar apps and playable inline by any recipient. **MP3** (audio/mpeg, 48 kHz stereo, 128 or 192 kbps CBR) is the deliberate format: WhatsApp accepts it, every platform plays it, and LAME-as-WebAssembly is a small, patent-free encoder that behaves identically in every browser. The microphone is never used.

## Pipeline (src/audio/AudioExportService.ts)

1. **Hash** the audible content (`takeHash`): notes/pedals (id-independent), tempo, reverb mix and room (a take without a room hashing as Room), sample-pack version + exporter version, bitrate, metronome inclusion, loudness mode — not the volume slider, which the render ignores. A cache hit in the `audioCache` table returns the stored MP3 instantly. The sample-pack version is how choosing a different piano invalidates a cached export: the take is re-stamped when the selection changes, so the render always uses the piano the user just heard.
2. **Save** the take (forced autosave flush).
3. **Render** via `OfflineTakeRenderer`: `OfflineAudioContext` (2ch/48kHz, the take and then its tail — 3 s, or the room's RT60 and half a second more where that is longer: 3.3 s in the Hall, 5 s in the Cathedral), the same `PianoGraphFactory` graph in the take's own reverb room, `SampleBank` buffers, and envelope constants as live playback; sustain pedal pre-applied to durations, velocity-0 notes (written, not played) left out, and the notes struck in the same order as live, so of two copies of a key struck together the louder is heard (`notesToRender`). Every sample is chosen before the render starts, but the voices are made as it goes: the render pauses (`suspend`) every 2 s to make those of the next few seconds, because an offline context works through every voice it holds on every 128-frame quantum, started or not — made all at once, the 11-minute Chopin Ballade took 22 minutes to render in desktop Chrome, and this way takes about 20 s. Firefox cannot pause an offline render, so there every voice is made up front, as before. The piano plays at the default volume and without the live peak guard (see Level below); the optional metronome is a click track rather than a render — one accented click and one plain one, each rendered by the live metronome's own synthesis, and the time of every beat — so it costs a few kilobytes instead of another full-length channel, and never counts toward the piano's loudness.
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

## Reverb (src/audio/reverbImpulse.ts)

The reverb is a convolution with the impulse of a room, made in code from seeded noise rather than recorded: a room at a sample rate is the same impulse every time, so an export renders through exactly the reverb the take was heard in. There are four rooms, chosen beside the reverb slider and stored on the take (`instrument.reverbRoom`; Room when absent):

| Room      | Pre-delay | Early reflections | RT60 low / high | Measured T20, < 500 Hz / > 8 kHz | Trim     |
| --------- | --------- | ----------------- | --------------- | -------------------------------- | -------- |
| Studio    | 10 ms     | 6, up to 30 ms    | 0.8 / 0.5 s     | 0.76 / 0.55 s                    | +6.94 dB |
| Room      | 15 ms     | 8, up to 45 ms    | 2.0 / 1.2 s     | 2.02 / 1.34 s                    | +0.44 dB |
| Hall      | 20 ms     | 8, up to 60 ms    | 2.8 / 1.6 s     | 2.80 / 1.83 s                    | −2.32 dB |
| Cathedral | 25 ms     | 10, up to 75 ms   | 4.5 / 2.2 s     | 4.37 / 2.69 s                    | −5.55 dB |

Each impulse is silent for its pre-delay; then come the early reflections, from alternate sides, each reaching the far ear 0.2–0.8 ms later at 0.6 of the level; under them the tail swells in over 10–40 ms. The tail is noise split by a one-pole crossover at 1.5 kHz into a low band and its complement, each decaying exponentially at its own RT60, and everything passes through a gentle one-pole low-pass for air absorption, from 6 kHz in the Studio down to 3 kHz in the Cathedral. The measured decays are Schroeder integrals (T20) of the 48 kHz impulses: the crossover's gentle slope leaves some of the slow band up high, which lengthens the high band's measured decay by 10–25%, the more the further apart the two are. An impulse lasts until its low band has fallen 60 dB, but never past 4.5 s, so that a phone can convolve it live; the Cathedral's takes 11–16 ms to make at 48 kHz in Chromium, the Studio's 2–3 ms, and each is made once per room and rate.

The ConvolverNode's own normalisation is off. The impulse is normalised in code exactly as the Web Audio spec's `calculateNormalizationScale` would have — 0.00125 over its RMS, times 44 100 over the sample rate — and then trimmed per room. That normalisation holds an impulse's RMS, not its energy, so the trims are what set each room's level:

- **Room** carries the energy of the impulse every take was heard through before there were rooms — 2.2 s of noise under a power-law envelope, normalised by the browser: 0.38 dB makes up for Room being shorter, and 0.06 dB for browsers calibrating to −58 dB where the spec says 0.00125. Its energy then matches within 0.01 dB, and a piano's wet energy — measured, K-weighted, over the first 30 s of each of the library's twelve tracks — is 0.3 dB under the old reverb's on average, −0.9 to +0.2 dB piece by piece. A noise impulse favours some partials over others, so a single chord can come out a dB or two either way, as it could between any two draws of the old impulse. The old envelope held on and then fell away, where Room's decays from the start: the same energy arrives earlier, and after 80 ms Room returns 2 dB less.
- **The others** are set for the same wetness at the same mix. What arrives within 80 ms of a note the ear fuses with the note; what comes later it hears as reverb. Equal energy would leave the Studio, which has less of its energy late, audibly drier than Room, and equal late energy would make it loud and boxy, so each room is trimmed halfway between, in dB: the mean of a piano's whole wet energy and of the part after 80 ms (measured through the impulse with its first 80 ms removed) is the same in every room, to 0.01 dB. Against Room, over the same twelve tracks:

| Room      | Whole wet energy | After 80 ms |
| --------- | ---------------- | ----------- |
| Studio    | +1.4 dB          | −1.4 dB     |
| Hall      | −0.4 dB          | +0.4 dB     |
| Cathedral | −1.0 dB          | +1.0 dB     |

Live, switching room builds the new room's convolver first, while the old one plays on — up to 40 ms of main-thread work for the Cathedral, mostly the browser preparing the convolution as it takes the impulse — then ducks the reverb out over 20 ms, puts the new convolver in the old one's place, and brings the reverb back over 20 ms. The old room's ringing is faded rather than cut off mid-sound, and the new room builds from what is played next; the dry piano is untouched throughout. Each ramp begins 20 ms ahead of the audio clock, from where the return will stand by then — worked out from the ramp under way, since an AudioParam's `value` does not say where a ramp has got to — so a switch made while the last one is still fading back in ducks from there, and whatever renders while the page is changing the automation is still on the ramp it was on. Rooms cycled as fast as a switch can be made, in Chromium, never move the return faster than its own 20 ms ramps. Only one convolver ever runs, where crossfading two would run both for the length of the fade, and a phone may not keep up with two long convolutions. Exporter version 8 is the first to render rooms, so exports cached before it render again.

## Tags

An ID3v2.3 tag (the version every player reads, Windows' own among them) names the take (`TIT2`), a library track's composer (`TPE1`, `TCOM`), the album `PoKeyBoard` and the piano it was rendered on (`TSSE`). The cache holds the untagged MP3 and the tag is written each time the file is handed over, so a take renamed after its export never carries its old title.

## MIDI (.mid)

**Share → MIDI (.mid)** is the one export without a dialog: `midiExport.takeToMidi` writes a Standard MIDI File (format 1, 960 ticks a quarter) from the take's freshest copy as the Share menu opens, so choosing it can hand the file to the share sheet inside the click. Tempo, meter and key go on a track of their own — the key the notation writes, declared or read from the pitches, minor where the score says so and otherwise major or minor as the pitches read — then the right hand and the left on channels 1 and 2 (split as the grand staff splits them), each with the sustain pedal and the General MIDI program nearest the piano (Acoustic Grand, or Electric Piano 1 for the Wurlitzer). Times go through the take's tempo map, so a bar in the file is a bar on the page. A key a hand strikes again while it is still down becomes a re-strike held until both notes have let go — one MIDI note-off cannot end one of two notes on the same key. A note written but not played (velocity 0) is left out: a note-on at velocity 0 is a note-off, and merged into a twin on its key it would hold that note on.

Cancel is available at every stage (the worker is terminated, or the main-thread fallback stops at its next slice); failures surface actionable messages and return the transport to idle.

## Sharing

The ready panel offers **Share audio** (builds a `File`, checks `navigator.canShare({files})`, calls `navigator.share` directly from that click — the OS lists compatible targets; WhatsApp appears only if installed), **Download MP3** (universal fallback, also used automatically when file sharing is unsupported), **Play preview**, and **Delete cached export**. `navigator.share` is never called after an async gap — the render finishes first, then the user's next explicit click shares the cached file.

## Cache invalidation

The take store bumps `contentRevision` only on audible edits (notes, pedals, tempo, piano, reverb mix or room, clear/undo). The autosave layer deletes the cached MP3 exactly when that revision moves. Renaming a take, moving the playhead or moving the volume slider keeps the cache (the filename is regenerated from the current title at share time, and the render plays at the default volume). Deleting a take cascades its cached audio.

## Memory management

- Working-set estimate ≈ `seconds × 48000 × 2ch × 4B × 2` (render buffer + PCM copy), the seconds including the room's tail; the export dialog warns above 8 minutes and refuses above 20.
- PCM moves to the worker by **transfer**; the worker's output transfers back; large references die with the worker.
- Out-of-memory or encoder crashes reject with a user-readable error — the UI never freezes silently.

## Transport integration

Export drives the machine states `renderingAudio → encodingAudio → audioReady` (cache hits fast-forward). Export starts only from `idle`/`paused`, and the service-worker update prompt is suppressed throughout.
