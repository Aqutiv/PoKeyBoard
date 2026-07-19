import { createMp3Encoder } from 'wasm-media-encoders';

/** The only bitrates the app offers; matches the encoder's CBR union type. */
export type ExportBitrateKbps = 128 | 192;

/** Samples per progress tick (~2s at 48kHz); also the main-thread yield step. */
const CHUNK_SAMPLES = 96_000;

/**
 * Encode stereo Float32 PCM to an MP3 byte stream. Isomorphic: the same
 * function runs inside the Web Worker (the fast path) and on the main thread
 * (the fallback used when the worker is unavailable or gets suspended).
 *
 * Yields to the event loop between chunks so progress renders and the main
 * thread is never blocked for long stretches during the fallback.
 */
export async function encodePcmToMp3(
  sampleRate: number,
  bitrateKbps: ExportBitrateKbps,
  left: Float32Array,
  right: Float32Array,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const encoder = await createMp3Encoder();
  signal?.throwIfAborted();
  encoder.configure({ sampleRate, channels: 2, bitrate: bitrateKbps });

  const total = left.length;
  const parts: Uint8Array[] = [];

  for (let offset = 0; offset < total; offset += CHUNK_SAMPLES) {
    signal?.throwIfAborted();
    const end = Math.min(total, offset + CHUNK_SAMPLES);
    const chunk = encoder.encode([left.subarray(offset, end), right.subarray(offset, end)]);
    if (chunk.length > 0) parts.push(chunk.slice());
    onProgress?.(total === 0 ? 1 : end / total);
    // Yield so progress paints and the main-thread fallback stays responsive.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  signal?.throwIfAborted();
  const final = encoder.finalize();
  if (final.length > 0) parts.push(final.slice());

  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
