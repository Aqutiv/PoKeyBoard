import { getCachedAudio, invalidateCachedAudio, putCachedAudio } from '@/data/audioCacheRepository';
import { persistenceService } from '@/data/persistence';
import { computeExportHash } from '@/domain/takeHash';
import type { Take } from '@/domain/takeTypes';
import { ExportError } from '@/utils/errors';
import { takeAudioFileName } from '@/utils/filenames';
import type { EncoderResponse } from '@/workers/mp3Encoder.worker';
import { encodePcmToMp3, type ExportBitrateKbps } from './mp3Encode';
import { renderTakeToBuffer } from './OfflineTakeRenderer';
import { effectivePlaybackDurationMs } from '@/features/transport/sustainPedal';

export const AUDIO_EXPORTER_VERSION = 2;

export type ExportQuality = 'share' | 'high';

export const QUALITY_BITRATE: Record<ExportQuality, ExportBitrateKbps> = {
  share: 128,
  high: 192,
};

export interface ExportOptions {
  quality: ExportQuality;
  includeMetronome: boolean;
  metronomeVolume: number;
}

export type ExportStage = 'saving' | 'rendering' | 'encoding';

export interface ExportProgress {
  stage: ExportStage;
  /** 0..1, or -1 for indeterminate stages. */
  fraction: number;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  hash: string;
  durationMs: number;
  sizeBytes: number;
  fromCache: boolean;
}

export class ExportCancelledError extends ExportError {
  constructor() {
    super('Export cancelled', 'Export cancelled.', 'exportCancelled');
  }
}

interface ActiveExportJob {
  cancelled: boolean;
  controller: AbortController;
  cancellation: Promise<never>;
  rejectCancellation: ((error: ExportCancelledError) => void) | null;
  worker: Worker | null;
  rejectWorker: ((error: ExportCancelledError) => void) | null;
}

/**
 * The full export pipeline: snapshot+save → offline render → worker MP3
 * encode → validate → cache under a deterministic hash. Cached results are
 * reused only while the hash still matches.
 */
class AudioExportService {
  private activeJob: ActiveExportJob | null = null;

  async exportTake(
    take: Take,
    options: ExportOptions,
    onProgress: (progress: ExportProgress) => void,
  ): Promise<ExportResult> {
    if (this.activeJob) {
      throw new ExportError(
        'An audio export is already running',
        'Wait for the current export to finish or cancel it first.',
        'exportFailed',
      );
    }
    const job = this.createJob();
    this.activeJob = job;
    try {
      const bitrateKbps = QUALITY_BITRATE[options.quality];
      const hash = await this.awaitJob(
        job,
        computeExportHash({
          take,
          exporterVersion: AUDIO_EXPORTER_VERSION,
          bitrateKbps,
          includeMetronome: options.includeMetronome,
          metronomeVolume: options.metronomeVolume,
        }),
      );
      const fileName = takeAudioFileName(take.title);

      const cached = await this.awaitJob(job, getCachedAudio(take.id));
      if (cached && cached.hash === hash) {
        return {
          blob: cached.blob,
          fileName,
          hash,
          durationMs: effectivePlaybackDurationMs(take),
          sizeBytes: cached.blob.size,
          fromCache: true,
        };
      }

      onProgress({ stage: 'saving', fraction: -1 });
      await this.awaitJob(job, persistenceService.flushSaveOrThrow());

      onProgress({ stage: 'rendering', fraction: -1 });
      const buffer = await this.awaitJob(
        job,
        renderTakeToBuffer(take, {
          includeMetronome: options.includeMetronome,
          metronomeVolume: options.metronomeVolume,
        }),
      );

      onProgress({ stage: 'encoding', fraction: 0 });
      const mp3 = await this.awaitJob(
        job,
        this.encode(job, buffer, bitrateKbps, (fraction) =>
          onProgress({ stage: 'encoding', fraction }),
        ),
      );

      const blob = new Blob([mp3], { type: 'audio/mpeg' });
      const minimumPlausible = Math.max(2_000, (buffer.duration * bitrateKbps * 1000 * 0.3) / 8);
      if (blob.size < minimumPlausible) {
        throw new ExportError(
          `Encoded MP3 implausibly small (${blob.size} bytes)`,
          'Encoding produced an invalid file. Please try again.',
          'exportEncodingInvalid',
        );
      }

      await this.awaitJob(
        job,
        putCachedAudio({
          takeId: take.id,
          hash,
          blob,
          mimeType: 'audio/mpeg',
          fileName,
          createdAt: new Date().toISOString(),
        }),
      );

      return {
        blob,
        fileName,
        hash,
        durationMs: effectivePlaybackDurationMs(take),
        sizeBytes: blob.size,
        fromCache: false,
      };
    } finally {
      if (this.activeJob === job) this.activeJob = null;
      job.rejectCancellation = null;
      job.rejectWorker = null;
      job.worker?.terminate();
      job.worker = null;
    }
  }

