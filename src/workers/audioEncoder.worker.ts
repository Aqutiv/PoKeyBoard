import { finishExport } from '@/audio/exportEncode';
import type { ExportEncoding } from '@/audio/exportFormats';
import type { ClickTrack, LoudnessMode } from '@/audio/loudness';

/**
 * Mastering and encoding, MP3 or FLAC, off the main thread. PCM arrives as
 * transferred ArrayBuffers (never cloned); the finished file transfers back
 * the same way, in the parts it was written in. The work lives in
 * exportEncode, shared with the main-thread fallback in AudioExportService,
 * which runs the same code a slice at a time.
 */
export interface EncodeRequest {
  type: 'encode';
  encoding: ExportEncoding;
  sampleRate: number;
  left: ArrayBuffer;
  right: ArrayBuffer;
  /** Small enough to copy; only the PCM is transferred. */
  clicks: ClickTrack | null;
  loudness: LoudnessMode;
}

export type EncoderResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; parts: ArrayBuffer[] }
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
  const out = await finishExport(
    {
      sampleRate: request.sampleRate,
      left: new Float32Array(request.left),
      right: new Float32Array(request.right),
      clicks: request.clicks,
      loudness: request.loudness,
    },
    request.encoding,
    (fraction) => scope.postMessage({ type: 'progress', fraction }),
  );
  const parts = out.map((part) => part.buffer);
  scope.postMessage({ type: 'done', parts }, parts);
}
