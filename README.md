# PoKeyBoard

**▶ Live app: https://aqutiv.github.io/PoKeyBoard/**

Play, record, and share piano performances — entirely in your browser. PoKeyBoard is an installable, offline-capable Progressive Web App: sampled acoustic and electric pianos with a multi-touch keyboard, computer-keyboard, game-controller and USB MIDI input, live grand-staff notation, a metronome, structured note-event recording, audible score scrubbing, and one-tap sharing through the OS share sheet (WhatsApp, Messages, email, …) as an MP3 or lossless FLAC, printable sheet music or a MIDI file.

No account. No backend. No microphone — "recording" captures the notes you play, and "audio export" re-renders them through the same piano engine into a real MP3 or FLAC.

## Quick start

Requires Node 20.19+ or 22.12+ (Node 24 used in development) and npm.

```bash
npm install
npm run dev        # http://localhost:5173
```

The piano sample packs ship in `public/piano/` (committed) — one directory per selectable piano. To regenerate one from its upstream sources you need `ffmpeg` on PATH:

```bash
node scripts/build-sample-pack.mjs salamander-grand-v4   # Yamaha C5, the default piano
node scripts/build-sample-pack.mjs headroom-grand-v2     # Yamaha C3, the warmer alternative
node scripts/build-sample-pack.mjs bitklavier-grand-v2   # Steinway D (bitKlavier, Lip Cardioid)
node scripts/build-sample-pack.mjs wurlitzer-ep203w-v1   # Wurlitzer EP203W electric piano
node scripts/build-icons.mjs                             # PWA icons from assets/branding
```

Acoustic pack builds download the recordings they need into the gitignored `samples-staging/`, convert to stereo 16-bit FLAC (`.sample` files), and measure loudness against the default piano. Build the default piano first — it is the reference the others are matched against. Re-running over an already-built pack is a no-op — it downloads nothing and leaves the working tree clean. A pack that adds a layer to an earlier generation of its piano re-uses that generation's published files rather than rebuilding them: Salamander's v4 and the Steinway's v2 add a pianissimo layer to v3's and v1's three.

The bitKlavier pack fetches only the part of each 48 kHz / 24-bit WAV it keeps, by HTTP Range, and checks every fetch against the sizes and SHA-256 hashes in its pins, stopping on any mismatch (`--pin` rewrote them from what upstream served): `scripts/lib/bitklavier-grand-v2.pins.json` for the pianissimo layer, and `bitklavier-grand-v1.pins.json` for the three it re-uses from v1. Its layers are raised toward Salamander's level before the 16-bit quantisation, never past −1 dBFS, so the app's later gain does not lift the dither floor.

The Wurlitzer pack preserves all 42 original mono FLAC recordings (2.39 MB), four velocity layers, tuning, and embedded sustain loops. Its upstream revision is pinned; only the file extension changes. A single gain matches its level to Salamander, and its outer sample regions extend to the app's full A0–C8 range. Live playback and MP3 exports share the same loop and envelope scheduler.

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
3. Settings → **Sound** → the download button on **Salamander**'s card (or **Headroom**'s / **Steinway**'s / **Wurlitzer**'s), which shows the pack's size, to pin a full sample pack — each piano card downloads on its own.

## Installing

- **iPhone / iPad (Safari):** Share menu → **Add to Home Screen**. iOS has no programmatic install prompt. Open the installed icon before creating important takes — the installed app may use a separate storage area from the Safari tab.
- **Android (Chrome):** accept the install prompt, or browser menu → _Add to Home screen_.
- **Desktop (Chrome/Edge):** the install icon in the address bar, or Settings → App inside the app when the browser offers it.

## Offline behavior

- The app shell (HTML/JS/CSS/icons/fonts, ~2.0 MB) is precached on first visit — the app starts with no connection.
- Piano samples load on demand and are runtime-cached as you play. For guaranteed full-range offline playing, use the download button on a piano's card in Settings → **Sound** (~24–28 MB per acoustic piano, 2.39 MB for Wurlitzer, downloaded and deleted independently, without touching takes).
- Updates download in the background and apply only when you choose (Settings offers them above its sections) — never mid-recording.

## Your data

- Takes are stored locally in this browser profile (IndexedDB), autosaved while you work, and restored (including the playhead) on the next visit.
- After your first real take the app requests **persistent storage**; Settings → App shows whether it was granted and current usage.
- **Backups:** Takes → _Backup all takes_ writes a single JSON with every take and your settings; _Restore backup_ merges it back (colliding ids become copies). Individual takes export/import as `*.pokeyboard.json`.
- Cross-device sync is not part of version 1 — move takes with JSON files.

