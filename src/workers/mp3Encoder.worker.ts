import { createMp3Encoder } from 'wasm-media-encoders';

/**
 * MP3 encoding off the main thread. PCM arrives as transferred ArrayBuffers
 * (never cloned); the finished MP3 transfers back the same way.
 */
/** The only bitrates the app offers; matches the encoder's CBR union type. */
export type ExportBitrateKbps = 128 | 192;

export interface EncodeRequest {
  type: 'encode';
  sampleRate: number;
  bitrateKbps: ExportBitrateKbps;
  left: ArrayBuffer;
  right: ArrayBuffer;
}

export type EncoderResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; mp3: ArrayBuffer }
  | { type: 'error'; message: string };

const CHUNK_SAMPLES = 96_000; // ~2s at 48kHz per progress tick

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: EncoderResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const data = event.data;
  if (data.type !== 'encode') return;
  void encode(data).catch((error: unknown) => {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function encode(request: EncodeRequest): Promise<void> {
  const encoder = await createMp3Encoder();
  encoder.configure({
    sampleRate: request.sampleRate,
    channels: 2,
    bitrate: request.bitrateKbps,
  });

  const left = new Float32Array(request.left);
  const right = new Float32Array(request.right);
  const total = left.length;
  const parts: Uint8Array[] = [];

  for (let offset = 0; offset < total; offset += CHUNK_SAMPLES) {
    const end = Math.min(total, offset + CHUNK_SAMPLES);
    const chunk = encoder.encode([left.subarray(offset, end), right.subarray(offset, end)]);
    if (chunk.length > 0) parts.push(chunk.slice());
    scope.postMessage({ type: 'progress', fraction: end / total });
  }
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
  scope.postMessage({ type: 'done', mp3: out.buffer }, [out.buffer]);
}
