# PoKeyBoard

**▶ Live app: https://aqutiv.github.io/PoKeyBoard/**

Play, record, and share piano performances — entirely in your browser. PoKeyBoard is an installable, offline-capable Progressive Web App: a sample-based grand piano with a multi-touch keyboard, computer-keyboard, game-controller and USB MIDI input, live grand-staff notation, a metronome, structured note-event recording, audible score scrubbing, and one-tap MP3 sharing through the OS share sheet (WhatsApp, Messages, email, …).

No account. No backend. No microphone — "recording" captures the notes you play, and "audio export" re-renders them through the same piano engine into a real MP3.

## Quick start

Requires Node 20.19+ or 22.12+ (Node 24 used in development) and npm.

```bash
npm install
npm run dev        # http://localhost:5173
```

The piano sample packs ship in `public/piano/` (committed) — one directory per selectable piano. To regenerate one from its upstream sources you need `ffmpeg` on PATH:

```bash
node scripts/build-sample-pack.mjs salamander-grand-v3   # Yamaha C5, the default piano
node scripts/build-sample-pack.mjs headroom-grand-v2     # Yamaha C3, the warmer alternative
node scripts/build-icons.mjs                             # PWA icons from assets/branding
```

Each run downloads the FLAC subset it needs into the gitignored `samples-staging/`, converts to stereo 16-bit FLAC (`.sample` files), and measures the pack's loudness against the default piano so the two match in the app. Build the default piano first — it is the reference the others are matched against. Re-running over an already-built pack is a no-op — it downloads nothing and leaves the working tree clean.

## Commands

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Vite dev server (no service worker)                 |
| `npm run build`     | Type-check + production build to `dist/`            |
| `npm run preview`   | Serve the production build at http://localhost:4173 |
| `npm run test`      | Unit tests (Vitest)                                 |
| `npm run test:e2e`  | Playwright end-to-end tests (builds first)          |
| `npm run lint`      | ESLint                                              |
| `npm run typecheck` | TypeScript project check                            |
| `npm run format`    | Prettier write / `format:check` to verify           |

## HTTPS requirement

Service workers, installation, `navigator.share`, and persistent storage all require a **secure context**. `localhost` counts; any other host must be HTTPS. To test on a phone against your dev machine, either use a tunneling tool that provides HTTPS or deploy the `dist/` build to any static HTTPS host.

## Testing on a phone

1. `npm run build && npm run preview -- --host` and open `http://<your-ip>:4173` **only for quick layout checks** (no SW on plain http), or deploy to an HTTPS host for the full experience.
2. First visit online; the app shell caches automatically.
3. Settings → **Piano** → **Download Salamander** (or **Download Headroom**) to pin a full sample pack — each piano card downloads on its own.

## Installing

- **iPhone / iPad (Safari):** Share menu → **Add to Home Screen**. iOS has no programmatic install prompt. Open the installed icon before creating important takes — the installed app may use a separate storage area from the Safari tab.
- **Android (Chrome):** accept the install prompt, or browser menu → _Add to Home screen_.
- **Desktop (Chrome/Edge):** the install icon in the address bar, or Settings → App inside the app when the browser offers it.

## Offline behavior

- The app shell (HTML/JS/CSS/icons/fonts, ~2.0 MB) is precached on first visit — the app starts with no connection.
- Piano samples load on demand and are runtime-cached as you play. For guaranteed full-range offline playing, use the **Download** button on a piano card in Settings → **Piano** (~24-28 MB per piano, downloaded and deleted independently, without touching takes).
- Updates download in the background and apply only when you choose (Settings → App) — never mid-recording.

## Your data

- Takes are stored locally in this browser profile (IndexedDB), autosaved while you work, and restored (including the playhead) on the next visit.
- After your first real take the app requests **persistent storage**; Settings shows whether it was granted and current usage.
- **Backups:** Takes → _Backup all takes_ writes a single JSON with every take and your settings; _Restore backup_ merges it back (colliding ids become copies). Individual takes export/import as `*.pokeyboard.json`.
- Cross-device sync is not part of version 1 — move takes with JSON files.

## Sharing audio

Open a take → **Share audio** → _Render audio_. The take renders offline through the same piano engine (never the microphone) and encodes to MP3 (128 or 192 kbps) in a Web Worker. Where the browser supports sharing files (iOS/Android), the OS share sheet opens with compatible apps — WhatsApp appears if it's installed; PoKeyBoard never assumes it is. Elsewhere the MP3 downloads. Unchanged takes reuse their cached MP3 instantly.

## Browser support

Core app: current Safari (iPhone/iPad), Chrome (Android/Windows/macOS/Linux), Edge (Windows). Optional APIs (install prompt, file sharing, persistent storage, wake lock, File System Access) are feature-detected — Settings → Diagnostics shows what this browser provides. Desktop Firefox works as a normal website (share falls back to download).

## Known limitations

- Audio pauses when the app goes to the background by default. Settings can opt recorded-take playback into continuing while minimized or unfocused (device power policies may still stop it); recordings always finalize and save safely.
- iPhone mutes web audio while the ring/silent switch is on silent; PoKeyBoard applies the standard media-session workaround, but if you hear nothing, check the switch.
- One sustain-pedal timeline (no half-pedaling), single instrument, no cloud sync in v1.
- MIDI input needs Web MIDI (Chrome, Edge and Opera, on desktop and Android; not Safari or Firefox) and is off until you enable it in Settings → **Playing**, which is what raises the browser's permission prompt. Every connected input plays, from any tab rather than only from Play; pitch bend shifts the visible keys and CC7 moves the master volume, since a sampled piano has no pitch to bend.
- MusicXML import (Takes → _Import_ → _Music score (MXL)_, `.mxl`/`.musicxml`/`.xml`) is one-way: scores become playable takes, but repeats/ornaments are not expanded and there is no MusicXML export.
- Importing from a link — Takes → _Import_ → _From a link (URL)_, or dragging a link straight onto the Takes screen — only works when the hosting site allows downloads from other origins. Raw GitHub, gists and jsDelivr do; most file-sharing and publisher pages do not. There is no proxy — a static host cannot have one — so when a link is refused, download the file and use the file picker instead.
- Very long takes (over ~8 minutes) warn before export; renders are capped at 20 minutes to protect memory.

## Deployment

Any static HTTPS host works. `POKEYBOARD_BASE=/subpath/ npm run build` produces a build rooted at a subpath (manifest, service-worker scope, and asset URLs all follow). See [DEPLOYMENT.md](DEPLOYMENT.md) for the checklist and caching-header table, and `.github/workflows/ci.yml` for the reference pipeline.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [TAKE_FORMAT.md](TAKE_FORMAT.md) · [AUDIO_EXPORT.md](AUDIO_EXPORT.md) · [PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md) · [TESTING.md](TESTING.md) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