## Daily listening and practice

- On desktop, **Play** includes piano selection and **Piano volume** beside the metronome. **Click volume** controls the metronome independently.
- Changing piano never stops the music: the piano playing carries on while the new one loads — a ring runs round the picker (or the piano's card in Settings → Sound) as it does — and the new one takes over from the next note, mid-phrase. Notes already ringing finish on the piano they began on. Record waits the moment it takes for the new piano to be ready; if it cannot be loaded, the previous piano stays chosen and says so.
- During playback the keyboard lights every note the take plays, each hand in its own shade, and slides to wherever the music is — a glow at the edge marks notes still off the keys. Turn the sliding off in Settings → **Display** (**Keyboard follows playback**); it also waits a few seconds after you move the keyboard yourself, and never moves under a key you are holding.
- Lit keys show how hard each note is played: a soft note lights its key with a pale wash of its hand's colour, a loud one with the colour in full. That holds for the take's notes and for the ones you play yourself — by touch, mouse, computer keyboard, game controller or MIDI — and for the falling notes. Turn it off in Settings → **Display** (**Velocity shading on keys and falling notes**) to light every note alike.
- **Falling notes:** the switch at the top of Play (**Notation | Falling notes**) shows the take's notes falling onto the keys instead of the score. Each note is a bar standing over its key, as long as the key is held, and reaches the key just as it lights — in its hand's colour, as deep as it is played. The bars move with the keyboard, go round an A–B loop with a dashed line where it starts again, and mark notes off either end of the keys at that edge. They take three seconds to fall at any playback speed: **−** and **+** in the corner (or Ctrl/⌘ + the mouse wheel, or a pinch on a trackpad or a phone) choose anything from one second to eight, and that is remembered too. Drag the notes up or down to scrub through the take, as the score scrubs sideways. Faint lines mark where each bar starts. Each bar carries its note's name, spelled as the score spells it, where there is room, following Settings → **Display** (**Note names on keys and falling notes**). Switch on **Finger numbers on falling notes** there too and each bar carries the finger that plays it, numbered from the thumb in both hands (thumb 1, little finger 5): the score's own where it prints one, as the library's fingered editions do, and otherwise one worked out to suit the hand. With names on as well, the name stands over the number where the bar has room for both. When a Training hold waits for you, the notes it asks for glow where they meet their keys, and the glow holds still if you ask your system for less motion. The choice is remembered. With a phone on its side the notes fall over a shorter keyboard, and **Keyboard** shows the keys alone.
- Zoom the score with **−** and **+** above it, by pinching it with two fingers on a touch screen or a trackpad (Safari's included), or with Ctrl/⌘ + scroll; the zoom is kept with the take. A pinch never moves the playhead, even if the first finger had begun to scrub. Fast passages are spread out so their noteheads never touch.
- Choose **Listen**, **Practice left**, **Practice right**, or **Practice both** next to the transport, and how to practise beside it. **Wait for me** waits for you to play the highlighted notes. A note played a moment early counts, so playback carries straight on, and a key you hold into a wait keeps sounding. **Keep time** never waits: it counts you in, a bar or more, then plays on in time and leaves your hand's notes for you to play along. Where nothing else would sound, the metronome comes on to keep the beat. The style is remembered for the next hand you choose, and changing it, or the hand, during a run pauses playback. **Recording** holds Overdub/Replace; compact screens keep the combined **Modes** menu, with the style in it once a hand is chosen.
- Library remembers your filter and scroll position while you move between pages during the current session. **Clear filter** restores the full list; reloading starts a fresh search.
- While a take plays on another page, the **Now playing** bar stays visible below scrolling content and offers Pause and Stop. Pausing keeps the bar visible with Resume; stopping or reaching the end dismisses it. Select its title to return to Play.
- Paused practice offers **Return to practice** instead of Resume. Continue from Play, where the highlighted notes are visible.
- Select a personal take's title on Play to rename it. Enter saves and Escape cancels; library titles stay fixed. Takes also supports title search.
- Learn shows the available lesson count for the selected level. Expand **Upcoming lessons** to see the remaining curriculum.
- Settings comes in four sections — **Sound** (the pianos, volume, reverb, playback), **Playing** (touch, MIDI keyboard, game controller), **Display** (the keys, theme, language) and **App** (install, updates, storage, diagnostics, reset) — and opens on the one used last.
- A badge on Settings indicates a waiting update, which Settings offers above its sections; Settings → App shows the running build's commit and date. Updates still apply only when you choose at a safe time.

The BPM field changes the metronome and score grid, including tempo changes from a chosen bar. It does **not** change how fast recorded notes play back: the **speed** control beside the seek bar does, from 25% to 150%, without changing pitch (recording always runs at 100%). **A–B** repeats a passage: tap it as the passage starts and again as it ends — while playing or with the playhead parked at each end — and playback goes round it, the metronome and practice holds included, until a third tap. Both are kept with the take and never change its exported audio.

## Sharing audio

Open a take → **Share** → **Audio (MP3, FLAC)** → _Render audio_. The take renders offline through the same piano engine (never the microphone) and encodes in a Web Worker to MP3 (128 or 192 kbps) or to lossless FLAC (16- or 24-bit, several times the size). Where the browser supports sharing files (iOS/Android), the OS share sheet opens with compatible apps — WhatsApp appears if it's installed; PoKeyBoard never assumes it is. Elsewhere the file downloads. Unchanged takes reuse their cached MP3 instantly, and the dialog remembers the format, quality and level you chose last.

Every export leaves at the same loudness — −16 LUFS, the level music apps play at — with its loudest moments held just under full scale, so a quiet take is easy to hear on a phone and a loud one never clips. Choose _As played_ to keep a pianissimo quiet instead. Files are tagged with the take's title (and a library track's composer), so a music player shows more than a file name.

**Share → MIDI (.mid)** hands over the notes themselves, for a notation editor, a DAW or another piano app: tempo changes, meter and key, each hand on a track of its own, and the pedal.

**Share → Link…** puts the whole take in a link — compressed into the part after `#`, which a browser never sends to a server, so nothing is uploaded; anyone with the link can open it. Opening one shows the same preview as an imported file, and nothing is saved until you choose _Import_. A Library piece gets a short link that just names it. Most takes fit in a few thousand characters; past 32,000 the dialog warns that some apps cut long links, and the very longest go as a file instead. See [TAKE_FORMAT.md](TAKE_FORMAT.md#share-links).

## Browser support

Core app: current Safari (iPhone/iPad), Chrome (Android/Windows/macOS/Linux), Edge (Windows). Optional APIs (install prompt, file sharing, persistent storage, wake lock, File System Access) are feature-detected — Settings → App → **Device details** shows what this browser provides. Desktop Firefox works as a normal website (share falls back to download).

## Known limitations

- Audio pauses when the app goes to the background by default. Settings → Sound can opt recorded-take playback into continuing while minimized or unfocused (device power policies may still stop it); recordings always finalize and save safely.
- iPhone mutes web audio while the ring/silent switch is on silent; PoKeyBoard applies the standard media-session workaround, but if you hear nothing, check the switch.
- One sustain-pedal timeline (no half-pedaling), single instrument, no cloud sync in v1.
- MIDI input needs Web MIDI (Chrome, Edge and Opera, on desktop and Android; not Safari or Firefox) and is off until you enable it in Settings → **Playing**, which is what raises the browser's permission prompt. Every connected input plays, from any tab rather than only from Play; pitch bend shifts the visible keys and CC7 moves the master volume, since a sampled piano has no pitch to bend.
- MusicXML import (Takes → _Import_ → _Music score (MXL)_, `.mxl`/`.musicxml`/`.xml`) is one-way: scores become playable takes, but repeats/ornaments are not expanded and there is no MusicXML export.
- MIDI import (Takes → _Import_ → _MIDI file (.mid)_, `.mid`/`.midi`) reads types 0 and 1; a type 2 file or one timed in SMPTE frames has to be saved again as type 0 or 1. A file carries no spelling, voices or tuplets, so the notation works those out as it does for a recording, and drums (channel 10) are left out. See [TAKE_FORMAT.md](TAKE_FORMAT.md#midi-import).
- Importing from a link — Takes → _Import_ → _From a link (URL)_, or dragging a link straight onto the Takes screen — only works when the hosting site allows downloads from other origins. Raw GitHub, gists and jsDelivr do; most file-sharing and publisher pages do not. There is no proxy — a static host cannot have one — so when a link is refused, download the file and use the file picker instead.
- Very long takes (over ~8 minutes) warn before export; renders are capped at 20 minutes to protect memory.

## Deployment

Any static HTTPS host works. `POKEYBOARD_BASE=/subpath/ npm run build` produces a build rooted at a subpath (manifest, service-worker scope, and asset URLs all follow). See [DEPLOYMENT.md](DEPLOYMENT.md) for the checklist and caching-header table, and `.github/workflows/ci.yml` for the reference pipeline.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [TAKE_FORMAT.md](TAKE_FORMAT.md) · [AUDIO_EXPORT.md](AUDIO_EXPORT.md) · [PWA_AND_OFFLINE.md](PWA_AND_OFFLINE.md) · [TESTING.md](TESTING.md) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
