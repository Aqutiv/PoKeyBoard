# Testing

## Automated

```bash
npm run test        # 289 Vitest unit tests (jsdom + fake-indexeddb)
npm run test:e2e    # 24 Playwright tests against the production preview build
npm run lint && npm run typecheck && npm run format:check
```

**Unit coverage** (tests/unit): MIDI name conversion and round-trips, staff mapping (splits, accidentals, ledgers, stems), visual quantization grids and duration symbols, notation layout (chords, measures, rests, 2000-note budget), take schema validation/repair/normalization, migrations (chain, future-version rejection), deterministic sorting, take duration, export-hash stability and invalidation triggers, filename sanitization, timing math, transport state machine (all legal/illegal transitions, busy states), transport clock (count-in anchoring), sustain application, scrub crossings (directions, chords, boundary-jitter dedupe, 20k-note jump performance), keyboard geometry/hit testing/velocity curve, pointer tracker (chords, glissando, cancel paths), velocity layer mapping, capability detection, take repository CRUD/revisions/cascades, settings persistence round-trips.

**E2E coverage** (tests/e2e, real service worker + samples + wasm encoder): shell load, mouse key press with aria-pressed, computer-keyboard input, sustain latch, offline shell reload via SW, recording (with and without count-in) → playback → auto-pause → reload persistence, undo pass, metronome beat indicator, takes list/rename/duplicate/delete, JSON export download and validated import (plus invalid-file rejection), full backup download, MP3 export with downloaded-file header/size validation, cached-export reuse, download fallback (headless has no share targets), and a service-worker update prompt driven by byte-modifying the served worker.

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
12. **Background/foreground:** backgrounding pauses sound; returning never auto-blasts audio.
13. **iPhone silent switch:** with the switch on silent, the piano still sounds after the first gesture (workaround active); Settings hint present.
14. **MP3 export & share sheet:** render a take; share sheet opens from the button; WhatsApp appears only when installed; the received file plays; on Firefox desktop the MP3 downloads instead.
15. **Offline launch:** enable airplane mode after "Download piano for offline use" → installed app launches, full keyboard plays, takes list intact.
16. **Storage restoration:** force-quit and relaunch → last take and playhead restored; installed-app storage is separate from the browser tab (verify and note).
17. **Install flows:** Android/desktop prompt installs with correct icon; iOS Add-to-Home-Screen icon and standalone launch look right.
18. **Update flow:** deploy a new build → "update available" appears in Settings and applies only on request, never during recording.
