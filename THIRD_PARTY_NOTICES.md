# Third-party notices

PoKeyBoard bundles the following third-party assets and libraries.

## Salamander Grand Piano v3 (piano samples)

- **Author:** Alexander Holm
- **License:** Creative Commons Attribution 3.0 Unported (CC-BY 3.0),
  <https://creativecommons.org/licenses/by/3.0/>
- **Source:** <https://github.com/sfzinstruments/SalamanderGrandPiano>
  (original distribution: <https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html>)
- **Files:** `public/piano/salamander-grand-v1/*.sample` (MP3 audio; the
  neutral extension keeps download managers from intercepting sample fetches)
- **Modifications:** subset of the original 16 velocity layers (layers 5, 10,
  and 15) across the 30 minor-third root pitches; converted from 48 kHz/24-bit
  FLAC to 48 kHz mono MP3 at 128 kbps; trimmed to 7–12 seconds with a fade-out
  (see `scripts/build-sample-pack.mjs` for the exact pipeline).

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

## Reverb impulse response

The room reverb impulse response is generated procedurally at runtime
(`src/audio/PianoGraphFactory.ts`); no third-party audio is used.