  cancel(): void {
    const job = this.activeJob;
    if (!job || job.cancelled) return;
    job.cancelled = true;
    job.controller.abort();
    const error = new ExportCancelledError();
    const rejectCancellation = job.rejectCancellation;
    job.rejectCancellation = null;
    rejectCancellation?.(error);
    const rejectWorker = job.rejectWorker;
    job.rejectWorker = null;
    rejectWorker?.(error);
    job.worker?.terminate();
    job.worker = null;
  }

  async deleteCachedExport(takeId: string): Promise<void> {
    await invalidateCachedAudio(takeId);
  }

  private createJob(): ActiveExportJob {
    let rejectCancellation: ((error: ExportCancelledError) => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    return {
      cancelled: false,
      controller: new AbortController(),
      cancellation,
      rejectCancellation,
      worker: null,
      rejectWorker: null,
    };
  }

  private async awaitJob<T>(job: ActiveExportJob, operation: Promise<T>): Promise<T> {
    if (job.cancelled) throw new ExportCancelledError();
    return Promise.race([operation, job.cancellation]);
  }

  /**
   * Encode the rendered buffer to MP3. The Web Worker is the fast path (keeps
   * the UI responsive); if it can't be constructed, crashes, or errors — which
   * happens when a background/suspended tab kills the worker mid-compile, or on
   * browsers with flaky module-worker support — we fall back to encoding on the
   * main thread with the identical encoder. The worker is an optimization, not
   * a requirement, so export never dies just because the worker did.
   */
  private async encode(
    job: ActiveExportJob,
    buffer: AudioBuffer,
    bitrateKbps: ExportBitrateKbps,
    onFraction: (fraction: number) => void,
  ): Promise<ArrayBuffer> {
    try {
      return await this.encodeViaWorker(job, buffer, bitrateKbps, onFraction);
    } catch (workerError) {
      if (job.cancelled) throw new ExportCancelledError();
      console.error('[export] MP3 worker failed, falling back to main thread:', workerError);
      try {
        // Worker transfers detach the PCM buffers; re-extract from the buffer.
        const { left, right } = extractStereoPcm(buffer);
        const out = await encodePcmToMp3(
          buffer.sampleRate,
          bitrateKbps,
          left,
          right,
          onFraction,
          job.controller.signal,
        );
        return out.buffer as ArrayBuffer;
      } catch (fallbackError) {
        if (job.cancelled || job.controller.signal.aborted) throw new ExportCancelledError();
        const reason =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new ExportError(
          `MP3 encode failed on worker and main thread: ${reason}`,
          `Audio export failed: ${reason}`,
          'exportFailed',
          { cause: fallbackError },
        );
      }
    }
  }

  /** Encode via the Web Worker; rejects on construction, crash, or error. */
  private encodeViaWorker(
    job: ActiveExportJob,
    buffer: AudioBuffer,
    bitrateKbps: ExportBitrateKbps,
    onFraction: (fraction: number) => void,
  ): Promise<ArrayBuffer> {
    // Transfer channel copies; the AudioBuffer itself stays untouched.
    const { left, right } = extractStereoPcm(buffer);

    return new Promise<ArrayBuffer>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../workers/mp3Encoder.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (constructError) {
        reject(
          new Error(
            `MP3 worker could not be created: ${
              constructError instanceof Error ? constructError.message : String(constructError)
            }`,
          ),
        );
        return;
      }
      job.worker = worker;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        worker.terminate();
        if (job.worker === worker) job.worker = null;
        job.rejectWorker = null;
      };
      job.rejectWorker = (error) => {
        cleanup();
        reject(error);
      };
      worker.onmessage = (event: MessageEvent<EncoderResponse>) => {
        if (job.cancelled || job.worker !== worker) return;
        const message = event.data;
        if (message.type === 'progress') {
          onFraction(message.fraction);
        } else if (message.type === 'done') {
          cleanup();
          resolve(message.mp3);
        } else {
          cleanup();
          reject(new Error(`MP3 encoder reported: ${message.message}`));
        }
      };
      worker.onerror = (event) => {
        if (job.cancelled || job.worker !== worker) return;
        cleanup();
        reject(new Error(`MP3 worker crashed: ${event.message || 'unknown error'}`));
      };
      worker.postMessage(
        {
          type: 'encode',
          sampleRate: buffer.sampleRate,
          bitrateKbps,
          left: left.buffer,
          right: right.buffer,
        },
        [left.buffer, right.buffer],
      );
    });
  }
}

function extractStereoPcm(buffer: AudioBuffer): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(buffer.length);
  const right = new Float32Array(buffer.length);
  buffer.copyFromChannel(left, 0);
  buffer.copyFromChannel(right, buffer.numberOfChannels > 1 ? 1 : 0);
  return { left, right };
}

export const audioExportService = new AudioExportService();
