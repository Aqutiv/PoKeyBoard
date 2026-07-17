import { encodePcmToMp3, type ExportBitrateKbps } from '@/audio/mp3Encode';

/**
 * MP3 encoding off the main thread. PCM arrives as transferred ArrayBuffers
 * (never cloned); the finished MP3 transfers back the same way. The actual
 * encode lives in the shared, isomorphic encodePcmToMp3 so the main-thread
 * fallback in AudioExportService runs identical code.
 */
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
  const out = await encodePcmToMp3(
    request.sampleRate,
    request.bitrateKbps,
    new Float32Array(request.left),
    new Float32Array(request.right),
    (fraction) => scope.postMessage({ type: 'progress', fraction }),
  );
  const mp3 = out.buffer as ArrayBuffer;
  scope.postMessage({ type: 'done', mp3 }, [mp3]);
}
