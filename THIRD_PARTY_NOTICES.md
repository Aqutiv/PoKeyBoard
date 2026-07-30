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

The room reverb impulse response is generated procedurally at runtime
(`src/audio/PianoGraphFactory.ts`); no third-party audio is used.
