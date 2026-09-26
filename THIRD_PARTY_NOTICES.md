# Third-party notices

PoKeyBoard bundles the following third-party assets and libraries.

## Salamander Grand Piano v3 (piano samples)

- **Author:** Alexander Holm
- **License:** Creative Commons Attribution 3.0 Unported (CC-BY 3.0),
  <https://creativecommons.org/licenses/by/3.0/>
- **Source:** <https://github.com/sfzinstruments/SalamanderGrandPiano>
  (original distribution: <https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html>)
- **Files:** `public/piano/salamander-grand-v3/*.sample` (FLAC audio; the
  neutral extension keeps download managers from intercepting sample fetches,
  and browsers decode from the bytes rather than the extension). The superseded
  `public/piano/salamander-grand-v2/*.sample` pack (mono MP3) is retained so
  already-published URLs never 404 for clients still on the old app shell.
- **Modifications:** subset of the original 16 velocity layers (layers 5, 10,
  and 15) across the 30 minor-third root pitches; kept at the source's 48 kHz
  and stereo, with the 24-bit source reduced to 16-bit using triangular dither;
  encoded as FLAC; trimmed to 7–12 seconds with a fade-out (see
  `scripts/build-sample-pack.mjs` for the exact pipeline).

Attribution is also shown in the app's About view.

## Headroom Piano (piano samples)

- **Author:** Bengt Nilsson (Yamaha C3 grand); SFZ mapping by kinwie
- **License:** Creative Commons Attribution 4.0 International (CC-BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>
- **Source:** <https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano>
- **Files:** `public/piano/headroom-grand-v2/*.sample` (FLAC audio under the same
  neutral extension as the Salamander pack). The superseded
  `public/piano/headroom-grand-v1/*.sample` pack (mono MP3) is retained so
  already-published URLs never 404 for clients still on the old app shell.
- **Modifications:** subset of the original 5 velocity levels (LEVEL1, LEVEL3,
  and LEVEL5) across the 30 minor-third root pitches, close-mic position only
  (the Decca Tree position is not shipped); kept at the source's 44.1 kHz,
  16-bit and stereo — no resampling and no channel downmix — and re-encoded as
  FLAC; trimmed to 7–12 seconds with a fade-out (dithered, because the fade
  itself requantizes); a per-layer gain is applied at playback time so the pack
  sits at the Salamander pack's loudness (see `scripts/build-sample-pack.mjs`
  for the exact pipeline and the measured values in the pack's `manifest.json`).

Attribution is also shown in the app's About view.

## bitKlavier Grand Sample Library — Lip Cardioid Mic Image (piano samples)

- **Title:** bitKlavier Grand Sample Library—Lip Cardioid Mic Image
- **Authors:** Matthew Wang, Andrés Villalta, Jeffrey Gordon, Katie Chou,
  Christien Ayers and Daniel Trueman, Princeton University. A new Steinway D
  concert grand in Taplin Auditorium, Princeton, recorded in January 2021 with
  the lid fully open; the Lip Cardioid image is a pair of DPA 4011 cardioids at
  the lip of the lid.
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>
- **Source:** Princeton Data Commons, DOI
  [10.34770/xm18-yr83](https://doi.org/10.34770/xm18-yr83), the 48 kHz / 24-bit
  release.
- **Files:** `public/piano/bitklavier-grand-v1/*.sample` (FLAC audio under the
  same neutral extension as the other packs).
- **Modifications:** subset of the original 16 velocity layers (layers 7, 10
  and 14) across the 30 minor-third root pitches; the hammer-release,
  release-resonance and pedal samples are not used; each recording trimmed to
  7–12 seconds with a 1.5-second fade-out; a gain applied to each layer
  (+7.11, +5.80 and +0.33 dB) that brings it toward the Salamander pack's
  loudness without letting any sample exceed −1 dBFS; reduced from 24 to 16
  bits with triangular dither and encoded as FLAC, keeping the source's 48 kHz
  and stereo. See `scripts/build-sample-pack.mjs` and
  `scripts/lib/bitklavier.mjs` for the exact pipeline, and
  `scripts/lib/bitklavier-grand-v1.pins.json` for the size and SHA-256 of every
  source byte range used.

Attribution, with links to the dataset and the license, is also shown in the
app's About view.

## Wurlitzer EP203W (electric piano samples)

- **Author:** Greg Sullivan; SFZ mapping by kinwie.
- **License:** Creative Commons Attribution 3.0 Unported (CC BY 3.0),
  <https://creativecommons.org/licenses/by/3.0/>. The full license is included
  in `public/piano/wurlitzer-ep203w-v1/LICENSE.txt`.
- **Source:** <https://github.com/sfzinstruments/GregSullivan.E-Pianos>, revision
  `8c3e581acda3594b553948ff0222d4f84a698376`, Wurlitzer EP200 directory.
  Greg recorded his own EP203W, a member of the EP200 family.
- **Files:** `public/piano/wurlitzer-ep203w-v1/*.sample`, 42 original mono,
  44.1 kHz, 16-bit FLAC recordings. Audio bytes are unchanged; only the file
  extension is renamed. Source loop points are extracted into the manifest.
- **Adaptations:** SFZ note/velocity regions, tuning and gain corrections
  converted to a web manifest; outer regions extended to A0–C8; a shared
  1 ms attack, 5 s hold, 25 s linear decay and 100 ms release envelope; v²
  velocity response and one measured pack gain. No added effects or sample
  trimming. Builds use `node scripts/build-sample-pack.mjs wurlitzer-ep203w-v1`.

Attribution and source/license links are also shown in the app's About view.

## LAME MP3 encoder (via wasm-media-encoders)

- **Package:** `wasm-media-encoders` (MIT license) bundling the LAME MP3
  encoder compiled to WebAssembly
- **LAME license:** GNU Lesser General Public License (LGPL),
  <https://lame.sourceforge.io/>
- **Use:** client-side MP3 encoding of exported takes; the encoder runs
  locally in a Web Worker and is not modified.

## pdf-lib

- **Package:** `pdf-lib` (MIT license), <https://pdf-lib.js.org/>
- **Use:** client-side assembly of the sheet-music PDF export; pages are
  rendered locally to canvas and embedded as images. The library is loaded
  on demand (code-split) and is not modified.

## Fraunces (display typeface)

- **Author:** Undercase Type (Phaedra Charles, Flavia Zimbardi)
- **License:** SIL Open Font License 1.1 (OFL),
  <https://openfontlicense.org/>
- **Source:** <https://github.com/undercasetype/Fraunces>, bundled via the
  `@fontsource/fraunces` npm package (latin 600 subset only)
- **Use:** display headings and titles; served self-hosted and precached by
  the service worker for offline use. The font is not modified.

## Reverb impulse response

The reverb's room impulse responses are generated procedurally at runtime
(`src/audio/reverbImpulse.ts`); no third-party audio is used.
