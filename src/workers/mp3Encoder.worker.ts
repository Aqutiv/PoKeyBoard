import type { ClickTrack, LoudnessMode } from '@/audio/loudness';
import { finishMp3, type ExportBitrateKbps } from '@/audio/mp3Encode';

/**
 * Mastering and MP3 encoding off the main thread. PCM arrives as transferred
 * ArrayBuffers (never cloned); the finished MP3 transfers back the same way.
 * The work lives in the shared, isomorphic finishMp3 so the main-thread
 * fallback in AudioExportService runs identical code.
 */
export interface EncodeRequest {
  type: 'encode';
  sampleRate: number;
  bitrateKbps: ExportBitrateKbps;
  left: ArrayBuffer;
  right: ArrayBuffer;
  /** Small enough to copy; only the PCM is transferred. */
  clicks: ClickTrack | null;
  loudness: LoudnessMode;
}

export type EncoderResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; mp3: ArrayBuffer }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: EncoderResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const data = event.data;
  if (data.type !== 'encode') return;
  void run(data).catch((error: unknown) => {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function run(request: EncodeRequest): Promise<void> {
  const out = await finishMp3(
    {
      sampleRate: request.sampleRate,
      left: new Float32Array(request.left),
      right: new Float32Array(request.right),
      clicks: request.clicks,
      loudness: request.loudness,
    },
    request.bitrateKbps,
    (fraction) => scope.postMessage({ type: 'progress', fraction }),
  );
  const mp3 = out.buffer as ArrayBuffer;
  scope.postMessage({ type: 'done', mp3 }, [mp3]);
}
