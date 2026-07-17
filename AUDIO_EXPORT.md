# Audio export

Goal: a rendered take must be sendable through WhatsApp and similar apps and playable inline by any recipient. **MP3** (audio/mpeg, 48 kHz stereo, 128 or 192 kbps CBR) is the deliberate format: WhatsApp accepts it, every platform plays it, and LAME-as-WebAssembly is a small, patent-free encoder that behaves identically in every browser. The microphone is never used.

## Pipeline (src/audio/AudioExportService.ts)

1. **Hash** the audible content (`takeHash`): notes/pedals (id-independent), tempo, instrument gains, sample-pack version + exporter version, bitrate, metronome inclusion. A cache hit in the `audioCache` table returns the stored MP3 instantly.
2. **Save** the take (forced autosave flush).
3. **Render** via `OfflineTakeRenderer`: `OfflineAudioContext` (2ch/48kHz, take + 3 s tail), the same `PianoGraphFactory` graph, `SampleBank` buffers, and envelope constants as live playback; sustain pedal pre-applied to durations; optional metronome clicks; rescale only if the peak would clip (dynamics are never flattened).
4. **Encode** in `mp3Encoder.worker`: channel copies are **transferred** (no clones), LAME encodes in ~2 s chunks with progress messages, and the finished buffer transfers back.
5. **Validate** (non-empty, plausible size for duration·bitrate), **cache** in `audioCache` keyed by take id + hash, and present the ready panel.

Cancel is available at every stage (the worker is terminated); failures surface actionable messages and return the transport to idle.

## Sharing

The ready panel offers **Share audio** (builds a `File`, checks `navigator.canShare({files})`, calls `navigator.share` directly from that click — the OS lists compatible targets; WhatsApp appears only if installed), **Download MP3** (universal fallback, also used automatically when file sharing is unsupported), **Play preview**, and **Delete cached export**. `navigator.share` is never called after an async gap — the render finishes first, then the user's next explicit click shares the cached file.

## Cache invalidation

The take store bumps `contentRevision` only on audible edits (notes, pedals, tempo, instrument, clear/undo). The autosave layer deletes the cached MP3 exactly when that revision moves. Renaming a take or moving the playhead keeps the cache (the filename is regenerated from the current title at share time). Deleting a take cascades its cached audio.

## Memory management

- Working-set estimate ≈ `seconds × 48000 × 2ch × 4B × 2` (render buffer + PCM copy); the export dialog warns above 8 minutes and refuses above 20.
- PCM moves to the worker by **transfer**; the worker's output transfers back; large references die with the worker.
- Out-of-memory or encoder crashes reject with a user-readable error — the UI never freezes silently.

## Transport integration

Export drives the machine states `renderingAudio → encodingAudio → audioReady` (cache hits fast-forward). Export starts only from `idle`/`paused`, and the service-worker update prompt is suppressed throughout.
